/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TImportItem } from "./day-report";

/** How much of the machine one AI request may use. Low uses the least, and each answer takes longer. */
export type TAIEffort = "high" | "medium" | "low";

export type TAIEffortProfile = {
  effort: TAIEffort;
  threads: number;
  context_tokens: number;
  max_answer_tokens: number;
  refine_rounds: number;
  history_messages: number;
  retrieval_chunks: number;
  llm_only_when_unclear: boolean;
};

/** Whether AI can be used in the workspace. With `configured` false the server has no AI and nothing shows. */
export type TAIStatus = {
  configured: boolean;
  reachable: boolean;
  enabled: boolean;
  effort?: TAIEffort;
  /** The model runtime: ok, loading, unavailable or model_missing. */
  llm?: string;
  runtime?: string;
  model?: string;
  profiles?: Record<TAIEffort, TAIEffortProfile>;
  can_manage: boolean;
  can_analyze: boolean;
};

export type TAISettingsPayload = { enabled: boolean; effort: TAIEffort };

export type TAISummaryRequest =
  | { kind: "issue"; issue: string }
  | { kind: "day_report"; date?: string }
  | { kind: "text"; text: string; title?: string };

export type TAISummary = {
  summary: string;
  /** Reviewer rounds that improved the draft (high effort only). */
  rounds: number;
  effort: TAIEffort;
  truncated: boolean;
  cached: boolean;
};

export type TAITaskProposals = { tasks: TImportItem[] };

export type TAIConversation = { id: string; title: string; updated_at: string };

export type TAIChatMessage = { role: "user" | "assistant"; content: string; created_at?: string };

export type TAIConversationDetail = TAIConversation & { summary: string; messages: TAIChatMessage[] };

export type TAISource = { n: number; type: string; id: string; title: string; url: string };

/** One event of a streamed chat answer. */
export type TAIChatEvent =
  | { event: "meta"; data: { conversation_id: string; sources: TAISource[]; effort: TAIEffort } }
  | { event: "token"; data: { text: string } }
  | { event: "done"; data: { conversation_id: string } }
  | { event: "error"; data: { detail: string } };

export type TAISearchResult = {
  type: string;
  id: string;
  title: string;
  url: string;
  project_id: string | null;
  snippet: string;
  score: number;
};

export type TEvidenceLevel = "STRONG" | "PARTIAL" | "WEAK" | "NO_DATA";

export type TEvidenceItem = {
  date: string;
  kind: "issue" | "micro";
  key: string;
  name: string;
  minutes: number;
  finished: boolean;
  evidence: { activity: boolean; document: boolean; note: boolean };
  done_but_open: boolean;
  support: number;
};

export type TEvidenceFacts = {
  reported_minutes: number;
  reported_hours: number;
  reports_sent: number;
  reported_tasks: number;
  work_item_rows: number;
  rows_with_activity: number;
  rows_with_document: number;
  rows_with_note: number;
  rows_without_any_trace: number;
  hours_without_any_trace: number;
  marked_done: number;
  marked_done_still_open: number;
  micro_task_hours: number;
  days_over_12h: number;
  late_reports: number;
  changed_reports: number;
};

export type TEvidencePerson = {
  user: { id: string; display_name: string; avatar_url: string | null };
  score: number;
  level: TEvidenceLevel;
  facts: TEvidenceFacts;
  flags: string[];
  items: TEvidenceItem[];
};

export type TAIVerdict = "well_supported" | "partly_supported" | "weakly_supported" | "no_data";

export type TAIMemberReview = {
  user_id: string;
  name: string;
  score: number;
  rule_verdict: TAIVerdict;
  verdict: TAIVerdict;
  explanation: string;
  questions: string[];
  /** `ai` when the model wrote it, `rules` when the numbers were clear enough (or the model was down). */
  source: "ai" | "rules";
};

export type TAITeamReview = {
  members: TAIMemberReview[];
  summary: string[];
  summary_source: "ai" | "rules";
  effort: TAIEffort;
  cached: boolean;
};

export type TWorkEvidence = {
  from: string;
  to: string;
  team: {
    people: number;
    people_reporting: number;
    reported_hours: number;
    average_score: number;
    weak: number;
    partial: number;
    marked_done_still_open: number;
    hours_without_any_trace: number;
  };
  people: TEvidencePerson[];
  notice: string;
  review?: TAITeamReview;
};

export type TWorkEvidenceParams = { from: string; to: string; team?: string; user?: string };
