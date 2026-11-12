/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import type {
  TAIChatEvent,
  TAIConversation,
  TAIConversationDetail,
  TAISearchResult,
  TAISettingsPayload,
  TAIStatus,
  TAISummary,
  TAISummaryRequest,
  TAITaskProposals,
  TWorkEvidence,
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

  async summarize(workspaceSlug: string, payload: TAISummaryRequest): Promise<TAISummary> {
    return this.post(this.path(workspaceSlug, "summarize/"), payload)
      .then((response) => response?.data)
      .catch(this.rethrow);
  }

  /** Task proposals for the import preview; nothing is created. */
  async proposeTasks(workspaceSlug: string, prompt: string): Promise<TAITaskProposals> {
    return this.post(this.path(workspaceSlug, "tasks/"), { prompt })
      .then((response) => response?.data)
      .catch(this.rethrow);
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

  /** Managers: work evidence per person (no AI needed). */
  async getEvidence(workspaceSlug: string, params: TWorkEvidenceParams): Promise<TWorkEvidence> {
    return this.get(this.path(workspaceSlug, "team/"), { params })
      .then((response) => response?.data)
      .catch(this.rethrow);
  }

  /** Managers: the same evidence explained by Plane AI. */
  async reviewTeam(workspaceSlug: string, params: TWorkEvidenceParams): Promise<TWorkEvidence> {
    return this.post(this.path(workspaceSlug, "team/"), params)
      .then((response) => response?.data)
      .catch(this.rethrow);
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
