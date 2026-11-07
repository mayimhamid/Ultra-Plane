/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { CheckCircle2, X } from "lucide-react";
import { setToast } from "@plane/blocks/toast";
import { durationText, formatMinutes, parseDuration, spanMinutes, toDateKey } from "@plane/services";
import type { TReportPlace } from "@plane/types";
import { cn } from "@plane/utils";

/** What the person told us about the work: the day, how long (from-to or only how long), where and what. */
export type TFinishedWork = {
  day: string;
  minutes: number;
  start?: string;
  end?: string;
  place: TReportPlace;
  note: string;
};

type Props = {
  /** "Task done", or whatever names the thing that was finished. */
  heading?: string;
  /** The key of the work item, when it has one. */
  label?: string;
  name: string;
  /** Adds the work to the Day Report; throws when it cannot. */
  onSubmit: (work: TFinishedWork) => Promise<void>;
  /** Finished before, nothing to report: the task is only marked done. */
  onSkip: () => Promise<void> | void;
  onClose: () => void;
};

const field =
  "h-10 w-full rounded-md border border-subtle bg-layer-1 px-2 text-body-sm-medium text-primary outline-none focus:border-accent-strong";
// Remembers the place chosen last time, so the next task needs one tap less.
const PLACE_KEY = "ultra-plane-last-place";

const lastPlace = (): TReportPlace | "" => {
  try {
    return (window.localStorage.getItem(PLACE_KEY) as TReportPlace | null) ?? "";
  } catch {
    return "";
  }
};

/**
 * The box that asks how long a finished task took, like a Day Report row: the day, from and to (or only how long),
 * remote or onsite, and what was done. It is the same for a work item moved to Done and for a micro task.
 */
export function FinishTaskDialog({ heading = "Task done", label, name, onSubmit, onSkip, onClose }: Props) {
  const [day, setDay] = useState(() => toDateKey(new Date()));
  const [spread, setSpread] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [duration, setDuration] = useState("");
  const [place, setPlace] = useState<TReportPlace | "">(lastPlace);
  const [note, setNote] = useState("");
  const [earlier, setEarlier] = useState(false);
  const [busy, setBusy] = useState(false);

  const minutes = spread ? parseDuration(duration) : spanMinutes(start, end);

  const save = async () => {
    if (earlier) {
      setBusy(true);
      try {
        await onSkip();
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!minutes) {
      setToast({
        type: "error",
        title: "Enter the time",
        message: spread ? "Type how long, like 1:30 or 45m." : "Give the start and end time.",
      });
      return;
    }
    if (!place) {
      setToast({ type: "error", title: "Remote or onsite?", message: "Choose where the work was done." });
      return;
    }
    setBusy(true);
    try {
      await onSubmit({ day, minutes, ...(spread ? {} : { start, end }), place, note });
      try {
        window.localStorage.setItem(PLACE_KEY, place);
      } catch {
        // storage blocked
      }
    } catch {
      // the caller already said what went wrong; the box stays open so nothing typed is lost
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add the finished task to the Day Report"
        className="flex max-h-[92dvh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-t-xl border border-subtle bg-surface-1 p-4 shadow-raised-300 sm:rounded-xl"
      >
        <header className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-success-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 className="text-h5-medium text-primary">{heading}</h2>
            <p className="truncate text-body-sm-regular text-secondary">
              {label ? <span className="text-tertiary">{label} </span> : null}
              {name}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="inline-flex size-9 items-center justify-center rounded-md hover:bg-layer-1"
          >
            <X className="size-5" />
          </button>
        </header>

        <label className="flex min-h-11 items-start gap-3 rounded-lg border border-subtle p-3">
          <input
            type="checkbox"
            aria-label="Done earlier, do not add it to a Day Report"
            checked={earlier}
            onChange={(event) => setEarlier(event.target.checked)}
            className="mt-0.5 size-5 shrink-0"
          />
          <span>
            <span className="block text-body-sm-medium text-primary">Done earlier, do not add it to a Day Report</span>
            <span className="text-caption-sm-regular text-tertiary">
              For work finished before, already reported, or not worth reporting.
            </span>
          </span>
        </label>

        {earlier ? null : (
          <>
            <p className="text-body-xs-regular text-secondary">
              How long did it take? It goes into the Day Report with "Task done", like a row you add there.
            </p>
            <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
              <label className="flex min-w-36 flex-1 flex-col gap-0.5">
                <span className="text-caption-sm-medium text-tertiary">Day</span>
                <input
                  type="date"
                  value={day}
                  max={toDateKey(new Date())}
                  onChange={(e) => setDay(e.target.value)}
                  className={field}
                />
              </label>
              {spread ? (
                <label className="flex min-w-28 flex-1 flex-col gap-0.5">
                  <span className="text-caption-sm-medium text-tertiary">How long</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={duration}
                    placeholder="1:30"
                    onChange={(e) => setDuration(e.target.value)}
                    onBlur={() => {
                      const value = parseDuration(duration);
                      if (value) setDuration(durationText(value));
                    }}
                    className={field}
                  />
                </label>
              ) : (
                <>
                  <label className="flex min-w-28 flex-1 flex-col gap-0.5">
                    <span className="text-caption-sm-medium text-tertiary">From</span>
                    <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={field} />
                  </label>
                  <label className="flex min-w-28 flex-1 flex-col gap-0.5">
                    <span className="text-caption-sm-medium text-tertiary">To</span>
                    <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={field} />
                  </label>
                </>
              )}
              <span className="pb-2.5 text-body-sm-semibold text-primary tabular-nums">
                {minutes ? formatMinutes(minutes) : "—"}
              </span>
            </div>
            <label className="flex min-h-10 items-center gap-2 text-body-xs-medium text-secondary">
              <input
                type="checkbox"
                checked={spread}
                onChange={(event) => {
                  if (event.target.checked && minutes) setDuration(durationText(minutes));
                  setSpread(event.target.checked);
                }}
                className="size-5"
              />
              Not continuous (only how long)
            </label>
            <div role="radiogroup" aria-label="Place" className="flex self-start rounded-md border border-subtle p-0.5">
              {(["REMOTE", "ONSITE"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={place === value}
                  onClick={() => setPlace(value)}
                  className={cn(
                    "min-h-9 rounded px-4 text-body-xs-medium",
                    place === value ? "bg-accent-primary text-on-color" : "text-secondary hover:bg-layer-1"
                  )}
                >
                  {value === "REMOTE" ? "Remote" : "Onsite"}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="What was done (optional)"
              className={field}
            />
          </>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className="inline-flex min-h-11 items-center rounded-md bg-accent-primary px-4 text-body-sm-medium text-on-color disabled:opacity-60"
          >
            {earlier ? "Done, without reporting" : busy ? "Adding..." : "Add to the Day Report"}
          </button>
          {earlier ? null : (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-11 items-center rounded-md border border-subtle px-4 text-body-sm-medium text-secondary hover:bg-layer-1"
            >
              Not now
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
