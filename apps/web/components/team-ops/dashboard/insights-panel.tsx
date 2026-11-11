/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import type { TLoadStatus, TRiskLevel } from "@plane/types";
import { cn } from "@plane/utils";
import { StatCard, hours } from "@/components/team-ops/control/report-shared";
import { useMember } from "@/hooks/store/use-member";
import { useInsights } from "@/hooks/team-ops/use-work-reports";

const LEVEL_STYLE: Record<TRiskLevel, string> = {
  HIGH: "bg-danger-subtle text-danger-primary",
  MEDIUM: "bg-warning-subtle text-warning-primary",
  LOW: "bg-layer-1 text-tertiary",
  NONE: "bg-layer-1 text-tertiary",
};

const LOAD_LABEL: Record<TLoadStatus, string> = {
  OVERLOADED: "Overloaded",
  BALANCED: "Balanced",
  LIGHT: "Light",
  UNKNOWN: "No plan to compare",
};

type Props = { workspaceSlug: string; from: string; to: string; team: string };

/** Task risk and workload, computed on the server from due dates, assignments, planned and logged time. */
export const InsightsPanel = observer(function InsightsPanel({ workspaceSlug, from, to, team }: Props) {
  const { getUserDetails } = useMember();
  const { insights, error } = useInsights(workspaceSlug, true, { from, to, team: team || undefined });
  const name = (id: string) => getUserDetails(id)?.display_name ?? "Unknown";

  if (error) return <p className="text-body-sm-regular text-tertiary">Task risk could not be loaded.</p>;
  if (!insights) return null;
  const { risks, workload } = insights;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Open tasks" value={risks.open_tasks} />
        <StatCard label="High risk" value={risks.summary.HIGH} tone={risks.summary.HIGH ? "bad" : undefined} />
        <StatCard label="Medium risk" value={risks.summary.MEDIUM} tone={risks.summary.MEDIUM ? "warn" : undefined} />
        <StatCard label="Unassigned" value={workload.unassigned_tasks} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="Tasks at risk" className="rounded-lg border border-subtle bg-surface-1 p-4">
          <h2 className="mb-3 text-body-sm-medium text-primary">Tasks at risk</h2>
          {risks.tasks.length === 0 ? (
            <p className="text-body-sm-regular text-tertiary">No open task carries risk.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-subtle">
              {risks.tasks.map((task) => (
                <li key={task.issue} className="flex flex-col gap-1 py-2">
                  <span className="flex items-center justify-between gap-2 text-body-sm-regular">
                    <span className="min-w-0 truncate text-primary">
                      <span className="text-tertiary">{task.key} </span>
                      {task.name}
                    </span>
                    <span
                      className={cn("shrink-0 rounded px-1.5 py-0.5 text-caption-sm-medium", LEVEL_STYLE[task.level])}
                    >
                      {task.level.toLowerCase()} · {task.score}
                    </span>
                  </span>
                  <span className="text-caption-sm-regular text-tertiary">
                    {task.factors.map((factor) => factor.detail).join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-label="Workload" className="rounded-lg border border-subtle bg-surface-1 p-4">
          <h2 className="mb-3 text-body-sm-medium text-primary">Workload</h2>
          <p className="-mt-2 mb-3 text-caption-sm-regular text-tertiary">
            Planned time still to do, against the hours in each person&apos;s calendar for this period.
          </p>
          {workload.people.length === 0 ? (
            <p className="text-body-sm-regular text-tertiary">Nobody to show.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-subtle">
              {workload.people.map((person) => (
                <li key={person.user} className="flex items-center justify-between gap-2 py-2 text-body-sm-regular">
                  <span className="min-w-0 truncate text-primary">{name(person.user)}</span>
                  <span className="shrink-0 text-tertiary tabular-nums">
                    {person.open_tasks} open
                    {person.overdue_tasks ? ` · ${person.overdue_tasks} overdue` : ""} ·{" "}
                    {hours(Math.round(person.remaining_seconds / 60))} of{" "}
                    {hours(Math.round(person.capacity_seconds / 60))} · {LOAD_LABEL[person.status]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <p className="text-caption-sm-regular text-tertiary">{insights.notice}</p>
    </div>
  );
});
