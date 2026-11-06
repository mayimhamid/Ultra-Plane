/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import { Button } from "@makeplane/propel/components/button";
import { setToast } from "@plane/blocks/toast";
import { durationText, formatMinutes, parseDuration, spanMinutes } from "@plane/services";
import type { TDayReport, TDayReportRowInput, TReportPlace } from "@plane/types";
import { cn } from "@plane/utils";
// hooks
import { useDayReport, useDayReportHistory, useMicroTasks } from "@/hooks/team-ops/use-day-report";
// local imports
import { getErrorMessage } from "../calendar/error-message";
import { ReportHistory } from "./report-history";
import { TaskCell } from "./task-cell";
import type { TTaskRef } from "./task-cell";
import { ProgressLine } from "./verdict-badge";

type TRow = {
  key: string;
  task: TTaskRef | null;
  /** Work done in one go: from and to. */
  start: string;
  end: string;
  /** Work spread over the day: only how long, typed as 1:30, 1.5 or 45m. */
  spread: boolean;
  duration: string;
  place: TReportPlace | "";
  finished: boolean;
  note: string;
  /** Progress from the server, for rows that were saved. */
  saved?: TDayReport["entries"][number]["task"];
};

const PLACES: { value: TReportPlace; label: string }[] = [
  { value: "REMOTE", label: "Remote" },
  { value: "ONSITE", label: "Onsite" },
];
const PLACE_LABEL: Record<string, string> = { REMOTE: "Remote", ONSITE: "Onsite", HYBRID: "Hybrid" };
// Waits after the last change before the draft is saved on the server by itself.
const AUTOSAVE_MS = 3000;

let counter = 0;
const newKey = () => `row-${Date.now()}-${(counter += 1)}`;
const emptyRow = (place: TReportPlace | ""): TRow => ({
  key: newKey(),
  task: null,
  start: "",
  end: "",
  spread: false,
  duration: "",
  place,
  finished: false,
  note: "",
});

const fromReport = (report: TDayReport): TRow[] =>
  report.entries.map((entry) => ({
    key: entry.id,
    task: entry.task
      ? {
          kind: entry.task.kind,
          id: entry.task.id,
          key: entry.task.key,
          name: entry.task.name,
          project: entry.task.project?.name ?? null,
          isMeeting: entry.task.is_meeting,
        }
      : null,
    start: entry.start ?? "",
    end: entry.end ?? "",
    spread: !entry.start,
    duration: entry.start ? "" : durationText(entry.minutes),
    // Rows saved before places existed take the day's planned place.
    place:
      entry.location ||
      (report.planned_mode === "REMOTE" || report.planned_mode === "ONSITE" ? report.planned_mode : ""),
    finished: entry.finished,
    note: entry.note,
    saved: entry.task,
  }));

/** Minutes of a row, or `null` while its time is not filled in properly. */
const minutesOf = (row: TRow) => (row.spread ? parseDuration(row.duration) : spanMinutes(row.start, row.end));
const isFilled = (row: TRow) => Boolean(row.task || row.start || row.end || row.duration.trim() || row.note.trim());

const dayTitle = new Intl.DateTimeFormat("en-US", { weekday: "long", day: "numeric", month: "long" });
const parse = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const at = (stamp: string | number) =>
  new Date(stamp).toLocaleString("en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const clock = (stamp: number) => new Date(stamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

// What is typed is kept in this browser until it reaches the server, so closing the tab loses nothing.
const storageKey = (workspaceSlug: string, day: string) => `ultra-plane-day-report:${workspaceSlug}:${day}`;
const readLocal = (key: string): TRow[] | null => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as { rows: TRow[] }).rows : null;
  } catch {
    return null;
  }
};
const writeLocal = (key: string, rows: TRow[] | null) => {
  try {
    if (rows) window.localStorage.setItem(key, JSON.stringify({ rows, at: Date.now() }));
    else window.localStorage.removeItem(key);
  } catch {
    // storage is blocked: the server draft is the only copy
  }
};

type Props = { workspaceSlug: string; day: string; user?: string; canSeeHistory: boolean };

/**
 * The Day Report: every task worked on, with the time it took (from–to, or only how long when the work was
 * spread over the day) and where it was done. Today's draft saves itself; it is sent at the end of the day. A
 * sent report, or a past day's, can still be changed, but the change is recorded and the managers are told.
 */
export const DayReportCard = observer(function DayReportCard({ workspaceSlug, day, user, canSeeHistory }: Props) {
  const { report, isLoading, save } = useDayReport(workspaceSlug, day, user);
  const { tasks: microTasks } = useMicroTasks(workspaceSlug);
  const [rows, setRows] = useState<TRow[]>([]);
  const [reason, setReason] = useState("");
  const [isSaving, setIsSaving] = useState<"draft" | "send" | "auto" | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [restored, setRestored] = useState(false);
  const [autoSavedAt, setAutoSavedAt] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const loadedFor = useRef<string | null>(null);
  const history = useDayReportHistory(workspaceSlug, day, user, showHistory && canSeeHistory);
  const localKey = storageKey(workspaceSlug, day);

  const readOnly = !report?.can_edit;
  const recorded = report?.changes_are_recorded ?? false;
  const isPast = report ? report.date < report.today : false;
  const defaultPlace: TReportPlace | "" =
    report?.planned_mode === "REMOTE" || report?.planned_mode === "ONSITE" ? report.planned_mode : "";

  // Rows are loaded once per day shown: later saves keep what is on screen (and the cursor where it is).
  useEffect(() => {
    if (!report) return;
    const id = `${day}:${user ?? "me"}`;
    if (loadedFor.current === id) return;
    loadedFor.current = id;
    const local = report.can_edit ? readLocal(localKey) : null;
    const loaded = fromReport(report);
    if (local && local.some(isFilled)) {
      setRows(local);
      setRestored(true);
      setDirty(true);
    } else {
      setRows(loaded.length > 0 || !report.can_edit ? loaded : [emptyRow(defaultPlace)]);
      setRestored(false);
      setDirty(false);
    }
    setReason("");
    setAutoSavedAt(null);
  }, [report, day, user, localKey, defaultPlace]);

  // Every change is kept in this browser right away.
  useEffect(() => {
    if (!readOnly && dirty) writeLocal(localKey, rows);
  }, [rows, dirty, readOnly, localKey]);

  const total = rows.reduce((sum, row) => sum + (minutesOf(row) ?? 0), 0);
  const places = new Set(rows.filter((row) => isFilled(row) && row.place).map((row) => row.place));
  const dayPlace = places.size > 1 ? "HYBRID" : places.size === 1 ? [...places][0] : (report?.mode ?? "");

  const problems = useMemo(() => {
    const list: string[] = [];
    rows.forEach((row, index) => {
      if (!isFilled(row)) return;
      if (!row.task) list.push(`Row ${index + 1}: choose the task.`);
      if (minutesOf(row) === null)
        list.push(
          row.spread
            ? `Row ${index + 1}: enter how long, like 1:30 or 45m.`
            : `Row ${index + 1}: enter the start and end time (the end after the start).`
        );
      if (!row.place) list.push(`Row ${index + 1}: choose remote or onsite.`);
    });
    if (total > 24 * 60) list.push("The rows add up to more than 24 hours.");
    return list;
  }, [rows, total]);

  const update = (key: string, patch: Partial<TRow>) => {
    setDirty(true);
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch, saved: patch.task ? undefined : row.saved } : row))
    );
  };

  const entriesOf = (list: TRow[]): TDayReportRowInput[] =>
    list.filter(isFilled).map((row) => {
      const entry: TDayReportRowInput = {
        minutes: minutesOf(row) ?? 0,
        location: row.place,
        finished: row.finished,
        note: row.note,
      };
      if (!row.spread) {
        entry.start = row.start;
        entry.end = row.end;
      }
      if (row.task?.kind === "micro") entry.micro_task = row.task.id;
      else entry.issue = row.task!.id;
      return entry;
    });

  /** Puts the server's progress (planned time, verdict) on the saved rows without replacing them. */
  const applyProgress = (next: TDayReport) => {
    const filled = rows.filter(isFilled);
    setRows((current) =>
      current.map((row) => {
        const index = filled.findIndex((item) => item.key === row.key);
        return index >= 0 && next.entries[index] ? { ...row, saved: next.entries[index].task } : row;
      })
    );
  };

  const send = async (submit: boolean) => {
    if (problems.length > 0) {
      setToast({ type: "error", title: "Check the report", message: problems[0] });
      return;
    }
    const entries = entriesOf(rows);
    if (submit && entries.length === 0) {
      setToast({ type: "error", title: "Nothing to send", message: "Add at least one task with its time." });
      return;
    }
    setIsSaving(submit ? "send" : "draft");
    try {
      const next = await save({ entries, submit, reason });
      writeLocal(localKey, null);
      setDirty(false);
      setRestored(false);
      applyProgress(next);
      setToast({
        type: "success",
        title: next.status === "SUBMITTED" ? (recorded ? "Change saved" : "Day report sent") : "Draft saved",
        message: recorded ? "Your manager can see what changed." : `${formatMinutes(next.total_minutes)} reported.`,
      });
    } catch (error) {
      setToast({ type: "error", title: "Could not save", message: getErrorMessage(error) });
    } finally {
      setIsSaving(null);
    }
  };

  // Today's unsent draft saves itself on the server a few seconds after the last change (on any device).
  const canAutosave = !readOnly && !recorded && dirty && problems.length === 0 && rows.some(isFilled);
  useEffect(() => {
    if (!canAutosave || isSaving) return;
    const autosave = async () => {
      setIsSaving("auto");
      try {
        const next = await save({ entries: entriesOf(rows), submit: false });
        writeLocal(localKey, null);
        setDirty(false);
        setAutoSavedAt(Date.now());
        applyProgress(next);
      } catch {
        // offline or refused: the rows stay kept on this device and the next change tries again
      } finally {
        setIsSaving(null);
      }
    };
    const timer = window.setTimeout(() => void autosave(), AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, canAutosave]);

  if (isLoading || !report) {
    return <p className="text-body-sm-regular text-tertiary">Loading the report...</p>;
  }

  const status =
    report.status === "SUBMITTED"
      ? `Sent ${report.submitted_at ? at(report.submitted_at) : ""}${report.is_late ? " (late)" : ""}`
      : report.exists
        ? "Draft, not sent yet"
        : "Not started";

  const field =
    "h-10 w-full rounded-md border bg-layer-1 px-2 text-body-sm-medium text-primary tabular-nums outline-none focus:border-accent-strong disabled:opacity-80";

  return (
    <section
      aria-label="Day report"
      className="flex flex-col gap-4 rounded-lg border border-subtle bg-surface-1 p-4 sm:p-5"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-h5-medium text-primary">Day Report · {dayTitle.format(parse(report.date))}</h2>
          <p className="flex flex-wrap items-center gap-2 text-body-sm-regular text-secondary">
            {status}
            {dayPlace ? (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-caption-sm-medium",
                  dayPlace === "HYBRID"
                    ? "bg-[color-mix(in_oklab,#7c3aed_15%,transparent)] text-[#7c3aed]"
                    : dayPlace === "REMOTE"
                      ? "bg-[color-mix(in_oklab,#0284c7_15%,transparent)] text-[#0284c7]"
                      : "bg-[color-mix(in_oklab,#16a34a_15%,transparent)] text-[#16a34a]"
                )}
              >
                {PLACE_LABEL[dayPlace] ?? dayPlace}
              </span>
            ) : null}
          </p>
        </div>
        <div className="text-right">
          <p className="text-caption-sm-regular text-tertiary">Total</p>
          <p className="text-h4-medium text-primary tabular-nums">{formatMinutes(total)}</p>
        </div>
      </header>

      {report.edit_count > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning-strong bg-warning-subtle px-3 py-2">
          <span className="text-body-xs-medium text-primary">
            Changed {report.edit_count} time{report.edit_count === 1 ? "" : "s"} after it was due
            {report.last_edited_at ? `, last on ${at(report.last_edited_at)}` : ""}.
          </span>
          {canSeeHistory ? (
            <button
              type="button"
              className="min-h-8 text-body-xs-medium text-accent-primary hover:underline"
              onClick={() => setShowHistory((open) => !open)}
            >
              {showHistory ? "Hide changes" : "See the changes"}
            </button>
          ) : null}
        </div>
      ) : null}
      {showHistory && canSeeHistory ? <ReportHistory revisions={history.data ?? []} /> : null}

      {restored && !readOnly ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-accent-strong bg-accent-subtle px-3 py-2 text-body-xs-regular text-primary">
          <span>Your unsaved changes were kept and are back.</span>
          <button
            type="button"
            className="min-h-8 text-body-xs-medium text-accent-primary hover:underline"
            onClick={() => {
              writeLocal(localKey, null);
              const loaded = fromReport(report);
              setRows(loaded.length > 0 ? loaded : [emptyRow(defaultPlace)]);
              setRestored(false);
              setDirty(false);
            }}
          >
            Discard them
          </button>
        </div>
      ) : null}

      {!readOnly && recorded ? (
        <p className="rounded-md border border-accent-strong bg-accent-subtle px-3 py-2 text-body-xs-regular text-primary">
          {report.status === "SUBMITTED"
            ? "This report was sent. You can still change it: the change is recorded and your manager is told."
            : "This day is over (forgot the report?). Sending it now is recorded as late and your manager is told."}
        </p>
      ) : null}

      <ul className="flex flex-col gap-3">
        {rows.map((row, index) => {
          const minutes = minutesOf(row);
          return (
            <li key={row.key} className="flex flex-col gap-2 rounded-lg border border-subtle p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <TaskCell
                    workspaceSlug={workspaceSlug}
                    value={row.task}
                    onChange={(task) => update(row.key, { task })}
                    microTasks={microTasks ?? []}
                    disabled={readOnly}
                  />
                  {row.saved ? (
                    <div className="mt-1">
                      <ProgressLine progress={row.saved} />
                    </div>
                  ) : null}
                </div>
                {!readOnly ? (
                  <button
                    type="button"
                    aria-label={`Remove row ${index + 1}`}
                    onClick={() => {
                      setDirty(true);
                      setRows((current) =>
                        current.length > 1 ? current.filter((item) => item.key !== row.key) : [emptyRow(defaultPlace)]
                      );
                    }}
                    className="inline-flex size-10 shrink-0 items-center justify-center rounded-md text-danger-primary hover:bg-danger-subtle"
                  >
                    ✕
                  </button>
                ) : null}
              </div>

              <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
                {row.spread ? (
                  <label className="flex min-w-32 flex-1 flex-col gap-0.5 sm:max-w-40 sm:flex-none">
                    <span className="text-caption-sm-medium text-tertiary">How long</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={row.duration}
                      disabled={readOnly}
                      placeholder="1:30"
                      aria-label={`How long, row ${index + 1}`}
                      onChange={(event) => update(row.key, { duration: event.target.value })}
                      onBlur={() => {
                        const value = parseDuration(row.duration);
                        if (value) update(row.key, { duration: durationText(value) });
                      }}
                      className={cn(field, row.duration && !minutes ? "border-danger-strong" : "border-subtle")}
                    />
                  </label>
                ) : (
                  <>
                    <label className="flex min-w-32 flex-1 flex-col gap-0.5 sm:max-w-40 sm:flex-none">
                      <span className="text-caption-sm-medium text-tertiary">From</span>
                      <input
                        type="time"
                        value={row.start}
                        disabled={readOnly}
                        aria-label={`Start time, row ${index + 1}`}
                        onChange={(event) => update(row.key, { start: event.target.value })}
                        className={cn(field, "border-subtle")}
                      />
                    </label>
                    <label className="flex min-w-32 flex-1 flex-col gap-0.5 sm:max-w-40 sm:flex-none">
                      <span className="text-caption-sm-medium text-tertiary">To</span>
                      <input
                        type="time"
                        value={row.end}
                        disabled={readOnly}
                        aria-label={`End time, row ${index + 1}`}
                        onChange={(event) => update(row.key, { end: event.target.value })}
                        className={cn(
                          field,
                          row.start && row.end && !minutes ? "border-danger-strong" : "border-subtle"
                        )}
                      />
                    </label>
                  </>
                )}
                <span className="min-w-14 pb-2.5 text-body-sm-medium text-primary tabular-nums">
                  {minutes ? formatMinutes(minutes) : "—"}
                </span>
                <label className="flex min-h-10 items-center gap-2 text-body-xs-medium text-secondary">
                  <input
                    type="checkbox"
                    checked={row.spread}
                    disabled={readOnly}
                    onChange={(event) => {
                      const spread = event.target.checked;
                      // Keep the time already entered when switching between the two ways.
                      const current = minutesOf(row);
                      update(row.key, {
                        spread,
                        duration: spread && current ? durationText(current) : row.duration,
                      });
                    }}
                    className="size-5"
                  />
                  Not continuous (only how long)
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div
                  role="radiogroup"
                  aria-label={`Place, row ${index + 1}`}
                  className="flex rounded-md border border-subtle p-0.5"
                >
                  {PLACES.map((place) => (
                    <button
                      key={place.value}
                      type="button"
                      role="radio"
                      aria-checked={row.place === place.value}
                      disabled={readOnly}
                      onClick={() => update(row.key, { place: place.value })}
                      className={cn(
                        "min-h-9 rounded px-3 text-body-xs-medium",
                        row.place === place.value
                          ? "bg-accent-primary text-on-color"
                          : "text-secondary hover:bg-layer-1"
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
                    onChange={(event) => update(row.key, { finished: event.target.checked })}
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
                aria-label={`Note of row ${index + 1}`}
                onChange={(event) => update(row.key, { note: event.target.value })}
                className="h-10 w-full rounded-md border border-subtle bg-layer-1 px-3 text-body-sm-regular text-primary outline-none focus:border-accent-strong"
              />
            </li>
          );
        })}
      </ul>

      {readOnly ? null : (
        <>
          <button
            type="button"
            onClick={() => {
              setDirty(true);
              const last = rows[rows.length - 1];
              setRows((current) => [...current, emptyRow(last?.place || defaultPlace)]);
            }}
            className="min-h-10 self-start rounded-md border border-dashed border-strong px-4 text-body-sm-medium text-secondary hover:bg-layer-1"
          >
            + Add a task
          </button>

          {recorded ? (
            <label className="flex flex-col gap-1">
              <span className="text-body-xs-medium text-secondary">
                {isPast && report.status !== "SUBMITTED" ? "Why is it late?" : "Why the change?"} (your manager sees
                this)
              </span>
              <input
                type="text"
                value={reason}
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
                placeholder="For example: forgot the afternoon meeting"
                className="h-10 rounded-md border border-subtle bg-layer-1 px-3 text-body-sm-regular text-primary outline-none focus:border-accent-strong"
              />
            </label>
          ) : null}

          {problems.length > 0 && rows.some(isFilled) ? (
            <p role="alert" className="text-body-xs-regular text-danger-primary">
              {problems[0]}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            {recorded ? (
              <Button
                variant="primary"
                size="lg"
                stretch="auto"
                label={isPast && report.status !== "SUBMITTED" ? "Send the forgotten report" : "Save the change"}
                loading={isSaving === "send"}
                disabled={isSaving === "send" || isSaving === "draft"}
                onClick={() => void send(true)}
              />
            ) : (
              <>
                <Button
                  variant="primary"
                  size="lg"
                  stretch="auto"
                  label="Finish the day and send"
                  loading={isSaving === "send"}
                  disabled={isSaving === "send" || isSaving === "draft"}
                  onClick={() => void send(true)}
                />
                <Button
                  variant="secondary"
                  size="lg"
                  stretch="auto"
                  label="Save draft"
                  loading={isSaving === "draft"}
                  disabled={isSaving === "send" || isSaving === "draft"}
                  onClick={() => void send(false)}
                />
              </>
            )}
            <span className="text-caption-sm-regular text-tertiary" aria-live="polite">
              {isSaving === "auto"
                ? "Saving draft..."
                : autoSavedAt
                  ? `Draft saved automatically at ${clock(autoSavedAt)}`
                  : dirty
                    ? "Kept on this device until saved"
                    : ""}
            </span>
          </div>
          <p className="text-caption-sm-regular text-tertiary">
            Give each task its from and to time. When the work was spread over the day, tick "Not continuous" and type
            only how long (1:30, 1.5 or 45m). Remote and onsite in one day make it a hybrid day. Tick "Task done" when a
            task is finished: it is also set to Done in its project, and Speedy, On time or OverTime compares all its
            reported time with its plan.
          </p>
        </>
      )}
    </section>
  );
});
