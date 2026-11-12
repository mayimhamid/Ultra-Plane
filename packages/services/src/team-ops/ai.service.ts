/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import type {
  TAIChatEvent,
  TAIFeedbackPayload,
  TAIJob,
  TAITeamReview,
  TAskPayload,
  TAskResult,
  TDailyReview,
  TDailyReviewParams,
  TDailyReviewResult,
  TAIConversation,
  TAIConversationDetail,
  TAISearchResult,
  TAISettingsPayload,
  TAIStatus,
  TAISummary,
  TAISummaryRequest,
  TAITaskProposals,
  TWorkEvidence,
  TWorkQuality,
  TWorkEvidenceParams,
} from "@plane/types";
// services
import { APIService } from "../api.service";

/** Splits a server-sent-events text into events; returns the events and the unfinished rest. */
export const parseSSE = (buffer: string): { events: TAIChatEvent[]; rest: string } => {
  const events: TAIChatEvent[] = [];
  const blocks = buffer.split(/\r?\n\r?\n/);
  const rest = blocks.pop() ?? "";
  for (const block of blocks) {
    let event = "";
    let data = "";
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!event || !data) continue;
    try {
      events.push({ event, data: JSON.parse(data) } as TAIChatEvent);
    } catch {
      // A broken event is skipped; the next ones still arrive.
    }
  }
  return { events, rest };
};

/** What a failed job says to the person. */
const JOB_ERRORS: Record<string, string> = {
  llm_unavailable: "The AI model is not answering right now. Try again in a few minutes.",
  internal_error: "The AI could not finish this. Try again; if it keeps failing, tell an admin.",
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The AI of Team Ops. Every call goes through Plane's API, which checks access and talks to Plane AI. */
export class TeamAIService extends APIService {
  constructor(BASE_URL?: string) {
    super(BASE_URL || API_BASE_URL);
  }

  private path(workspaceSlug: string, rest = "") {
    return `/api/workspaces/${workspaceSlug}/team-ops/ai/${rest}`;
  }

  private rethrow = (error: { response?: { data?: unknown } }) => {
    throw error?.response?.data;
  };

  async getStatus(workspaceSlug: string): Promise<TAIStatus> {
    return this.get(this.path(workspaceSlug))
      .then((response) => response?.data)
      .catch(this.rethrow);
  }

  /** Admins: AI on or off, and the effort. */
  async saveSettings(workspaceSlug: string, payload: TAISettingsPayload): Promise<TAIStatus> {
    return this.patch(this.path(workspaceSlug, "settings/"), payload)
      .then((response) => response?.data)
      .catch(this.rethrow);
  }

  /** A job's current state. */
  async getJob<T>(workspaceSlug: string, id: string): Promise<TAIJob<T>> {
    return this.get(this.path(workspaceSlug, `jobs/${id}/`))
      .then((response) => response?.data)
      .catch(this.rethrow);
  }

  /**
   * Polls a job until it is done and returns its result. Slow work on a small CPU can take minutes, so this
   * waits up to `timeoutMs` (60 minutes: a large model on a CPU can take that long for a whole team) and reports progress. Rejects with `{ error }` when the job failed.
   */
  async waitForJob<T>(
    workspaceSlug: string,
    job: TAIJob<T>,
    onProgress?: (job: TAIJob<T>) => void,
    { intervalMs = 1500, timeoutMs = 60 * 60 * 1000 }: { intervalMs?: number; timeoutMs?: number } = {}
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    let current = job;
    for (;;) {
      onProgress?.(current);
      if (current.status === "done" && current.result) return current.result;
      if (current.status === "failed") throw { error: JOB_ERRORS[current.error] ?? JOB_ERRORS.internal_error };
      if (Date.now() > deadline) throw { error: "The AI is taking too long. Look again later." };
      // eslint-disable-next-line no-await-in-loop -- polling one job: each check waits for the previous one
      await sleep(intervalMs);
      // eslint-disable-next-line no-await-in-loop -- see above
      current = await this.getJob<T>(workspaceSlug, current.id);
    }
  }

  private startJob<T>(workspaceSlug: string, rest: string, payload: object): Promise<TAIJob<T>> {
    return this.post(this.path(workspaceSlug, rest), payload)
      .then((response) => response?.data)
      .catch(this.rethrow);
  }

  async summarize(workspaceSlug: string, payload: TAISummaryRequest): Promise<TAISummary> {
    const job = await this.startJob<TAISummary>(workspaceSlug, "summarize/", payload);
    return this.waitForJob(workspaceSlug, job);
  }

  /** Task proposals for the import preview; nothing is created. */
  async proposeTasks(workspaceSlug: string, prompt: string): Promise<TAITaskProposals> {
    const job = await this.startJob<TAITaskProposals>(workspaceSlug, "tasks/", { prompt });
    return this.waitForJob(workspaceSlug, job);
  }

  /** Rate an answer (1 right, -1 wrong, with the right answer): it becomes training data. */
  async sendFeedback(workspaceSlug: string, jobId: string, payload: TAIFeedbackPayload): Promise<void> {
    return this.post(this.path(workspaceSlug, `jobs/${jobId}/feedback/`), payload)
      .then(() => undefined)
      .catch(this.rethrow);
  }

  /** Managers: the rows of one day's reports and the latest AI review of them. */
  async getDailyReview(workspaceSlug: string, params: TDailyReviewParams): Promise<TDailyReview> {
    return this.get(this.path(workspaceSlug, "daily/"), { params })
      .then((response) => response?.data)
      .catch(this.rethrow);
  }

  /** Managers: start the Daily review; returns the job (poll it with `waitForJob`). */
  async startDailyReview(workspaceSlug: string, params: TDailyReviewParams): Promise<TAIJob<TDailyReviewResult>> {
    return this.startJob(workspaceSlug, "daily/", params);
  }

  /** Managers: the caller's recent questions. */
  async listQuestions(workspaceSlug: string): Promise<TAIJob<TAskResult>[]> {
    return this.get(this.path(workspaceSlug, "ask/"))
      .then((response) => response?.data)
      .catch(this.rethrow);
  }

  /** Managers: ask a question about the team; returns the job. */
  async ask(workspaceSlug: string, payload: TAskPayload): Promise<TAIJob<TAskResult>> {
    return this.startJob(workspaceSlug, "ask/", payload);
  }

  /** Admins: where the training data (JSONL) is downloaded from. */
  trainingExportUrl(workspaceSlug: string): string {
    return `${this.baseURL}${this.path(workspaceSlug, "training/")}`;
  }

  async listConversations(workspaceSlug: string): Promise<TAIConversation[]> {
    return this.get(this.path(workspaceSlug, "chat/"))
      .then((response) => response?.data)
      .catch(this.rethrow);
  }

  async getConversation(workspaceSlug: string, id: string): Promise<TAIConversationDetail> {
    return this.get(this.path(workspaceSlug, `chat/${id}/`))
      .then((response) => response?.data)
      .catch(this.rethrow);
  }

  async deleteConversation(workspaceSlug: string, id: string): Promise<void> {
    return this.delete(this.path(workspaceSlug, `chat/${id}/`))
      .then(() => undefined)
      .catch(this.rethrow);
  }

  async search(workspaceSlug: string, q: string): Promise<{ results: TAISearchResult[] }> {
    return this.get(this.path(workspaceSlug, "search/"), { params: { q } })
      .then((response) => response?.data)
      .catch(this.rethrow);
  }

  /** Admins: send the workspace's work items and documents to Plane AI for search. */
  async index(workspaceSlug: string): Promise<{ documents: number; chunks: number }> {
    return this.post(this.path(workspaceSlug, "index/"))
      .then((response) => response?.data)
      .catch(this.rethrow);
  }

  /** Managers: quality of work per person with the trend (no AI needed). */
  async getQuality(workspaceSlug: string, params: TWorkEvidenceParams): Promise<TWorkQuality> {
    return this.get(this.path(workspaceSlug, "quality/"), { params })
      .then((response) => response?.data)
      .catch(this.rethrow);
  }

  /** Managers: work evidence per person (no AI needed). */
  async getEvidence(workspaceSlug: string, params: TWorkEvidenceParams): Promise<TWorkEvidence> {
    return this.get(this.path(workspaceSlug, "team/"), { params })
      .then((response) => response?.data)
      .catch(this.rethrow);
  }

  /** Managers: start Plane AI's explanation of the evidence; returns the job. */
  async reviewTeam(workspaceSlug: string, params: TWorkEvidenceParams): Promise<TAIJob<TAITeamReview>> {
    return this.startJob(workspaceSlug, "team/", params);
  }

  /**
   * Ask the assistant; `onEvent` gets the answer piece by piece. Uses `fetch` because the answer is a stream.
   * Resolves when the answer is complete; rejects with `{ error }` when it could not start.
   */
  async chat(
    workspaceSlug: string,
    body: { message: string; conversation?: string | null; use_workspace?: boolean },
    onEvent: (event: TAIChatEvent) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const response = await fetch(`${this.baseURL}${this.path(workspaceSlug, "chat/")}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok || !response.body) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      throw { error: data.error ?? "The assistant could not answer." };
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      // eslint-disable-next-line no-await-in-loop -- the pieces of one stream must be read in order
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSSE(buffer);
      buffer = parsed.rest;
      parsed.events.forEach(onEvent);
    }
    parseSSE(`${buffer}\n\n`).events.forEach(onEvent);
  }
}
