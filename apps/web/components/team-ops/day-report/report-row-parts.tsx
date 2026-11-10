/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronRight, Circle, Paperclip, X } from "lucide-react";
import { setToast } from "@plane/blocks/toast";
import { FILE_ACCEPT, durationText, fileLimitError, formatMinutes, parseDuration } from "@plane/services";
import type { TMicroTask } from "@plane/types";
import { cn } from "@plane/utils";
// hooks
import { dayReportService } from "@/hooks/team-ops/use-day-report";
import { useHubPeople } from "@/hooks/team-ops/use-hub";
// local imports
import { getErrorMessage } from "../calendar/error-message";
import { PLACES, PLACE_COLOR, PLACE_LABEL, isIncomplete, minutesOf, needsDocument } from "./report-rows";
import type { TRow } from "./report-rows";
import { TaskCell } from "./task-cell";
import { ProgressLine, VerdictBadge } from "./verdict-badge";

const FIELD =
  "h-10 w-full rounded-md border bg-layer-1 px-2 text-body-sm-medium text-primary tabular-nums outline-none focus:border-accent-strong disabled:opacity-80";

/** One task of the report as a single line; pressing it opens its details. */
export function ReportRowLine({ row, index, onOpen }: { row: TRow; index: number; onOpen: () => void }) {
  const minutes = minutesOf(row);
  const incomplete = isIncomplete(row);
  const task = row.task;
  return (
    <button
      type="button"
      aria-label={`Task ${index + 1}: ${task?.name ?? "not chosen yet"}. Open its details`}
      onClick={onOpen}
      className={cn(
        "flex min-h-12 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left hover:bg-layer-1",
        incomplete ? "border-danger-strong" : "border-subtle"
      )}
    >
      <span
        aria-hidden
        title={row.place ? PLACE_LABEL[row.place] : "No place yet"}
        className={cn("size-2.5 shrink-0 rounded-full", !row.place && "border border-dashed border-strong")}
        style={row.place ? { backgroundColor: PLACE_COLOR[row.place] } : undefined}
      />
      <span className="min-w-0 flex-1 truncate text-body-sm-regular text-primary">
        {task ? (
          <>
            <span className="text-tertiary">{task.key ?? (task.isMeeting ? "Meeting" : "Micro")} </span>
            {task.name}
          </>
        ) : (
          <span className="text-tertiary">Choose the task</span>
        )}
      </span>
      {!row.spread && row.start && row.end ? (
        <span className="hidden shrink-0 text-caption-sm-regular text-tertiary tabular-nums sm:inline">
          {row.start}–{row.end}
        </span>
      ) : null}
      <span
        className={cn(
          "shrink-0 text-body-sm-medium tabular-nums",
          minutes ? "text-primary" : incomplete ? "text-danger-primary" : "text-tertiary"
        )}
      >
        {minutes ? formatMinutes(minutes) : "—"}
      </span>
      {row.finished ? <CheckCircle2 className="size-4 shrink-0 text-success-primary" aria-label="Task done" /> : null}
      {row.saved ? <VerdictBadge status={row.saved.status} className="hidden shrink-0 sm:inline-flex" /> : null}
      <ChevronRight className="size-4 shrink-0 text-tertiary" aria-hidden />
    </button>
  );
}

const TEXT_FILE = /\.(md|markdown|txt)$/i;
const MAX_TEXT_FILE = 100 * 1024;

/**
 * The document of a task that is done, whatever the person has: a text or Markdown file is read into the note
 * (so it shows like a README), any other file goes to the Doc Hub and the note says where it is.
 */
function AttachDocument({
  workspaceSlug,
  row,
  day,
  onChange,
}: {
  workspaceSlug: string;
  row: TRow;
  day: string;
  onChange: (patch: Partial<TRow>) => void;
}) {
  const [isBusy, setIsBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const task = row.task;
  if (!task) return null;

  const take = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const chosen = Array.from(list);
    const problem = fileLimitError(chosen);
    if (problem) return setToast({ type: "error", title: "Cannot attach", message: problem });
    setIsBusy(true);
    try {
      let note = row.note;
      const isText = (file: File) => TEXT_FILE.test(file.name) && file.size <= MAX_TEXT_FILE;
      const others = chosen.filter((file) => !isText(file));
      const texts = await Promise.all(chosen.filter(isText).map((file) => file.text()));
      for (const text of texts.map((value) => value.trim()).filter(Boolean)) {
        note = note.trim()
          ? `${note.trim()}

${text}`
          : text;
      }
      if (others.length > 0) {
        const doc = await dayReportService.uploadTaskDocument(workspaceSlug, { task, day, files: others });
        const line = `Document in the Doc Hub: ${doc.title} (${others.map((file) => file.name).join(", ")})`;
        note = note.trim() ? `${note.trim()}\n\n${line}` : line;
      }
      onChange({ note });
    } catch (error) {
      setToast({ type: "error", title: "Could not attach", message: getErrorMessage(error) });
    } finally {
      setIsBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={input}
        type="file"
        multiple
        accept={FILE_ACCEPT}
        className="sr-only"
        id="row-document-files"
        onChange={(event) => void take(event.target.files)}
      />
      <label
        htmlFor="row-document-files"
        className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-md border border-subtle px-3 text-body-xs-medium text-accent-primary hover:bg-layer-1"
      >
        <Paperclip className="size-4" aria-hidden />
        {isBusy ? "Attaching..." : "Attach a file"}
      </label>
      <span className="text-caption-sm-regular text-tertiary">
        Markdown and text files are read into the note; other files go to the Doc Hub.
      </span>
    </div>
  );
}

/** Tell someone about this task: tag people, add files (a document, a README) and a note, all in one send. */
function ShareTask({ workspaceSlug, row }: { workspaceSlug: string; row: TRow }) {
  const { people } = useHubPeople(workspaceSlug);
  const [isOpen, setIsOpen] = useState(false);
  const [userIds, setUserIds] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [fileError, setFileError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const task = row.task;
  if (!task) return null;

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next = [...files, ...Array.from(list)];
    const problem = fileLimitError(next);
    if (problem) return setFileError(problem);
    setFileError("");
    setFiles(next);
    if (input.current) input.current.value = "";
  };

  const send = async () => {
    setIsSending(true);
    try {
      await dayReportService.shareTask(workspaceSlug, {
        task: { kind: task.kind, id: task.id },
        finished: row.finished,
        note: row.note,
        users: userIds,
        files,
      });
      setToast({ type: "success", title: "Sent", message: "The people you tagged were told." });
      setUserIds([]);
      setFiles([]);
      setIsOpen(false);
    } catch (error) {
      setToast({ type: "error", title: "Could not send", message: getErrorMessage(error) });
    } finally {
      setIsSending(false);
    }
  };

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex min-h-10 items-center gap-2 self-start rounded-md border border-subtle px-3 text-body-xs-medium text-accent-primary hover:bg-layer-1"
      >
        <Paperclip className="size-4" aria-hidden />
        Add a document and tell someone
      </button>
    );
  }

  return (
    <section aria-label="Tell someone" className="flex flex-col gap-2 rounded-lg border border-subtle p-3">
      <p className="text-body-sm-medium text-primary">Tell someone about this task</p>
      <p className="text-caption-sm-regular text-tertiary">
        They are notified, and see the note above and the files. {row.finished ? "It says the task is done." : ""}
      </p>
      <fieldset className="flex max-h-40 flex-wrap gap-x-3 gap-y-1 overflow-y-auto">
        <legend className="mb-1 text-caption-sm-medium text-secondary">Tag people</legend>
        {(people ?? []).map((person) => (
          <label key={person.id} className="flex min-h-9 items-center gap-1.5 text-body-xs-regular text-primary">
            <input
              type="checkbox"
              checked={userIds.includes(person.id)}
              onChange={() =>
                setUserIds((current) =>
                  current.includes(person.id) ? current.filter((id) => id !== person.id) : [...current, person.id]
                )
              }
              className="size-4"
            />
            {person.display_name}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          multiple
          accept={FILE_ACCEPT}
          className="sr-only"
          id="share-task-files"
          onChange={(event) => addFiles(event.target.files)}
        />
        <label
          htmlFor="share-task-files"
          className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md border border-subtle px-3 text-body-xs-medium text-secondary hover:bg-layer-1"
        >
          <Paperclip className="size-4" aria-hidden />
          Attach files
        </label>
        <span className="text-caption-sm-regular text-tertiary">
          {files.length > 0 ? `${files.length} file${files.length === 1 ? "" : "s"}` : "A document, a README, any file"}
        </span>
      </div>
      {fileError ? (
        <p role="alert" className="text-body-xs-regular text-danger-primary">
          {fileError}
        </p>
      ) : null}
      {files.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${file.size}-${file.lastModified}`}
              className="flex items-center justify-between gap-2 text-body-xs-regular"
            >
              <span className="truncate text-primary">{file.name}</span>
              <button
                type="button"
                className="shrink-0 text-accent-primary hover:underline"
                onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="inline-flex min-h-10 items-center rounded-md px-3 text-body-sm-medium text-secondary hover:bg-layer-1"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={isSending || userIds.length === 0}
          onClick={() => void send()}
          className="inline-flex min-h-10 items-center rounded-md bg-accent-primary px-4 text-body-sm-medium text-on-color disabled:opacity-50"
        >
          {isSending ? "Sending..." : "Send"}
        </button>
      </div>
    </section>
  );
}

type DialogProps = {
  workspaceSlug: string;
  /** The day of the report, for naming the document. */
  day: string;
  row: TRow;
  index: number;
  microTasks: TMicroTask[];
  readOnly: boolean;
  onChange: (patch: Partial<TRow>) => void;
  onRemove: () => void;
  onClose: () => void;
};

/** The details of one task of the report, in a small box in the middle of the page (a sheet on a phone). */
export function ReportRowDialog({
  workspaceSlug,
  day,
  row,
  index,
  microTasks,
  readOnly,
  onChange,
  onRemove,
  onClose,
}: DialogProps) {
  const minutes = minutesOf(row);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Task ${index + 1} of the Day Report`}
        className="flex max-h-[92dvh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-xl border border-subtle bg-surface-1 p-4 shadow-raised-300 sm:rounded-xl"
      >
        <header className="flex items-center justify-between gap-2">
          <h2 className="text-h5-medium text-primary">Task {index + 1}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="inline-flex size-10 items-center justify-center rounded-full hover:bg-layer-1"
          >
            <X className="size-5" />
          </button>
        </header>

        <div>
          <TaskCell
            workspaceSlug={workspaceSlug}
            value={row.task}
            onChange={(task) => onChange({ task })}
            microTasks={microTasks}
            disabled={readOnly}
            inline
          />
          {row.saved ? (
            <div className="mt-1">
              <ProgressLine progress={row.saved} />
            </div>
          ) : null}
          {/* The state of the task, said plainly: done, or still being worked on. */}
          {row.task ? (
            <p
              className={cn(
                "mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-caption-sm-medium",
                row.finished || row.saved?.finished
                  ? "bg-success-subtle text-success-primary"
                  : "bg-layer-1 text-secondary"
              )}
            >
              {row.finished || row.saved?.finished ? (
                <CheckCircle2 className="size-3.5" aria-hidden />
              ) : (
                <Circle className="size-3.5" aria-hidden />
              )}
              {row.finished || row.saved?.finished ? "Task done" : "In progress (not done yet)"}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
          {row.spread ? (
            <label className="flex min-w-32 flex-1 flex-col gap-0.5">
              <span className="text-caption-sm-medium text-tertiary">How long</span>
              <input
                type="text"
                inputMode="decimal"
                value={row.duration}
                disabled={readOnly}
                placeholder="1:30"
                aria-label="How long"
                onChange={(event) => onChange({ duration: event.target.value })}
                onBlur={() => {
                  const value = parseDuration(row.duration);
                  if (value) onChange({ duration: durationText(value) });
                }}
                className={cn(FIELD, row.duration && !minutes ? "border-danger-strong" : "border-subtle")}
              />
            </label>
          ) : (
            <>
              <label className="flex min-w-28 flex-1 flex-col gap-0.5">
                <span className="text-caption-sm-medium text-tertiary">From</span>
                <input
                  type="time"
                  value={row.start}
                  disabled={readOnly}
                  aria-label="Start time"
                  onChange={(event) => onChange({ start: event.target.value })}
                  className={cn(FIELD, "border-subtle")}
                />
              </label>
              <label className="flex min-w-28 flex-1 flex-col gap-0.5">
                <span className="text-caption-sm-medium text-tertiary">To</span>
                <input
                  type="time"
                  value={row.end}
                  disabled={readOnly}
                  aria-label="End time"
                  onChange={(event) => onChange({ end: event.target.value })}
                  className={cn(FIELD, row.start && row.end && !minutes ? "border-danger-strong" : "border-subtle")}
                />
              </label>
            </>
          )}
          <span className="min-w-14 pb-2.5 text-body-sm-semibold text-primary tabular-nums">
            {minutes ? formatMinutes(minutes) : "—"}
          </span>
        </div>

        <label className="flex min-h-10 items-center gap-2 text-body-xs-medium text-secondary">
          <input
            type="checkbox"
            checked={row.spread}
            disabled={readOnly}
            onChange={(event) => {
              const spread = event.target.checked;
              // Keep the time already entered when switching between the two ways.
              onChange({ spread, duration: spread && minutes ? durationText(minutes) : row.duration });
            }}
            className="size-5"
          />
          Not continuous (only how long)
        </label>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div role="radiogroup" aria-label="Place" className="flex rounded-md border border-subtle p-0.5">
            {PLACES.map((place) => (
              <button
                key={place.value}
                type="button"
                role="radio"
                aria-checked={row.place === place.value}
                disabled={readOnly}
                onClick={() => onChange({ place: place.value })}
                className={cn(
                  "min-h-9 rounded px-4 text-body-xs-medium",
                  row.place === place.value ? "bg-accent-primary text-on-color" : "text-secondary hover:bg-layer-1"
                )}
              >
                {place.label}
              </button>
            ))}
          </div>
          <label className="flex min-h-10 items-center gap-2 text-body-xs-medium text-secondary">
            <input
              type="checkbox"
              checked={row.finished}
              disabled={readOnly}
              onChange={(event) => onChange({ finished: event.target.checked })}
              className="size-5"
            />
            Task done
          </label>
        </div>

        {/* The whole text, in a box that scrolls: a long note can be read from start to end. */}
        <label className="flex flex-col gap-0.5">
          <span className="text-caption-sm-medium text-tertiary">
            {needsDocument(row) || row.finished
              ? "Document: what was done (required for a done task)"
              : "What was done"}
          </span>
          <textarea
            value={row.note}
            readOnly={readOnly}
            rows={5}
            placeholder={readOnly ? "Nothing was written." : "What was done (optional)"}
            aria-label="What was done"
            dir="auto"
            onChange={(event) => onChange({ note: event.target.value })}
            className={cn(
              "max-h-64 min-h-28 w-full resize-y overflow-y-auto rounded-md border bg-layer-1 px-3 py-2 text-body-sm-regular leading-relaxed whitespace-pre-wrap text-primary outline-none focus:border-accent-strong",
              needsDocument(row) ? "border-danger-strong" : "border-subtle"
            )}
          />
        </label>

        {readOnly || !row.task || !row.finished ? null : (
          <AttachDocument workspaceSlug={workspaceSlug} row={row} day={day} onChange={onChange} />
        )}

        {readOnly || !row.task ? null : <ShareTask workspaceSlug={workspaceSlug} row={row} />}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 items-center rounded-md bg-accent-primary px-5 text-body-sm-medium text-on-color"
          >
            Done
          </button>
          {readOnly ? null : (
            <button
              type="button"
              onClick={onRemove}
              className="inline-flex min-h-11 items-center rounded-md px-3 text-body-sm-medium text-danger-primary hover:bg-danger-subtle"
            >
              Remove task
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
