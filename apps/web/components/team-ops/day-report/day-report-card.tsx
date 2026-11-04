/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { Button } from "@makeplane/propel/components/button";
import { setToast } from "@plane/blocks/toast";
import { durationText, formatMinutes, parseDuration } from "@plane/services";
import type { TDayReport, TDayReportRowInput } from "@plane/types";
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
  time: string;
  finished: boolean;
  note: string;
  /** Progress from the server, for rows that were saved. */
  saved?: TDayReport["entries"][number]["task"];
};

let counter = 0;
const newKey = () => `row-${Date.now()}-${(counter += 1)}`;
const emptyRow = (): TRow => ({ key: newKey(), task: null, time: "", finished: false, note: "" });

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
    time: durationText(entry.minutes),
    finished: entry.finished,
    note: entry.note,
    saved: entry.task,
  }));

const dayTitle = new Intl.DateTimeFormat("en-US", { weekday: "long", day: "numeric", month: "long" });
const parse = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const at = (stamp: string) =>
  new Date(stamp).toLocaleString("en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

type Props = { workspaceSlug: string; day: string; user?: string; canSeeHistory: boolean };

/**
 * The Day Report: every task worked on today with the time it took, sent at the end of the day. A sent report,
 * or a past day's, can still be changed, but the change is recorded and the managers are told.
 */
export const DayReportCard = observer(function DayReportCard({ workspaceSlug, day, user, canSeeHistory }: Props) {
  const { report, isLoading, save } = useDayReport(workspaceSlug, day, user);
  const { tasks: microTasks } = useMicroTasks(workspaceSlug);
  const [rows, setRows] = useState<TRow[]>([]);
  const [reason, setReason] = useState("");
  const [isSaving, setIsSaving] = useState<"draft" | "send" | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const history = useDayReportHistory(workspaceSlug, day, user, showHistory && canSeeHistory);

  // Load the saved rows whenever the day (or the saved report) changes.
  useEffect(() => {
    if (!report) return;
    const loaded = fromReport(report);
    setRows(loaded.length > 0 || !report.can_edit ? loaded : [emptyRow()]);
    setReason("");
  }, [report]);

  const readOnly = !report?.can_edit;
  const minutes = rows.map((row) => parseDuration(row.time) ?? 0);
  const total = minutes.reduce((sum, value) => sum + value, 0);
  const isPast = report ? report.date < report.today : false;
  const recorded = report?.changes_are_recorded ?? false;

  const problems = useMemo(() => {
    const list: string[] = [];
    rows.forEach((row, index) => {
      const filled = row.task || row.time.trim() || row.note.trim();
      if (!filled) return;
      if (!row.task) list.push(`Row ${index + 1}: choose the task.`);
      if (!parseDuration(row.time)) list.push(`Row ${index + 1}: enter the time, like 1:30 or 45m.`);
    });
    if (total > 24 * 60) list.push("The rows add up to more than 24 hours.");
    return list;
  }, [rows, total]);

  const update = (key: string, patch: Partial<TRow>) =>
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch, saved: patch.task ? undefined : row.saved } : row))
    );

  const send = async (submit: boolean) => {
    const filled = rows.filter((row) => row.task || row.time.trim());
    if (problems.length > 0) {
      setToast({ type: "error", title: "Check the report", message: problems[0] });
      return;
    }
    if (submit && filled.length === 0) {
      setToast({ type: "error", title: "Nothing to send", message: "Add at least one task with its time." });
      return;
    }
    const entries: TDayReportRowInput[] = filled.map((row) => {
      const entry: TDayReportRowInput = {
        minutes: parseDuration(row.time) ?? 0,
        finished: row.finished,
        note: row.note,
      };
      if (row.task?.kind === "micro") entry.micro_task = row.task.id;
      else entry.issue = row.task!.id;
      return entry;
    });
    setIsSaving(submit ? "send" : "draft");
    try {
      const next = await save({ entries, submit, reason });
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

  if (isLoading || !report) {
    return <p className="text-body-sm-regular text-tertiary">Loading the report...</p>;
  }

  const status =
    report.status === "SUBMITTED"
      ? `Sent ${report.submitted_at ? at(report.submitted_at) : ""}${report.is_late ? " (late)" : ""}`
      : report.exists
        ? "Draft, not sent yet"
        : "Not started";

  return (
    <section
      aria-label="Day report"
      className="flex flex-col gap-4 rounded-lg border border-subtle bg-surface-1 p-4 sm:p-5"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-h5-medium text-primary">Day Report · {dayTitle.format(parse(report.date))}</h2>
          <p className="text-body-sm-regular text-secondary">
            {status}
            {report.mode ? ` · ${report.mode.charAt(0)}${report.mode.slice(1).toLowerCase()}` : ""}
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

      {!readOnly && recorded ? (
        <p className="rounded-md border border-accent-strong bg-accent-subtle px-3 py-2 text-body-xs-regular text-primary">
          {report.status === "SUBMITTED"
            ? "This report was sent. You can still change it: the change is recorded and your manager is told."
            : "This day is over (forgot the report?). Sending it now is recorded as late and your manager is told."}
        </p>
      ) : null}

      {/* Header row, only on wide screens; on a phone every row is a card. */}
      <div className="hidden grid-cols-[minmax(0,2.2fr)_7rem_6rem_minmax(0,1.4fr)_2.5rem] gap-2 px-1 text-caption-sm-medium text-tertiary md:grid">
        <span>Project · task</span>
        <span>Time</span>
        <span>Finished</span>
        <span>Note</span>
        <span />
      </div>

      <ul className="flex flex-col gap-2">
        {rows.map((row, index) => {
          const progress = row.saved;
          return (
            <li
              key={row.key}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-md border border-subtle p-2 md:grid-cols-[minmax(0,2.2fr)_7rem_6rem_minmax(0,1.4fr)_2.5rem] md:items-start md:border-0 md:p-1"
            >
              <div className="col-span-2 flex flex-col gap-1 md:col-span-1">
                <TaskCell
                  workspaceSlug={workspaceSlug}
                  value={row.task}
                  onChange={(task) => update(row.key, { task })}
                  microTasks={microTasks ?? []}
                  disabled={readOnly}
                />
                {progress ? <ProgressLine progress={progress} /> : null}
              </div>
              <label className="flex flex-col gap-0.5">
                <span className="text-caption-sm-medium text-tertiary md:sr-only">Time</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={row.time}
                  disabled={readOnly}
                  placeholder="1:30"
                  aria-label={`Time of row ${index + 1}`}
                  onChange={(event) => update(row.key, { time: event.target.value })}
                  onBlur={() => {
                    const value = parseDuration(row.time);
                    if (value) update(row.key, { time: durationText(value) });
                  }}
                  className={cn(
                    "h-10 w-full rounded-md border bg-layer-1 px-3 text-body-sm-medium text-primary tabular-nums outline-none focus:border-accent-strong",
                    row.time && !parseDuration(row.time) ? "border-danger-strong" : "border-subtle"
                  )}
                />
              </label>
              <label className="flex min-h-10 items-center gap-2 self-end text-body-xs-medium text-secondary md:self-center">
                <input
                  type="checkbox"
                  checked={row.finished}
                  disabled={readOnly}
                  onChange={(event) => update(row.key, { finished: event.target.checked })}
                  className="size-5 accent-[var(--background-color-accent-primary)]"
                />
                Done
              </label>
              <input
                type="text"
                value={row.note}
                disabled={readOnly}
                placeholder="What was done (optional)"
                aria-label={`Note of row ${index + 1}`}
                onChange={(event) => update(row.key, { note: event.target.value })}
                className="col-span-2 h-10 w-full rounded-md border border-subtle bg-layer-1 px-3 text-body-sm-regular text-primary outline-none focus:border-accent-strong md:col-span-1"
              />
              {!readOnly ? (
                <button
                  type="button"
                  aria-label={`Remove row ${index + 1}`}
                  onClick={() =>
                    setRows((current) =>
                      current.length > 1 ? current.filter((item) => item.key !== row.key) : [emptyRow()]
                    )
                  }
                  className="col-span-2 min-h-10 rounded-md text-body-xs-medium text-danger-primary hover:bg-danger-subtle md:col-span-1"
                >
                  ✕<span className="ml-1 md:sr-only">Remove</span>
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>

      {readOnly ? null : (
        <>
          <button
            type="button"
            onClick={() => setRows((current) => [...current, emptyRow()])}
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

          {problems.length > 0 ? (
            <p role="alert" className="text-body-xs-regular text-danger-primary">
              {problems[0]}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {recorded ? (
              <Button
                variant="primary"
                size="lg"
                stretch="auto"
                label={isPast && report.status !== "SUBMITTED" ? "Send the forgotten report" : "Save the change"}
                loading={isSaving === "send"}
                disabled={isSaving !== null}
                onClick={() => void send(true)}
              />
            ) : (
              <>
                <Button
                  variant="primary"
                  size="lg"
                  stretch="auto"
                  label="Send the day report"
                  loading={isSaving === "send"}
                  disabled={isSaving !== null}
                  onClick={() => void send(true)}
                />
                <Button
                  variant="secondary"
                  size="lg"
                  stretch="auto"
                  label="Save draft"
                  loading={isSaving === "draft"}
                  disabled={isSaving !== null}
                  onClick={() => void send(false)}
                />
              </>
            )}
          </div>
          <p className="text-caption-sm-regular text-tertiary">
            Type the time as 1:30, 1.5 or 45m. Tick Done when a task is finished: its result (Speedy, On time, OverTime)
            compares all the time reported on it with its planned time.
          </p>
        </>
      )}
    </section>
  );
});
