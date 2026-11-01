/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { formatHm } from "@plane/services";
import type { TDayHours } from "@plane/types";

/** One colour per kind of time, used in every chart: onsite blue, remote green, parallel purple, frozen red. */
export const HOUR_COLORS = {
  onsite: "var(--background-color-accent-primary)",
  remote: "var(--border-color-success-strong)",
  parallel: "#8b5cf6",
  frozen: "var(--border-color-danger-strong)",
} as const;

export const HOUR_LABELS: Record<keyof typeof HOUR_COLORS, string> = {
  onsite: "Onsite",
  remote: "Remote",
  parallel: "Parallel",
  frozen: "Frozen",
};

const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", day: "numeric" });
const parse = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export function HoursLegend({ hideParallel = false }: { hideParallel?: boolean }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-caption-sm-regular text-secondary">
      {(Object.keys(HOUR_COLORS) as (keyof typeof HOUR_COLORS)[])
        .filter((key) => !(hideParallel && key === "parallel"))
        .map((key) => (
          <li key={key} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ backgroundColor: HOUR_COLORS[key] }} />
            {HOUR_LABELS[key]}
          </li>
        ))}
    </ul>
  );
}

/** Stacked bars per day. Frozen time is red, so a bad day stands out at once. */
export function HoursChart({
  days,
  height = 160,
  hideParallel = false,
}: {
  days: TDayHours[];
  height?: number;
  /** Leave the parallel time out of the bars and the legend. */
  hideParallel?: boolean;
}) {
  const parallelOf = (day: TDayHours) => (hideParallel ? 0 : day.parallel_seconds);
  const total = (day: TDayHours) => day.onsite_seconds + day.remote_seconds + parallelOf(day) + day.frozen_seconds;
  const top = Math.max(3600, ...days.map(total));
  const crowded = days.length > 14;
  return (
    <div className="flex flex-col gap-2">
      <ol className="flex items-end gap-1" style={{ height }}>
        {days.map((day) => {
          const parts = [
            ["onsite", day.onsite_seconds],
            ["remote", day.remote_seconds],
            ["parallel", parallelOf(day)],
            ["frozen", day.frozen_seconds],
          ] as const;
          return (
            <li
              key={day.date}
              className="flex h-full min-w-0 flex-1 flex-col items-center justify-end"
              title={`${weekday.format(parse(day.date))}: ${
                parts
                  .filter(([, seconds]) => seconds > 0)
                  .map(([key, seconds]) => `${HOUR_LABELS[key]} ${formatHm(seconds)}`)
                  .join(", ") || "no work"
              }`}
            >
              <div
                className="flex w-full max-w-10 flex-col-reverse overflow-hidden rounded-t-sm"
                style={{ height: `${(total(day) / top) * 100}%` }}
              >
                {parts.map(([key, seconds]) =>
                  seconds > 0 ? (
                    <div
                      key={key}
                      style={{ height: `${(seconds / total(day)) * 100}%`, backgroundColor: HOUR_COLORS[key] }}
                    />
                  ) : null
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <ol className="flex gap-1">
        {days.map((day, index) => (
          <li key={day.date} className="min-w-0 flex-1 text-center text-[10px] text-tertiary">
            {crowded && index % 3 !== 0 ? "" : weekday.format(parse(day.date))}
          </li>
        ))}
      </ol>
      <HoursLegend hideParallel={hideParallel} />
    </div>
  );
}
