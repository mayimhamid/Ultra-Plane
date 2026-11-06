/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { useSearchParams } from "react-router";
import { CALENDAR_KINDS, toDateKey } from "@plane/services";
import type { TCalendarKind } from "@plane/types";
import { cn } from "@plane/utils";
// components
import { ButtonAvatars } from "@/components/dropdowns/member/avatar";
import { DAY_KIND_META, DayKindDot } from "@/components/team-ops/calendar/work-mode";
import { ControlRoot } from "@/components/team-ops/control";
import {
  DayBars,
  ReportFilters,
  StatCard,
  hours,
  usePeriod,
  useReportSummary,
} from "@/components/team-ops/control/report-shared";
import { VerdictBadge } from "@/components/team-ops/day-report/verdict-badge";
import { PersonAvatar } from "@/components/team-ops/hub/person-avatar";
import { TasksView } from "@/components/team-ops/tasks";
// hooks
import { useMember } from "@/hooks/store/use-member";
import { useCalendarSettings } from "@/hooks/team-ops/use-work-calendar";
import { useDashboard } from "@/hooks/team-ops/use-work-reports";

type Props = { workspaceSlug: string };

/**
 * One page for managers, from the Day Reports: the hours of the week or month, who is where today, time per
 * project, the tasks and how they are going, and everyone's numbers. Tap a day in the chart to open Control.
 */
const DashboardOverview = observer(function DashboardOverview({ workspaceSlug }: Props) {
  const [, setSearchParams] = useSearchParams();
  const periodState = usePeriod("week");
  const { period } = periodState;
  const [team, setTeam] = useState("");
  const { permissions } = useCalendarSettings(workspaceSlug);
  const { getUserDetails } = useMember();
  const canView = permissions?.can_view_team ?? false;
  const { data, error } = useReportSummary(workspaceSlug, { from: period.from, to: period.to, team }, canView);
  // Who is where today comes from the calendar plans.
  const today = toDateKey(new Date());
  const { dashboard } = useDashboard(workspaceSlug, canView, { from: today, to: today, team: team || undefined });

  if (!permissions) return null;
  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-3xl p-6">
        <p className="rounded-lg border border-dashed border-subtle p-4 text-body-sm-regular text-tertiary">
          The dashboard is only open to the people your workspace admins chose. Ask an admin if you need it.
        </p>
      </div>
    );
  }

  const name = (id: string) => getUserDetails(id)?.display_name ?? "Unknown";
  const totals = data?.totals;
  const reporting = totals?.people_reporting ?? 0;
  const maxProject = Math.max(1, ...(data?.projects ?? []).map((project) => project.minutes));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <ReportFilters workspaceSlug={workspaceSlug} periodState={periodState} team={team} setTeam={setTeam} />

      {error ? (
        <p role="alert" className="text-body-sm-medium text-danger-primary">
          The dashboard could not be loaded. Reload the page to try again.
        </p>
      ) : null}

      {totals ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatCard label="Hours reported" value={hours(totals.minutes)} hint={period.label} />
          <StatCard
            label="People reporting"
            value={`${reporting} / ${totals.people}`}
            hint={`${hours(reporting ? Math.round(totals.minutes / reporting) : 0)} each`}
          />
          <StatCard
            label="Remote · Onsite"
            value={`${Math.round(totals.remote_minutes / 60)}h · ${Math.round(totals.onsite_minutes / 60)}h`}
          />
          <StatCard
            label="Reports"
            value={`${totals.reports_sent} sent`}
            hint={`${totals.reports_missing} missing · ${totals.reports_late} late`}
            tone={totals.reports_missing ? "warn" : "good"}
          />
          <StatCard
            label="Tasks set to Done"
            value={totals.completed_tasks}
            hint={`${totals.speedy} Speedy · ${totals.on_time} On time`}
            tone="good"
          />
          <StatCard label="OverTime" value={totals.overtime} tone={totals.overtime ? "bad" : "good"} />
        </div>
      ) : null}

      {dashboard ? (
        <section aria-label="Today" className="rounded-lg border border-subtle bg-surface-1 p-4">
          <h2 className="mb-2 text-body-sm-medium text-primary">Where people are today (their plans)</h2>
          <ul className="grid gap-3 md:grid-cols-3">
            {CALENDAR_KINDS.filter((kind: TCalendarKind) => dashboard.today.counts[kind] > 0).map((kind) => (
              <li key={kind}>
                <p className="flex items-center gap-2 text-body-xs-medium text-secondary">
                  <DayKindDot kind={kind} />
                  {DAY_KIND_META[kind].label} ({dashboard.today.counts[kind]})
                </p>
                <div className="mt-1 flex items-center gap-1">
                  <ButtonAvatars showTooltip={false} userIds={dashboard.today.users[kind].slice(0, 6)} size="xs" />
                  <span className="truncate text-caption-sm-regular text-tertiary">
                    {dashboard.today.users[kind].slice(0, 3).map(name).join(", ")}
                  </span>
                </div>
              </li>
            ))}
            {CALENDAR_KINDS.every((kind) => dashboard.today.counts[kind] === 0) ? (
              <li className="text-body-sm-regular text-tertiary">Nothing is planned for today.</li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {data ? (
        <section aria-label="Hours by day" className="rounded-lg border border-subtle bg-surface-1 p-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-body-sm-medium text-primary">Team hours per day</h2>
            <button
              type="button"
              onClick={() => setSearchParams({ view: "control" })}
              className="min-h-8 text-body-xs-medium text-accent-primary hover:underline"
            >
              Open in Control (per person, per day)
            </button>
          </div>
          <DayBars days={data.days} onSelect={() => setSearchParams({ view: "control" })} />
        </section>
      ) : null}

      {data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <section aria-label="Projects" className="rounded-lg border border-subtle bg-surface-1 p-4">
            <h2 className="mb-3 text-body-sm-medium text-primary">Time per project</h2>
            {data.projects.length === 0 ? (
              <p className="text-body-sm-regular text-tertiary">Nothing reported in this period.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {data.projects.map((project) => (
                  <li key={project.id ?? "micro"} className="flex flex-col gap-1">
                    <span className="flex items-center justify-between gap-2 text-body-sm-regular">
                      <span className="truncate text-primary">
                        {project.identifier ? <span className="text-tertiary">{project.identifier} </span> : null}
                        {project.name}
                      </span>
                      <span className="shrink-0 text-primary tabular-nums">{hours(project.minutes)}</span>
                    </span>
                    <span className="h-1.5 overflow-hidden rounded-full bg-layer-1">
                      <span
                        className="block h-full rounded-full bg-accent-primary"
                        style={{ width: `${(project.minutes / maxProject) * 100}%` }}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-label="Tasks" className="rounded-lg border border-subtle bg-surface-1 p-4">
            <h2 className="mb-3 text-body-sm-medium text-primary">Tasks worked on</h2>
            {data.tasks.length === 0 ? (
              <p className="text-body-sm-regular text-tertiary">Nothing reported in this period.</p>
            ) : (
              <ul className="flex max-h-96 flex-col divide-y divide-subtle overflow-y-auto">
                {data.tasks.map((task) => (
                  <li key={`${task.kind}-${task.id}`} className="flex items-center gap-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body-sm-regular text-primary">
                        {task.key ? <span className="text-tertiary">{task.key} </span> : null}
                        {task.name}
                      </span>
                      <span className="flex min-w-0 items-center gap-1.5 text-caption-sm-regular text-tertiary">
                        {task.state ? (
                          <span
                            className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-[11px] font-medium"
                            style={{
                              color: task.state.color,
                              backgroundColor: `color-mix(in oklab, ${task.state.color} 15%, transparent)`,
                            }}
                          >
                            <span
                              aria-hidden
                              className="size-1.5 rounded-full"
                              style={{ backgroundColor: task.state.color }}
                            />
                            {task.state.name}
                          </span>
                        ) : null}
                        <span className="truncate">
                          {task.project ?? "No project"} · {task.people.join(", ")}
                        </span>
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-0.5">
                      <span className="text-body-sm-medium text-primary tabular-nums">{hours(task.minutes)}</span>
                      <VerdictBadge status={task.status} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}

      {data ? (
        <div className="overflow-x-auto rounded-lg border border-subtle bg-surface-1">
          <table className="w-full min-w-[44rem] text-left">
            <thead className="border-b border-subtle bg-layer-1 text-caption-sm-medium text-tertiary">
              <tr>
                {["Person", "Hours", "Days", "Set to Done", "OverTime", "Reports missing", "Late", "Edits"].map((c) => (
                  <th key={c} scope="col" className="px-3 py-2">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle text-body-sm-regular text-primary">
              {data.people.map((person) => (
                <tr key={person.user.id}>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      <PersonAvatar person={person.user} size="sm" />
                      {person.user.display_name}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-semibold tabular-nums">{hours(person.total_minutes)}</td>
                  <td className="px-3 py-2 tabular-nums">{Object.keys(person.days).length}</td>
                  <td className="px-3 py-2 tabular-nums">{person.completed_tasks || "–"}</td>
                  <td className={cn("px-3 py-2 tabular-nums", person.overtime && "text-danger-primary")}>
                    {person.overtime || "–"}
                  </td>
                  <td className={cn("px-3 py-2 tabular-nums", person.reports_missing && "text-warning-primary")}>
                    {person.reports_missing || "–"}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{person.reports_late || "–"}</td>
                  <td className="px-3 py-2 tabular-nums">{person.edits || "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
});

const TABS = [
  { key: "overview", label: "Overview", managers: true },
  { key: "tasks", label: "Tasks", managers: false },
  { key: "control", label: "Control", managers: true },
] as const;

const CORE_LINKS = [
  { label: "Views", path: "workspace-views/all-issues" },
  { label: "Analytics", path: "analytics/overview" },
  { label: "Archives", path: "projects/archives" },
];

/** The Dashboard: the overview, Control for managers, and the Views, Analytics and Archives pages as tabs. */
export const DashboardRoot = observer(function DashboardRoot({ workspaceSlug }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { permissions } = useCalendarSettings(workspaceSlug);
  const showControl = (permissions?.can_view_team ?? false) || (permissions?.can_manage ?? false);
  const requested = searchParams.get("view");
  // People who may not see the team open on their tasks.
  const view = !permissions
    ? "overview"
    : !showControl || requested === "tasks"
      ? "tasks"
      : requested === "control"
        ? "control"
        : "overview";

  return (
    <div className="flex w-full flex-col">
      <nav
        aria-label="Dashboard"
        className="mx-auto flex w-full max-w-6xl gap-1 overflow-x-auto border-b border-subtle px-4 pt-4 sm:px-6"
      >
        {TABS.filter((tab) => !tab.managers || showControl).map((tab) => (
          <button
            key={tab.key}
            type="button"
            aria-current={view === tab.key ? "page" : undefined}
            onClick={() => setSearchParams(tab.key === "overview" ? {} : { view: tab.key })}
            className={
              view === tab.key
                ? "-mb-px shrink-0 border-b-2 border-accent-strong px-3 py-2 text-body-sm-medium whitespace-nowrap text-primary"
                : "-mb-px shrink-0 border-b-2 border-transparent px-3 py-2 text-body-sm-medium whitespace-nowrap text-tertiary hover:text-secondary"
            }
          >
            {tab.label}
          </button>
        ))}
        {CORE_LINKS.map((tab) => (
          <Link
            key={tab.label}
            href={`/${workspaceSlug}/${tab.path}/`}
            className="-mb-px shrink-0 border-b-2 border-transparent px-3 py-2 text-body-sm-medium whitespace-nowrap text-tertiary hover:text-secondary"
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      {view === "control" ? <ControlRoot workspaceSlug={workspaceSlug} embedded /> : null}
      {view === "tasks" ? <TasksView workspaceSlug={workspaceSlug} /> : null}
      {view === "overview" ? <DashboardOverview workspaceSlug={workspaceSlug} /> : null}
    </div>
  );
});
