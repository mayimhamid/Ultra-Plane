/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
import { InputField } from "@makeplane/propel/components/input-field";
import { SelectField } from "@makeplane/propel/components/select-field";
import type { TIssueSearchResponse } from "@plane/types";
// hooks
import { useProject } from "@/hooks/store/use-project";
import useDebounce from "@/hooks/use-debounce";
// services
import { WorkspaceService } from "@/services/workspace.service";

const workspaceService = new WorkspaceService();
/** High enough to list every work item of a project. */
const ALL_TASKS = 1000;

export type TPickedTask = { id: string; name: string; key: string; projectId: string };

type Props = {
  workspaceSlug: string;
  value: TPickedTask | null;
  onChange: (value: TPickedTask | null) => void;
  disabled?: boolean;
};

/** Two steps: the project first, then a work item of that project. */
export const ProjectTaskPicker = observer(function ProjectTaskPicker(props: Props) {
  const { workspaceSlug, value, onChange, disabled } = props;
  // states
  const [projectId, setProjectId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLDivElement>(null);
  // hooks
  const { joinedProjectIds, getPartialProjectById } = useProject();
  const debouncedQuery = useDebounce(query, 250);

  const { data, isLoading } = useSWR(projectId ? `TEAM_OPS_PROJECT_TASKS_${projectId}_${debouncedQuery}` : null, () =>
    workspaceService.searchEntity(workspaceSlug, {
      // Every work item of the project; the box at the top narrows it down.
      count: ALL_TASKS,
      project_id: projectId!,
      query_type: ["issue"],
      query: debouncedQuery,
    })
  );

  const projectOptions = joinedProjectIds.map((id) => ({ value: id, label: getPartialProjectById(id)?.name ?? id }));
  const results: TIssueSearchResponse[] = data?.issue ?? [];

  const choose = (issue: TIssueSearchResponse) => {
    onChange({
      id: issue.id,
      name: issue.name,
      key: `${issue.project__identifier}-${issue.sequence_id}`,
      projectId: projectId!,
    });
    setQuery("");
    setIsOpen(false);
  };

  // Put the cursor in the search box when the list opens
  useEffect(() => {
    if (isOpen) search.current?.querySelector("input")?.focus();
  }, [isOpen]);

  // Close the list on a click outside it or on Escape
  useEffect(() => {
    if (!isOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setIsOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [isOpen]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-subtle bg-layer-1 px-3 py-2.5">
        <span className="min-w-0 truncate text-body-sm-medium text-primary">
          <span className="text-tertiary">{value.key}</span> {value.name}
        </span>
        <button
          type="button"
          className="shrink-0 text-body-xs-medium text-accent-primary hover:underline"
          onClick={() => onChange(null)}
          disabled={disabled}
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <SelectField
          size="lg"
          label="1. Project"
          options={projectOptions}
          value={projectId ?? undefined}
          onValueChange={(next) => setProjectId(next ?? null)}
          disabled={disabled}
        />
      </div>
      <div ref={box} className="relative">
        <p className="mb-1 text-body-xs-medium text-secondary">2. Task</p>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          disabled={disabled || !projectId}
          onClick={() => setIsOpen((open) => !open)}
          className="flex w-full items-center justify-between gap-2 rounded-md border border-subtle bg-layer-1 px-3 py-2.5 text-left text-body-sm-regular text-tertiary hover:border-strong disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="truncate">{projectId ? "Choose a task" : "Choose a project first"}</span>
          <span aria-hidden className="text-caption-sm-regular">
            {isOpen ? "▲" : "▼"}
          </span>
        </button>
        {isOpen && projectId ? (
          <div className="absolute z-20 mt-1 flex w-full flex-col gap-1 rounded-md border border-subtle bg-surface-1 p-2 shadow-raised-200">
            <div ref={search}>
              <InputField
                type="text"
                size="lg"
                orientation="vertical"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search the work items of this project"
                aria-label="Search work items"
              />
            </div>
            <ul role="listbox" aria-label="Work items" className="max-h-72 overflow-y-auto py-1">
              {results.length === 0 ? (
                <li className="px-3 py-2 text-13 text-tertiary">
                  {isLoading ? "Searching..." : "No work items found in this project."}
                </li>
              ) : (
                results.map((issue) => (
                  <li key={issue.id} role="option" aria-selected={false}>
                    <button
                      type="button"
                      className="w-full truncate rounded px-3 py-2 text-left text-13 hover:bg-layer-1"
                      onClick={() => choose(issue)}
                    >
                      <span className="font-medium text-tertiary">
                        {issue.project__identifier}-{issue.sequence_id}
                      </span>{" "}
                      {issue.name}
                    </button>
                  </li>
                ))
              )}
            </ul>
            {results.length > 0 ? (
              <p className="px-1 text-caption-sm-regular text-tertiary">{results.length} work items</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
});
