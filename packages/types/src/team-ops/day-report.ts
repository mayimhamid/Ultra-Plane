/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export type TPlanUnit = "HOURS" | "DAYS";

/** How a task is going against its planned time. `null` when it has no planned time. */
export type TTaskVerdict = "SPEEDY" | "ON_TIME" | "OVERTIME" | "IN_PROGRESS" | null;

export type TTaskProgress = {
  planned_minutes: number | null;
  planned_amount: number | null;
  unit: TPlanUnit;
  /** All the time reported on the task, by everyone, on every day. */
  reported_minutes: number;
  finished: boolean;
  status: TTaskVerdict;
};

export type TDayReportTask = TTaskProgress & {
  kind: "issue" | "micro";
  id: string;
  key: string | null;
  name: string;
  is_meeting?: boolean;
  project: { id: string; name: string } | null;
};

export type TReportPlace = "REMOTE" | "ONSITE";

export type TDayReportRow = {
  id: string;
  task: TDayReportTask | null;
  minutes: number;
  /** "09:30" when the work was done in one go; null for work spread over the day. */
  start: string | null;
  end: string | null;
  location: TReportPlace | "";
  finished: boolean;
  note: string;
};

export type TDayReport = {
  date: string;
  today: string;
  /** Where the day was worked: from the rows (both places: HYBRID), else the day's answer. */
  mode: string | null;
  planned_mode: string | null;
  status: "DRAFT" | "SUBMITTED";
  exists: boolean;
  submitted_at: string | null;
  is_late: boolean;
  edit_count: number;
  last_edited_at: string | null;
  total_minutes: number;
  /** A change from now on is recorded and the managers are told. */
  changes_are_recorded: boolean;
  can_edit: boolean;
  entries: TDayReportRow[];
};

export type TDayReportRowInput = {
  issue?: string;
  micro_task?: string;
  /** Used when `start` and `end` are not given. */
  minutes: number;
  start?: string;
  end?: string;
  location?: TReportPlace | "";
  finished: boolean;
  note: string;
};

export type TDayReportRevisionRow = {
  task: string;
  minutes: number;
  start?: string | null;
  end?: string | null;
  location?: string;
  finished: boolean;
  note: string;
};

export type TDayReportRevision = {
  id: number;
  kind: "LATE" | "CHANGE";
  reason: string;
  changed_at: string;
  changed_by: { id: string; display_name: string } | null;
  before: TDayReportRevisionRow[];
  after: TDayReportRevisionRow[];
};

export type TTeamDayReportRow = {
  user: { id: string; display_name: string; avatar_url: string | null };
  status: "DRAFT" | "SUBMITTED" | null;
  submitted_at: string | null;
  is_late: boolean;
  edit_count: number;
  total_minutes: number;
  mode: string | null;
};

export type TTaskPlan = TTaskProgress & { can_edit: boolean };

export type TMicroTask = TTaskProgress & {
  id: string;
  title: string;
  description: string;
  is_meeting: boolean;
  assignee: { id: string; display_name: string; avatar_url: string | null };
  created_by: string | null;
  due_date: string | null;
  done: boolean;
  done_at: string | null;
  created_at: string;
};

export type TMicroTaskInput = {
  title: string;
  description?: string;
  amount?: number | string | null;
  unit?: TPlanUnit;
  due_date?: string | null;
  is_meeting?: boolean;
  /** Give it to someone else (managers only). */
  user?: string;
};

/** One task of an import file, as the AI prompt asks for it. */
export type TImportItem = {
  title: string;
  description?: string;
  planned_hours?: number;
  planned_days?: number;
  due_date?: string;
  start_date?: string;
  priority?: string;
  assignees?: string[] | string;
  module?: string;
  state?: string;
  labels?: string[] | string;
  is_meeting?: boolean;
};

export type TImportRow = {
  row: number;
  title: string;
  description?: string;
  planned_amount: number | string | null;
  unit: TPlanUnit;
  due_date: string | null;
  start_date?: string | null;
  priority?: string;
  is_meeting?: boolean;
  assignee?: { id: string; display_name: string };
  assignees?: { id: string; display_name: string }[];
  module?: { id: string; name: string } | null;
  state?: { id: string; name: string } | null;
  labels?: { id: string; name: string }[];
  errors: string[];
};

export type TImportResult = { ok: boolean; rows: TImportRow[]; created: number };

export type TImportRequest = {
  target: "micro" | "project";
  project?: string;
  user?: string;
  items: TImportItem[];
  dry_run: boolean;
};

export type TImportContext = {
  project?: { name: string; identifier: string };
  people: { display_name: string; email: string }[];
  modules: string[];
  states: string[];
  labels: string[];
};

/** One person's reported work in a period (Control and the Dashboard). */
export type TReportPersonSummary = {
  user: { id: string; display_name: string; avatar_url: string | null };
  total_minutes: number;
  remote_minutes: number;
  onsite_minutes: number;
  /** Minutes per day, "2026-11-04": 135. */
  days: Record<string, number>;
  /** Where the person worked each day: REMOTE, ONSITE or HYBRID. */
  places: Record<string, string>;
  task_count: number;
  finished: number;
  /** Work items assigned to the person that reached a Done state in the period. */
  completed_tasks: number;
  speedy: number;
  on_time: number;
  overtime: number;
  expected_days: number;
  reports_sent: number;
  reports_missing: number;
  reports_late: number;
  edits: number;
};

export type TReportSummary = {
  from: string;
  to: string;
  totals: {
    minutes: number;
    remote_minutes: number;
    onsite_minutes: number;
    people: number;
    people_reporting: number;
    reports_sent: number;
    reports_missing: number;
    reports_late: number;
    edits: number;
    completed_tasks: number;
    speedy: number;
    on_time: number;
    overtime: number;
  };
  people: TReportPersonSummary[];
  days: { date: string; minutes: number; remote_minutes: number; onsite_minutes: number; people: number }[];
  projects: { id: string | null; name: string; identifier: string; minutes: number }[];
  tasks: (TTaskProgress & {
    kind: "issue" | "micro";
    id: string;
    key: string | null;
    name: string;
    project: string | null;
    /** The project's id (micro tasks have none), to group the tasks under a project. */
    project_id: string | null;
    /** The work item's state in its project (micro tasks: Open or Done). */
    state: { name: string; group: string; color: string } | null;
    minutes: number;
    people: string[];
    /** When the time was spent: the day, from and to (when the row has them), who and how long. */
    entries: { date: string; start: string | null; end: string | null; minutes: number; person: string }[];
  })[];
};
