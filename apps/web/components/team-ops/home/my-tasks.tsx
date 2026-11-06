/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import Link from "next/link";
import useSWR from "swr";
import { ListTodo } from "lucide-react";
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
function TimeBlock({ task }: { task: TTask }) {
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
  return (
    <div className="flex w-full flex-col gap-0.5 sm:w-48 sm:items-end">
      <span className="text-caption-sm-medium text-warning-primary">No planned time</span>
      {task.seconds ? (
        <span className="text-caption-sm-regular text-tertiary tabular-nums">
          {formatMinutes(Math.round(task.seconds / 60))} logged
        </span>
      ) : null}
    </div>
  );
}

function TaskRow({ task, workspaceSlug }: { task: TTask; workspaceSlug: string }) {
  const subItems = task.forks.filter((fork) => fork.kind === "sub").length;
  const people = task.assignees.length > 1 ? task.assignees : [];
  const overtime = task.plan?.status === "OVERTIME";
  return (
    <li>
      <Link
        href={`/${workspaceSlug}/browse/${task.key}/`}
        className={cn(
          "flex flex-wrap items-center gap-x-6 gap-y-3 border-l-2 px-5 py-4 hover:bg-layer-1",
          overtime ? "border-l-[#dc2626]" : "border-l-transparent"
        )}
      >
        <span className="w-24 shrink-0 text-caption-sm-medium text-tertiary tabular-nums">{task.key}</span>
        <span className="flex min-w-0 flex-1 basis-64 flex-col gap-1.5">
          <span className="truncate text-body-md-medium text-primary">{task.name}</span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption-sm-regular text-tertiary">
            <span>{task.project.name}</span>
            {task.state ? <span>{task.state.name}</span> : null}
            {subItems > 0 ? (
              <span>
                {subItems} sub work item{subItems === 1 ? "" : "s"}
              </span>
            ) : null}
            {task.flows.slice(0, 2).map((flow) => (
              <span key={flow.id} className="rounded-full bg-layer-1 px-2 py-0.5 text-secondary">
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
        <TimeBlock task={task} />
      </Link>
    </li>
  );
}

/** Home: the work items given to me that are not done yet, by their state in the project. */
export const MyTasks = observer(function MyTasks({ workspaceSlug }: { workspaceSlug: string }) {
  const { data } = useSWR(`TEAM_OPS_MY_TASKS_${workspaceSlug}`, () =>
    workdayService.getTasks(workspaceSlug, { mine: "1", status: "open" })
  );
  const tasks: TTask[] = data?.results ?? [];
  const groups = GROUPS.map((group) =>
    Object.assign({}, group, { tasks: tasks.filter((task) => (task.state?.group ?? "backlog") === group.key) })
  );

  return (
    <section aria-label="My tasks" className="flex flex-col rounded-lg border border-subtle bg-surface-1">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-subtle px-5 py-4">
        <h2 className="flex items-center gap-2 text-body-md-medium text-primary">
          <ListTodo className="size-4 text-accent-primary" aria-hidden />
          My tasks
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {groups.map((group) => (
            <span
              key={group.key}
              className="inline-flex items-center gap-1.5 rounded-full bg-layer-1 px-2.5 py-1 text-caption-sm-medium text-secondary"
            >
              <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: group.color }} />
              {group.tasks.length} {group.label.toLowerCase()}
            </span>
          ))}
        </div>
      </header>
      {tasks.length === 0 ? (
        <p className="px-5 py-6 text-body-sm-regular text-tertiary">
          {data ? "Nothing open is assigned to you." : "Loading..."}
        </p>
      ) : (
        groups
          .filter((group) => group.tasks.length > 0)
          .map((group) => (
            <div key={group.key} className="flex flex-col border-b border-subtle last:border-b-0">
              <p
                className="flex items-center gap-2 bg-layer-1/50 px-5 py-2 text-caption-sm-medium"
                style={{ color: group.color }}
              >
                <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: group.color }} />
                {group.label} ({group.tasks.length})
              </p>
              <ul className="flex flex-col divide-y divide-subtle">
                {group.tasks.slice(0, PER_GROUP).map((task) => (
                  <TaskRow key={task.id} task={task} workspaceSlug={workspaceSlug} />
                ))}
              </ul>
              {group.tasks.length > PER_GROUP ? (
                <Link
                  href={`/${workspaceSlug}/team-ops/dashboard/?view=tasks`}
                  className="px-5 py-3 text-caption-sm-medium text-accent-primary hover:underline"
                >
                  {group.tasks.length - PER_GROUP} more
                </Link>
              ) : null}
            </div>
          ))
      )}
      <p className="border-t border-subtle px-5 py-3 text-caption-sm-regular text-tertiary">
        Moving a task to Done in its project asks how long it took and adds it to your Day Report.
      </p>
    </section>
  );
});
