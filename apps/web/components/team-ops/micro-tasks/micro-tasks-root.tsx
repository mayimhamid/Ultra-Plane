/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { Trash2, Users } from "lucide-react";
import { Button } from "@makeplane/propel/components/button";
import { setToast } from "@plane/blocks/toast";
import { formatMinutes, toDateKey } from "@plane/services";
import type { TMicroTask, TPlanUnit } from "@plane/types";
import { cn } from "@plane/utils";
// hooks
import { useUser } from "@/hooks/store/user";
import { dayReportService, refreshTeamOps, useMicroTasks } from "@/hooks/team-ops/use-day-report";
import { useHubPeople } from "@/hooks/team-ops/use-hub";
import { useCalendarSettings } from "@/hooks/team-ops/use-work-calendar";
// components
import { getErrorMessage } from "../calendar/error-message";
import { FinishTaskDialog } from "../day-report/finish-task-dialog";
import type { TFinishedWork } from "../day-report/finish-task-dialog";
import { ProgressLine } from "../day-report/verdict-badge";
import { TaskImportButtons } from "../import/task-import-button";

const GREEN = "#16a34a";
const field =
  "h-10 rounded-md border border-subtle bg-layer-1 px-3 text-body-sm-regular text-primary outline-none focus:border-accent-strong";

function TaskRow({
  task,
  onToggle,
  onDelete,
}: {
  task: TMicroTask;
  onToggle: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  return (
    <li
      className={cn(
        "flex items-start gap-3 rounded-md border bg-surface-1 p-3",
        task.is_meeting ? "border-l-4" : "border-subtle"
      )}
      style={task.is_meeting ? { borderColor: GREEN } : undefined}
    >
      <input
        type="checkbox"
        checked={task.done}
        onChange={() => void onToggle()}
        aria-label={task.done ? `Mark ${task.title} as open` : `Mark ${task.title} as done`}
        className="mt-1 size-5 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className={cn("text-body-sm-medium", task.done ? "text-tertiary line-through" : "text-primary")}>
          {task.is_meeting ? (
            <span
              className="mr-2 rounded-full px-2 py-0.5 text-caption-sm-medium text-white"
              style={{ backgroundColor: GREEN }}
            >
              Meeting
            </span>
          ) : null}
          {task.title}
        </p>
        {task.description ? <p className="text-body-xs-regular text-secondary">{task.description}</p> : null}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <ProgressLine progress={task} />
          {task.due_date ? <span className="text-caption-sm-regular text-tertiary">Due {task.due_date}</span> : null}
        </div>
      </div>
      <button
        type="button"
        aria-label={`Delete ${task.title}`}
        onClick={() => void onDelete()}
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-md text-tertiary hover:bg-danger-subtle hover:text-danger-primary"
      >
        <Trash2 className="size-4" />
      </button>
    </li>
  );
}

/** Small tasks with no project, and meetings. They appear in the Day Report under "No project". */
export const MicroTasksRoot = observer(function MicroTasksRoot({ workspaceSlug }: { workspaceSlug: string }) {
  const { data: currentUser } = useUser();
  const { permissions } = useCalendarSettings(workspaceSlug);
  const { people } = useHubPeople(workspaceSlug);
  const [person, setPerson] = useState<string>("");
  const forSomeoneElse = person && person !== currentUser?.id ? person : undefined;
  const { tasks, isLoading, create, update, remove } = useMicroTasks(workspaceSlug, forSomeoneElse);

  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState<TPlanUnit>("HOURS");
  const [due, setDue] = useState("");
  const [meeting, setMeeting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showDone, setShowDone] = useState(false);
  // The task whose "done" box is open: it asks how long the work took before the task is finished.
  const [finishing, setFinishing] = useState<TMicroTask | null>(null);
  const meetingInput = useRef<HTMLInputElement>(null);
  const isNamingMeeting = meeting !== null;

  // The name box takes the cursor when it opens.
  useEffect(() => {
    if (isNamingMeeting) meetingInput.current?.focus();
  }, [isNamingMeeting]);

  const guard = async (action: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    try {
      await action();
      if (success) setToast({ type: "success", title: success, message: "It is in your Day Report list." });
      return true;
    } catch (error) {
      setToast({ type: "error", title: "Something went wrong", message: getErrorMessage(error) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const done = await guard(
      () => create({ title, amount: amount || null, unit, due_date: due || null }),
      "Micro task added"
    );
    if (done) {
      setTitle("");
      setAmount("");
      setDue("");
    }
  };

  const addMeeting = async () => {
    if (!meeting?.trim()) return;
    const done = await guard(() => create({ title: meeting, is_meeting: true }), "Meeting added");
    if (done) setMeeting(null);
  };

  /** Ticking an open task asks how long it took (like a work item moved to Done); for someone else's task it only ticks. */
  const finish = async (task: TMicroTask) => {
    if (forSomeoneElse) {
      await guard(() => update(task.id, { done: true }));
      return;
    }
    setFinishing(task);
  };

  const reportFinished = async (task: TMicroTask, { day, minutes, start, end, place, note }: TFinishedWork) => {
    try {
      // The report row, marked finished, also marks the micro task done.
      await dayReportService.addRow(workspaceSlug, day, {
        micro_task: task.id,
        minutes,
        ...(start && end ? { start, end } : {}),
        location: place,
        finished: true,
        note,
      });
      await refreshTeamOps();
      setToast({
        type: "success",
        title: "Added to the Day Report",
        message: `${task.title} · ${formatMinutes(minutes)}${day === toDateKey(new Date()) ? " today" : ` on ${day}`}.`,
      });
      setFinishing(null);
    } catch (error) {
      setToast({ type: "error", title: "Could not add it", message: getErrorMessage(error) });
      throw error;
    }
  };

  const open = (tasks ?? []).filter((task) => !task.done);
  const finished = (tasks ?? []).filter((task) => task.done);
  const personName = (people ?? []).find((p) => p.id === forSomeoneElse)?.display_name ?? currentUser?.display_name;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-h4-medium text-primary">Micro Tasks</h1>
          <p className="text-body-sm-regular text-secondary">
            Small tasks with no project. In the Day Report they are under "No project".
          </p>
        </div>
        <TaskImportButtons
          workspaceSlug={workspaceSlug}
          target="micro"
          userId={forSomeoneElse}
          personName={personName}
        />
      </header>

      {permissions?.can_view_team ? (
        <label className="flex max-w-sm flex-col gap-1">
          <span className="flex items-center gap-1 text-body-xs-medium text-secondary">
            <Users className="size-3.5" aria-hidden /> Whose tasks
          </span>
          <select value={person} onChange={(event) => setPerson(event.target.value)} className={field}>
            <option value="">Mine</option>
            {(people ?? [])
              .filter((p) => p.id !== currentUser?.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name}
                </option>
              ))}
          </select>
        </label>
      ) : null}

      <section
        aria-label="New micro task"
        className="flex flex-col gap-3 rounded-lg border border-subtle bg-surface-1 p-4"
      >
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_6.5rem_10rem]">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && title.trim()) void add();
            }}
            placeholder="What needs doing?"
            aria-label="Title"
            className={field}
          />
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            placeholder="Planned"
            aria-label="Planned time"
            className={field}
          />
          <select
            value={unit}
            onChange={(event) => setUnit(event.target.value as TPlanUnit)}
            aria-label="Unit"
            className={field}
          >
            <option value="HOURS">hours</option>
            <option value="DAYS">days</option>
          </select>
          <input
            type="date"
            value={due}
            onChange={(event) => setDue(event.target.value)}
            aria-label="Due date"
            className={field}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="lg"
            stretch="auto"
            label="Add task"
            loading={busy}
            disabled={!title.trim()}
            onClick={() => void add()}
          />
          <button
            type="button"
            onClick={() => setMeeting("")}
            className="inline-flex min-h-10 items-center gap-2 rounded-md px-4 text-body-sm-medium text-white"
            style={{ backgroundColor: GREEN }}
          >
            <span aria-hidden className="size-2 rounded-full bg-white" />
            Meeting
          </button>
        </div>
        {meeting !== null ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border-2 p-3" style={{ borderColor: GREEN }}>
            <input
              ref={meetingInput}
              value={meeting}
              onChange={(event) => setMeeting(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void addMeeting();
                if (event.key === "Escape") setMeeting(null);
              }}
              placeholder="Name of the meeting"
              aria-label="Name of the meeting"
              className={cn(field, "min-w-0 flex-1")}
            />
            <button
              type="button"
              disabled={!meeting.trim() || busy}
              onClick={() => void addMeeting()}
              className="min-h-10 rounded-md px-4 text-body-sm-medium text-white disabled:opacity-50"
              style={{ backgroundColor: GREEN }}
            >
              Add meeting
            </button>
            <button
              type="button"
              onClick={() => setMeeting(null)}
              className="min-h-10 px-3 text-body-sm-medium text-secondary"
            >
              Cancel
            </button>
          </div>
        ) : null}
      </section>

      {isLoading ? <p className="text-body-sm-regular text-tertiary">Loading...</p> : null}
      {!isLoading && open.length === 0 ? (
        <p className="rounded-lg border border-dashed border-subtle p-6 text-center text-body-sm-regular text-tertiary">
          No open micro tasks.
        </p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {open.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            onToggle={() => finish(task)}
            onDelete={async () => void (await guard(() => remove(task.id)))}
          />
        ))}
      </ul>

      {finishing ? (
        <FinishTaskDialog
          key={finishing.id}
          heading={finishing.is_meeting ? "Meeting done" : "Task done"}
          name={finishing.title}
          onSubmit={(work) => reportFinished(finishing, work)}
          onSkip={async () => {
            if (await guard(() => update(finishing.id, { done: true }))) setFinishing(null);
          }}
          onClose={() => setFinishing(null)}
        />
      ) : null}

      {finished.length > 0 ? (
        <section className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setShowDone((value) => !value)}
            className="min-h-10 self-start text-body-sm-medium text-accent-primary hover:underline"
          >
            {showDone ? "Hide" : "Show"} done ({finished.length})
          </button>
          {showDone ? (
            <ul className="flex flex-col gap-2">
              {finished.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onToggle={async () => void (await guard(() => update(task.id, { done: false })))}
                  onDelete={async () => void (await guard(() => remove(task.id)))}
                />
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
});
