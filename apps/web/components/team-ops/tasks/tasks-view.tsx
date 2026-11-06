/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import useSWR from "swr";
import { Badge } from "@makeplane/propel/components/badge";
import { InputField } from "@makeplane/propel/components/input-field";
import { SelectField } from "@makeplane/propel/components/select-field";
import { WorkdayService, formatHm, planLabel } from "@plane/services";
import type { TTask, TTaskFork, TTaskLite } from "@plane/types";
import { cn } from "@plane/utils";
// hooks
import useDebounce from "@/hooks/use-debounce";
import { VerdictBadge } from "../day-report/verdict-badge";

const workdayService = new WorkdayService();

type Props = { workspaceSlug: string };

const ALL = "all";
const STATUS = [
  { value: ALL, label: "Open and done" },
  { value: "open", label: "Open" },
  { value: "done", label: "Done" },
];

const GROUP_VARIANT: Record<string, "neutral" | "brand" | "success" | "danger"> = {
  backlog: "neutral",
  unstarted: "neutral",
  started: "brand",
  completed: "success",
  cancelled: "danger",
};

function Assignees({ people }: { people: TTaskLite["assignees"] }) {
  if (people.length === 0) return <span className="text-caption-sm-regular text-tertiary">Nobody</span>;
  return (
    <span className="truncate text-caption-sm-regular text-secondary">
      {people.map((p) => p.display_name).join(", ")}
    </span>
  );
}

function FlowChips({ flows }: { flows: TTaskLite["flows"] }) {
  if (flows.length === 0) return null;
  return (
    <>
      {flows.map((flow) => (
        <span
          key={flow.id}
          className={cn(
            "rounded-full px-2 py-0.5 text-caption-sm-regular",
            flow.side ? "bg-warning-subtle text-warning-primary" : "bg-accent-subtle text-accent-primary"
          )}
          title={flow.side ? "Added after the flow was drawn: a side task" : "Part of the flow"}
        >
          {flow.name}
          {flow.stages.length > 0 ? ` · ${flow.stages.join(", ")}` : ""}
          {flow.side ? " · side task" : ""}
        </span>
      ))}
    </>
  );
}

/** A task and a fork of it look alike: the key and name, the project, the state, the flows. */
function Line({ item, workspaceSlug }: { item: TTaskLite; workspaceSlug: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Link
          href={`/${workspaceSlug}/browse/${item.key}/`}
          className="truncate text-body-sm-medium text-primary hover:underline"
        >
          <span className="text-tertiary">{item.key}</span> {item.name}
        </Link>
        {item.state ? (
          <Badge variant={GROUP_VARIANT[item.state.group] ?? "neutral"} size="sm" label={item.state.name} />
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-full bg-layer-1 px-2 py-0.5 text-caption-sm-regular text-secondary">
          {item.project.name}
        </span>
        <FlowChips flows={item.flows} />
        <Assignees people={item.assignees} />
      </div>
    </div>
  );
}

function Fork({ fork, workspaceSlug }: { fork: TTaskFork; workspaceSlug: string }) {
  if (fork.kind === "sub") {
    return (
      <li className="rounded-md border border-subtle bg-surface-1 px-3 py-2">
        <p className="mb-1 text-caption-sm-medium text-tertiary uppercase">Sub work item</p>
        <Line item={fork} workspaceSlug={workspaceSlug} />
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-subtle bg-surface-1 px-3 py-2">
      <div className="min-w-0">
        <p className="text-caption-sm-medium text-tertiary uppercase">Person</p>
        <p className="truncate text-body-sm-medium text-primary">{fork.user.display_name}</p>
      </div>
      <p className="text-caption-sm-regular text-secondary tabular-nums">
        {fork.stage ? `Stage: ${fork.stage} · ` : ""}
        {formatHm(fork.seconds)} reported on {fork.sessions} day{fork.sessions === 1 ? "" : "s"}
        {fork.done ? " · done" : ""}
      </p>
    </li>
  );
}

export function TaskRow({ task, workspaceSlug }: { task: TTask; workspaceSlug: string }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <Line item={task} workspaceSlug={workspaceSlug} />
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-body-sm-medium text-primary tabular-nums">{formatHm(task.seconds)}</span>
          {task.plan?.planned_minutes ? (
            <span className="flex items-center gap-1.5 text-caption-sm-regular text-tertiary">
              of {planLabel(task.plan.planned_amount, task.plan.unit)}
              <VerdictBadge status={task.plan.status} />
            </span>
          ) : null}
          {task.forks.length > 0 ? (
            <button
              type="button"
              aria-expanded={open}
              className="text-caption-sm-medium text-accent-primary hover:underline"
              onClick={() => setOpen(!open)}
            >
              {open ? "Hide" : "Show"} {task.forks.length} fork{task.forks.length === 1 ? "" : "s"}
            </button>
          ) : (
            <span className="text-caption-sm-regular text-tertiary">No forks</span>
          )}
        </div>
      </div>
      {open ? (
        <ul className="ml-4 flex flex-col gap-2 border-l-2 border-subtle pl-3">
          {task.forks.map((fork) => (
            <Fork
              key={fork.kind === "sub" ? fork.id : `${fork.user.id}-${fork.stage ?? ""}`}
              fork={fork}
              workspaceSlug={workspaceSlug}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** Tasks: every work item of your projects in one list and one shape, with the forks under each task. */
export const TasksView = observer(function TasksView({ workspaceSlug }: Props) {
  const [project, setProject] = useState(ALL);
  const [flow, setFlow] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [mine, setMine] = useState(false);
  const [query, setQuery] = useState("");
  const q = useDebounce(query, 300);
  const params = {
    project: project === ALL ? undefined : project,
    flow: flow === ALL ? undefined : flow,
    status: status === ALL ? undefined : (status as "open" | "done"),
    mine: mine ? ("1" as const) : undefined,
    q: q.trim() || undefined,
  };
  const { data, isLoading } = useSWR(`TEAM_OPS_TASKS_${workspaceSlug}_${JSON.stringify(params)}`, () =>
    workdayService.getTasks(workspaceSlug, params)
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-52 [&_button]:min-w-0">
          <SelectField
            size="lg"
            label="Project"
            options={[
              { value: ALL, label: "All projects" },
              ...(data?.filters.projects ?? []).map((p) => ({ value: p.id, label: p.name })),
            ]}
            value={project}
            onValueChange={(value) => setProject(value ?? ALL)}
          />
        </div>
        <div className="w-52 [&_button]:min-w-0">
          <SelectField
            size="lg"
            label="Teamflow"
            options={[
              { value: ALL, label: "All flows" },
              ...(data?.filters.flows ?? []).map((f) => ({ value: f.id, label: `${f.name} (${f.project})` })),
            ]}
            value={flow}
            onValueChange={(value) => setFlow(value ?? ALL)}
          />
        </div>
        <div className="w-40 [&_button]:min-w-0">
          <SelectField
            size="lg"
            label="Status"
            options={STATUS}
            value={status}
            onValueChange={(value) => setStatus(value ?? ALL)}
          />
        </div>
        <div className="min-w-48 flex-1">
          <InputField
            type="text"
            size="lg"
            orientation="vertical"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tasks"
            aria-label="Search tasks"
          />
        </div>
        <button
          type="button"
          aria-pressed={mine}
          onClick={() => setMine(!mine)}
          className={cn(
            "rounded-md border px-3 py-2 text-body-xs-medium",
            mine ? "border-accent-strong bg-accent-subtle text-accent-primary" : "border-subtle text-secondary"
          )}
        >
          Only mine
        </button>
      </div>

      <p className="text-caption-sm-regular text-tertiary">
        {isLoading ? "Loading..." : `${data?.total ?? 0} task${data?.total === 1 ? "" : "s"}`}
        {data?.has_more ? ` (showing the latest ${data.results.length}; narrow the filters to see others)` : ""}. A fork
        is a sub work item, or a person working on the task with their own time and stage.
      </p>

      <ul className="flex flex-col divide-y divide-subtle rounded-lg border border-subtle bg-surface-1">
        {(data?.results ?? []).length === 0 && !isLoading ? (
          <li className="px-4 py-8 text-center text-body-sm-regular text-tertiary">No tasks match.</li>
        ) : null}
        {(data?.results ?? []).map((task) => (
          <TaskRow key={task.id} task={task} workspaceSlug={workspaceSlug} />
        ))}
      </ul>
    </div>
  );
});
