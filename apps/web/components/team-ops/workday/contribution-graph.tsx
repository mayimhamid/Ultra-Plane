/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import useSWR from "swr";
import { WorkdayService, buildHeatGrid, formatHm, toDateKey } from "@plane/services";
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

// Weeks run Saturday to Friday.
const ROW_LABELS = [
  { key: "sat", label: "Sat", short: "S" },
  { key: "sun", label: "", short: "S" },
  { key: "mon", label: "Mon", short: "M" },
  { key: "tue", label: "", short: "T" },
  { key: "wed", label: "Wed", short: "W" },
  { key: "thu", label: "", short: "T" },
  { key: "fri", label: "Fri", short: "F" },
];
const SATURDAY = 6;
const LABEL_COLUMN = "1.75rem";
// The same gap between squares, across and down.
const GAP = "4px";
const monthShort = new Intl.DateTimeFormat("en-US", { month: "short" });
const monthLong = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const full = new Intl.DateTimeFormat("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const parse = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const two = (value: number) => String(value).padStart(2, "0");

type Cell = { date: string; level: number; tasks: number; seconds: number };

const describe = (cell: Cell) =>
  `${cell.tasks === 0 ? "No work" : `${cell.tasks} task${cell.tasks === 1 ? "" : "s"} · ${formatHm(cell.seconds)}`} on ${full.format(parse(cell.date))}`;

type MonthRow = { key: string; cells: { key: string; cell: Cell | null }[] };

/** The days of one month in rows of Saturday to Friday; the first and last week are padded with empty cells. */
const monthRows = (year: number, month: number, byDate: Map<string, Cell>): MonthRow[] => {
  const lead = (new Date(year, month, 1).getDay() - SATURDAY + 7) % 7;
  const count = new Date(year, month + 1, 0).getDate();
  const cells: (Cell | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: count }, (_, index) => {
      const date = `${year}-${two(month + 1)}-${two(index + 1)}`;
      return byDate.get(date) ?? { date, level: 0, tasks: 0, seconds: 0 };
    }),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, week) => {
    const row = cells.slice(week * 7, week * 7 + 7);
    const key = row.find((cell) => cell)?.date ?? `week-${week}`;
    return { key, cells: row.map((cell, column) => ({ key: cell?.date ?? `${key}-pad-${column}`, cell })) };
  });
};

/**
 * The year of work, one square per day, like a contribution graph: darker blue means more tasks (or hours). The
 * whole calendar year is shown, up to its last day, and fits the width (no scrolling). On a phone one month at a
 * time is shown, with bigger squares.
 */
export function ContributionGraph({ workspaceSlug, userId }: Props) {
  const [metric, setMetric] = useState<THeatMetric>("tasks");
  const today = toDateKey(new Date());
  const year = Number(today.slice(0, 4));
  const [viewMonth, setViewMonth] = useState(Number(today.slice(5, 7)) - 1);
  const [picked, setPicked] = useState<string | null>(null);
  // Today's square counts the running timer too, so it is refreshed every minute.
  const { data } = useSWR(
    `TEAM_OPS_HEATMAP_${workspaceSlug}_${userId ?? "me"}`,
    () => workdayService.getHeatmap(workspaceSlug, userId),
    { refreshInterval: 60_000 }
  );
  const days = useMemo(() => (data?.days ?? []).filter((day) => day.date.startsWith(`${year}-`)), [data, year]);
  const grid = useMemo(() => buildHeatGrid(`${year}-01-01`, `${year}-12-31`, days, metric), [days, metric, year]);
  const byDate = useMemo(() => {
    const map = new Map<string, Cell>();
    for (const cell of grid.flat()) if (cell) map.set(cell.date, cell);
    return map;
  }, [grid]);
  const rowsOfMonth = useMemo(() => monthRows(year, viewMonth, byDate), [year, viewMonth, byDate]);

  const totalTasks = days.reduce((sum, day) => sum + day.tasks, 0);
  const totalSeconds = days.reduce((sum, day) => sum + day.seconds, 0);
  const activeDays = days.length;
  const pickedCell = picked ? byDate.get(picked) : undefined;

  // Every week and every square gets a stable key from its dates.
  const weeks = grid.map((week, index) => {
    const firstDay = week.find((cell) => cell !== null);
    const anchor = firstDay?.date ?? `week-${index}`;
    // A month name goes above the first column that starts in that month.
    const previous = index > 0 ? grid[index - 1].find((cell) => cell !== null) : null;
    const date = firstDay ? parse(firstDay.date) : null;
    const label =
      date && (!previous || parse(previous.date).getMonth() !== date.getMonth()) ? monthShort.format(date) : "";
    return {
      key: anchor,
      label,
      cells: week.map((cell, row) => ({ key: cell?.date ?? `${anchor}-pad-${row}`, cell })),
    };
  });
  // Squares are exactly as wide as they are tall: their size comes from the width of the box (container units),
  // so the gap is the same between columns and between rows, whatever the width.
  const cellSize = `calc((100cqw - ${LABEL_COLUMN} - ${weeks.length} * ${GAP}) / ${weeks.length})`;
  const columns = `${LABEL_COLUMN} repeat(${weeks.length}, var(--cell))`;

  return (
    <section
      aria-label={`Work in ${year}`}
      className="flex flex-col gap-3 rounded-lg border border-subtle bg-surface-1 p-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-body-md-medium text-primary">
            {metric === "tasks"
              ? `${totalTasks} task${totalTasks === 1 ? "" : "s"} finished`
              : `${formatHm(totalSeconds)} worked`}{" "}
            in {year}
          </h3>
          <p className="text-caption-sm-regular text-tertiary">
            {activeDays} day{activeDays === 1 ? "" : "s"} with finished work · weeks run Saturday to Friday
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
                "min-h-8 rounded-md px-3 py-1 text-body-xs-medium",
                metric === item ? "bg-accent-subtle text-accent-primary" : "text-tertiary hover:text-secondary"
              )}
            >
              {item === "tasks" ? "Tasks" : "Hours"}
            </button>
          ))}
        </div>
      </header>

      {/* Wide screens: the whole year, squares that grow with the width. */}
      <div
        className="hidden md:block"
        style={{ containerType: "inline-size", "--cell": cellSize, "--gap": GAP } as CSSProperties}
      >
        <div className="grid gap-x-[var(--gap)]" style={{ gridTemplateColumns: columns }}>
          <span />
          {weeks.map(({ key, label }) => (
            <span key={key} className="h-[15px] overflow-visible text-[10px] whitespace-nowrap text-tertiary">
              {label}
            </span>
          ))}
        </div>
        <div
          className="mt-[var(--gap)] grid grid-flow-col gap-[var(--gap)]"
          style={{ gridTemplateColumns: columns, gridTemplateRows: "repeat(7, var(--cell))" }}
        >
          {ROW_LABELS.map((row) => (
            <span key={row.key} className="flex items-center text-[10px] text-tertiary">
              {row.label}
            </span>
          ))}
          {weeks.flatMap((week) =>
            week.cells.map(({ key, cell }) =>
              cell ? (
                <div
                  key={key}
                  className={cn("rounded-[3px]", cell.date > today && "opacity-40")}
                  style={{ backgroundColor: LEVEL_COLOR[cell.level] }}
                  title={describe(cell)}
                />
              ) : (
                <div key={key} />
              )
            )
          )}
        </div>
      </div>

      {/* Phones: one month at a time, so nothing scrolls. */}
      <div className="flex flex-col gap-3 md:hidden">
        <div className="flex items-center justify-between">
          <button
            type="button"
            aria-label="Previous month"
            disabled={viewMonth === 0}
            onClick={() => {
              setViewMonth(viewMonth - 1);
              setPicked(null);
            }}
            className="inline-flex size-10 items-center justify-center rounded-full border border-subtle text-secondary hover:bg-layer-1 disabled:opacity-40"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <span className="text-body-sm-medium text-primary">{monthLong.format(new Date(year, viewMonth, 1))}</span>
          <button
            type="button"
            aria-label="Next month"
            disabled={viewMonth === 11}
            onClick={() => {
              setViewMonth(viewMonth + 1);
              setPicked(null);
            }}
            className="inline-flex size-10 items-center justify-center rounded-full border border-subtle text-secondary hover:bg-layer-1 disabled:opacity-40"
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] text-tertiary">
          {ROW_LABELS.map((row) => (
            <span key={row.key}>{row.short}</span>
          ))}
        </div>
        <div className="flex flex-col gap-1.5">
          {rowsOfMonth.map((week) => (
            <div key={week.key} className="grid grid-cols-7 gap-1.5">
              {week.cells.map(({ key, cell }) =>
                cell ? (
                  <button
                    key={key}
                    type="button"
                    aria-label={describe(cell)}
                    aria-pressed={picked === cell.date}
                    onClick={() => setPicked(picked === cell.date ? null : cell.date)}
                    className={cn(
                      "flex aspect-square items-center justify-center rounded-md text-[12px] tabular-nums",
                      cell.level >= 3 ? "text-on-color" : "text-secondary",
                      cell.date > today && "opacity-40",
                      picked === cell.date && "ring-2 ring-accent-strong",
                      cell.date === today && "font-semibold"
                    )}
                    style={{ backgroundColor: LEVEL_COLOR[cell.level] }}
                  >
                    {Number(cell.date.slice(8))}
                  </button>
                ) : (
                  <span key={key} className="aspect-square" />
                )
              )}
            </div>
          ))}
        </div>
        <p className="min-h-5 text-caption-sm-regular text-secondary">
          {pickedCell ? describe(pickedCell) : "Tap a day to see its work."}
        </p>
      </div>

      <footer className="flex items-center justify-end gap-1 text-caption-sm-regular text-tertiary">
        Less
        {LEVEL_COLOR.map((color) => (
          <span key={color} className="size-[11px] rounded-[3px]" style={{ backgroundColor: color }} />
        ))}
        More
      </footer>
    </section>
  );
}
