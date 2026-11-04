/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useState } from "react";
import useSWR from "swr";
import { WorkdayService, buildHeatGrid, formatHm } from "@plane/services";
import type { THeatMetric } from "@plane/services";
import { cn } from "@plane/utils";

const workdayService = new WorkdayService();

type Props = { workspaceSlug: string; userId?: string };

// Steps of blue, mixed with the page's own surface so they read in light and dark themes.
const LEVEL_COLOR = [
  "var(--background-color-layer-1)",
  "color-mix(in oklab, var(--background-color-accent-primary) 28%, var(--background-color-layer-1))",
  "color-mix(in oklab, var(--background-color-accent-primary) 52%, var(--background-color-layer-1))",
  "color-mix(in oklab, var(--background-color-accent-primary) 76%, var(--background-color-layer-1))",
  "var(--background-color-accent-primary)",
];

const ROW_LABELS = [
  { key: "sat", label: "Sat" },
  { key: "sun", label: "" },
  { key: "mon", label: "Mon" },
  { key: "tue", label: "" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "" },
  { key: "fri", label: "Fri" },
];
const month = new Intl.DateTimeFormat("en-US", { month: "short" });
const full = new Intl.DateTimeFormat("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const parse = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** A year of work, one square per day, like a contribution graph: darker blue means more tasks (or hours). */
export function ContributionGraph({ workspaceSlug, userId }: Props) {
  const [metric, setMetric] = useState<THeatMetric>("tasks");
  // Today's square counts the running timer too, so it is refreshed every minute.
  const { data } = useSWR(
    `TEAM_OPS_HEATMAP_${workspaceSlug}_${userId ?? "me"}`,
    () => workdayService.getHeatmap(workspaceSlug, userId),
    { refreshInterval: 60_000 }
  );
  const grid = useMemo(() => (data ? buildHeatGrid(data.from, data.to, data.days, metric) : []), [data, metric]);

  const totalTasks = (data?.days ?? []).reduce((sum, day) => sum + day.tasks, 0);
  const totalSeconds = (data?.days ?? []).reduce((sum, day) => sum + day.seconds, 0);
  const activeDays = (data?.days ?? []).length;

  // Every week and every square gets a stable key from its dates.
  const weeks = grid.map((week, index) => {
    const firstDay = week.find((cell) => cell !== null);
    const anchor = firstDay?.date ?? `week-${index}`;
    // A month name goes above the first column that starts in that month.
    const previous = index > 0 ? grid[index - 1].find((cell) => cell !== null) : null;
    const date = firstDay ? parse(firstDay.date) : null;
    const label = date && (!previous || parse(previous.date).getMonth() !== date.getMonth()) ? month.format(date) : "";
    return {
      key: anchor,
      label,
      cells: week.map((cell, row) => ({ key: cell?.date ?? `${anchor}-pad-${row}`, cell })),
    };
  });

  return (
    <section
      aria-label="Work in the last year"
      className="flex flex-col gap-3 rounded-lg border border-subtle bg-surface-1 p-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-body-md-medium text-primary">
            {metric === "tasks" ? `${totalTasks} task days` : `${formatHm(totalSeconds)} worked`} in the last year
          </h3>
          <p className="text-caption-sm-regular text-tertiary">
            {activeDays} days with finished work · weeks run Saturday to Friday
          </p>
        </div>
        <div role="group" aria-label="Measure" className="flex gap-1 rounded-lg border border-subtle p-0.5">
          {(["tasks", "hours"] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={metric === item}
              onClick={() => setMetric(item)}
              className={cn(
                "rounded-md px-3 py-1 text-body-xs-medium",
                metric === item ? "bg-accent-subtle text-accent-primary" : "text-tertiary hover:text-secondary"
              )}
            >
              {item === "tasks" ? "Tasks" : "Hours"}
            </button>
          ))}
        </div>
      </header>

      <div className="overflow-x-auto pb-1">
        <div className="flex min-w-max gap-2">
          <div className="flex flex-col gap-[3px] pt-[18px]">
            {ROW_LABELS.map((row) => (
              <span key={row.key} className="h-[11px] text-[10px] leading-[11px] text-tertiary">
                {row.label}
              </span>
            ))}
          </div>
          <div>
            <div className="flex gap-[3px]">
              {weeks.map(({ key, label }) => (
                <span
                  key={key}
                  className="h-[15px] w-[11px] overflow-visible text-[10px] whitespace-nowrap text-tertiary"
                >
                  {label}
                </span>
              ))}
            </div>
            <div className="mt-[3px] flex gap-[3px]">
              {weeks.map((week) => (
                <div key={week.key} className="flex flex-col gap-[3px]">
                  {week.cells.map(({ key, cell }) =>
                    cell ? (
                      <div
                        key={key}
                        className="size-[11px] rounded-[2px]"
                        style={{ backgroundColor: LEVEL_COLOR[cell.level] }}
                        title={`${
                          cell.tasks === 0
                            ? "No work"
                            : `${cell.tasks} task${cell.tasks === 1 ? "" : "s"} · ${formatHm(cell.seconds)}`
                        } on ${full.format(parse(cell.date))}`}
                      />
                    ) : (
                      <div key={key} className="size-[11px]" />
                    )
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <footer className="flex items-center justify-end gap-1 text-caption-sm-regular text-tertiary">
        Less
        {LEVEL_COLOR.map((color) => (
          <span key={color} className="size-[11px] rounded-[2px]" style={{ backgroundColor: color }} />
        ))}
        More
      </footer>
    </section>
  );
}
