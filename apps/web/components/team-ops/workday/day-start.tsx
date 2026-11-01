/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { Button } from "@makeplane/propel/components/button";
import type { TDayMode, TWorkPlace, TWorkSession } from "@plane/types";
import { cn } from "@plane/utils";

const MODES: { value: TDayMode; label: string; text: string }[] = [
  { value: "ONSITE", label: "Onsite", text: "At the office" },
  { value: "REMOTE", label: "Remote", text: "From home or elsewhere" },
];

export const modeLabel = (mode: TDayMode) => MODES.find((item) => item.value === mode)?.label ?? mode;

/** The first question of every day. Nothing else on the page works until it is answered. */
export function DayStart({ onChoose }: { onChoose: (mode: TDayMode) => Promise<unknown> }) {
  return (
    <section
      aria-label="Start your day"
      className="flex flex-col gap-4 rounded-lg border border-accent-strong bg-surface-1 p-6"
    >
      <div>
        <h2 className="text-h4-medium text-primary">Good day. How are you working today?</h2>
        <p className="text-body-sm-regular text-secondary">
          Your team sees it, and your time is counted by it. If you work a task in the other place, the day becomes
          hybrid by itself.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {MODES.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => void onChoose(item.value)}
            className="flex flex-col items-start gap-1 rounded-lg border border-subtle p-4 text-left hover:border-accent-strong hover:bg-accent-subtle"
          >
            <span className="text-body-md-medium text-primary">{item.label}</span>
            <span className="text-body-sm-regular text-secondary">{item.text}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

const LABEL: Record<TDayMode, string> = { ONSITE: "Onsite", REMOTE: "Remote", HYBRID: "Hybrid (both)" };

/** Today's answer. It is not a control: changing it is a deliberate step at the bottom of the page. */
export function DayModeChip({ mode }: { mode: TDayMode }) {
  return (
    <span
      title="Your answer for today. To change it, use the confirmation at the bottom of the page."
      className="rounded-lg bg-accent-subtle px-3 py-1.5 text-body-xs-medium text-accent-primary"
    >
      Today: {LABEL[mode]}
    </span>
  );
}

/** Covers the page with a blur until the question inside is answered. */
export function Gate({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-canvas/70 p-6 backdrop-blur-md"
    >
      <div className="w-full max-w-3xl">{children}</div>
    </div>
  );
}

type OverrideProps = {
  mode: TDayMode;
  sessions: TWorkSession[];
  onSubmit: (mode: TDayMode, places: Record<string, TWorkPlace>) => Promise<unknown>;
};

/** At the very end of the page, in red: change today's answer, and say again where every finished task was done. */
export function DayOverride({ mode, sessions, onSubmit }: OverrideProps) {
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState<TWorkPlace>(mode === "ONSITE" ? "ONSITE" : "REMOTE");
  const [places, setPlaces] = useState<Record<string, TWorkPlace>>({});
  const [isSaving, setIsSaving] = useState(false);
  const placeOf = (session: TWorkSession): TWorkPlace =>
    places[session.id] ?? (session.location === "ONSITE" || session.location === "REMOTE" ? session.location : next);
  const options: TWorkPlace[] = ["ONSITE", "REMOTE"];

  if (!open) {
    return (
      <div className="flex justify-end">
        <button
          type="button"
          className="text-body-xs-medium text-danger-primary hover:underline"
          onClick={() => setOpen(true)}
        >
          Change today&apos;s answer
        </button>
      </div>
    );
  }

  const submit = async () => {
    setIsSaving(true);
    try {
      await onSubmit(next, Object.fromEntries(sessions.map((session) => [session.id, placeOf(session)])));
      setOpen(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section
      aria-label="Change today's answer"
      className="flex flex-col gap-3 rounded-lg border border-danger-strong bg-danger-subtle p-4"
    >
      <div>
        <h3 className="text-body-md-medium text-danger-primary">Change today&apos;s answer</h3>
        <p className="text-body-xs-regular text-secondary">
          Your manager sees the original answer changed. Say again where you did each task today; if they differ, the
          day becomes hybrid.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-body-sm-medium text-primary">Today I worked mainly</span>
        {options.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={next === item}
            onClick={() => setNext(item)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-body-xs-medium",
              next === item ? "border-danger-strong bg-surface-1 text-danger-primary" : "border-subtle text-secondary"
            )}
          >
            {item === "ONSITE" ? "Onsite" : "Remote"}
          </button>
        ))}
      </div>
      {sessions.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {sessions.map((session) => (
            <li key={session.id} className="flex flex-wrap items-center justify-between gap-2 text-body-xs-regular">
              <span className="min-w-0 truncate text-primary">
                {session.work_item} {session.work_item_name}
              </span>
              <span className="flex gap-1">
                {options.map((item) => (
                  <button
                    key={item}
                    type="button"
                    aria-pressed={placeOf(session) === item}
                    onClick={() => setPlaces({ ...places, [session.id]: item })}
                    className={cn(
                      "rounded px-2 py-0.5 text-caption-sm-medium",
                      placeOf(session) === item ? "bg-danger-strong text-on-color" : "bg-surface-1 text-secondary"
                    )}
                  >
                    {item === "ONSITE" ? "Onsite" : "Remote"}
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex gap-2">
        <Button
          variant="danger"
          size="md"
          stretch="auto"
          label="Confirm the change"
          loading={isSaving}
          onClick={submit}
        />
        <Button variant="secondary" size="md" stretch="auto" label="Keep my answer" onClick={() => setOpen(false)} />
      </div>
    </section>
  );
}

/** At the bottom, in red: reopen the confirmed week plan. The page is blurred again until it is confirmed anew. */
export function WeekUnlock({ onUnlock }: { onUnlock: () => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  if (!open) {
    return (
      <div className="flex justify-end">
        <button
          type="button"
          className="text-body-xs-medium text-danger-primary hover:underline"
          onClick={() => setOpen(true)}
        >
          Change my week plan
        </button>
      </div>
    );
  }
  return (
    <section
      aria-label="Change the week plan"
      className="flex flex-col gap-3 rounded-lg border border-danger-strong bg-danger-subtle p-4"
    >
      <div>
        <h3 className="text-body-md-medium text-danger-primary">Change my week plan</h3>
        <p className="text-body-xs-regular text-secondary">
          Your manager already sees this plan, and is told that you reopened it. You cannot start work until you confirm
          the week again.
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          variant="danger"
          size="md"
          stretch="auto"
          label="Reopen the plan"
          loading={isSaving}
          onClick={async () => {
            setIsSaving(true);
            try {
              await onUnlock();
            } finally {
              setIsSaving(false);
              setOpen(false);
            }
          }}
        />
        <Button variant="secondary" size="md" stretch="auto" label="Keep it" onClick={() => setOpen(false)} />
      </div>
    </section>
  );
}
