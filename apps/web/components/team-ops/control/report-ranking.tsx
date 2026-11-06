/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { orderBy } from "lodash-es";
import type { TReportPersonSummary } from "@plane/types";
import { cn } from "@plane/utils";
// components
import { PersonAvatar } from "../hub/person-avatar";
// local imports
import { ReportFilters, hours, usePeriod, useReportSummary } from "./report-shared";

type TSort = "hours" | "finished" | "on_time" | "days";

const SORTS: { value: TSort; label: string }[] = [
  { value: "hours", label: "Hours" },
  { value: "finished", label: "Tasks done" },
  { value: "on_time", label: "On time" },
  { value: "days", label: "Days reported" },
];

const MEDALS = ["#eab308", "#94a3b8", "#c2410c"];

/** Share of the tasks with a result that were Speedy or On time. */
const onTimeShare = (person: TReportPersonSummary) => {
  const judged = person.speedy + person.on_time + person.overtime;
  return judged ? (person.speedy + person.on_time) / judged : 0;
};
const daysReported = (person: TReportPersonSummary) => Object.keys(person.days).length;

/** Control, Ranking: who reported the most, finished the most and kept to the planned time best. */
export const ReportRanking = observer(function ReportRanking({ workspaceSlug }: { workspaceSlug: string }) {
  const periodState = usePeriod("month");
  const { period } = periodState;
  const [team, setTeam] = useState("");
  const [sort, setSort] = useState<TSort>("hours");
  const { data } = useReportSummary(workspaceSlug, { from: period.from, to: period.to, team });

  const value = (person: TReportPersonSummary) =>
    sort === "hours"
      ? person.total_minutes
      : sort === "finished"
        ? person.finished
        : sort === "on_time"
          ? onTimeShare(person)
          : daysReported(person);
  const rows = orderBy(data?.people ?? [], [value, (p) => p.total_minutes], ["desc", "desc"]);

  return (
    <div className="flex flex-col gap-4">
      <ReportFilters workspaceSlug={workspaceSlug} periodState={periodState} team={team} setTeam={setTeam} />
      <div role="group" aria-label="Rank by" className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-caption-sm-medium text-tertiary">Rank by</span>
        {SORTS.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={sort === item.value}
            onClick={() => setSort(item.value)}
            className={cn(
              "min-h-9 rounded-full border px-3 text-caption-sm-medium",
              sort === item.value
                ? "border-accent-strong bg-accent-subtle text-accent-primary"
                : "border-subtle text-secondary hover:bg-layer-1"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <ol className="flex flex-col gap-2">
        {rows.map((person, index) => {
          const share = onTimeShare(person);
          return (
            <li
              key={person.user.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-subtle bg-surface-1 px-3 py-2.5"
            >
              <span
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-body-sm-semibold"
                style={
                  index < 3 && value(person)
                    ? { backgroundColor: MEDALS[index], color: "white" }
                    : { color: "var(--text-color-tertiary)" }
                }
              >
                {index + 1}
              </span>
              <PersonAvatar person={person.user} />
              <span className="min-w-32 flex-1">
                <span className="block truncate text-body-sm-medium text-primary">{person.user.display_name}</span>
                <span className="text-caption-sm-regular text-tertiary">
                  {daysReported(person)} days reported
                  {person.reports_missing ? ` · ${person.reports_missing} missing` : ""}
                </span>
              </span>
              <dl className="grid grid-cols-4 gap-x-4 text-right">
                <div>
                  <dt className="text-caption-sm-regular text-tertiary">Hours</dt>
                  <dd className="text-body-sm-semibold text-primary tabular-nums">{hours(person.total_minutes)}</dd>
                </div>
                <div>
                  <dt className="text-caption-sm-regular text-tertiary">Done</dt>
                  <dd className="text-body-sm-semibold text-primary tabular-nums">
                    {person.finished}/{person.task_count}
                  </dd>
                </div>
                <div>
                  <dt className="text-caption-sm-regular text-tertiary">On time</dt>
                  <dd
                    className={cn(
                      "text-body-sm-semibold tabular-nums",
                      share >= 0.8 ? "text-success-primary" : share > 0 ? "text-warning-primary" : "text-tertiary"
                    )}
                  >
                    {person.speedy + person.on_time + person.overtime ? `${Math.round(share * 100)}%` : "–"}
                  </dd>
                </div>
                <div>
                  <dt className="text-caption-sm-regular text-tertiary">OverTime</dt>
                  <dd
                    className={cn(
                      "text-body-sm-semibold tabular-nums",
                      person.overtime ? "text-danger-primary" : "text-tertiary"
                    )}
                  >
                    {person.overtime}
                  </dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ol>
      <p className="text-caption-sm-regular text-tertiary">
        From the Day Reports of {period.label}. "On time" counts the tasks with a planned time that were Speedy or On
        time; OverTime ones went past their plan.
      </p>
    </div>
  );
});
