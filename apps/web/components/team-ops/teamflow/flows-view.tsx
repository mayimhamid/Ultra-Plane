/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Fragment, useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
import { Badge } from "@makeplane/propel/components/badge";
import { Button } from "@makeplane/propel/components/button";
import { setToast } from "@plane/blocks/toast";
import { WorkdayService } from "@plane/services";
import type { TFlow, TFlowModule, TFlowStage } from "@plane/types";
import { cn } from "@plane/utils";
// hooks
import { flowService, useFlows } from "@/hooks/team-ops/use-hub";
// local imports
import { getErrorMessage } from "../calendar/error-message";
import { TaskRow } from "../tasks/tasks-view";
import { FlowEditor } from "./flow-editor";
import { OfferPanel } from "./offer-panel";

const workdayService = new WorkdayService();

type Props = { workspaceSlug: string };

const Bar = ({ percent }: { percent: number | null }) => (
  <div className="h-1.5 overflow-hidden rounded-full bg-layer-1" aria-hidden>
    <div
      className={cn("h-full rounded-full", percent === 100 ? "bg-success-strong" : "bg-accent-primary")}
      style={{ width: `${percent ?? 0}%` }}
    />
  </div>
);

function ModuleBlock({
  module,
  pending,
  selected,
  onSelect,
}: {
  module: TFlowModule;
  pending: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className={cn(
          "flex w-full flex-col gap-1.5 rounded-md border bg-surface-1 p-2 text-left hover:bg-layer-1",
          selected ? "border-accent-strong ring-1 ring-accent-strong" : "border-subtle"
        )}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-body-xs-medium text-primary">{module.name}</span>
          {pending ? (
            <span className="text-caption-sm-medium text-warning-primary">Pending</span>
          ) : (
            <span className="text-caption-sm-medium text-secondary tabular-nums">
              {module.percent === null ? "no tasks" : `${module.percent}%`}
            </span>
          )}
        </span>
        {!pending ? <Bar percent={module.percent} /> : null}
        {!pending && module.total > 0 ? (
          <span className="text-caption-sm-regular text-tertiary">
            {module.done} of {module.total} tasks done
            {module.side_total > 0 ? ` · +${module.side_done}/${module.side_total} side` : ""}
          </span>
        ) : null}
        {module.people.length > 0 ? (
          <span className="truncate text-caption-sm-regular text-secondary">
            {module.people.map((person) => person.display_name).join(", ")}
          </span>
        ) : null}
      </button>
    </li>
  );
}

function StageColumn({
  stage,
  index,
  selectedModule,
  onSelect,
}: {
  stage: TFlowStage;
  index: number;
  selectedModule: string | null;
  onSelect: (moduleId: string) => void;
}) {
  return (
    <section
      aria-label={`Stage ${index + 1}: ${stage.name}`}
      className={cn(
        "flex w-60 shrink-0 flex-col gap-2 rounded-lg border p-3",
        stage.pending ? "border-subtle bg-layer-1" : "border-accent-strong bg-surface-1"
      )}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-caption-sm-regular text-tertiary">Phase {index + 1}</p>
          <h4 className="truncate text-body-sm-medium text-primary">{stage.name}</h4>
        </div>
        {stage.pending ? (
          <Badge variant="neutral" size="sm" label="Pending" />
        ) : (
          <span className="text-body-sm-medium text-primary tabular-nums">
            {stage.percent === null ? "—" : `${stage.percent}%`}
          </span>
        )}
      </header>
      <ul className="flex flex-col gap-2">
        {stage.modules.map((module) => (
          <ModuleBlock
            key={module.id}
            module={module}
            pending={stage.pending}
            selected={selectedModule === module.id}
            onSelect={() => onSelect(module.id)}
          />
        ))}
      </ul>
    </section>
  );
}

/** The tasks of the module that was clicked, in the same shape as everywhere else. */
function ModuleTasks({ workspaceSlug, module }: { workspaceSlug: string; module: TFlowModule }) {
  const { data, isLoading } = useSWR(`TEAM_OPS_MODULE_TASKS_${module.id}`, () =>
    workdayService.getTasks(workspaceSlug, { module: module.id })
  );
  return (
    <section
      aria-label={`Tasks of ${module.name}`}
      className="flex flex-col gap-2 rounded-lg border border-accent-strong p-3"
    >
      <h4 className="text-body-sm-medium text-primary">
        {module.name}: {isLoading ? "loading" : `${data?.total ?? 0} task(s)`}
      </h4>
      <ul className="flex flex-col divide-y divide-subtle rounded-lg border border-subtle bg-surface-1">
        {(data?.results ?? []).length === 0 && !isLoading ? (
          <li className="px-4 py-4 text-body-sm-regular text-tertiary">No work items in this module yet.</li>
        ) : null}
        {(data?.results ?? []).map((task) => (
          <TaskRow key={task.id} task={task} workspaceSlug={workspaceSlug} />
        ))}
      </ul>
    </section>
  );
}

function FlowChart({ flow, workspaceSlug }: { flow: TFlow; workspaceSlug: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const module = flow.stages.flatMap((stage) => stage.modules).find((item) => item.id === selected) ?? null;
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto pb-2">
        <div className="flex min-w-max items-stretch gap-1">
          {flow.stages.map((stage, index) => (
            <Fragment key={stage.id}>
              {index > 0 ? (
                <div aria-hidden className="flex w-8 shrink-0 items-center justify-center text-h5-medium text-tertiary">
                  →
                </div>
              ) : null}
              <StageColumn
                stage={stage}
                index={index}
                selectedModule={selected}
                onSelect={(id) => setSelected(selected === id ? null : id)}
              />
            </Fragment>
          ))}
        </div>
      </div>
      {module ? <ModuleTasks workspaceSlug={workspaceSlug} module={module} /> : null}
    </div>
  );
}

/** A project in phases: each phase holds modules, its progress is theirs. Click a module to see its tasks. */
export const FlowsView = observer(function FlowsView({ workspaceSlug }: Props) {
  const { flows, canManage, refresh } = useFlows(workspaceSlug);
  const [editing, setEditing] = useState<TFlow | "new" | null>(null);

  const remove = async (flow: TFlow) => {
    try {
      await flowService.remove(workspaceSlug, flow.id);
      await refresh();
    } catch (error) {
      setToast({ type: "error", title: "Could not delete", message: getErrorMessage(error) });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-body-sm-regular text-secondary">
          A flow splits a project into phases. Each phase holds modules of the project, and the progress of the phase is
          the progress of its modules. A phase stays <b>Pending</b> until the phases before it are finished.
        </p>
        {canManage ? (
          <Button variant="primary" size="md" stretch="auto" label="New flow" onClick={() => setEditing("new")} />
        ) : null}
      </div>

      {editing ? (
        <FlowEditor
          workspaceSlug={workspaceSlug}
          flow={editing === "new" ? null : editing}
          onDone={async () => {
            setEditing(null);
            await refresh();
          }}
          onCancel={() => setEditing(null)}
        />
      ) : null}

      {flows && flows.length === 0 ? (
        <p className="rounded-lg border border-subtle bg-surface-1 p-4 text-body-sm-regular text-tertiary">
          No flows yet. Create one for a project, or start a new project together with its flow.
        </p>
      ) : null}

      {(flows ?? []).map((flow) => (
        <article key={flow.id} className="flex flex-col gap-3 rounded-lg border border-subtle bg-surface-1 p-4">
          <header className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-body-md-medium text-primary">{flow.name}</h3>
              <p className="text-caption-sm-regular text-tertiary">
                {flow.project.identifier} · {flow.project.name}
              </p>
            </div>
            {canManage ? (
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" stretch="auto" label="Edit" onClick={() => setEditing(flow)} />
                <Button variant="secondary" size="sm" stretch="auto" label="Delete" onClick={() => void remove(flow)} />
              </div>
            ) : null}
          </header>
          <FlowChart flow={flow} workspaceSlug={workspaceSlug} />
          {flow.side_tasks.total > 0 ? (
            <p className="text-caption-sm-regular text-tertiary">
              Side tasks (added to a module after this flow was drawn, they never hold a phase back):{" "}
              {flow.side_tasks.done} of {flow.side_tasks.total} done.
            </p>
          ) : null}
          <OfferPanel workspaceSlug={workspaceSlug} flowId={flow.id} onTaken={refresh} />
        </article>
      ))}
    </div>
  );
});
