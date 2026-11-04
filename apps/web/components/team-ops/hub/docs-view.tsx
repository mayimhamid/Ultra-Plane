/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useRef, useState } from "react";
import { observer } from "mobx-react";
import { Paperclip } from "lucide-react";
import Link from "next/link";
import { Button } from "@makeplane/propel/components/button";
import { InputField } from "@makeplane/propel/components/input-field";
import { SelectField } from "@makeplane/propel/components/select-field";
import { TextAreaField } from "@makeplane/propel/components/text-area-field";
import { setToast } from "@plane/blocks/toast";
import { FILE_ACCEPT, MAX_FILE_MB, fileLimitError } from "@plane/services";
import type { THubDoc } from "@plane/types";
import { cn } from "@plane/utils";
// hooks
import { useUser } from "@/hooks/store/user";
import { useProject } from "@/hooks/store/use-project";
import { hubExtraService, hubService, useHubDocs, useHubFiles } from "@/hooks/team-ops/use-hub";
// local imports
import { getErrorMessage } from "../calendar/error-message";
import { FilesView } from "./files-view";

type Props = { workspaceSlug: string };

const NONE = "none";
const dateFormat = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric" });
const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** A picked file is told apart by its name, size and date, so the same file is never added twice. */
const identity = (file: File) => `${file.name}-${file.size}-${file.lastModified}`;

type Draft = { id?: string; title: string; body: string; tags: string; project: string; page?: string | null };
const emptyDraft: Draft = { title: "", body: "", tags: "", project: NONE };

/** Written documents with tags, an optional project and their own files: the text and its files are one document. */
export const DocsView = observer(function DocsView({ workspaceSlug }: Props) {
  // states
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [projectFilter, setProjectFilter] = useState(NONE);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState("");
  const [open, setOpen] = useState<THubDoc | null>(null);
  const [showOther, setShowOther] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  // hooks
  const { data: currentUser } = useUser();
  const { joinedProjectIds, getPartialProjectById } = useProject();
  const { docs, tags, refresh } = useHubDocs(workspaceSlug, {
    q: query || undefined,
    tag: tag || undefined,
    project: projectFilter === NONE ? undefined : projectFilter,
  });
  const { files: otherFiles } = useHubFiles(workspaceSlug);

  const projectOptions = [
    { value: NONE, label: "No project" },
    ...joinedProjectIds.map((id) => ({ value: id, label: getPartialProjectById(id)?.name ?? id })),
  ];
  const filterOptions = [{ value: NONE, label: "All projects" }, ...projectOptions.slice(1)];

  const show = async (doc: THubDoc) => {
    try {
      setOpen(await hubExtraService.getDoc(workspaceSlug, doc.id));
      setDraft(null);
      setNewFiles([]);
      setShowOther(false);
    } catch (error) {
      setToast({ type: "error", title: "Could not open", message: getErrorMessage(error) });
    }
  };

  const pickFiles = (list: FileList | null) => {
    if (!list) return;
    const known = new Set(newFiles.map(identity));
    const next = [...newFiles, ...Array.from(list).filter((file) => !known.has(identity(file)))];
    const problem = fileLimitError(next);
    if (problem) return setFileError(problem);
    setFileError("");
    setNewFiles(next);
    if (picker.current) picker.current.value = "";
  };

  const save = async () => {
    if (!draft) return;
    setIsSaving(true);
    try {
      let saved = await hubExtraService.saveDoc(
        workspaceSlug,
        {
          title: draft.title,
          body: draft.body,
          tags: draft.tags
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
          project: draft.project === NONE ? null : draft.project,
        },
        draft.id
      );
      if (newFiles.length > 0) {
        try {
          await hubExtraService.uploadFiles(workspaceSlug, newFiles, saved.id);
          saved = await hubExtraService.getDoc(workspaceSlug, saved.id);
        } catch (error) {
          // the document is saved; only its files did not go up
          setToast({
            type: "error",
            title: "The document is saved, but its files were not",
            message: getErrorMessage(error),
          });
        }
      }
      await refresh();
      setDraft(null);
      setNewFiles([]);
      setFileError("");
      setOpen(saved);
    } catch (error) {
      setToast({ type: "error", title: "Could not save", message: getErrorMessage(error) });
    } finally {
      setIsSaving(false);
    }
  };

  const remove = async (doc: THubDoc) => {
    try {
      await hubExtraService.deleteDoc(workspaceSlug, doc.id);
      setOpen(null);
      await refresh();
    } catch (error) {
      setToast({ type: "error", title: "Could not delete", message: getErrorMessage(error) });
    }
  };

  /** Adds files to the document that is open. */
  const addFilesToOpen = async (list: FileList | null) => {
    if (!list || list.length === 0 || !open) return;
    const chosen = Array.from(list);
    const problem = fileLimitError(chosen);
    if (problem) return setToast({ type: "error", title: "Could not upload", message: problem });
    setIsUploading(true);
    try {
      await hubExtraService.uploadFiles(workspaceSlug, chosen, open.id);
      setOpen(await hubExtraService.getDoc(workspaceSlug, open.id));
      await refresh();
    } catch (error) {
      setToast({ type: "error", title: "Could not upload", message: getErrorMessage(error) });
    } finally {
      setIsUploading(false);
      if (picker.current) picker.current.value = "";
    }
  };

  const openFile = async (id: string) => {
    try {
      const { url } = await hubService.getFileLink(workspaceSlug, id);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setToast({ type: "error", title: "Could not open the file", message: getErrorMessage(error) });
    }
  };

  const removeFile = async (doc: THubDoc, id: string) => {
    try {
      await hubExtraService.deleteFile(workspaceSlug, id);
      setOpen(await hubExtraService.getDoc(workspaceSlug, doc.id));
      await refresh();
    } catch (error) {
      setToast({ type: "error", title: "Could not remove", message: getErrorMessage(error) });
    }
  };

  // On a phone the list of documents and one document are two screens
  const showDetail = Boolean(draft || open || showOther);
  const backToList = () => {
    setOpen(null);
    setDraft(null);
    setNewFiles([]);
    setShowOther(false);
  };

  const edit = (doc: THubDoc) => {
    setNewFiles([]);
    setFileError("");
    setDraft({
      id: doc.id,
      title: doc.title,
      body: doc.body ?? "",
      tags: doc.tags.join(", "),
      project: doc.project?.id ?? NONE,
      page: doc.page,
    });
  };

  const editingDoc = draft?.id ? open : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-subtle px-4 py-3">
        <h2 className="text-body-md-medium text-primary">Doc Hub</h2>
        <Button
          variant="primary"
          size="sm"
          stretch="auto"
          label="New document"
          onClick={() => {
            setOpen(null);
            setShowOther(false);
            setNewFiles([]);
            setFileError("");
            setDraft(emptyDraft);
          }}
        />
      </header>
      <div className="flex min-h-0 flex-1">
        <aside
          className={cn(
            "w-full shrink-0 flex-col gap-2 overflow-y-auto border-subtle p-3 md:flex md:w-80 md:border-r",
            showDetail ? "hidden" : "flex"
          )}
        >
          <InputField
            type="text"
            size="lg"
            orientation="vertical"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search titles"
            aria-label="Search titles"
          />
          <div className="[&_button]:min-w-0">
            <SelectField
              size="lg"
              label="Project"
              options={filterOptions}
              value={projectFilter}
              onValueChange={(value) => setProjectFilter(value ?? NONE)}
            />
          </div>
          {tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={tag === item}
                  onClick={() => setTag(tag === item ? "" : item)}
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-caption-sm-regular",
                    tag === item ? "bg-accent-subtle text-accent-primary" : "bg-layer-1 text-secondary"
                  )}
                >
                  #{item}
                </button>
              ))}
            </div>
          ) : null}
          <ul className="flex flex-col gap-1.5">
            {(docs ?? []).length === 0 ? (
              <li className="text-body-xs-regular text-tertiary">No documents for this filter.</li>
            ) : null}
            {(docs ?? []).map((doc) => (
              <li key={doc.id}>
                <button
                  type="button"
                  onClick={() => void show(doc)}
                  className={cn(
                    "flex w-full flex-col gap-0.5 rounded-md border px-3 py-2 text-left hover:bg-layer-1",
                    open?.id === doc.id ? "border-accent-strong" : "border-subtle"
                  )}
                >
                  <span className="truncate text-body-sm-medium text-primary">{doc.title}</span>
                  <span className="flex items-center gap-1.5 truncate text-caption-sm-regular text-tertiary">
                    <span className="truncate">
                      {doc.project ? `${doc.project.identifier} · ` : ""}
                      {doc.author.display_name} · {dateFormat.format(new Date(doc.updated_at))}
                    </span>
                    {doc.file_count > 0 ? (
                      <span className="ml-auto inline-flex shrink-0 items-center gap-0.5">
                        <Paperclip className="size-3" aria-hidden />
                        {doc.file_count}
                        <span className="sr-only"> files</span>
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {(otherFiles ?? []).length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setOpen(null);
                setDraft(null);
                setNewFiles([]);
                setShowOther(true);
              }}
              className={cn(
                "mt-1 flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-body-xs-medium text-secondary hover:bg-layer-1",
                showOther ? "border-accent-strong" : "border-subtle"
              )}
            >
              <span>Other files</span>
              <span className="text-caption-sm-regular text-tertiary">{(otherFiles ?? []).length}</span>
            </button>
          ) : null}
        </aside>
        <section className={cn("min-w-0 flex-1 overflow-y-auto p-4 md:block", showDetail ? "block" : "hidden")}>
          <button
            type="button"
            onClick={backToList}
            className="mb-3 flex items-center gap-1.5 text-body-sm-medium text-accent-primary md:hidden"
          >
            <span aria-hidden>&larr;</span> Documents
          </button>
          {showOther ? (
            <div className="-m-4 h-[calc(100%+2rem)]">
              <FilesView workspaceSlug={workspaceSlug} />
            </div>
          ) : draft ? (
            <div className="flex max-w-3xl flex-col gap-3">
              <InputField
                type="text"
                size="lg"
                orientation="vertical"
                value={draft.title}
                maxLength={200}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                placeholder="Title"
                aria-label="Title"
              />
              {draft.page ? (
                <p className="text-body-sm-regular text-secondary">
                  The text of this document is a Plane Page. Save, then use "Open in Pages" to write it.
                </p>
              ) : (
                <TextAreaField
                  size="lg"
                  label="Description"
                  value={draft.body}
                  rows={14}
                  onChange={(event) => setDraft({ ...draft, body: event.target.value })}
                />
              )}
              <InputField
                type="text"
                size="lg"
                orientation="vertical"
                value={draft.tags}
                onChange={(event) => setDraft({ ...draft, tags: event.target.value })}
                placeholder="Tags, separated by commas"
                aria-label="Tags"
              />
              <div className="max-w-xs [&_button]:min-w-0">
                <SelectField
                  size="lg"
                  label="Project"
                  options={projectOptions}
                  value={draft.project}
                  onValueChange={(value) => setDraft({ ...draft, project: value ?? NONE })}
                />
                {draft.project !== NONE && !draft.page ? (
                  <p className="mt-1 text-caption-sm-regular text-tertiary">
                    A document of a project is kept as a Page in that project.
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-body-sm-medium text-primary">Files</h4>
                  <div>
                    <input
                      ref={picker}
                      id="doc-draft-files"
                      type="file"
                      multiple
                      accept={FILE_ACCEPT}
                      className="sr-only"
                      onChange={(event) => pickFiles(event.target.files)}
                    />
                    <label
                      htmlFor="doc-draft-files"
                      className="cursor-pointer rounded-md border border-subtle px-3 py-1.5 text-body-xs-medium text-accent-primary hover:bg-layer-1"
                    >
                      Add files
                    </label>
                  </div>
                </div>
                <p className="text-caption-sm-regular text-tertiary">
                  Up to {MAX_FILE_MB} MB each. They are kept with this document and seen by whoever can read it.
                </p>
                {fileError ? <p className="text-body-xs-regular text-danger-primary">{fileError}</p> : null}
                <ul className="divide-y divide-subtle rounded-md border border-subtle">
                  {(editingDoc?.files ?? []).map((file) => (
                    <li key={file.id} className="flex items-center justify-between gap-2 px-3 py-2">
                      <span className="min-w-0 truncate text-body-sm-regular text-primary">
                        {file.name}{" "}
                        <span className="text-caption-sm-regular text-tertiary">{formatSize(file.size)}</span>
                      </span>
                      <button
                        type="button"
                        className="text-body-xs-regular text-tertiary hover:text-danger-primary"
                        onClick={() => editingDoc && void removeFile(editingDoc, file.id)}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                  {newFiles.map((file) => (
                    <li key={identity(file)} className="flex items-center justify-between gap-2 px-3 py-2">
                      <span className="min-w-0 truncate text-body-sm-regular text-primary">
                        {file.name}{" "}
                        <span className="text-caption-sm-regular text-tertiary">{formatSize(file.size)}</span>
                      </span>
                      <button
                        type="button"
                        className="text-body-xs-regular text-tertiary hover:text-danger-primary"
                        onClick={() => setNewFiles(newFiles.filter((item) => item !== file))}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                  {(editingDoc?.files ?? []).length === 0 && newFiles.length === 0 ? (
                    <li className="px-3 py-2 text-body-xs-regular text-tertiary">No files.</li>
                  ) : null}
                </ul>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  size="md"
                  stretch="auto"
                  label="Save"
                  loading={isSaving}
                  disabled={!draft.title.trim()}
                  onClick={save}
                />
                <Button
                  variant="secondary"
                  size="md"
                  stretch="auto"
                  label="Cancel"
                  onClick={() => {
                    setDraft(null);
                    setNewFiles([]);
                    setFileError("");
                  }}
                />
              </div>
            </div>
          ) : open ? (
            <article className="flex max-w-3xl flex-col gap-3">
              <header className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-h5-medium text-primary">{open.title}</h3>
                  <p className="text-caption-sm-regular text-tertiary">
                    {open.author.display_name} · {dateFormat.format(new Date(open.updated_at))}
                    {open.project ? ` · ${open.project.name}` : ""}
                  </p>
                  {open.tags.length > 0 ? (
                    <p className="text-caption-sm-regular text-accent-primary">
                      {open.tags.map((item) => `#${item}`).join(" ")}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  {open.page && open.project ? (
                    <Link
                      className="rounded-md border border-subtle px-2.5 py-1 text-body-xs-medium text-accent-primary hover:bg-layer-1"
                      href={`/${workspaceSlug}/projects/${open.project.id}/pages/${open.page}/`}
                    >
                      Open in Pages
                    </Link>
                  ) : null}
                  {open.author.id === currentUser?.id ? (
                    <>
                      <Button variant="secondary" size="sm" stretch="auto" label="Edit" onClick={() => edit(open)} />
                      <Button
                        variant="secondary"
                        size="sm"
                        stretch="auto"
                        label="Delete"
                        onClick={() => void remove(open)}
                      />
                    </>
                  ) : null}
                </div>
              </header>
              <p className="text-body-sm-regular break-words whitespace-pre-wrap text-primary">{open.body}</p>
              <section aria-label="Files" className="flex flex-col gap-2 border-t border-subtle pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-body-sm-medium text-primary">Files ({(open.files ?? []).length})</h4>
                  {open.author.id === currentUser?.id ? (
                    <div>
                      <input
                        ref={picker}
                        id="doc-open-files"
                        type="file"
                        multiple
                        accept={FILE_ACCEPT}
                        className="sr-only"
                        onChange={(event) => void addFilesToOpen(event.target.files)}
                      />
                      <label
                        htmlFor="doc-open-files"
                        className="cursor-pointer rounded-md border border-subtle px-3 py-1.5 text-body-xs-medium text-accent-primary hover:bg-layer-1"
                      >
                        {isUploading ? "Uploading..." : "Add files"}
                      </label>
                    </div>
                  ) : null}
                </div>
                {(open.files ?? []).length === 0 ? (
                  <p className="text-body-xs-regular text-tertiary">This document has no files.</p>
                ) : (
                  <ul className="divide-y divide-subtle rounded-md border border-subtle">
                    {(open.files ?? []).map((file) => (
                      <li key={file.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                        <div className="min-w-0">
                          <button
                            type="button"
                            className="truncate text-body-sm-medium text-accent-primary hover:underline"
                            onClick={() => void openFile(file.id)}
                          >
                            {file.name}
                          </button>
                          <p className="text-caption-sm-regular text-tertiary">
                            {formatSize(file.size)} · {file.uploaded_by.display_name} ·{" "}
                            {dateFormat.format(new Date(file.created_at))}
                          </p>
                        </div>
                        {open.author.id === currentUser?.id || file.uploaded_by.id === currentUser?.id ? (
                          <button
                            type="button"
                            className="text-body-xs-regular text-tertiary hover:text-danger-primary"
                            onClick={() => void removeFile(open, file.id)}
                          >
                            Remove
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </article>
          ) : (
            <p className="text-body-sm-regular text-tertiary">Choose a document, or write a new one.</p>
          )}
        </section>
      </div>
    </div>
  );
});
