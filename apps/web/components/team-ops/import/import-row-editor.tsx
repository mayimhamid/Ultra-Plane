/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { Button } from "@makeplane/propel/components/button";
import type { TImportContext, TImportItem, TImportRow, TPlanUnit } from "@plane/types";
import { cn } from "@plane/utils";

const PRIORITIES = ["none", "urgent", "high", "medium", "low"];
const FIELD =
  "min-h-10 w-full rounded-md border border-subtle bg-layer-1 px-3 text-body-sm-regular text-primary outline-none focus:border-accent-strong";

type Draft = {
  title: string;
  priority: string;
  assignees: string[];
  module: string;
  amount: string;
  unit: TPlanUnit;
  due: string;
  meeting: boolean;
};

const draftOf = (row: TImportRow, context?: TImportContext): Draft => ({
  title: row.title,
  priority: row.priority ?? "none",
  // The people are stored by email when we know it (display names can repeat), else by the name that was read.
  assignees: (row.assignees ?? []).map(
    (person) =>
      context?.people.find((known) => known.display_name === person.display_name)?.email ?? person.display_name
  ),
  module: row.module?.name ?? "",
  amount: row.planned_amount ? String(row.planned_amount) : "",
  unit: row.unit,
  due: row.due_date ?? "",
  meeting: Boolean(row.is_meeting),
});

/** What the person changed, as the fields of an import item. An empty field clears the value. */
const patchOf = (draft: Draft, target: "micro" | "project"): Partial<TImportItem> => {
  const amount = Number(draft.amount.replace(",", "."));
  const planned = draft.amount.trim() && amount > 0 ? amount : undefined;
  const patch: Partial<TImportItem> = {
    title: draft.title.trim(),
    due_date: draft.due || undefined,
    planned_hours: draft.unit === "HOURS" ? planned : undefined,
    planned_days: draft.unit === "DAYS" ? planned : undefined,
  };
  if (target === "micro") return { ...patch, is_meeting: draft.meeting };
  return {
    ...patch,
    priority: draft.priority,
    assignees: draft.assignees,
    module: draft.module || undefined,
  };
};

type Props = {
  row: TImportRow;
  target: "micro" | "project";
  context?: TImportContext;
  onSave: (patch: Partial<TImportItem>) => void;
  onCancel: () => void;
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-caption-sm-medium text-tertiary">{label}</span>
      {children}
    </label>
  );
}

/** The fields of one task of the import preview: its name, priority, people, module, planned time and due date. */
export function ImportRowEditor({ row, target, context, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(row, context));
  const change = (patch: Partial<Draft>) => setDraft((now) => ({ ...now, ...patch }));
  const isChosen = (person: { display_name: string; email: string }) =>
    draft.assignees.includes(person.email) || draft.assignees.includes(person.display_name);
  const toggle = (person: { display_name: string; email: string }) =>
    change({
      assignees: isChosen(person)
        ? draft.assignees.filter((value) => value !== person.email && value !== person.display_name)
        : [...draft.assignees, person.email],
    });

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-accent-strong bg-surface-1 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (draft.title.trim()) onSave(patchOf(draft, target));
      }}
    >
      <Field label="Task">
        <input
          value={draft.title}
          onChange={(event) => change({ title: event.target.value })}
          required
          className={FIELD}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Planned time">
          <input
            value={draft.amount}
            onChange={(event) => change({ amount: event.target.value })}
            inputMode="decimal"
            placeholder="e.g. 4"
            className={FIELD}
          />
        </Field>
        <Field label="Unit">
          <select
            value={draft.unit}
            onChange={(event) => change({ unit: event.target.value as TPlanUnit })}
            className={FIELD}
          >
            <option value="HOURS">Hours</option>
            <option value="DAYS">Days</option>
          </select>
        </Field>
        <Field label="Due date">
          <input
            type="date"
            value={draft.due}
            onChange={(event) => change({ due: event.target.value })}
            className={FIELD}
          />
        </Field>
        {target === "project" ? (
          <Field label="Priority">
            <select
              value={draft.priority}
              onChange={(event) => change({ priority: event.target.value })}
              className={FIELD}
            >
              {PRIORITIES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <label className="flex min-h-10 items-center gap-2 self-end text-body-sm-regular text-primary">
            <input
              type="checkbox"
              checked={draft.meeting}
              onChange={(event) => change({ meeting: event.target.checked })}
            />
            Meeting
          </label>
        )}
      </div>
      {target === "project" ? (
        <>
          <Field label="Module">
            <select value={draft.module} onChange={(event) => change({ module: event.target.value })} className={FIELD}>
              <option value="">No module</option>
              {(context?.modules ?? []).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex flex-col gap-1">
            <span className="text-caption-sm-medium text-tertiary">People</span>
            <div className="flex flex-wrap gap-2">
              {(context?.people ?? []).map((person) => (
                <button
                  key={person.email}
                  type="button"
                  aria-pressed={isChosen(person)}
                  onClick={() => toggle(person)}
                  className={cn(
                    "min-h-9 rounded-full border px-3 text-caption-sm-medium",
                    isChosen(person)
                      ? "border-accent-strong bg-accent-subtle text-accent-primary"
                      : "border-subtle text-secondary hover:bg-layer-1"
                  )}
                >
                  {person.display_name}
                </button>
              ))}
              {!context ? <span className="text-caption-sm-regular text-tertiary">Loading people...</span> : null}
            </div>
          </div>
        </>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" size="lg" stretch="auto" label="Save" disabled={!draft.title.trim()} />
        <Button variant="secondary" size="lg" stretch="auto" label="Cancel" onClick={onCancel} />
      </div>
    </form>
  );
}
