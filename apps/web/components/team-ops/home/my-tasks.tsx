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
// components
import { VerdictBadge } from "../day-report/verdict-badge";

const workdayService = new WorkdayService();

// The open state groups of Plane, in the order work moves through them.
const GROUPS = [
  { key: "started", label: "In progress", color: "#f59e0b" },
  { key: "unstarted", label: "To do", color: "#3b82f6" },
  { key: "backlog", label: "Backlog", color: "#94a3b8" },
];

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
    <section aria-label="My tasks" className="flex flex-col gap-3 rounded-lg border border-subtle bg-surface-1 p-4">
      <header className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-body-md-medium text-primary">
          <ListTodo className="size-4 text-accent-primary" aria-hidden />
          My tasks
        </h2>
        <span className="text-caption-sm-regular text-tertiary">
          {groups.map((group) => `${group.tasks.length} ${group.label.toLowerCase()}`).join(" · ")}
        </span>
      </header>
      {tasks.length === 0 ? (
        <p className="text-body-sm-regular text-tertiary">{data ? "Nothing open is assigned to you." : "Loading..."}</p>
      ) : (
        groups
          .filter((group) => group.tasks.length > 0)
          .map((group) => (
            <div key={group.key} className="flex flex-col gap-1">
              <p className="flex items-center gap-2 text-caption-sm-medium" style={{ color: group.color }}>
                <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: group.color }} />
                {group.label} ({group.tasks.length})
              </p>
              <ul className="flex flex-col divide-y divide-subtle">
                {group.tasks.slice(0, 8).map((task) => (
                  <li key={task.id}>
                    <Link
                      href={`/${workspaceSlug}/browse/${task.key}/`}
                      className="flex min-h-11 items-center gap-3 rounded-md px-1 py-1.5 hover:bg-layer-1"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body-sm-regular text-primary">
                          <span className="text-tertiary">{task.key}</span> {task.name}
                        </span>
                        <span className="text-caption-sm-regular text-tertiary">
                          {task.state?.name ?? ""} · {task.project.name}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-0.5 text-caption-sm-regular text-tertiary tabular-nums">
                        {task.plan?.planned_minutes ? (
                          <>
                            <span>
                              {formatMinutes(task.plan.reported_minutes)} of{" "}
                              {planLabel(task.plan.planned_amount, task.plan.unit)}
                            </span>
                            <VerdictBadge status={task.plan.status} />
                          </>
                        ) : task.seconds ? (
                          <span>{formatMinutes(Math.round(task.seconds / 60))}</span>
                        ) : null}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              {group.tasks.length > 8 ? (
                <Link
                  href={`/${workspaceSlug}/team-ops/dashboard/?view=tasks`}
                  className="self-start text-caption-sm-medium text-accent-primary hover:underline"
                >
                  {group.tasks.length - 8} more
                </Link>
              ) : null}
            </div>
          ))
      )}
      <p className="text-caption-sm-regular text-tertiary">
        Moving a task to Done in its project asks how long it took and adds it to your Day Report.
      </p>
    </section>
  );
});
