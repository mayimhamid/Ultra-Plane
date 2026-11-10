/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import type {
  TDayReport,
  TDayReportRevision,
  TDayReportRowInput,
  TImportContext,
  TImportRequest,
  TImportResult,
  TMicroTask,
  TMicroTaskInput,
  TPlanUnit,
  TReportSummary,
  TTaskPlan,
  TTaskVerdict,
  TTeamDayReportRow,
} from "@plane/types";
// services
import { APIService } from "../api.service";

/** Minutes as "2h 05m", "45m" or "0m". */
export const formatMinutes = (minutes: number) => {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest}m`;
  return `${hours}h ${String(rest).padStart(2, "0")}m`;
};

/**
 * What a person types in the time box, as minutes: "1:30", "1.5", "1.5h", "90m", "2h 15m", "45". A bare number
 * up to 12 is hours, a bigger one minutes. `null` when it cannot be read.
 */
export const parseDuration = (text: string): number | null => {
  const value = text.trim().toLowerCase().replace(",", ".");
  if (!value) return null;
  const clock = value.match(/^(\d{1,2}):(\d{1,2})$/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const parts = value.match(/^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m)?$/);
  if (parts && (parts[1] || parts[2])) return Math.round(Number(parts[1] ?? 0) * 60 + Number(parts[2] ?? 0));
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return number <= 12 ? Math.round(number * 60) : Math.round(number);
};

/** Minutes between two "HH:MM" times; `null` when one is missing or the end is not after the start. */
const clockMinutes = (value: string) => {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

export const spanMinutes = (start: string, end: string): number | null => {
  const from = clockMinutes(start);
  const to = clockMinutes(end);
  if (from === null || to === null || to <= from) return null;
  return to - from;
};

/** Minutes back to the short form shown in the time box. */
export const durationText = (minutes: number) => {
  if (!minutes) return "";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}:${String(rest).padStart(2, "0")}`;
};

export const VERDICT_LABEL: Record<Exclude<TTaskVerdict, null>, string> = {
  SPEEDY: "Speedy",
  ON_TIME: "On time",
  OVERTIME: "OverTime",
  IN_PROGRESS: "In progress",
};

export const planLabel = (amount: number | null, unit: TPlanUnit) =>
  amount === null ? "No plan" : `${amount} ${unit === "DAYS" ? (amount === 1 ? "day" : "days") : "h"}`;

const unwrap = (error: unknown) => {
  throw (error as { response?: { data?: unknown } })?.response?.data;
};

export class DayReportService extends APIService {
  constructor(BASE_URL?: string) {
    super(BASE_URL || API_BASE_URL);
  }

  private base(workspaceSlug: string) {
    return `/api/workspaces/${workspaceSlug}/team-ops`;
  }

  async getReport(workspaceSlug: string, day: string, user?: string): Promise<TDayReport> {
    return this.get(`${this.base(workspaceSlug)}/day-reports/${day}/`, { params: user ? { user } : {} })
      .then((response) => response?.data)
      .catch(unwrap);
  }

  /** Saves the rows; `submit` sends the report; `reason` explains a late send or a change. */
  async saveReport(
    workspaceSlug: string,
    day: string,
    body: { entries: TDayReportRowInput[]; submit?: boolean; reason?: string }
  ): Promise<TDayReport> {
    return this.put(`${this.base(workspaceSlug)}/day-reports/${day}/`, body)
      .then((response) => response?.data)
      .catch(unwrap);
  }

  /** Adds one row to the caller's report of `day`, keeping the rows already there. */
  async addRow(workspaceSlug: string, day: string, row: TDayReportRowInput & { reason?: string }): Promise<TDayReport> {
    return this.post(`${this.base(workspaceSlug)}/day-reports/${day}/rows/`, row)
      .then((response) => response?.data)
      .catch(unwrap);
  }

  /**
   * Tells people about a task of the report: a note and files for the people (or teams) tagged. It is posted in
   * the Hub, so they are notified and keep the files.
   */
  async shareTask(
    workspaceSlug: string,
    payload: {
      task: { kind: "issue" | "micro"; id: string };
      finished: boolean;
      note: string;
      users: string[];
      files: File[];
    }
  ): Promise<{ posted: number; files: number }> {
    const form = new FormData();
    form.append(payload.task.kind === "issue" ? "issue" : "micro_task", payload.task.id);
    form.append("finished", payload.finished ? "true" : "false");
    if (payload.note.trim()) form.append("note", payload.note);
    payload.users.forEach((user) => form.append("users", user));
    payload.files.forEach((file) => form.append("files", file));
    return this.post(`${this.base(workspaceSlug)}/day-reports/share/`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getHistory(workspaceSlug: string, day: string, user?: string): Promise<TDayReportRevision[]> {
    return this.get(`${this.base(workspaceSlug)}/day-reports/${day}/history/`, { params: user ? { user } : {} })
      .then((response) => response?.data?.results ?? [])
      .catch(unwrap);
  }

  async getTeam(
    workspaceSlug: string,
    day?: string,
    place?: string
  ): Promise<{ date: string; results: TTeamDayReportRow[] }> {
    return this.get(`${this.base(workspaceSlug)}/day-reports/team/`, {
      params: { ...(day ? { date: day } : {}), ...(place ? { place } : {}) },
    })
      .then((response) => response?.data)
      .catch(unwrap);
  }

  /** What the team reported in a period: per person and day, projects and tasks. */
  async getSummary(
    workspaceSlug: string,
    params: { from: string; to: string; team?: string; place?: string; user?: string }
  ): Promise<TReportSummary> {
    return this.get(`${this.base(workspaceSlug)}/day-reports/summary/`, { params })
      .then((response) => response?.data)
      .catch(unwrap);
  }

  /** Link of the CSV of the team's report rows; `place` keeps only remote, onsite or hybrid days. */
  exportUrl(workspaceSlug: string, from: string, to: string, place?: string) {
    const query = new URLSearchParams({ from, to, ...(place ? { place } : {}) });
    return `${this.baseURL}${this.base(workspaceSlug)}/day-reports/export/?${query.toString()}`;
  }

  async getPlan(workspaceSlug: string, issueId: string): Promise<TTaskPlan> {
    return this.get(`${this.base(workspaceSlug)}/task-plans/${issueId}/`)
      .then((response) => response?.data)
      .catch(unwrap);
  }

  async setPlan(workspaceSlug: string, issueId: string, amount: number | "", unit: TPlanUnit): Promise<TTaskPlan> {
    return this.put(`${this.base(workspaceSlug)}/task-plans/${issueId}/`, { amount, unit })
      .then((response) => response?.data)
      .catch(unwrap);
  }

  async listMicroTasks(workspaceSlug: string, user?: string): Promise<TMicroTask[]> {
    return this.get(`${this.base(workspaceSlug)}/micro-tasks/`, { params: user ? { user } : {} })
      .then((response) => response?.data?.results ?? [])
      .catch(unwrap);
  }

  async createMicroTask(workspaceSlug: string, body: TMicroTaskInput): Promise<TMicroTask> {
    return this.post(`${this.base(workspaceSlug)}/micro-tasks/`, body)
      .then((response) => response?.data)
      .catch(unwrap);
  }

  async updateMicroTask(
    workspaceSlug: string,
    id: string,
    body: Partial<TMicroTaskInput> & { done?: boolean }
  ): Promise<TMicroTask> {
    return this.patch(`${this.base(workspaceSlug)}/micro-tasks/${id}/`, body)
      .then((response) => response?.data)
      .catch(unwrap);
  }

  async deleteMicroTask(workspaceSlug: string, id: string): Promise<void> {
    return this.delete(`${this.base(workspaceSlug)}/micro-tasks/${id}/`)
      .then(() => undefined)
      .catch(unwrap);
  }

  /** Names an import may use (people, and a project's modules, states and labels), for the AI prompt. */
  async getImportContext(workspaceSlug: string, project?: string): Promise<TImportContext> {
    return this.get(`${this.base(workspaceSlug)}/import/tasks/`, { params: project ? { project } : {} })
      .then((response) => response?.data)
      .catch(unwrap);
  }

  /** `dry_run: true` checks the rows and returns a preview; `false` creates them all (or none). */
  async importTasks(workspaceSlug: string, body: TImportRequest): Promise<TImportResult> {
    return this.post(`${this.base(workspaceSlug)}/import/tasks/`, body)
      .then((response) => response?.data)
      .catch(unwrap);
  }
}
