/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TFlow, THubPerson, TTeamflowRow, TTeamStatusRow } from "./workday";

export type TControlPeriod = {
  seconds: number;
  onsite_seconds: number;
  remote_seconds: number;
  parallel_seconds: number;
  sessions: number;
  tasks: number;
  without_document: number;
  attention: number;
  break_seconds: number;
  frozen_seconds: number;
  freezes: number;
};

/** One person: what they are doing now and their work in the period. */
export type TControlRow = TTeamStatusRow & {
  period: TControlPeriod;
  /** Working days from today to the end of the week without a plan. */
  unplanned_days: number;
  /** The person confirmed this week's plan. */
  week_confirmed: boolean;
};

export type TControlTotals = {
  seconds: number;
  onsite_seconds: number;
  remote_seconds: number;
  parallel_seconds: number;
  sessions: number;
  break_seconds: number;
  frozen_seconds: number;
  freezes: number;
  unplanned_people: number;
  working_now: number;
};

export type TControlTeam = { from: string; to: string; results: TControlRow[]; totals: TControlTotals };

export type TControlParams = { from: string; to: string; team?: string; user?: string };

export type TInterruptionRow = {
  kind: "BREAK" | "FREEZE";
  user: Pick<THubPerson, "id" | "display_name">;
  work_item: string | null;
  started_at: string;
  ended_at: string | null;
  seconds: number;
};

export type THubOverviewChannel = {
  id: string;
  kind: "TEAM" | "PROJECT" | "GENERAL" | "NEWS";
  name: string;
  members: number;
  messages: number;
  last_at: string | null;
  today: number;
  is_locked: boolean;
};

export type THubOverview = {
  channels: THubOverviewChannel[];
  private_conversations: number;
  docs: number;
  files: number;
  file_bytes: number;
  secrets: number;
  secret_publishers: number;
};

export type TFlowOverviewItem = TFlow & {
  percent: number | null;
  current_stage: string | null;
  finished: boolean;
  pending_stages: number;
  /** Modules of the stage that holds the flow which have no work items yet. */
  modules_without_tasks: string[];
};

export type TFlowOverview = {
  flows: TFlowOverviewItem[];
  stale_handoffs: TTeamflowRow[];
  stale_after_hours: number;
};

export type TDayHours = {
  date: string;
  onsite_seconds: number;
  remote_seconds: number;
  parallel_seconds: number;
  frozen_seconds: number;
  break_seconds: number;
};

export type TPersonDayHours = TDayHours & {
  /** `null` on days without work; otherwise whether an admin approved the day. */
  approved: boolean | null;
};

export type TControlHours = {
  from: string;
  to: string;
  people: { user: { id: string; display_name: string }; days: TPersonDayHours[]; pending_days: number }[];
  team: TDayHours[];
  pending_days: number;
  can_approve: boolean;
};

export type TRankingRow = {
  user: { id: string; display_name: string };
  tasks: number;
  finished: number;
  seconds: number;
  parallel_seconds: number;
  active_days: number;
  rank_tasks: number | null;
  rank_hours: number | null;
  badges: string[];
};

export type TSumRow = {
  user: { id: string; display_name: string };
  main_seconds: number;
  onsite_seconds: number;
  remote_seconds: number;
  parallel_seconds: number;
  tasks: number;
  /** Time the timer was frozen in the period. */
  frozen_seconds: number;
  /** The part of it an admin decided to count. */
  credited_frozen_seconds: number;
  total_seconds: number;
};

export type TSumTime = {
  from: string;
  to: string;
  parallel_double: boolean;
  results: TSumRow[];
  total_seconds: number;
};

/** What a manager may read about someone's notifications: title and state, never the text of a private message. */
export type TPersonNotification = {
  id: string;
  kind: "MENTION" | "ATTENTION" | "FREEZE" | "NEWS" | "FLOW";
  title: string;
  actor: string | null;
  created_at: string;
  read: boolean;
};
