/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { Button } from "@makeplane/propel/components/button";
import { formatClock } from "@plane/services";
import type { TWorkdayTimer, TWorkPlace } from "@plane/types";
// local imports
import { useSecondsSince } from "./now-card";
import { ProjectTaskPicker } from "./project-task-picker";
import type { TPickedTask } from "./project-task-picker";

const PURPLE = "#8b5cf6";

type Props = {
  workspaceSlug: string;
  /** The place of the main task, which a parallel task starts in. */
  defaultPlace: TWorkPlace | "";
  parallel: TWorkdayTimer[];
  onStart: (task: TPickedTask, place?: TWorkPlace) => Promise<void>;
  onFinish: (timer: TWorkdayTimer) => void;
};

function ParallelRow({ timer, onFinish }: { timer: TWorkdayTimer; onFinish: () => void }) {
  const since = useSecondsSince(timer.server_time);
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-t pt-3" style={{ borderColor: PURPLE }}>
      <div className="min-w-0">
        <p className="text-caption-sm-regular" style={{ color: PURPLE }}>
          Parallel
        </p>
        <p className="truncate text-body-sm-medium text-primary">
          {timer.work_item} {timer.work_item_name}
        </p>
      </div>
      <span className="font-mono text-h5-medium text-primary tabular-nums">
        {formatClock(timer.worked_seconds + since)}
      </span>
      <Button variant="secondary" size="md" stretch="auto" label="Finish" onClick={onFinish} />
    </li>
  );
}

/** Tasks worked at the same time as the main one, as many as needed. Each has its own clock, in purple. */
export function ParallelTasks({ workspaceSlug, defaultPlace, parallel, onStart, onFinish }: Props) {
  const [adding, setAdding] = useState(false);
  const [task, setTask] = useState<TPickedTask | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const start = async () => {
    if (!task) return;
    setIsBusy(true);
    try {
      await onStart(task, defaultPlace || undefined);
      setTask(null);
      setAdding(false);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <section aria-label="Parallel tasks" className="flex flex-col gap-2">
      {parallel.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {parallel.map((timer) => (
            <ParallelRow key={timer.id} timer={timer} onFinish={() => onFinish(timer)} />
          ))}
        </ul>
      ) : null}
      {adding ? (
        <div className="flex flex-col gap-3 rounded-lg border border-dashed p-4" style={{ borderColor: PURPLE }}>
          <p className="text-body-sm-medium text-primary">Add a task you work on at the same time</p>
          <ProjectTaskPicker workspaceSlug={workspaceSlug} value={task} onChange={setTask} disabled={isBusy} />
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="md"
              stretch="auto"
              label="Start parallel task"
              disabled={!task}
              loading={isBusy}
              onClick={start}
            />
            <Button variant="secondary" size="md" stretch="auto" label="Cancel" onClick={() => setAdding(false)} />
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="self-start text-body-sm-medium hover:underline"
          style={{ color: PURPLE }}
          onClick={() => setAdding(true)}
        >
          + Add a parallel task
        </button>
      )}
    </section>
  );
}
