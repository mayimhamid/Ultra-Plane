/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import useSWR from "swr";
import { formatMinutes, toDateKey } from "@plane/services";
import type { TReportSummary } from "@plane/types";
import { cn } from "@plane/utils";
// hooks
import { dayReportService } from "@/hooks/team-ops/use-day-report";
import { useOpsTeams } from "@/hooks/team-ops/use-work-calendar";

export type TPeriodMode = "week" | "month";
export type TPeriod = { mode: TPeriodMode; from: string; to: string; label: string; days: string[] };

// Weeks run Saturday to Friday in this workspace.
const SATURDAY = 6;
const parse = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const short = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" });
const monthName = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });

const periodOf = (mode: TPeriodMode, anchor: Date): TPeriod => {
  let first: Date;
  let last: Date;
  if (mode === "week") {
    first = new Date(
      anchor.getFullYear(),
      anchor.getMonth(),
      anchor.getDate() - ((anchor.getDay() - SATURDAY + 7) % 7)
    );
    last = new Date(first.getFullYear(), first.getMonth(), first.getDate() + 6);
  } else {
    first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  }
  const days: string[] = [];
  for (let day = new Date(first); day <= last; day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1))
    days.push(toDateKey(day));
  return {
    mode,
    from: toDateKey(first),
    to: toDateKey(last),
    days,
    label: mode === "week" ? `${short.format(first)} – ${short.format(last)}` : monthName.format(first),
  };
};

/** A week (Saturday to Friday) or a month, moved with the arrows; starts on the current one. */
export const usePeriod = (initial: TPeriodMode = "week") => {
  const [mode, setMode] = useState<TPeriodMode>(initial);
  const [anchor, setAnchor] = useState(() => new Date());
  const period = useMemo(() => periodOf(mode, anchor), [mode, anchor]);
  const move = (step: number) =>
    setAnchor((current) =>
      mode === "week"
        ? new Date(current.getFullYear(), current.getMonth(), current.getDate() + step * 7)
        : new Date(current.getFullYear(), current.getMonth() + step, 1)
    );
  const isCurrent = period.days.includes(toDateKey(new Date()));
  return { period, mode, setMode, move, isCurrent, reset: () => setAnchor(new Date()) };
};

const PLACES = [
  { value: "", label: "All" },
  { value: "REMOTE", label: "Remote" },
  { value: "ONSITE", label: "Onsite" },
  { value: "HYBRID", label: "Hybrid" },
];

type FiltersProps = {
  workspaceSlug: string;
  periodState: ReturnType<typeof usePeriod>;
  team: string;
  setTeam: (team: string) => void;
  place?: string;
  setPlace?: (place: string) => void;
};

/** Week / Month, the arrows, the team and (optionally) where people worked. */
export function ReportFilters({ workspaceSlug, periodState, team, setTeam, place, setPlace }: FiltersProps) {
  const { teams } = useOpsTeams(workspaceSlug);
  const { period, mode, setMode, move, isCurrent, reset } = periodState;
  const chip = (active: boolean) =>
    cn(
      "min-h-9 rounded-md px-3 text-body-xs-medium",
      active ? "bg-accent-primary text-on-color" : "text-secondary hover:bg-layer-1"
    );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="Period" className="flex rounded-md border border-subtle p-0.5">
        {(["week", "month"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
            className={chip(mode === value)}
          >
            {value === "week" ? "Week" : "Month"}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={`Previous ${mode}`}
          onClick={() => move(-1)}
          className="inline-flex size-9 items-center justify-center rounded-md border border-subtle hover:bg-layer-1"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="min-w-36 text-center text-body-sm-medium text-primary">{period.label}</span>
        <button
          type="button"
          aria-label={`Next ${mode}`}
          onClick={() => move(1)}
          className="inline-flex size-9 items-center justify-center rounded-md border border-subtle hover:bg-layer-1"
        >
          <ChevronRight className="size-4" />
        </button>
        {!isCurrent ? (
          <button
            type="button"
            onClick={reset}
            className="min-h-9 px-2 text-body-xs-medium text-accent-primary hover:underline"
          >
            {mode === "week" ? "This week" : "This month"}
          </button>
        ) : null}
      </div>
      <select
        value={team}
        aria-label="Team"
        onChange={(event) => setTeam(event.target.value)}
        className="h-9 rounded-md border border-subtle bg-layer-1 px-2 text-body-xs-medium text-primary"
      >
        <option value="">All teams</option>
        {(teams ?? []).map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      {setPlace ? (
        <div role="group" aria-label="Where they worked" className="flex rounded-md border border-subtle p-0.5">
          {PLACES.map((item) => (
            <button
              key={item.value || "all"}
              type="button"
              aria-pressed={place === item.value}
              onClick={() => setPlace(item.value)}
              className={chip(place === item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export const useReportSummary = (
  workspaceSlug: string,
  params: { from: string; to: string; team?: string; place?: string },
  enabled = true
) =>
  useSWR<TReportSummary>(
    enabled ? `TEAM_OPS_REPORT_SUMMARY_${workspaceSlug}_${JSON.stringify(params)}` : null,
    () =>
      dayReportService.getSummary(workspaceSlug, {
        from: params.from,
        to: params.to,
        ...(params.team ? { team: params.team } : {}),
        ...(params.place ? { place: params.place } : {}),
      }),
    { keepPreviousData: true }
  );

/** Hours as "7h 30m"; an empty day is a dash. */
export const hours = (minutes: number) => (minutes > 0 ? formatMinutes(minutes) : "–");

export function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "good" | "warn" | "bad";
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-subtle bg-surface-1 px-4 py-3">
      <span className="text-caption-sm-regular text-tertiary">{label}</span>
      <span
        className={cn(
          "text-h4-medium tabular-nums",
          tone === "good"
            ? "text-success-primary"
            : tone === "warn"
              ? "text-warning-primary"
              : tone === "bad"
                ? "text-danger-primary"
                : "text-primary"
        )}
      >
        {value}
      </span>
      {hint ? <span className="truncate text-caption-sm-regular text-tertiary">{hint}</span> : null}
    </div>
  );
}

const REMOTE = "#0284c7";
const ONSITE = "#16a34a";

/** One bar per day: onsite and remote hours stacked, the total on top. */
export function DayBars({
  days,
  onSelect,
  height = 140,
}: {
  days: TReportSummary["days"];
  onSelect?: (date: string) => void;
  height?: number;
}) {
  const max = Math.max(60, ...days.map((day) => day.minutes));
  const today = toDateKey(new Date());
  return (
    <div>
      <div className="flex items-end gap-1 overflow-x-auto pb-1" style={{ height: height + 40 }}>
        {days.map((day) => {
          const date = parse(day.date);
          const other = Math.max(0, day.minutes - day.remote_minutes - day.onsite_minutes);
          return (
            <button
              key={day.date}
              type="button"
              disabled={!onSelect}
              onClick={() => onSelect?.(day.date)}
              title={`${short.format(date)}: ${hours(day.minutes)} by ${day.people} people`}
              className="flex min-w-7 flex-1 flex-col items-center gap-1 rounded-sm disabled:cursor-default"
            >
              <span className="flex w-full flex-col-reverse overflow-hidden rounded-sm bg-layer-1" style={{ height }}>
                <span style={{ height: `${(day.onsite_minutes / max) * 100}%`, backgroundColor: ONSITE }} />
                <span style={{ height: `${(day.remote_minutes / max) * 100}%`, backgroundColor: REMOTE }} />
                <span
                  style={{ height: `${(other / max) * 100}%` }}
                  className="bg-[var(--background-color-accent-primary)]"
                />
              </span>
              <span
                className={cn(
                  "flex flex-col items-center text-[10px] leading-tight tabular-nums",
                  day.date === today ? "font-semibold text-accent-primary" : "text-tertiary"
                )}
              >
                <span>{date.getDate()}</span>
                <span className="text-secondary">{day.minutes ? Math.round(day.minutes / 6) / 10 : "·"}</span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-1 flex gap-3 text-caption-sm-regular text-tertiary">
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-sm" style={{ backgroundColor: ONSITE }} /> Onsite
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-sm" style={{ backgroundColor: REMOTE }} /> Remote
        </span>
        <span>Numbers are hours.</span>
      </p>
    </div>
  );
}

export const PLACE_COLOR: Record<string, string> = { REMOTE, ONSITE, HYBRID: "#7c3aed" };
export const dayLabel = (key: string) => {
  const date = parse(key);
  return { weekday: date.toLocaleDateString("en-US", { weekday: "short" }), day: date.getDate(), date };
};
