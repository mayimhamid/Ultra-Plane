/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import { FilePlus2, FileText, Folder, Paperclip, X } from "lucide-react";
import Link from "next/link";
import { Button } from "@makeplane/propel/components/button";
import { InputField } from "@makeplane/propel/components/input-field";
import { SelectField } from "@makeplane/propel/components/select-field";
import { TextAreaField } from "@makeplane/propel/components/text-area-field";
import { setToast } from "@plane/blocks/toast";
import { FILE_ACCEPT, MAX_FILE_MB, fileLimitError } from "@plane/services";
import type { THubDoc, TLibraryFile } from "@plane/types";
import { cn } from "@plane/utils";
// hooks
import { useUser } from "@/hooks/store/user";
import { useProject } from "@/hooks/store/use-project";
import { hubExtraService, hubService, useHubDocs, useHubFiles } from "@/hooks/team-ops/use-hub";
// local imports
import { getErrorMessage } from "../calendar/error-message";
import { DocTree, buildTree, flattenTree, withDescendants } from "./doc-tree";
import { FilesView } from "./files-view";
import { MarkdownView } from "./markdown-view";
import { MentionPicker } from "./mention-picker";

type Props = { workspaceSlug: string };

const NONE = "none";
const dateFormat = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric" });
const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** A picked file is told apart by its name, size and date, so the same file is never added twice. */
const identity = (file: File) => `${file.name}-${file.size}-${file.lastModified}`;

// Files the app can show as a page: Markdown (like a README) and plain text.
const READABLE = /\.(md|markdown|txt)$/i;
const MARKDOWN = /\.(md|markdown)$/i;
const MAX_READ_BYTES = 1024 * 1024;

type Draft = {
  id?: string;
  title: string;
  body: string;
  tags: string;
  project: string;
  /** The document it is inside. */
  parent: string;
  page?: string | null;
  /** Colleagues to tell when it is saved (not kept: a mention is a one-time notification). */
  mentions: string[];
};
const emptyDraft: Draft = { title: "", body: "", tags: "", project: NONE, parent: NONE, mentions: [] };

type TReading = { name: string; text: string; markdown: boolean };

/** A file shown as a page in a box over the document. */
function FileReader({ reading, onClose }: { reading: TReading; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={reading.name}
        className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-xl border border-subtle bg-surface-1 shadow-raised-300 sm:rounded-xl"
      >
        <header className="flex items-center justify-between gap-2 border-b border-subtle px-4 py-2">
          <h2 className="min-w-0 truncate text-body-md-medium text-primary">{reading.name}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full hover:bg-layer-1"
          >
            <X className="size-5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {reading.markdown ? (
            <MarkdownView source={reading.text} />
          ) : (
            <pre className="font-mono text-body-sm-regular break-words whitespace-pre-wrap text-primary">
              {reading.text}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Documents as a tree of folders and pages (factory-monitor, then nginx inside it, then a page inside that), each
 * written in Markdown and shown like a GitHub README, with its own files. A text or Markdown file can be read in
 * the app too, or just kept as a file.
 */
export const DocsView = observer(function DocsView({ workspaceSlug }: Props) {
  // states
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [projectFilter, setProjectFilter] = useState(NONE);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [preview, setPreview] = useState(false);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState("");
  const [open, setOpen] = useState<THubDoc | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [reading, setReading] = useState<TReading | null>(null);
  const [showOther, setShowOther] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const mdPicker = useRef<HTMLInputElement>(null);
  // hooks
  const { data: currentUser } = useUser();
  const { joinedProjectIds, getPartialProjectById } = useProject();
  const filtering = Boolean(query || tag || projectFilter !== NONE);
  const { docs, tags, refresh } = useHubDocs(workspaceSlug, {
    q: query || undefined,
    tag: tag || undefined,
    project: projectFilter === NONE ? undefined : projectFilter,
  });
  // The whole tree, for the list of choices of "Inside" and for the pages inside the open one.
  const { docs: allDocs } = useHubDocs(workspaceSlug, {});
  const { files: otherFiles } = useHubFiles(workspaceSlug);

  const tree = useMemo(() => buildTree(allDocs ?? []), [allDocs]);
  const filteredTree = useMemo(() => buildTree(docs ?? []), [docs]);
  const inside = useMemo(() => (open ? (allDocs ?? []).filter((doc) => doc.parent === open.id) : []), [allDocs, open]);
  const expandedSet = useMemo(() => new Set(expanded), [expanded]);

  const projectOptions = [
    { value: NONE, label: "No project" },
    ...joinedProjectIds.map((id) => ({ value: id, label: getPartialProjectById(id)?.name ?? id })),
  ];
  const filterOptions = [{ value: NONE, label: "All projects" }, ...projectOptions.slice(1)];

  const parentOptions = useMemo(() => {
    const blocked = draft?.id ? withDescendants(tree, draft.id) : new Set<string>();
    return [
      { value: NONE, label: "Top level" },
      ...flattenTree(tree)
        .filter(({ doc }) => !blocked.has(doc.id))
        .map(({ doc, depth }) => ({ value: doc.id, label: `${"– ".repeat(depth)}${doc.title}` })),
    ];
  }, [tree, draft?.id]);

  const toggle = (id: string) =>
    setExpanded((now) => (now.includes(id) ? now.filter((item) => item !== id) : [...now, id]));

  const show = async (doc: { id: string }) => {
    try {
      const full = await hubExtraService.getDoc(workspaceSlug, doc.id);
      setOpen(full);
      setDraft(null);
      setNewFiles([]);
      setShowOther(false);
      // The folders above it open, so the list shows where it is.
      setExpanded((now) => [...new Set([...now, ...(full.path ?? []).map((item) => item.id), full.id])]);
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

  /** A Markdown (or text) file becomes the text of the document, to be edited here. */
  const loadMarkdown = async (list: FileList | null) => {
    const chosen = list?.[0];
    if (mdPicker.current) mdPicker.current.value = "";
    if (!chosen || !draft) return;
    if (chosen.size > MAX_READ_BYTES) {
      return setToast({ type: "error", title: "Too large", message: "A text file here can be up to 1 MB." });
    }
    const text = await chosen.text();
    setDraft({
      ...draft,
      body: draft.body ? `${draft.body}\n\n${text}` : text,
      title: draft.title || chosen.name.replace(/\.(md|markdown|txt)$/i, ""),
    });
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
          parent: draft.parent === NONE ? null : draft.parent,
          mentions: draft.mentions,
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
      setPreview(false);
      setNewFiles([]);
      setFileError("");
      await show(saved);
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

  /** Reads a text or Markdown file in the app, like a page. */
  const readFile = async (file: TLibraryFile) => {
    if (file.size > MAX_READ_BYTES) {
      return setToast({
        type: "error",
        title: "Too large to read here",
        message: "Open it instead; it is more than 1 MB.",
      });
    }
    try {
      const { url } = await hubService.getFileLink(workspaceSlug, file.id);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`The file answered ${response.status}.`);
      setReading({ name: file.name, text: await response.text(), markdown: MARKDOWN.test(file.name) });
    } catch (error) {
      setToast({ type: "error", title: "Could not read it here", message: getErrorMessage(error) });
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

  const startNew = (parent: string) => {
    setOpen(null);
    setShowOther(false);
    setNewFiles([]);
    setFileError("");
    setPreview(false);
    setDraft({ ...emptyDraft, parent });
  };

  const edit = (doc: THubDoc) => {
    setNewFiles([]);
    setFileError("");
    setPreview(false);
    setDraft({
      id: doc.id,
      title: doc.title,
      body: doc.body ?? "",
      tags: doc.tags.join(", "),
      project: doc.project?.id ?? NONE,
      parent: doc.parent ?? NONE,
      page: doc.page,
      mentions: [],
    });
  };

  const editingDoc = draft?.id ? open : null;
  const canChange = (doc: THubDoc) => doc.author.id === currentUser?.id;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-subtle px-4 py-3">
        <h2 className="text-body-md-medium text-primary">Doc Hub</h2>
        <Button variant="primary" size="sm" stretch="auto" label="New document" onClick={() => startNew(NONE)} />
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
          {(docs ?? []).length === 0 ? (
            <p className="text-body-xs-regular text-tertiary">
              {filtering ? "No documents for this filter." : "No documents yet. Write the first one."}
            </p>
          ) : (
            <DocTree
              nodes={filtering ? filteredTree : tree}
              openId={open?.id}
              // Searching shows every match, opened out; otherwise the folders open as they are pressed.
              expanded={filtering ? new Set((docs ?? []).map((doc) => doc.id)) : expandedSet}
              onToggle={toggle}
              onOpen={(doc) => void show(doc)}
            />
          )}
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
              <div className="max-w-sm [&_button]:min-w-0">
                <SelectField
                  size="lg"
                  label="Inside"
                  options={parentOptions}
                  value={draft.parent}
                  onValueChange={(value) => setDraft({ ...draft, parent: value ?? NONE })}
                />
              </div>
              {draft.page ? (
                <p className="text-body-sm-regular text-secondary">
                  The text of this document is a Plane Page. Save, then use "Open in Pages" to write it.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div
                      role="tablist"
                      aria-label="Write or preview"
                      className="flex rounded-md border border-subtle p-0.5"
                    >
                      {[
                        { key: false, label: "Write" },
                        { key: true, label: "Preview" },
                      ].map((tab) => (
                        <button
                          key={tab.label}
                          type="button"
                          role="tab"
                          aria-selected={preview === tab.key}
                          onClick={() => setPreview(tab.key)}
                          className={cn(
                            "min-h-8 rounded px-3 text-body-xs-medium",
                            preview === tab.key ? "bg-accent-primary text-on-color" : "text-secondary hover:bg-layer-1"
                          )}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                    <div>
                      <input
                        ref={mdPicker}
                        id="doc-markdown-file"
                        type="file"
                        accept=".md,.markdown,.txt,text/markdown,text/plain"
                        className="sr-only"
                        onChange={(event) => void loadMarkdown(event.target.files)}
                      />
                      <label
                        htmlFor="doc-markdown-file"
                        className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md border border-subtle px-3 text-body-xs-medium text-accent-primary hover:bg-layer-1"
                      >
                        <FilePlus2 className="size-3.5" aria-hidden />
                        Load a .md file
                      </label>
                    </div>
                  </div>
                  {preview ? (
                    <div className="min-h-48 rounded-md border border-subtle bg-surface-1 p-4">
                      {draft.body.trim() ? (
                        <MarkdownView source={draft.body} />
                      ) : (
                        <p className="text-body-sm-regular text-tertiary">Nothing to preview yet.</p>
                      )}
                    </div>
                  ) : (
                    <TextAreaField
                      size="lg"
                      label="Text (Markdown)"
                      value={draft.body}
                      rows={16}
                      onChange={(event) => setDraft({ ...draft, body: event.target.value })}
                    />
                  )}
                  <p className="text-caption-sm-regular text-tertiary">
                    Markdown works: # headings, **bold**, lists, `code`, code blocks, tables and - [ ] task lists.
                  </p>
                </div>
              )}
              <MentionPicker
                workspaceSlug={workspaceSlug}
                value={draft.mentions}
                onChange={(mentions) => setDraft({ ...draft, mentions })}
                what="this document"
              />
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
              {(open.path ?? []).length > 0 ? (
                <nav
                  aria-label="Where this document is"
                  className="flex flex-wrap items-center gap-1 text-caption-sm-regular"
                >
                  {(open.path ?? []).map((item) => (
                    <span key={item.id} className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void show(item)}
                        className="text-accent-primary hover:underline"
                      >
                        {item.title}
                      </button>
                      <span aria-hidden className="text-tertiary">
                        /
                      </span>
                    </span>
                  ))}
                  <span className="text-secondary">{open.title}</span>
                </nav>
              ) : null}
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
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    stretch="auto"
                    label="Add a page inside"
                    onClick={() => startNew(open.id)}
                  />
                  {open.page && open.project ? (
                    <Link
                      className="rounded-md border border-subtle px-2.5 py-1 text-body-xs-medium text-accent-primary hover:bg-layer-1"
                      href={`/${workspaceSlug}/projects/${open.project.id}/pages/${open.page}/`}
                    >
                      Open in Pages
                    </Link>
                  ) : null}
                  {canChange(open) ? (
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
              {open.page ? (
                <p className="text-body-sm-regular break-words whitespace-pre-wrap text-primary">{open.body}</p>
              ) : open.body?.trim() ? (
                <MarkdownView source={open.body} className="rounded-lg border border-subtle bg-surface-1 p-5" />
              ) : (
                <p className="text-body-sm-regular text-tertiary">This document has no text yet.</p>
              )}
              {inside.length > 0 ? (
                <section aria-label="Pages inside" className="flex flex-col gap-2 border-t border-subtle pt-3">
                  <h4 className="text-body-sm-medium text-primary">Inside ({inside.length})</h4>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {inside.map((child) => (
                      <li key={child.id}>
                        <button
                          type="button"
                          onClick={() => void show(child)}
                          className="flex w-full items-center gap-2 rounded-lg border border-subtle px-3 py-2 text-left hover:bg-layer-1"
                        >
                          {(allDocs ?? []).some((doc) => doc.parent === child.id) ? (
                            <Folder className="size-4 shrink-0 text-accent-primary" aria-hidden />
                          ) : (
                            <FileText className="size-4 shrink-0 text-tertiary" aria-hidden />
                          )}
                          <span className="min-w-0 flex-1 truncate text-body-sm-medium text-primary">
                            {child.title}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              <section aria-label="Files" className="flex flex-col gap-2 border-t border-subtle pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="flex items-center gap-1.5 text-body-sm-medium text-primary">
                    <Paperclip className="size-3.5" aria-hidden />
                    Files ({(open.files ?? []).length})
                  </h4>
                  {canChange(open) ? (
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
                        <div className="flex items-center gap-3">
                          {READABLE.test(file.name) ? (
                            <button
                              type="button"
                              className="text-body-xs-medium text-accent-primary hover:underline"
                              onClick={() => void readFile(file)}
                            >
                              Read here
                            </button>
                          ) : null}
                          {canChange(open) || file.uploaded_by.id === currentUser?.id ? (
                            <button
                              type="button"
                              className="text-body-xs-regular text-tertiary hover:text-danger-primary"
                              onClick={() => void removeFile(open, file.id)}
                            >
                              Remove
                            </button>
                          ) : null}
                        </div>
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
      {reading ? <FileReader reading={reading} onClose={() => setReading(null)} /> : null}
    </div>
  );
});
