/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export type TFileInfo = { id: string; name: string; content_type: string; size: number };

/** One finished stretch of work on a work item. */
export type TWorkSession = {
  id: string;
  user: string;
  project: string;
  issue: string | null;
  /** `KEY-12` */
  work_item: string | null;
  work_item_name: string | null;
  started_at: string;
  finished_at: string;
  duration_seconds: number;
  summary: string;
  document_text: string;
  /** The person confirmed that there is no document for this work. */
  no_document: boolean;
  needs_attention: boolean;
  attention_message: string;
  files: TFileInfo[];
  location: TWorkPlace | "";
  is_parallel: boolean;
  break_seconds: number;
  frozen_seconds: number;
};

export type TFinishWorkPayload = {
  summary: string;
  document_text: string;
  no_document: boolean;
  attention_message: string;
  attention_teams: string[];
  /** Colleagues tagged one by one, besides the teams. */
  attention_users: string[];
  files: File[];
  /** The parallel timer to finish; leave out for the main one. */
  timer?: string;
};

export type TFinishWorkResponse = { session: TWorkSession; capped: boolean };

/** Time spent on a work item in a period. */
export type TWorkTask = { issue: string; name: string; key: string; seconds: number };
export type TWorkTasks = { results: TWorkTask[]; total_seconds: number };

export type THubPerson = { id: string; display_name: string; avatar_url: string | null };

export type THubChannel = {
  id: string;
  kind: "TEAM" | "PROJECT" | "GENERAL" | "NEWS" | "DM";
  name: string;
  team: string | null;
  project: string | null;
  unread: number;
  /** Only admins write in News. */
  can_post: boolean;
};

export type THubChannelDetail = THubChannel & { members: THubPerson[] };

export type THubChannelList = { results: THubChannel[]; unread_mentions: number };

export type THubMessage = {
  id: string;
  channel: string;
  author: THubPerson;
  body: string;
  parent: string | null;
  kind: "MESSAGE" | "ATTENTION";
  session: string | null;
  created_at: string;
  edited_at: string | null;
  is_deleted: boolean;
  mentions: THubPerson[];
  mentions_me: boolean;
  attachments: TFileInfo[];
};

export type THubMessagePayload = {
  body: string;
  parent?: string | null;
  users: string[];
  teams: string[];
  files: File[];
};

export type THubMention = {
  id: string;
  channel: string;
  message: string;
  author: THubPerson;
  body: string;
  kind: "MESSAGE" | "ATTENTION";
  via_team: string | null;
  created_at: string;
  read: boolean;
};

export type TTeamflowStatus = "pending" | "delivered";

export type TTeamflowRow = {
  message: string;
  channel: string;
  from_team: { id: string; name: string } | null;
  to_team: { id: string; name: string };
  author: { id: string; display_name: string };
  kind: "MESSAGE" | "ATTENTION";
  summary: string;
  work_item: string | null;
  files: TFileInfo[];
  status: TTeamflowStatus;
  created_at: string;
};

export type TTeamflowEdge = { from: string; to: string; pending: number; delivered: number };

export type TTeamflow = {
  results: TTeamflowRow[];
  nodes: { id: string; name: string }[];
  edges: TTeamflowEdge[];
};

export type TTeamflowParams = { team?: string; status?: TTeamflowStatus; from?: string; to?: string };

export type TDayMode = "REMOTE" | "ONSITE" | "HYBRID";
export type TWorkPlace = "REMOTE" | "ONSITE";
/** RUNNING counts time, BREAK is a rest pause, FROZEN means a check-in was not answered. */
export type TTimerState = "RUNNING" | "BREAK" | "FROZEN";

export type TWorkdayTimer = {
  id: string;
  is_parallel: boolean;
  /** "" for a task; MEETING for a meeting (no work item, no check-in, no report). */
  activity: "" | "MEETING";
  state: TTimerState;
  location: TWorkPlace | "";
  started_at: string;
  worked_seconds: number;
  paused_at: string | null;
  /** When the next "still working?" falls due; `null` while on a break or frozen. */
  check_in_due_at: string | null;
  check_in_grace_seconds: number;
  check_in_every_seconds: number;
  issue: string | null;
  work_item: string | null;
  work_item_name: string | null;
  project: string | null;
  server_time: string;
};

export type TInterruption = { kind: "BREAK" | "FREEZE"; started_at: string; ended_at: string | null; seconds: number };

export type TDayTotals = {
  onsite_seconds: number;
  remote_seconds: number;
  /** Tasks worked beside the main one; counted apart from the onsite and remote hours. */
  parallel_seconds: number;
  /** Time in meetings today, the running one included. */
  meeting_seconds: number;
  break_seconds: number;
  frozen_seconds: number;
  interruptions: TInterruption[];
};

/** One day of the week (Saturday to Friday) and how the person plans to work on it. */
export type TWeekDay = {
  date: string;
  /** `null` when nothing is planned yet. */
  mode: "ONSITE" | "REMOTE" | "OFF" | "LEAVE" | null;
  /** A working day of the workspace that is not a holiday. */
  expected: boolean;
  past: boolean;
};

export type TWeekPlan = {
  start: string;
  end: string;
  days: TWeekDay[];
  /** The person confirmed the plan; it is locked until they reopen it. */
  confirmed: boolean;
  /** Every working day from today to the end of the week is planned. Starting work needs this. */
  complete: boolean;
  missing: string[];
};

export type TWorkdayState = {
  day: { date: string; mode: TDayMode } | null;
  timer: TWorkdayTimer | null;
  /** Second and third tasks worked at the same time as the main one. */
  parallel: TWorkdayTimer[];
  totals: TDayTotals;
  week: TWeekPlan;
};

export type THeatmap = {
  from: string;
  to: string;
  days: { date: string; sessions: number; tasks: number; seconds: number }[];
};

export type TTeamStatusRow = {
  user: THubPerson;
  mode: TDayMode | null;
  state: TTimerState | "IDLE" | "DONE";
  work_item: string | null;
  work_item_name: string | null;
  location: TWorkPlace | "";
  activity: "" | "MEETING";
  worked_today_seconds: number;
  frozen_today_seconds: number;
};

export type TOpsNotification = {
  id: string;
  kind:
    | "MENTION"
    | "ATTENTION"
    | "FREEZE"
    | "NEWS"
    | "DIRECT"
    | "SECRET"
    | "FLOW"
    | "REPLY"
    | "ASSIGN"
    | "CHECKIN"
    | "LEAVE";
  title: string;
  body: string;
  link: string;
  actor: string | null;
  created_at: string;
  read: boolean;
};

export type THubDoc = {
  id: string;
  title: string;
  tags: string[];
  project: { id: string; name: string; identifier: string } | null;
  author: THubPerson;
  updated_at: string;
  excerpt: string;
  /** The Plane Page the document is written in (documents of a project). */
  page: string | null;
  /** Only in the full document. */
  body?: string;
};

export type THubDocPayload = { title: string; body: string; tags: string[]; project: string | null };

export type TLibraryFile = TFileInfo & { uploaded_by: THubPerson; created_at: string; source: string };

export type THubSecret = {
  id: string;
  name: string;
  description: string;
  publisher: THubPerson;
  project: { id: string; name: string } | null;
  is_publisher: boolean;
  updated_at: string;
  /** Only for the publisher. */
  shared_with?: string[];
};

export type THubSecretPayload = {
  name: string;
  description: string;
  value: string;
  project?: string | null;
  users?: string[];
};

export type THubSecretLog = {
  action: "CREATE" | "REVEAL" | "UPDATE" | "GRANT" | "REVOKE";
  user: THubPerson;
  target: THubPerson | null;
  at: string;
};

/** One module of a stage: its progress, and the people on it (lead, members, assignees). */
export type TFlowModule = {
  id: string;
  name: string;
  /** The module's own status in Plane: backlog, planned, in-progress, paused, completed, cancelled. */
  status: string;
  done: number;
  total: number;
  /** Work items added to the module after the flow was drawn. They never hold a stage back. */
  side_done: number;
  side_total: number;
  percent: number | null;
  people: THubPerson[];
};

export type TFlowStage = {
  id: string;
  name: string;
  /** Waiting for an earlier stage to finish. */
  pending: boolean;
  /** The progress of its modules together. */
  percent: number | null;
  done: number;
  total: number;
  side_done: number;
  side_total: number;
  modules: TFlowModule[];
};

export type TFlow = {
  id: string;
  name: string;
  project: { id: string; name: string; identifier: string };
  side_tasks: { done: number; total: number };
  stages: TFlowStage[];
};

export type TFlowPayload = { project?: string; name: string; stages: { name: string; modules: string[] }[] };

export type TFlowOffer = {
  eligible: boolean;
  /** Open work items nobody has. */
  pull: { id: string; name: string; key: string }[];
  /** Open work items others are still on, which the person can join. */
  merge: { id: string; name: string; key: string }[];
};

export type TTaskProject = { id: string; name: string; identifier: string };

export type TTaskFlow = {
  id: string;
  name: string;
  /** The stages of this flow the people on the task are in. */
  stages: string[];
  /** The task was created after the flow was drawn. */
  side: boolean;
};

/** One work item, in the same shape wherever it is shown. */
export type TTaskLite = {
  id: string;
  key: string;
  name: string;
  project: TTaskProject;
  state: { name: string; group: string } | null;
  assignees: THubPerson[];
  flows: TTaskFlow[];
};

/** A branch of a task: a sub work item, or a person working on it with their own time and stage. */
export type TTaskFork =
  | ({ kind: "sub" } & TTaskLite)
  | {
      kind: "person";
      user: THubPerson;
      seconds: number;
      sessions: number;
      stage: string | null;
      done: boolean;
    };

export type TTask = TTaskLite & { seconds: number; sessions: number; forks: TTaskFork[] };

export type TTaskParams = {
  /** One work item, whether or not it is a sub work item. */
  issue?: string;
  /** The work items of one module. */
  module?: string;
  project?: string;
  flow?: string;
  assignee?: string;
  status?: "open" | "done";
  q?: string;
  mine?: "1";
};

export type TTasks = {
  results: TTask[];
  total: number;
  has_more: boolean;
  filters: {
    projects: TTaskProject[];
    flows: { id: string; name: string; project: string }[];
  };
};

/** What the flow editor offers for a project. */
export type TProjectModule = { id: string; name: string; status: string; people: THubPerson[] };

/** The work items of a module and the relations among them. `blocking`: `from` blocks `to`. */
export type TModuleRelationKind = "blocking" | "duplicate" | "relates_to";
export type TModuleRelationItem = {
  id: string;
  key: string;
  name: string;
  state_group: string | null;
  /** The work item it is a sub work item of, when that one is in the module too. */
  parent: string | null;
};
export type TModuleRelation = { id: string; from: string; to: string; type: TModuleRelationKind };
export type TModuleRelations = { issues: TModuleRelationItem[]; relations: TModuleRelation[] };
