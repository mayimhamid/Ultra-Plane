/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import type {
  TFinishWorkPayload,
  TDayMode,
  TFinishWorkResponse,
  TModuleRelations,
  THeatmap,
  TOpsNotification,
  TTeamStatusRow,
  TTaskParams,
  TTasks,
  TTeamflow,
  TTeamflowParams,
  TWorkPlace,
  TWorkSession,
  TWorkTasks,
  TWorkdayState,
} from "@plane/types";
// services
import { APIService } from "../api.service";

const MULTIPART = { headers: { "Content-Type": "multipart/form-data" } };

/** Builds the multipart body of a finished piece of work; empty optional parts are left out. */
export const buildFinishForm = (payload: TFinishWorkPayload): FormData => {
  const form = new FormData();
  form.append("summary", payload.summary);
  if (payload.document_text) form.append("document_text", payload.document_text);
  form.append("no_document", payload.no_document ? "true" : "false");
  if (payload.timer) form.append("timer", payload.timer);
  if (payload.attention_message.trim()) {
    form.append("attention_message", payload.attention_message);
    payload.attention_teams.forEach((team) => form.append("attention_teams", team));
    payload.attention_users.forEach((user) => form.append("attention_users", user));
  }
  payload.files.forEach((file) => form.append("files", file));
  return form;
};

export class WorkdayService extends APIService {
  constructor(BASE_URL?: string) {
    super(BASE_URL || API_BASE_URL);
  }

  private base(workspaceSlug: string) {
    return `/api/workspaces/${workspaceSlug}/team-ops`;
  }

  /** Stops the timer and records what was done. */
  async finishWork(workspaceSlug: string, payload: TFinishWorkPayload): Promise<TFinishWorkResponse> {
    return this.post(`${this.base(workspaceSlug)}/work-sessions/finish/`, buildFinishForm(payload), MULTIPART)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async listSessions(
    workspaceSlug: string,
    params: { from: string; to: string; user?: string }
  ): Promise<TWorkSession[]> {
    return this.get(`${this.base(workspaceSlug)}/work-sessions/`, { params })
      .then((response) => response?.data?.results)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** Every work item of the person's projects in one shape, with forks, projects and flows. */
  async getModuleRelations(workspaceSlug: string, projectId: string, moduleId: string): Promise<TModuleRelations> {
    return this.get(`${this.base(workspaceSlug)}/projects/${projectId}/modules/${moduleId}/relations/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getTasks(workspaceSlug: string, params: TTaskParams): Promise<TTasks> {
    return this.get(`${this.base(workspaceSlug)}/tasks/`, { params })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** Time per work item in a period. */
  async listTasks(workspaceSlug: string, params: { from: string; to: string; user?: string }): Promise<TWorkTasks> {
    return this.get(`${this.base(workspaceSlug)}/work-tasks/`, { params })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getTeamflow(workspaceSlug: string, params: TTeamflowParams): Promise<TTeamflow> {
    return this.get(`${this.base(workspaceSlug)}/teamflow/`, { params })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** Work per day over the last year, for the contribution graph. */
  async getHeatmap(workspaceSlug: string, user?: string): Promise<THeatmap> {
    return this.get(`${this.base(workspaceSlug)}/work-sessions/heatmap/`, { params: user ? { user } : {} })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** Confirms and locks this week's plan. */
  async confirmWeek(workspaceSlug: string): Promise<TWorkdayState> {
    return this.post(`${this.base(workspaceSlug)}/workday/week/confirm/`, {})
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** Reopens a confirmed plan so it can be changed. Managers are told. */
  async unlockWeek(workspaceSlug: string): Promise<TWorkdayState> {
    return this.post(`${this.base(workspaceSlug)}/workday/week/unlock/`, {})
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** Starts a second task beside the main one. */
  async startParallel(workspaceSlug: string, issue: string, location?: TWorkPlace): Promise<TWorkdayState> {
    return this.post(`${this.base(workspaceSlug)}/workday/parallel/`, { issue, location })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** Changes today's answer after the fact; `sessions` gives the place of every task finished today. */
  async overrideDay(
    workspaceSlug: string,
    mode: TDayMode,
    sessions: Record<string, TWorkPlace>
  ): Promise<TWorkdayState> {
    return this.post(`${this.base(workspaceSlug)}/workday/day/override/`, { mode, sessions })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** How the caller works today, the running task and the day so far. */
  async getState(workspaceSlug: string): Promise<TWorkdayState> {
    return this.get(`${this.base(workspaceSlug)}/workday/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** Answers "how are you working today?". */
  async setDayMode(workspaceSlug: string, mode: TDayMode): Promise<TWorkdayState> {
    return this.post(`${this.base(workspaceSlug)}/workday/day/`, { mode })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** Starts the timer on a work item; on a hybrid day `location` says where. */
  async startWork(workspaceSlug: string, issue: string, location?: TWorkPlace): Promise<TWorkdayState> {
    return this.post(`${this.base(workspaceSlug)}/workday/start/`, { issue, location })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async setBreak(workspaceSlug: string, action: "start" | "end"): Promise<TWorkdayState> {
    return this.post(`${this.base(workspaceSlug)}/workday/break/`, { action })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** "Yes, I am still working." Also ends a freeze. */
  async checkIn(workspaceSlug: string): Promise<TWorkdayState> {
    return this.post(`${this.base(workspaceSlug)}/workday/check-in/`, {})
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** Who is doing what right now, for managers. */
  async getTeamStatus(workspaceSlug: string): Promise<TTeamStatusRow[]> {
    return this.get(`${this.base(workspaceSlug)}/workday/team/`)
      .then((response) => response?.data?.results)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async listNotifications(workspaceSlug: string): Promise<{ unread: number; results: TOpsNotification[] }> {
    return this.get(`${this.base(workspaceSlug)}/notifications/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** Marks one notification, or all of them, as read; `read: false` makes the one given unread again. */
  async markNotificationsRead(workspaceSlug: string, id?: string, read = true): Promise<void> {
    return this.post(`${this.base(workspaceSlug)}/notifications/`, id ? { id, ...(read ? {} : { read: false }) } : {})
      .then(() => undefined)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
