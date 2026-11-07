/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { CheckCircle2, ChevronRight, X } from "lucide-react";
import { durationText, formatMinutes, parseDuration } from "@plane/services";
import type { TMicroTask } from "@plane/types";
import { cn } from "@plane/utils";
// local imports
import { PLACES, PLACE_COLOR, PLACE_LABEL, isIncomplete, minutesOf } from "./report-rows";
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

type DialogProps = {
  workspaceSlug: string;
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

        <input
          type="text"
          value={row.note}
          disabled={readOnly}
          placeholder="What was done (optional)"
          aria-label="What was done"
          onChange={(event) => onChange({ note: event.target.value })}
          className="h-10 w-full rounded-md border border-subtle bg-layer-1 px-3 text-body-sm-regular text-primary outline-none focus:border-accent-strong"
        />

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
