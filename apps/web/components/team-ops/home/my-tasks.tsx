/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import useSWR from "swr";
import { ChevronDown, ListTodo, Search } from "lucide-react";
import { WorkdayService, formatMinutes, planLabel } from "@plane/services";
import type { TTask } from "@plane/types";
import { cn } from "@plane/utils";
// components
import { VERDICT_COLOR, VerdictBadge } from "../day-report/verdict-badge";
import { PersonAvatar } from "../hub/person-avatar";

const workdayService = new WorkdayService();

// The open state groups of Plane, in the order work moves through them.
const GROUPS = [
  { key: "started", label: "In progress", color: "#f59e0b" },
  { key: "unstarted", label: "To do", color: "#3b82f6" },
  { key: "backlog", label: "Backlog", color: "#94a3b8" },
];
const PER_GROUP = 8;

/** The time reported so far against the plan: a bar in the verdict's color, the numbers and the verdict. */
function TimeBlock({ task, active }: { task: TTask; active: boolean }) {
  const plan = task.plan;
  if (plan?.planned_minutes) {
    const share = Math.min(100, Math.round((plan.reported_minutes / plan.planned_minutes) * 100));
    const color = plan.status ? VERDICT_COLOR[plan.status] : "#64748b";
    return (
      <div className="flex w-full flex-col gap-1.5 sm:w-48">
        <div className="flex items-center justify-between gap-2">
          <span className="text-caption-sm-regular text-secondary tabular-nums">
            {formatMinutes(plan.reported_minutes)} of {planLabel(plan.planned_amount, plan.unit)}
          </span>
          <VerdictBadge status={plan.status} />
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-layer-1" aria-hidden>
          <div className="h-full rounded-full" style={{ width: `${share}%`, backgroundColor: color }} />
        </div>
      </div>
    );
  }
  // Work that is being done without a plan is worth a look; a backlog item without one is just not planned yet.
  return (
    <div className="flex w-full flex-col gap-0.5 sm:w-48 sm:items-end">
      <span className={cn("text-caption-sm-medium", active ? "text-warning-primary" : "text-tertiary")}>
        {active ? "No planned time" : "Not planned"}
      </span>
      {task.seconds ? (
        <span className="text-caption-sm-regular text-tertiary tabular-nums">
          {formatMinutes(Math.round(task.seconds / 60))} logged
        </span>
      ) : null}
    </div>
  );
}

function TaskRow({ task, workspaceSlug, active }: { task: TTask; workspaceSlug: string; active: boolean }) {
  const subItems = task.forks.filter((fork) => fork.kind === "sub").length;
  const people = task.assignees.length > 1 ? task.assignees : [];
  const overtime = task.plan?.status === "OVERTIME";
  return (
    <li>
      <Link
        href={`/${workspaceSlug}/browse/${task.key}/`}
        className={cn(
          "flex flex-wrap items-center gap-x-5 gap-y-2 border-l-2 px-5 py-3 hover:bg-layer-1",
          overtime ? "border-l-[#dc2626]" : "border-l-transparent"
        )}
      >
        <span className="w-28 shrink-0 text-caption-sm-medium text-tertiary tabular-nums">{task.key}</span>
        <span className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
          <span className="truncate text-body-sm-medium text-primary">{task.name}</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption-sm-regular text-tertiary">
            <span className="rounded bg-layer-1 px-1.5 py-0.5 text-secondary">{task.project.name}</span>
            {subItems > 0 ? (
              <span>
                {subItems} sub work item{subItems === 1 ? "" : "s"}
              </span>
            ) : null}
            {task.flows.slice(0, 2).map((flow) => (
              <span key={flow.id} className="rounded-full border border-subtle px-2 py-0.5">
                {flow.name}
              </span>
            ))}
            {people.length > 0 ? (
              <span className="flex -space-x-1.5" title={people.map((person) => person.display_name).join(", ")}>
                {people.slice(0, 4).map((person) => (
                  <PersonAvatar key={person.id} person={person} size="sm" className="ring-surface-1 ring-2" />
                ))}
              </span>
            ) : null}
          </span>
        </span>
        <TimeBlock task={task} active={active} />
      </Link>
    </li>
  );
}

const matches = (task: TTask, query: string) =>
  `${task.key} ${task.name} ${task.project.name}`.toLowerCase().includes(query.toLowerCase());

/** Home: the work items given to me that are not done yet, by their state in the project. */
export const MyTasks = observer(function MyTasks({ workspaceSlug }: { workspaceSlug: string }) {
  const [query, setQuery] = useState("");
  const [closed, setClosed] = useState<string[]>([]);
  const { data } = useSWR(`TEAM_OPS_MY_TASKS_${workspaceSlug}`, () =>
    workdayService.getTasks(workspaceSlug, { mine: "1", status: "open" })
  );
  const tasks: TTask[] = data?.results ?? [];
  const shown = query.trim() ? tasks.filter((task) => matches(task, query.trim())) : tasks;
  const groups = GROUPS.map((group) =>
    Object.assign({}, group, { tasks: shown.filter((task) => (task.state?.group ?? "backlog") === group.key) })
  );
  const toggle = (key: string) =>
    setClosed((now) => (now.includes(key) ? now.filter((k) => k !== key) : [...now, key]));

  return (
    <section aria-label="My tasks" className="flex flex-col rounded-lg border border-subtle bg-surface-1">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-subtle px-5 py-3">
        <h2 className="flex items-center gap-2 text-body-md-medium text-primary">
          <ListTodo className="size-4 text-accent-primary" aria-hidden />
          My tasks
          <span className="text-caption-sm-regular text-tertiary">{tasks.length} open</span>
        </h2>
        {tasks.length > 5 ? (
          <label className="flex min-h-8 items-center gap-2 rounded-md border border-subtle bg-surface-1 px-2.5 text-body-xs-regular text-secondary">
            <Search className="size-3.5 text-tertiary" aria-hidden />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter tasks"
              aria-label="Filter tasks"
              className="w-40 bg-transparent text-primary outline-none placeholder:text-tertiary"
            />
          </label>
        ) : null}
      </header>
      {shown.length === 0 ? (
        <p className="px-5 py-6 text-body-sm-regular text-tertiary">
          {!data ? "Loading..." : tasks.length === 0 ? "Nothing open is assigned to you." : "No task matches."}
        </p>
      ) : (
        groups
          .filter((group) => group.tasks.length > 0)
          .map((group) => {
            const open = !closed.includes(group.key);
            return (
              <div key={group.key} className="flex flex-col border-b border-subtle last:border-b-0">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => toggle(group.key)}
                  className="flex min-h-10 items-center gap-2 bg-layer-1/50 px-5 py-2 text-left text-caption-sm-medium hover:bg-layer-1"
                  style={{ color: group.color }}
                >
                  <ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} aria-hidden />
                  <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: group.color }} />
                  {group.label}
                  <span className="text-tertiary">{group.tasks.length}</span>
                </button>
                {open ? (
                  <>
                    <ul className="flex flex-col divide-y divide-subtle">
                      {group.tasks.slice(0, PER_GROUP).map((task) => (
                        <TaskRow
                          key={task.id}
                          task={task}
                          workspaceSlug={workspaceSlug}
                          active={group.key !== "backlog"}
                        />
                      ))}
                    </ul>
                    {group.tasks.length > PER_GROUP ? (
                      <Link
                        href={`/${workspaceSlug}/team-ops/dashboard/?view=tasks`}
                        className="px-5 py-2.5 text-caption-sm-medium text-accent-primary hover:underline"
                      >
                        {group.tasks.length - PER_GROUP} more
                      </Link>
                    ) : null}
                  </>
                ) : null}
              </div>
            );
          })
      )}
      <p className="border-t border-subtle px-5 py-2.5 text-caption-sm-regular text-tertiary">
        Moving a task to Done in its project asks how long it took and adds it to your Day Report.
      </p>
    </section>
  );
});
