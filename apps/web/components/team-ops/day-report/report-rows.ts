/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { parseDuration, spanMinutes } from "@plane/services";
import type { TDayReport, TReportPlace } from "@plane/types";
import type { TTaskRef } from "./task-cell";

/** One row of the Day Report being written. */
export type TRow = {
  key: string;
  task: TTaskRef | null;
  /** Work done in one go: from and to. */
  start: string;
  end: string;
  /** Work spread over the day: only how long, typed as 1:30, 1.5 or 45m. */
  spread: boolean;
  duration: string;
  place: TReportPlace | "";
  finished: boolean;
  note: string;
  /** Progress from the server, for rows that were saved. */
  saved?: TDayReport["entries"][number]["task"];
};

export const PLACES: { value: TReportPlace; label: string }[] = [
  { value: "REMOTE", label: "Remote" },
  { value: "ONSITE", label: "Onsite" },
];
export const PLACE_LABEL: Record<string, string> = { REMOTE: "Remote", ONSITE: "Onsite", HYBRID: "Hybrid" };
export const PLACE_COLOR: Record<string, string> = { REMOTE: "#0284c7", ONSITE: "#16a34a" };

/** Minutes of a row, or `null` while its time is not filled in properly. */
export const minutesOf = (row: TRow) => (row.spread ? parseDuration(row.duration) : spanMinutes(row.start, row.end));

export const isFilled = (row: TRow) =>
  Boolean(row.task || row.start || row.end || row.duration.trim() || row.note.trim());

/** A row someone started but did not finish: no task, no usable time or no place. */
export const isIncomplete = (row: TRow) => isFilled(row) && (!row.task || minutesOf(row) === null || !row.place);
