/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Fragment, useRef, useState } from "react";
import { Brain, CircleHelp, Copy, FileUp, Minus, Pencil, Sparkles, X } from "lucide-react";
import useSWR from "swr";
import { Button } from "@makeplane/propel/components/button";
import { setToast } from "@plane/blocks/toast";
import { buildImportPrompt, parseImportText, toDateKey } from "@plane/services";
import type { TImportItem, TImportRow } from "@plane/types";
import { cn } from "@plane/utils";
// hooks
import { teamAIService, useAIStatus } from "@/hooks/team-ops/use-ai";
import { dayReportService, refreshTeamOps } from "@/hooks/team-ops/use-day-report";
// local imports
import { getErrorMessage } from "../calendar/error-message";
import { ImportRowEditor } from "./import-row-editor";

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
  const [open, setOpen] = useState<"import" | "prompt" | "help" | "choose" | null>(null);
  const [items, setItems] = useState<TImportItem[] | null>(null);
  const [rows, setRows] = useState<TImportRow[]>([]);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pasted, setPasted] = useState("");
  const [description, setDescription] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const { usable: aiUsable } = useAIStatus(workspaceSlug);

  const { data: context } = useSWR(
    open === "prompt" || open === "import" ? `TEAM_OPS_IMPORT_CONTEXT_${workspaceSlug}_${projectId ?? "micro"}` : null,
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

  /** Shows the preview of a changed list again: the server checks every task, so a fix clears its problem. */
  const recheck = async (list: TImportItem[]) => {
    setEditing(null);
    if (list.length === 0) {
      setItems(null);
      setRows([]);
      return;
    }
    setBusy(true);
    setError("");
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

  /** The workspace's own AI answers the same prompt; its tasks go to the usual preview, nothing is added yet. */
  const generate = async () => {
    setBusy(true);
    setError("");
    try {
      const { tasks } = await teamAIService.proposeTasks(workspaceSlug, prompt);
      if (tasks.length === 0) {
        setError("The AI found no tasks in the description. Add more detail and try again.");
        return;
      }
      setOpen("import");
      const preview = await request(tasks, true);
      setItems(tasks);
      setRows(preview.rows);
      setOk(preview.ok);
    } catch (problem) {
      setError(getErrorMessage(problem));
    } finally {
      setBusy(false);
    }
  };

  const removeTask = (index: number) => {
    if (items) void recheck(items.filter((_, position) => position !== index));
  };

  const saveTask = (index: number, patch: Partial<TImportItem>) => {
    if (items)
      void recheck(items.map((item, position) => (position === index ? Object.assign({}, item, patch) : item)));
  };

  const close = () => {
    setOpen(null);
    setItems(null);
    setRows([]);
    setError("");
    setPasted("");
    setEditing(null);
  };

  const prompt = context
    ? buildImportPrompt({ target, context, description, today: toDateKey(new Date()), personName })
    : "";

  const disabled = target === "project" && !projectId;
  const errors = rows.reduce((sum, row) => sum + row.errors.length, 0);

  return (
    <>
      {/* Phones: one button that offers the three (the header has no room for three). */}
      <button
        type="button"
        disabled={disabled}
        aria-label="Import tasks"
        onClick={() => setOpen("choose")}
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-subtle text-secondary hover:bg-layer-1 disabled:opacity-50 sm:hidden"
      >
        <FileUp className="size-4" aria-hidden />
      </button>
      {open === "choose" ? (
        <Panel title="Add many tasks" onClose={close}>
          <div className="flex flex-col gap-2">
            {[
              { key: "import" as const, icon: FileUp, label: "Import a file or an AI answer", color: "#2563eb" },
              { key: "prompt" as const, icon: Brain, label: "Build a prompt for ChatGPT or Claude", color: "#9333ea" },
              { key: "help" as const, icon: CircleHelp, label: "How it works", color: "#64748b" },
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setOpen(item.key)}
                className="flex min-h-12 items-center gap-3 rounded-lg border border-subtle px-3 text-left text-body-sm-medium text-primary hover:bg-layer-1"
              >
                <item.icon className="size-5" style={{ color: item.color }} aria-hidden />
                {item.label}
              </button>
            ))}
          </div>
        </Panel>
      ) : null}
      <div className="hidden gap-1 sm:flex">
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
        <button
          type="button"
          title="How to import with ChatGPT or Claude"
          aria-label="How to import with ChatGPT or Claude"
          onClick={() => setOpen("help")}
          className="inline-flex size-10 items-center justify-center rounded-md border border-subtle text-secondary hover:bg-layer-1"
        >
          <CircleHelp className="size-5" aria-hidden />
        </button>
      </div>

      {open === "help" ? (
        <Panel title="How to add many tasks at once" onClose={close}>
          <ol className="flex flex-col gap-3 text-body-sm-regular text-secondary">
            <li>
              <strong className="text-primary">1. Open the prompt.</strong> Press the purple brain button. Write what
              needs doing in the box: a description of the work, or paste your whole list (from Excel, notes or a
              document, even 100 lines).
            </li>
            <li>
              <strong className="text-primary">2. Copy it to ChatGPT or Claude.</strong> Press "Copy the prompt" and
              paste it into a new chat. The prompt already lists{" "}
              {target === "project" ? "the people, modules and states of this project" : "how micro tasks are written"},
              so the assistant splits the work into tasks and decides the time,{" "}
              {target === "project"
                ? "the people, the priority and the dates"
                : "the dates and which ones are meetings"}{" "}
              itself.
            </li>
            <li>
              <strong className="text-primary">3. Bring the answer back.</strong> Copy the assistant&apos;s whole answer
              (the JSON), press "Import" and paste it, or save it as a .json file and choose the file. A CSV with a
              "title" column works too.
            </li>
            <li>
              <strong className="text-primary">4. Check and confirm.</strong> A preview shows every task and any problem
              (a person who is not in the project, a missing title). Nothing is added until you press "Add". If
              something is wrong, ask the assistant to fix it and import again.
            </li>
          </ol>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="lg"
              stretch="auto"
              label="Open the prompt"
              onClick={() => setOpen("prompt")}
            />
            <Button
              variant="secondary"
              size="lg"
              stretch="auto"
              label="Import an answer"
              onClick={() => setOpen("import")}
            />
          </div>
        </Panel>
      ) : null}

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
              rows={7}
              placeholder="Describe the work, or paste your list of tasks (any length). For example: install 12 BLE anchors in hall B next week, test the coverage, write a report"
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
              {aiUsable ? (
                <Button
                  variant="secondary"
                  size="lg"
                  stretch="auto"
                  label={busy ? "The AI is writing the tasks..." : "Make the tasks with Plane AI"}
                  icon={<Sparkles className="size-4" />}
                  loading={busy}
                  disabled={!context || !description.trim()}
                  onClick={() => void generate()}
                />
              ) : null}
            </div>
            {error && open === "prompt" ? (
              <p role="alert" className="text-body-sm-regular text-danger-primary">
                {error}
              </p>
            ) : null}
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
                    : `${errors} problem${errors === 1 ? "" : "s"} found. Fix the marked tasks with the pencil, or remove them; nothing was added.`}
                </p>
                <div className="overflow-x-auto rounded-md border border-subtle">
                  <table className="w-full min-w-[40rem] text-left text-body-xs-regular">
                    <thead className="bg-layer-1 text-caption-sm-medium text-tertiary">
                      <tr>
                        <th className="px-3 py-2">#</th>
                        <th className="px-3 py-2">Task</th>
                        <th className="px-3 py-2">Planned</th>
                        <th className="px-3 py-2">Due</th>
                        <th className="px-3 py-2">{target === "micro" ? "For" : "People · module"}</th>
                        <th className="px-3 py-2">
                          <span className="sr-only">Edit or remove</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-subtle">
                      {rows.map((row, index) => (
                        <Fragment key={row.row}>
                          <tr className={row.errors.length ? "bg-danger-subtle" : undefined}>
                            <td className="px-3 py-2 text-tertiary">{index + 1}</td>
                            <td className="px-3 py-2">
                              <span className="text-primary">{row.title || "—"}</span>
                              {row.is_meeting ? <span className="ml-1 text-success-primary">(meeting)</span> : null}
                              {row.priority && row.priority !== "none" ? (
                                <span className="ml-2 text-caption-sm-medium text-tertiary">{row.priority}</span>
                              ) : null}
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
                            <td className="px-3 py-1">
                              <span className="flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  aria-label={`Edit task ${index + 1}`}
                                  title="Edit"
                                  disabled={busy}
                                  onClick={() => setEditing(editing === index ? null : index)}
                                  className="inline-flex size-9 items-center justify-center rounded-full text-secondary hover:bg-layer-1 disabled:opacity-50"
                                >
                                  <Pencil className="size-4" aria-hidden />
                                </button>
                                <button
                                  type="button"
                                  aria-label={`Remove task ${index + 1}`}
                                  title="Remove"
                                  disabled={busy}
                                  onClick={() => removeTask(index)}
                                  className="inline-flex size-9 items-center justify-center rounded-full bg-[#dc2626] text-white hover:opacity-90 disabled:opacity-50"
                                >
                                  <Minus className="size-4" aria-hidden />
                                </button>
                              </span>
                            </td>
                          </tr>
                          {editing === index ? (
                            <tr>
                              <td colSpan={6} className="bg-layer-1/40 p-3">
                                <ImportRowEditor
                                  row={row}
                                  target={target}
                                  context={context}
                                  onSave={(patch) => saveTask(index, patch)}
                                  onCancel={() => setEditing(null)}
                                />
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
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
                    disabled={!ok || busy}
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
