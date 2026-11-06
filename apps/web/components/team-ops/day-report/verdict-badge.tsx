/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { VERDICT_LABEL, formatMinutes, planLabel } from "@plane/services";
import type { TTaskProgress, TTaskVerdict } from "@plane/types";
import { cn } from "@plane/utils";

export const VERDICT_COLOR: Record<Exclude<TTaskVerdict, null>, string> = {
  SPEEDY: "#0ea5e9",
  ON_TIME: "#16a34a",
  OVERTIME: "#dc2626",
  IN_PROGRESS: "#64748b",
};

/** Speedy, On time, OverTime or In progress, in its own color. */
export function VerdictBadge({ status, className }: { status: TTaskVerdict; className?: string }) {
  if (!status) return null;
  const color = VERDICT_COLOR[status];
  return (
    <span
      className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-caption-sm-medium", className)}
      style={{ color, backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)` }}
    >
      {VERDICT_LABEL[status]}
    </span>
  );
}

/** "3h 10m of 4 h" and the verdict: the whole time reported on a task against its plan. */
export function ProgressLine({ progress }: { progress: TTaskProgress }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-caption-sm-regular text-tertiary">
      <span className="tabular-nums">
        {formatMinutes(progress.reported_minutes)} of {planLabel(progress.planned_amount, progress.unit)}
      </span>
      <VerdictBadge status={progress.status} />
    </span>
  );
}
