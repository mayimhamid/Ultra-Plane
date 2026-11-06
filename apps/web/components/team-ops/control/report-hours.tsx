/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { toDateKey } from "@plane/services";
import type { TReportPersonSummary } from "@plane/types";
import { cn } from "@plane/utils";
// components
import { DayReportCard } from "../day-report/day-report-card";
import { PersonAvatar } from "../hub/person-avatar";
// local imports
import {
  DayBars,
  PLACE_COLOR,
  ReportFilters,
  StatCard,
  dayLabel,
  hours,
  usePeriod,
  useReportSummary,
} from "./report-shared";

type Props = { workspaceSlug: string };

// A full working day: the darkest cell.
const FULL_DAY = 8 * 60;

/** One person's day, opened from the grid: the tasks, their times and the day's total, with its edits. */
function DayPanel({
  workspaceSlug,
  person,
  date,
  days,
  onDate,
  onClose,
}: {
  workspaceSlug: string;
  person: TReportPersonSummary;
  date: string;
  days: string[];
  onDate: (date: string) => void;
  onClose: () => void;
}) {
  const index = days.indexOf(date);
  // Escape closes the panel wherever the focus is.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const label = dayLabel(date).date.toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long" });
  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/30"
      role="presentation"
      // Only a tap on the dimmed area closes it, not one inside the panel.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${person.user.display_name}, ${label}`}
        className="flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-subtle bg-canvas shadow-raised-300"
      >
        <header className="flex items-center gap-3 border-b border-subtle bg-surface-1 px-4 py-3">
          <PersonAvatar person={person.user} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-body-md-medium text-primary">{person.user.display_name}</p>
            <p className="text-caption-sm-regular text-tertiary">
              {label} · {hours(person.days[date] ?? 0)}
            </p>
          </div>
          <button
            type="button"
            aria-label="Previous day"
            disabled={index <= 0}
            onClick={() => onDate(days[index - 1])}
            className="inline-flex size-9 items-center justify-center rounded-md border border-subtle disabled:opacity-40"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Next day"
            disabled={index >= days.length - 1}
            onClick={() => onDate(days[index + 1])}
            className="inline-flex size-9 items-center justify-center rounded-md border border-subtle disabled:opacity-40"
          >
            <ChevronRight className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="inline-flex size-9 items-center justify-center rounded-md hover:bg-layer-1"
          >
            <X className="size-5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4">
          {date > toDateKey(new Date()) ? (
            <p className="text-body-sm-regular text-tertiary">This day has not come yet.</p>
          ) : (
            <DayReportCard workspaceSlug={workspaceSlug} day={date} user={person.user.id} canSeeHistory />
          )}
        </div>
      </aside>
    </div>
  );
}

/**
 * Control, Hours: what everyone reported, as a week or a month. The totals on top, the hours per day, and one
 * row per person; a tap on a day opens what that person worked on, task by task, and the day's total.
 */
export const ReportHours = observer(function ReportHours({ workspaceSlug }: Props) {
  const periodState = usePeriod("week");
  const { period } = periodState;
  const [team, setTeam] = useState("");
  const [place, setPlace] = useState("");
  const [open, setOpen] = useState<{ user: string; date: string } | null>(null);
  const { data, isLoading, error } = useReportSummary(workspaceSlug, { from: period.from, to: period.to, team, place });
  const today = toDateKey(new Date());
  const people = data?.people ?? [];
  const totals = data?.totals;
  const openPerson = open ? people.find((person) => person.user.id === open.user) : undefined;
  const reporting = people.filter((person) => person.total_minutes > 0).length;

  return (
    <div className="flex flex-col gap-4">
      <ReportFilters
        workspaceSlug={workspaceSlug}
        periodState={periodState}
        team={team}
        setTeam={setTeam}
        place={place}
        setPlace={setPlace}
      />

      {error ? (
        <p role="alert" className="text-body-sm-medium text-danger-primary">
          The hours could not be loaded. Reload the page to try again.
        </p>
      ) : null}

      {totals ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatCard label="Hours reported" value={hours(totals.minutes)} hint={period.label} />
          <StatCard
            label="Per person"
            value={hours(reporting ? Math.round(totals.minutes / reporting) : 0)}
            hint={`${reporting} of ${totals.people} reported`}
          />
          <StatCard
            label="Remote · Onsite"
            value={`${Math.round(totals.remote_minutes / 60)}h · ${Math.round(totals.onsite_minutes / 60)}h`}
          />
          <StatCard
            label="Reports missing"
            value={totals.reports_missing}
            hint={`${totals.reports_sent} sent · ${totals.reports_late} late`}
            tone={totals.reports_missing ? "warn" : "good"}
          />
          <StatCard label="Changed after sending" value={totals.edits} tone={totals.edits ? "warn" : undefined} />
          <StatCard
            label="Tasks OverTime"
            value={totals.overtime}
            hint={`${totals.speedy} Speedy · ${totals.on_time} On time`}
            tone={totals.overtime ? "bad" : "good"}
          />
        </div>
      ) : null}

      {data ? (
        <section aria-label="Hours per day" className="rounded-lg border border-subtle bg-surface-1 p-4">
          <h2 className="mb-2 text-body-sm-medium text-primary">Team hours per day</h2>
          <DayBars days={data.days} height={period.mode === "week" ? 140 : 110} />
        </section>
      ) : null}

      <section aria-label="Hours per person" className="overflow-hidden rounded-lg border border-subtle bg-surface-1">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-subtle px-4 py-3">
          <h2 className="text-body-sm-medium text-primary">Hours per person</h2>
          <span className="text-caption-sm-regular text-tertiary">
            Tap a day to see the tasks and times of that day.
          </span>
        </header>
        <div className="overflow-x-auto overscroll-x-contain">
          <table className="w-full border-collapse text-left">
            <thead className="text-caption-sm-medium text-tertiary">
              <tr>
                <th scope="col" className="sticky left-0 z-[1] min-w-40 bg-surface-1 px-3 py-2">
                  Person
                </th>
                {period.days.map((day) => {
                  const label = dayLabel(day);
                  return (
                    <th
                      key={day}
                      scope="col"
                      className={cn("px-1 py-2 text-center", day === today && "text-accent-primary")}
                    >
                      <span className="font-normal block text-[10px]">{label.weekday}</span>
                      {label.day}
                    </th>
                  );
                })}
                <th scope="col" className="px-3 py-2 text-right">
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {people.map((person) => (
                <tr key={person.user.id}>
                  <th scope="row" className="font-normal sticky left-0 z-[1] bg-surface-1 px-3 py-1.5">
                    <span className="flex items-center gap-2">
                      <PersonAvatar person={person.user} size="sm" />
                      <span className="min-w-0">
                        <span className="block truncate text-body-sm-medium text-primary">
                          {person.user.display_name}
                        </span>
                        {person.reports_missing ? (
                          <span className="text-caption-sm-regular text-warning-primary">
                            {person.reports_missing} report{person.reports_missing === 1 ? "" : "s"} missing
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </th>
                  {period.days.map((day) => {
                    const minutes = person.days[day] ?? 0;
                    const where = person.places[day];
                    const strength = Math.min(1, minutes / FULL_DAY);
                    return (
                      <td key={day} className="p-0.5 text-center">
                        <button
                          type="button"
                          disabled={day > today}
                          onClick={() => setOpen({ user: person.user.id, date: day })}
                          title={`${person.user.display_name}, ${day}: ${hours(minutes)}${where ? ` (${where.toLowerCase()})` : ""}`}
                          className={cn(
                            "relative flex h-11 w-full min-w-11 flex-col items-center justify-center rounded-md text-caption-sm-medium tabular-nums",
                            "hover:ring-2 hover:ring-accent-strong disabled:opacity-40",
                            minutes ? "text-primary" : "text-tertiary"
                          )}
                          style={{
                            backgroundColor: minutes
                              ? `color-mix(in oklab, var(--background-color-accent-primary) ${Math.round(15 + strength * 55)}%, transparent)`
                              : undefined,
                          }}
                        >
                          {minutes ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}` : "·"}
                          {where ? (
                            <span
                              aria-hidden
                              className="absolute right-1 bottom-1 size-1.5 rounded-full"
                              style={{ backgroundColor: PLACE_COLOR[where] }}
                            />
                          ) : null}
                        </button>
                      </td>
                    );
                  })}
                  <td className="px-3 py-1.5 text-right text-body-sm-semibold text-primary tabular-nums">
                    {hours(person.total_minutes)}
                  </td>
                </tr>
              ))}
              {!isLoading && people.length === 0 ? (
                <tr>
                  <td
                    colSpan={period.days.length + 2}
                    className="px-4 py-6 text-center text-body-sm-regular text-tertiary"
                  >
                    Nobody here.
                  </td>
                </tr>
              ) : null}
            </tbody>
            {people.length > 0 && data ? (
              <tfoot className="border-t border-subtle text-caption-sm-medium text-secondary">
                <tr>
                  <th scope="row" className="sticky left-0 z-[1] bg-surface-1 px-3 py-2 text-left">
                    Team
                  </th>
                  {data.days.map((day) => (
                    <td key={day.date} className="px-1 py-2 text-center tabular-nums">
                      {day.minutes ? Math.round(day.minutes / 6) / 10 : ""}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right text-primary tabular-nums">{hours(data.totals.minutes)}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
        <p className="flex flex-wrap gap-3 border-t border-subtle px-4 py-2 text-caption-sm-regular text-tertiary">
          {Object.entries(PLACE_COLOR).map(([key, color]) => (
            <span key={key} className="flex items-center gap-1">
              <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
              {key.charAt(0) + key.slice(1).toLowerCase()}
            </span>
          ))}
          <span>Darker means more hours (8h is full).</span>
        </p>
      </section>

      {open && openPerson ? (
        <DayPanel
          workspaceSlug={workspaceSlug}
          person={openPerson}
          date={open.date}
          days={period.days}
          onDate={(date) => setOpen({ user: open.user, date })}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
});
