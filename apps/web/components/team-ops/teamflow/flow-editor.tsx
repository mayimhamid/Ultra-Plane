/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useState } from "react";
import { observer } from "mobx-react";
import { Button } from "@makeplane/propel/components/button";
import { CheckboxField } from "@makeplane/propel/components/checkbox-field";
import { InputField } from "@makeplane/propel/components/input-field";
import { SelectField } from "@makeplane/propel/components/select-field";
import { setToast } from "@plane/blocks/toast";
import type { TFlow, TProjectModule } from "@plane/types";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { flowService } from "@/hooks/team-ops/use-hub";
// services
import { ModuleService } from "@/services/module.service";
import { ProjectService } from "@/services/project/project.service";
// local imports
import { getErrorMessage } from "../calendar/error-message";

const moduleService = new ModuleService();
const projectService = new ProjectService();

type Draft = { name: string; stages: { name: string; modules: string[] }[] };
const NEW = "new";
const blankDraft: Draft = { name: "", stages: [{ name: "Phase 1", modules: [] }] };

const errorOf = (error: unknown): string => {
  const body = (error as { data?: unknown })?.data ?? error;
  return getErrorMessage(body);
};

type Props = {
  workspaceSlug: string;
  /** `null` to draw a new flow. */
  flow: TFlow | null;
  onDone: () => Promise<void>;
  onCancel: () => void;
};

/**
 * Pick the project (or start a new one together with the flow), name the phases, and choose the modules of
 * each phase. A module can be made on the spot.
 */
export const FlowEditor = observer(function FlowEditor({ workspaceSlug, flow, onDone, onCancel }: Props) {
  const { joinedProjectIds, getPartialProjectById, fetchProjects } = useProject();
  const [choice, setChoice] = useState<string | undefined>(flow?.project.id);
  const [projectId, setProjectId] = useState<string | undefined>(flow?.project.id);
  const [newName, setNewName] = useState("");
  const [newIdentifier, setNewIdentifier] = useState("");
  const [modules, setModules] = useState<TProjectModule[]>([]);
  const [draft, setDraft] = useState<Draft>(
    flow
      ? {
          name: flow.name,
          stages: flow.stages.map((stage) => ({ name: stage.name, modules: stage.modules.map((m) => m.id) })),
        }
      : blankDraft
  );
  const [moduleNames, setModuleNames] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  const loadModules = useCallback(async () => {
    if (!projectId) return;
    try {
      setModules(await flowService.listProjectModules(workspaceSlug, projectId));
    } catch (error) {
      setToast({ type: "error", title: "Could not load the modules", message: getErrorMessage(error) });
    }
  }, [workspaceSlug, projectId]);

  useEffect(() => {
    void loadModules();
  }, [loadModules]);

  const createProject = async () => {
    setBusy(true);
    try {
      const project = await projectService.createProject(workspaceSlug, {
        name: newName.trim(),
        identifier: newIdentifier.trim().toUpperCase(),
        network: 0,
      });
      await fetchProjects(workspaceSlug);
      setProjectId(project.id);
      setChoice(project.id);
      setDraft((current) => ({ ...current, name: current.name || newName.trim() }));
      setToast({ type: "success", title: "Project created", message: "Now add modules to its phases." });
    } catch (error) {
      const body = (error as { data?: Record<string, unknown> })?.data;
      setToast({
        type: "error",
        title: "Could not create the project",
        message: typeof body?.error === "string" ? body.error : errorOf(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const used = new Map<string, number>(
    draft.stages.flatMap((stage, index) => stage.modules.map((id) => [id, index] as const))
  );
  const setStage = (index: number, change: Partial<Draft["stages"][number]>) =>
    setDraft({ ...draft, stages: draft.stages.map((stage, i) => (i === index ? { ...stage, ...change } : stage)) });
  const toggle = (stageIndex: number, id: string) => {
    const stage = draft.stages[stageIndex];
    setStage(stageIndex, {
      modules: stage.modules.includes(id) ? stage.modules.filter((value) => value !== id) : [...stage.modules, id],
    });
  };

  const addModule = async (stageIndex: number) => {
    const name = (moduleNames[stageIndex] ?? "").trim();
    if (!name || !projectId) return;
    setBusy(true);
    try {
      const created = await moduleService.createModule(workspaceSlug, projectId, { name, status: "backlog" });
      await loadModules();
      setStage(stageIndex, { modules: [...draft.stages[stageIndex].modules, created.id] });
      setModuleNames({ ...moduleNames, [stageIndex]: "" });
    } catch (error) {
      setToast({ type: "error", title: "Could not create the module", message: errorOf(error) });
    } finally {
      setBusy(false);
    }
  };

  const ready =
    Boolean(projectId) &&
    draft.name.trim().length > 0 &&
    draft.stages.length > 0 &&
    draft.stages.every((stage) => stage.name.trim() && stage.modules.length > 0);

  const save = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      const payload = { project: projectId, name: draft.name, stages: draft.stages };
      if (flow) await flowService.update(workspaceSlug, flow.id, payload);
      else await flowService.create(workspaceSlug, payload);
      await onDone();
    } catch (error) {
      setToast({ type: "error", title: "Could not save", message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label="Flow editor"
      className="flex flex-col gap-4 rounded-lg border border-accent-strong bg-surface-1 p-4"
    >
      <h3 className="text-body-md-medium text-primary">{flow ? "Edit flow" : "New flow"}</h3>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-64 [&_button]:min-w-0">
          <SelectField
            size="lg"
            label="Project"
            options={[
              { value: NEW, label: "+ New project" },
              ...joinedProjectIds.map((id) => ({ value: id, label: getPartialProjectById(id)?.name ?? id })),
            ]}
            value={choice}
            disabled={Boolean(flow)}
            onValueChange={(value) => {
              setChoice(value ?? undefined);
              setProjectId(value && value !== NEW ? value : undefined);
              setDraft({ ...draft, stages: draft.stages.map((stage) => ({ ...stage, modules: [] })) });
            }}
          />
        </div>
        <div className="min-w-64 flex-1">
          <InputField
            type="text"
            size="lg"
            orientation="vertical"
            value={draft.name}
            maxLength={200}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            placeholder="Name of the flow, for example Release"
            aria-label="Name of the flow"
          />
        </div>
      </div>

      {choice === NEW && !projectId ? (
        <div className="flex flex-wrap items-end gap-3 rounded-md border border-dashed border-subtle p-3">
          <div className="min-w-56 flex-1">
            <InputField
              type="text"
              size="lg"
              orientation="vertical"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Name of the new project"
              aria-label="Name of the new project"
            />
          </div>
          <div className="w-40">
            <InputField
              type="text"
              size="lg"
              orientation="vertical"
              value={newIdentifier}
              maxLength={5}
              onChange={(event) => setNewIdentifier(event.target.value.toUpperCase())}
              placeholder="ID, e.g. REL"
              aria-label="Identifier of the new project"
            />
          </div>
          <Button
            variant="secondary"
            size="md"
            stretch="auto"
            label="Create the project"
            loading={busy}
            disabled={!newName.trim() || !newIdentifier.trim()}
            onClick={createProject}
          />
          <p className="basis-full text-caption-sm-regular text-tertiary">
            The project is created in Projects at the same time, so its modules and work items live there.
          </p>
        </div>
      ) : null}

      <ol className="flex flex-col gap-3">
        {draft.stages.map((stage, index) => (
          <li key={index} className="flex flex-col gap-2 rounded-md border border-subtle p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-body-sm-medium text-secondary">Phase {index + 1}</span>
              <div className="min-w-48 flex-1">
                <InputField
                  type="text"
                  size="lg"
                  orientation="vertical"
                  value={stage.name}
                  maxLength={200}
                  onChange={(event) => setStage(index, { name: event.target.value })}
                  aria-label={`Name of phase ${index + 1}`}
                />
              </div>
              {draft.stages.length > 1 ? (
                <button
                  type="button"
                  className="text-body-xs-regular text-tertiary hover:text-danger-primary"
                  onClick={() => setDraft({ ...draft, stages: draft.stages.filter((_, i) => i !== index) })}
                >
                  Remove phase
                </button>
              ) : null}
            </div>
            {projectId ? (
              <>
                <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
                  <legend className="mb-1 text-body-xs-medium text-secondary">Modules in this phase</legend>
                  {modules.length === 0 ? (
                    <span className="text-body-xs-regular text-tertiary">
                      This project has no modules yet. Make one below.
                    </span>
                  ) : null}
                  {modules.map((module) => {
                    const elsewhere = used.has(module.id) && used.get(module.id) !== index;
                    return (
                      <CheckboxField
                        key={module.id}
                        size="lg"
                        label={
                          (elsewhere ? `${module.name} (phase ${(used.get(module.id) ?? 0) + 1})` : module.name) +
                          (module.people.length > 0 ? ` · ${module.people.map((p) => p.display_name).join(", ")}` : "")
                        }
                        checked={stage.modules.includes(module.id)}
                        disabled={elsewhere}
                        onCheckedChange={() => toggle(index, module.id)}
                      />
                    );
                  })}
                </fieldset>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="w-64">
                    <InputField
                      type="text"
                      size="lg"
                      orientation="vertical"
                      value={moduleNames[index] ?? ""}
                      onChange={(event) => setModuleNames({ ...moduleNames, [index]: event.target.value })}
                      placeholder="New module in this phase"
                      aria-label={`New module in phase ${index + 1}`}
                    />
                  </div>
                  <Button
                    variant="secondary"
                    size="md"
                    stretch="auto"
                    label="Add module"
                    disabled={!(moduleNames[index] ?? "").trim() || busy}
                    onClick={() => void addModule(index)}
                  />
                </div>
              </>
            ) : (
              <p className="text-body-xs-regular text-tertiary">Choose or create a project to pick modules.</p>
            )}
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="md"
          stretch="auto"
          label="Add phase"
          disabled={draft.stages.length >= 12}
          onClick={() =>
            setDraft({ ...draft, stages: [...draft.stages, { name: `Phase ${draft.stages.length + 1}`, modules: [] }] })
          }
        />
        <Button
          variant="primary"
          size="md"
          stretch="auto"
          label="Save flow"
          loading={busy}
          disabled={!ready}
          onClick={save}
        />
        <Button variant="secondary" size="md" stretch="auto" label="Cancel" onClick={onCancel} />
      </div>
    </section>
  );
});
