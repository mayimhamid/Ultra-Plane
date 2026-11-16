/** Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useState } from "react";
import { Pencil } from "lucide-react";
import { setToast } from "@plane/blocks/toast";
import { dayReportService, refreshTeamOps } from "@/hooks/team-ops/use-day-report";
import { getErrorMessage } from "../calendar/error-message";

export function RenameMicroTask({
  workspaceSlug,
  id,
  title,
  onRenamed,
}: {
  workspaceSlug: string;
  id: string;
  title: string;
  onRenamed?: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(title);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const next = name.trim();
    if (!next || saving) return;
    if (next === title) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const task = await dayReportService.updateMicroTask(workspaceSlug, id, { title: next });
      onRenamed?.(task.title);
      setEditing(false);
      void refreshTeamOps().catch(() => {});
    } catch (error) {
      setToast({ type: "error", title: "Could not rename task", message: getErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  if (!editing)
    return (
      <button
        type="button"
        aria-label={`Rename ${title}`}
        onClick={() => {
          setName(title);
          setEditing(true);
        }}
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-md text-tertiary hover:bg-layer-1"
      >
        <Pencil className="size-4" />
      </button>
    );
  return (
    <form
      className="flex min-w-0 flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <input
        aria-label="Micro task name"
        value={name}
        maxLength={255}
        onChange={(event) => setName(event.target.value)}
        className="h-10 min-w-32 flex-1 rounded-md border border-subtle bg-layer-1 px-2 text-body-sm-regular text-primary"
      />
      <button
        type="submit"
        disabled={saving || !name.trim()}
        className="min-h-10 text-body-xs-medium text-accent-primary disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save"}
      </button>
      <button
        type="button"
        disabled={saving}
        onClick={() => setEditing(false)}
        className="min-h-10 text-body-xs-medium text-secondary"
      >
        Cancel
      </button>
    </form>
  );
}
