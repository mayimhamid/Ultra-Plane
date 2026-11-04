/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useRef, useState } from "react";
import { Brain, Copy, FileUp, X } from "lucide-react";
import useSWR from "swr";
import { Button } from "@makeplane/propel/components/button";
import { setToast } from "@plane/blocks/toast";
import { buildImportPrompt, parseImportText, toDateKey } from "@plane/services";
import type { TImportItem, TImportRow } from "@plane/types";
import { cn } from "@plane/utils";
// hooks
import { dayReportService, refreshTeamOps } from "@/hooks/team-ops/use-day-report";
// local imports
import { getErrorMessage } from "../calendar/error-message";

type Props = {
  workspaceSlug: string;
  target: "micro" | "project";
  /** The project of a project import. */
  projectId?: string;
  /** Whose micro tasks (managers can import for someone else). */
  userId?: string;
  personName?: string;
  onDone?: () => void;
};

function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[92dvh] w-full max-w-3xl flex-col gap-3 overflow-hidden rounded-t-xl border border-subtle bg-surface-1 p-4 shadow-raised-300 sm:rounded-xl"
      >
        <header className="flex items-center justify-between gap-2">
          <h2 className="text-h5-medium text-primary">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="inline-flex size-10 items-center justify-center rounded-full hover:bg-layer-1"
          >
            <X className="size-5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

/** "Import" (a JSON or CSV file, checked and previewed before anything is created) and the AI prompt builder. */
export function TaskImportButtons({ workspaceSlug, target, projectId, userId, personName, onDone }: Props) {
  const [open, setOpen] = useState<"import" | "prompt" | null>(null);
  const [items, setItems] = useState<TImportItem[] | null>(null);
  const [rows, setRows] = useState<TImportRow[]>([]);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pasted, setPasted] = useState("");
  const [description, setDescription] = useState("");
  const file = useRef<HTMLInputElement>(null);

  const { data: context } = useSWR(
    open === "prompt" ? `TEAM_OPS_IMPORT_CONTEXT_${workspaceSlug}_${projectId ?? "micro"}` : null,
    () => dayReportService.getImportContext(workspaceSlug, target === "project" ? projectId : undefined)
  );

  const request = (list: TImportItem[], dryRun: boolean) =>
    dayReportService.importTasks(workspaceSlug, {
      target,
      project: projectId,
      user: userId,
      items: list,
      dry_run: dryRun,
    });

  const check = async (text: string) => {
    setError("");
    setRows([]);
    let list: TImportItem[];
    try {
      list = parseImportText(text);
    } catch (problem) {
      setError((problem as Error).message);
      return;
    }
    setBusy(true);
    try {
      const preview = await request(list, true);
      setItems(list);
      setRows(preview.rows);
      setOk(preview.ok);
    } catch (problem) {
      setError(getErrorMessage(problem));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!items) return;
    setBusy(true);
    try {
      const result = await request(items, false);
      if (!result.ok) {
        setRows(result.rows);
        setOk(false);
        return;
      }
      setToast({ type: "success", title: "Imported", message: `${result.created} tasks were added.` });
      await refreshTeamOps();
      onDone?.();
      close();
    } catch (problem) {
      setError(getErrorMessage(problem));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setOpen(null);
    setItems(null);
    setRows([]);
    setError("");
    setPasted("");
  };

  const prompt = context
    ? buildImportPrompt({ target, context, description, today: toDateKey(new Date()), personName })
    : "";

  const disabled = target === "project" && !projectId;
  const errors = rows.reduce((sum, row) => sum + row.errors.length, 0);

  return (
    <>
      <div className="flex gap-1">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen("import")}
          className="inline-flex min-h-10 items-center gap-2 rounded-md border border-subtle px-3 text-body-sm-medium text-secondary hover:bg-layer-1 disabled:opacity-50"
        >
          <FileUp className="size-4" aria-hidden />
          Import
        </button>
        <button
          type="button"
          disabled={disabled}
          title="Build a prompt for ChatGPT or Claude"
          aria-label="Build a prompt for ChatGPT or Claude"
          onClick={() => setOpen("prompt")}
          className="inline-flex size-10 items-center justify-center rounded-md border border-subtle text-[#9333ea] hover:bg-layer-1 disabled:opacity-50"
        >
          <Brain className="size-5" aria-hidden />
        </button>
      </div>

      {open === "prompt" ? (
        <Panel title="Prompt for ChatGPT or Claude" onClose={close}>
          <div className="flex flex-col gap-3">
            <p className="text-body-sm-regular text-secondary">
              Describe the work. Copy the prompt into ChatGPT or Claude; it answers with JSON. Save the answer as a
              .json file, or paste it into Import.
            </p>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
              placeholder="For example: install 12 BLE anchors in hall B next week, test the coverage, write a report"
              className="rounded-md border border-subtle bg-layer-1 p-3 text-body-sm-regular text-primary outline-none focus:border-accent-strong"
            />
            <pre className="max-h-72 overflow-auto rounded-md border border-subtle bg-layer-1 p-3 text-caption-sm-regular whitespace-pre-wrap text-secondary">
              {context ? prompt : "Loading the names of people, modules and states..."}
            </pre>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                size="lg"
                stretch="auto"
                label="Copy the prompt"
                icon={<Copy className="size-4" />}
                disabled={!context}
                onClick={() => {
                  void navigator.clipboard
                    .writeText(prompt)
                    .then(() =>
                      setToast({ type: "success", title: "Copied", message: "Paste it into ChatGPT or Claude." })
                    )
                    .catch(() =>
                      setToast({ type: "error", title: "Could not copy", message: "Select the text and copy it." })
                    );
                }}
              />
              <Button
                variant="secondary"
                size="lg"
                stretch="auto"
                label="Import the answer"
                onClick={() => setOpen("import")}
              />
            </div>
          </div>
        </Panel>
      ) : null}

      {open === "import" ? (
        <Panel title={target === "micro" ? "Import micro tasks" : "Import work items"} onClose={close}>
          <div className="flex flex-col gap-3">
            {rows.length === 0 ? (
              <>
                <p className="text-body-sm-regular text-secondary">
                  Choose a .json or .csv file, or paste the JSON the AI answered. Nothing is added before you confirm.
                </p>
                <input
                  ref={file}
                  type="file"
                  accept=".json,.csv,.txt,application/json,text/csv"
                  className="sr-only"
                  id="team-ops-import-file"
                  onChange={(event) => {
                    const chosen = event.target.files?.[0];
                    if (chosen) void chosen.text().then(check);
                    event.target.value = "";
                  }}
                />
                <label
                  htmlFor="team-ops-import-file"
                  className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-strong p-4 text-center hover:bg-layer-1"
                >
                  <FileUp className="size-6 text-accent-primary" aria-hidden />
                  <span className="text-body-sm-medium text-primary">Choose a file</span>
                  <span className="text-caption-sm-regular text-tertiary">JSON or CSV with a "title" column</span>
                </label>
                <textarea
                  value={pasted}
                  onChange={(event) => setPasted(event.target.value)}
                  rows={5}
                  placeholder='Or paste here: [{"title": "...", "planned_hours": 2}]'
                  className="font-mono rounded-md border border-subtle bg-layer-1 p-3 text-caption-sm-regular text-primary outline-none focus:border-accent-strong"
                />
                <div>
                  <Button
                    variant="primary"
                    size="lg"
                    stretch="auto"
                    label="Check and preview"
                    loading={busy}
                    disabled={!pasted.trim()}
                    onClick={() => void check(pasted)}
                  />
                </div>
              </>
            ) : (
              <>
                <p className={cn("text-body-sm-medium", ok ? "text-success-primary" : "text-danger-primary")}>
                  {ok
                    ? `${rows.length} tasks are ready. Confirm to add them all.`
                    : `${errors} problem${errors === 1 ? "" : "s"} found. Fix the file and try again; nothing was added.`}
                </p>
                <div className="overflow-x-auto rounded-md border border-subtle">
                  <table className="w-full min-w-[36rem] text-left text-body-xs-regular">
                    <thead className="bg-layer-1 text-caption-sm-medium text-tertiary">
                      <tr>
                        <th className="px-3 py-2">#</th>
                        <th className="px-3 py-2">Task</th>
                        <th className="px-3 py-2">Planned</th>
                        <th className="px-3 py-2">Due</th>
                        <th className="px-3 py-2">{target === "micro" ? "For" : "People · module"}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-subtle">
                      {rows.map((row) => (
                        <tr key={row.row} className={row.errors.length ? "bg-danger-subtle" : undefined}>
                          <td className="px-3 py-2 text-tertiary">{row.row}</td>
                          <td className="px-3 py-2">
                            <span className="text-primary">{row.title || "—"}</span>
                            {row.is_meeting ? <span className="ml-1 text-success-primary">(meeting)</span> : null}
                            {row.errors.map((problem) => (
                              <span key={problem} className="block text-danger-primary">
                                {problem}
                              </span>
                            ))}
                          </td>
                          <td className="px-3 py-2 tabular-nums">
                            {row.planned_amount ? `${row.planned_amount} ${row.unit === "DAYS" ? "d" : "h"}` : "—"}
                          </td>
                          <td className="px-3 py-2">{row.due_date ?? "—"}</td>
                          <td className="px-3 py-2 text-secondary">
                            {target === "micro"
                              ? row.assignee?.display_name
                              : [
                                  (row.assignees ?? []).map((person) => person.display_name).join(", "),
                                  row.module?.name,
                                ]
                                  .filter(Boolean)
                                  .join(" · ") || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    size="lg"
                    stretch="auto"
                    label={`Add ${rows.length} tasks`}
                    loading={busy}
                    disabled={!ok}
                    onClick={() => void confirm()}
                  />
                  <Button
                    variant="secondary"
                    size="lg"
                    stretch="auto"
                    label="Choose another file"
                    onClick={() => {
                      setRows([]);
                      setItems(null);
                    }}
                  />
                </div>
              </>
            )}
            {error ? (
              <p role="alert" className="text-body-sm-regular text-danger-primary">
                {error}
              </p>
            ) : null}
          </div>
        </Panel>
      ) : null}
    </>
  );
}
