/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
import type { TIssueSearchResponse, TMicroTask } from "@plane/types";
import { cn } from "@plane/utils";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useDismiss } from "@/hooks/team-ops/use-dismiss";
import useDebounce from "@/hooks/use-debounce";
// services
import { WorkspaceService } from "@/services/workspace.service";

const workspaceService = new WorkspaceService();
const NO_PROJECT = "__micro__";

/** The task of a report row: a work item of a project, or a micro task (no project). */
export type TTaskRef = {
  kind: "issue" | "micro";
  id: string;
  key: string | null;
  name: string;
  project: string | null;
  isMeeting?: boolean;
};

type Props = {
  workspaceSlug: string;
  value: TTaskRef | null;
  onChange: (value: TTaskRef) => void;
  microTasks: TMicroTask[];
  disabled?: boolean;
};

/** One button; it opens a panel: the project (or "No project" for micro tasks), then a searchable task list. */
export const TaskCell = observer(function TaskCell({ workspaceSlug, value, onChange, microTasks, disabled }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const { joinedProjectIds, getPartialProjectById } = useProject();
  const debounced = useDebounce(query, 250);
  const isMicro = projectId === NO_PROJECT;

  const { data, isLoading } = useSWR(
    isOpen && projectId && !isMicro ? `TEAM_OPS_REPORT_TASKS_${projectId}_${debounced}` : null,
    () =>
      workspaceService.searchEntity(workspaceSlug, {
        count: 1000,
        project_id: projectId!,
        query_type: ["issue"],
        query: debounced,
      })
  );

  const close = useCallback(() => setIsOpen(false), []);
  useDismiss(box, isOpen, close);
  useEffect(() => {
    if (isOpen && projectId) search.current?.focus();
  }, [isOpen, projectId]);

  const issues: TIssueSearchResponse[] = data?.issue ?? [];
  const micro = microTasks.filter(
    (task) => !task.done && task.title.toLowerCase().includes(query.trim().toLowerCase())
  );

  const pick = (next: TTaskRef) => {
    onChange(next);
    setIsOpen(false);
    setQuery("");
  };

  return (
    <div ref={box} className="relative min-w-0">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className={cn(
          "flex min-h-10 w-full min-w-0 items-center gap-2 rounded-md border px-3 py-1.5 text-left text-body-sm-regular",
          value ? "border-subtle bg-surface-1" : "border-dashed border-strong text-tertiary",
          "hover:border-strong disabled:cursor-default disabled:opacity-80"
        )}
      >
        {value ? (
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-caption-sm-medium text-tertiary">
              {value.kind === "micro"
                ? value.isMeeting
                  ? "Meeting · no project"
                  : "Micro task · no project"
                : value.project}
            </span>
            <span className="truncate text-primary">
              {value.key ? <span className="text-tertiary">{value.key} </span> : null}
              {value.name}
            </span>
          </span>
        ) : (
          <span>Choose the task</span>
        )}
      </button>

      {isOpen ? (
        <div
          role="dialog"
          aria-label="Choose the task"
          className="absolute top-full left-0 z-30 mt-1 flex w-[min(92vw,26rem)] flex-col gap-2 rounded-lg border border-subtle bg-surface-1 p-2 shadow-raised-200"
        >
          <div className="flex flex-wrap gap-1">
            {joinedProjectIds.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setProjectId(id)}
                className={cn(
                  "min-h-8 rounded-full border px-3 text-caption-sm-medium",
                  projectId === id
                    ? "border-accent-strong bg-accent-subtle text-accent-primary"
                    : "border-subtle text-secondary hover:bg-layer-1"
                )}
              >
                {getPartialProjectById(id)?.name ?? id}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setProjectId(NO_PROJECT)}
              className={cn(
                "min-h-8 rounded-full border border-dashed px-3 text-caption-sm-medium",
                isMicro ? "border-accent-strong bg-accent-subtle text-accent-primary" : "border-strong text-secondary"
              )}
            >
              No project (micro tasks)
            </button>
          </div>
          {projectId ? (
            <>
              <input
                ref={search}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={isMicro ? "Search your micro tasks" : "Search the work items"}
                aria-label="Search tasks"
                className="h-10 rounded-md border border-subtle bg-layer-1 px-3 text-body-sm-regular text-primary outline-none focus:border-accent-strong"
              />
              <ul role="listbox" aria-label="Tasks" className="max-h-64 overflow-y-auto">
                {isMicro ? (
                  micro.length === 0 ? (
                    <li className="px-3 py-2 text-body-xs-regular text-tertiary">
                      No open micro tasks. Add them in Micro Tasks.
                    </li>
                  ) : (
                    micro.map((task) => (
                      <li key={task.id} role="option" aria-selected={value?.id === task.id}>
                        <button
                          type="button"
                          className="min-h-10 w-full truncate rounded px-3 py-2 text-left text-body-sm-regular hover:bg-layer-1"
                          onClick={() =>
                            pick({
                              kind: "micro",
                              id: task.id,
                              key: null,
                              name: task.title,
                              project: null,
                              isMeeting: task.is_meeting,
                            })
                          }
                        >
                          {task.is_meeting ? <span className="mr-1 text-success-primary">●</span> : null}
                          {task.title}
                        </button>
                      </li>
                    ))
                  )
                ) : issues.length === 0 ? (
                  <li className="px-3 py-2 text-body-xs-regular text-tertiary">
                    {isLoading ? "Searching..." : "No work items found."}
                  </li>
                ) : (
                  issues.map((issue) => (
                    <li key={issue.id} role="option" aria-selected={value?.id === issue.id}>
                      <button
                        type="button"
                        className="min-h-10 w-full truncate rounded px-3 py-2 text-left text-body-sm-regular hover:bg-layer-1"
                        onClick={() =>
                          pick({
                            kind: "issue",
                            id: issue.id,
                            key: `${issue.project__identifier}-${issue.sequence_id}`,
                            name: issue.name,
                            project: getPartialProjectById(projectId)?.name ?? null,
                          })
                        }
                      >
                        <span className="text-tertiary">
                          {issue.project__identifier}-{issue.sequence_id}
                        </span>{" "}
                        {issue.name}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </>
          ) : (
            <p className="px-1 text-caption-sm-regular text-tertiary">Choose a project, or "No project".</p>
          )}
        </div>
      ) : null}
    </div>
  );
});
