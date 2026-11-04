/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { sortBy } from "lodash-es";
import { observer } from "mobx-react";
import Link from "next/link";
import { AtSign, CornerUpLeft, FolderKanban, Paperclip, Pencil, SendHorizontal, Trash2, Users } from "lucide-react";
import { Badge } from "@makeplane/propel/components/badge";
import { Button } from "@makeplane/propel/components/button";
import { TextAreaField } from "@makeplane/propel/components/text-area-field";
import { setToast } from "@plane/blocks/toast";
import { FILE_ACCEPT, fileLimitError } from "@plane/services";
import type { THubChannel, THubMessage, THubPerson } from "@plane/types";
import { cn } from "@plane/utils";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useUser } from "@/hooks/store/user";
import { useHubChannel } from "@/hooks/team-ops/use-hub";
import { useOpsTeams } from "@/hooks/team-ops/use-work-calendar";
// local imports
import { getErrorMessage } from "../calendar/error-message";
import { FileTypeIcon, fileExtension, fileKind } from "./file-icon";
import { PersonAvatar, personColor } from "./person-avatar";

const KIND_LABEL: Record<THubChannel["kind"], string> = {
  TEAM: "Team",
  PROJECT: "Project",
  GENERAL: "General",
  NEWS: "News",
  DM: "Private",
};

const timeFormat = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit" });
const dayFormat = new Intl.DateTimeFormat("en-US", { weekday: "long", day: "numeric", month: "long" });

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const dayOf = (stamp: string) => new Date(stamp).toDateString();

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type TToken = { text: string; color?: string; href?: string };

/** The message text with tagged people, teams and projects picked out in color (projects are links). */
const renderBody = (body: string, tokens: TToken[], isOwn: boolean): ReactNode => {
  // Longest first, so "@Ann Lee" wins over "@Ann".
  const known = sortBy(
    tokens.filter((token) => token.text.length > 1),
    (token) => -token.text.length
  );
  if (known.length === 0) return body;
  const pattern = new RegExp(`(${known.map((token) => escape(token.text)).join("|")})`, "g");
  // Each part's key is where it starts in the text.
  let at = 0;
  const parts = body.split(pattern).map((text) => {
    const part = { text, key: `${at}` };
    at += text.length;
    return part;
  });
  return parts.map(({ text: part, key }) => {
    const token = known.find((item) => item.text === part);
    if (!token) return <Fragment key={key}>{part}</Fragment>;
    const style = isOwn ? undefined : { color: token.color };
    const className = cn("rounded px-0.5 font-semibold", isOwn ? "bg-white/20 text-on-color" : "bg-layer-2");
    return token.href ? (
      <Link key={key} href={token.href} className={cn(className, "underline-offset-2 hover:underline")} style={style}>
        {part}
      </Link>
    ) : (
      <span key={key} className={className} style={style}>
        {part}
      </span>
    );
  });
};

type MessageProps = {
  message: THubMessage;
  isOwn: boolean;
  isReply?: boolean;
  /** The previous message is by the same person a moment earlier: no repeated name and picture. */
  isFollowUp?: boolean;
  tokens: TToken[];
  onReply: (message: THubMessage) => void;
  onEdit: (message: THubMessage, body: string) => Promise<void>;
  onDelete: (message: THubMessage) => Promise<void>;
  onOpenFile: (fileId: string) => Promise<void>;
};

const actionClass =
  "inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-caption-sm-medium text-tertiary hover:bg-layer-1 hover:text-primary";

function Message({ message, isOwn, isReply, isFollowUp, tokens, onReply, onEdit, onDelete, onOpenFile }: MessageProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);

  if (message.is_deleted) {
    return (
      <p
        className={cn(
          "px-4 py-1 text-body-xs-regular text-tertiary italic",
          isOwn ? "text-right" : "pl-14",
          isReply && (isOwn ? "pr-8" : "pl-20")
        )}
      >
        Message deleted
      </p>
    );
  }

  const isAttention = message.kind === "ATTENTION";

  return (
    <article
      className={cn(
        "group flex gap-2 px-3",
        isOwn ? "flex-row-reverse" : "flex-row",
        isFollowUp ? "pt-0.5" : "pt-3",
        isReply && (isOwn ? "pr-8" : "pl-8")
      )}
    >
      {!isOwn ? (
        isFollowUp ? (
          <span className="w-8 shrink-0" />
        ) : (
          <PersonAvatar person={message.author} className="mt-5" />
        )
      ) : null}
      <div className={cn("flex max-w-[min(85%,40rem)] min-w-0 flex-col gap-1", isOwn ? "items-end" : "items-start")}>
        {!isFollowUp ? (
          <header className={cn("flex flex-wrap items-baseline gap-2 px-1", isOwn && "flex-row-reverse")}>
            <span
              className="text-body-xs-semibold"
              style={{ color: isOwn ? undefined : personColor(message.author.id) }}
            >
              {isOwn ? "You" : message.author.display_name}
            </span>
            <time className="text-caption-sm-regular text-tertiary" dateTime={message.created_at}>
              {timeFormat.format(new Date(message.created_at))}
            </time>
            {message.edited_at ? <span className="text-caption-sm-regular text-tertiary">edited</span> : null}
            {isAttention ? <Badge variant="warning" size="sm" label="Needs attention" /> : null}
          </header>
        ) : null}

        {isEditing ? (
          <div className="flex w-[min(80vw,32rem)] flex-col gap-2">
            <TextAreaField
              size="lg"
              label="Edit message"
              value={draft}
              rows={3}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && draft.trim()) {
                  event.preventDefault();
                  void onEdit(message, draft).then(() => setIsEditing(false));
                } else if (event.key === "Escape") {
                  setIsEditing(false);
                }
              }}
            />
            <div className="flex gap-2">
              <Button
                variant="primary"
                size="md"
                stretch="auto"
                label="Save"
                disabled={!draft.trim()}
                onClick={async () => {
                  await onEdit(message, draft);
                  setIsEditing(false);
                }}
              />
              <Button variant="secondary" size="md" stretch="auto" label="Cancel" onClick={() => setIsEditing(false)} />
            </div>
          </div>
        ) : message.body ? (
          <div
            className={cn(
              "rounded-2xl px-3.5 py-2 text-body-sm-regular break-words whitespace-pre-wrap",
              isOwn ? "rounded-tr-md bg-accent-primary text-on-color" : "rounded-tl-md bg-layer-1 text-primary",
              isAttention && "border-2 border-warning-strong",
              message.mentions_me && !isOwn && "ring-2 ring-accent-strong"
            )}
          >
            {renderBody(message.body, tokens, isOwn)}
          </div>
        ) : null}

        {message.attachments.length > 0 ? (
          <ul className={cn("flex flex-col gap-1.5", isOwn ? "items-end" : "items-start")}>
            {message.attachments.map((file) => {
              const kind = fileKind(file.name);
              return (
                <li key={file.id}>
                  <button
                    type="button"
                    className="flex max-w-[min(80vw,22rem)] min-w-0 items-center gap-3 rounded-xl border border-subtle bg-surface-1 py-2 pr-4 pl-2 text-left hover:bg-layer-1"
                    style={{ borderLeft: `3px solid ${kind.color}` }}
                    onClick={() =>
                      onOpenFile(file.id).catch((error) =>
                        setToast({ type: "error", title: "Could not open the file", message: getErrorMessage(error) })
                      )
                    }
                  >
                    <FileTypeIcon name={file.name} />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-body-xs-medium text-primary">{file.name}</span>
                      <span className="text-caption-sm-regular text-tertiary">
                        {fileExtension(file.name) || kind.label} · {formatSize(file.size)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}

        <footer
          className={cn(
            "flex gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100",
            isOwn && "flex-row-reverse"
          )}
        >
          <button type="button" className={actionClass} onClick={() => onReply(message)}>
            <CornerUpLeft className="size-3.5" aria-hidden />
            Reply
          </button>
          {isOwn ? (
            <>
              <button type="button" className={actionClass} onClick={() => setIsEditing(true)}>
                <Pencil className="size-3.5" aria-hidden />
                Edit
              </button>
              <button
                type="button"
                className={cn(actionClass, "hover:text-danger-primary")}
                onClick={() => onDelete(message)}
              >
                <Trash2 className="size-3.5" aria-hidden />
                Delete
              </button>
            </>
          ) : null}
        </footer>
      </div>
    </article>
  );
}

type TOption =
  | { kind: "person"; id: string; label: string; person: THubPerson }
  | { kind: "team"; id: string; label: string }
  | { kind: "everyone"; id: string; label: string }
  | { kind: "project"; id: string; label: string; identifier: string };

type TMenu = { trigger: "@" | "/"; start: number; query: string };

/** The "@" or "/" being typed just before the caret, with what follows it, or `null`. */
const findTrigger = (text: string, caret: number): TMenu | null => {
  const before = text.slice(0, caret);
  const at = Math.max(before.lastIndexOf("@"), before.lastIndexOf("/"));
  if (at < 0) return null;
  const query = before.slice(at + 1);
  const boundary = at === 0 || /\s/.test(before[at - 1]);
  if (!boundary || query.length > 30 || /\n/.test(query) || (query.match(/ /g)?.length ?? 0) > 1) return null;
  return { trigger: before[at] as "@" | "/", start: at, query };
};

type Props = { workspaceSlug: string; channel: THubChannel; onRead: () => void };

export const ChannelView = observer(function ChannelView({ workspaceSlug, channel, onRead }: Props) {
  // states
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [tagged, setTagged] = useState<THubPerson[]>([]);
  const [taggedTeams, setTaggedTeams] = useState<{ id: string; name: string }[]>([]);
  const [replyTo, setReplyTo] = useState<THubMessage | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [fileError, setFileError] = useState("");
  const [menu, setMenu] = useState<TMenu | null>(null);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLDivElement>(null);
  // hooks
  const { data: currentUser } = useUser();
  const { teams } = useOpsTeams(workspaceSlug);
  const { joinedProjectIds, getPartialProjectById } = useProject();
  const hub = useHubChannel(workspaceSlug, channel.id, onRead);

  // Replies sit under their root message, one level deep.
  const threads = useMemo(() => {
    const roots = (hub.messages ?? []).filter((message) => !message.parent);
    const replies = (hub.messages ?? []).filter((message) => message.parent);
    return roots.map((root) => ({ root, replies: replies.filter((reply) => reply.parent === root.id) }));
  }, [hub.messages]);

  // Scrolling: the newest message stays in view while reading the end; reading older ones is not disturbed.
  const scroller = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const olderAnchor = useRef<{ height: number; top: number } | null>(null);
  const lastMessage = hub.messages?.[hub.messages.length - 1];
  const firstId = hub.messages?.[0]?.id;

  useEffect(() => {
    nearBottom.current = true;
  }, [channel.id]);

  useEffect(() => {
    if (!lastMessage) return;
    if (nearBottom.current || lastMessage.author.id === currentUser?.id)
      bottom.current?.scrollIntoView?.({ block: "end" });
  }, [lastMessage, channel.id, currentUser?.id]);

  // After an older page is added above, keep the same message under the reader's eyes.
  useLayoutEffect(() => {
    const box = scroller.current;
    const anchor = olderAnchor.current;
    if (!box || !anchor) return;
    box.scrollTop = box.scrollHeight - anchor.height + anchor.top;
    olderAnchor.current = null;
  }, [firstId]);

  // Older messages load when the reader scrolls near the top, one page at a time.
  const loadOlderIfAtTop = (box: HTMLDivElement) => {
    if (box.scrollTop > 200 || !hub.hasMore || hub.isLoadingOlder || olderAnchor.current) return;
    olderAnchor.current = { height: box.scrollHeight, top: box.scrollTop };
    void hub
      .loadOlder()
      .then((added) => {
        if (!added) olderAnchor.current = null;
        return added;
      })
      .catch(() => {
        olderAnchor.current = null;
      });
  };

  const people = (hub.channel?.members ?? []).filter((person) => person.id !== currentUser?.id);
  const projects = joinedProjectIds
    .map((id) => getPartialProjectById(id))
    .filter((project): project is NonNullable<typeof project> => !!project);

  // People, teams and projects that are picked out in message text.
  const sharedTokens: TToken[] = [
    { text: "@everyone", color: "var(--background-color-accent-primary)" },
    ...(teams ?? []).map((team) => ({ text: `@${team.name}`, color: "var(--background-color-accent-primary)" })),
    ...projects.map((project) => ({
      text: `/${project.identifier}`,
      color: "#0d9488",
      href: `/${workspaceSlug}/projects/${project.id}/issues/`,
    })),
  ];
  const tokensFor = (message: THubMessage): TToken[] => [
    ...message.mentions.map((person) => ({ text: `@${person.display_name}`, color: personColor(person.id) })),
    ...sharedTokens,
  ];

  const options: TOption[] = (() => {
    if (!menu) return [];
    const query = menu.query.toLowerCase();
    if (menu.trigger === "/") {
      return projects
        .filter(
          (project) => project.name.toLowerCase().includes(query) || project.identifier.toLowerCase().includes(query)
        )
        .slice(0, 8)
        .map((project) => ({ kind: "project", id: project.id, label: project.name, identifier: project.identifier }));
    }
    const matchingPeople: TOption[] = people
      .filter((person) => person.display_name.toLowerCase().includes(query))
      .map((person) => ({ kind: "person", id: person.id, label: person.display_name, person }));
    const matchingTeams: TOption[] = (teams ?? [])
      .filter((team) => team.name.toLowerCase().includes(query))
      .map((team) => ({ kind: "team", id: team.id, label: team.name }));
    // "@everyone" tags the whole channel; it is found by typing "every" or "all".
    const everyone: TOption[] =
      query === "" || "everyone".startsWith(query) || "all".startsWith(query)
        ? [{ kind: "everyone", id: "everyone", label: "everyone" }]
        : [];
    return [...everyone, ...matchingPeople, ...matchingTeams].slice(0, 8);
  })();

  const textarea = () => composer.current?.querySelector("textarea") ?? null;

  const watchCaret = (text: string, caret: number) => {
    const next = findTrigger(text, caret);
    setMenu(next);
    if (next?.query !== menu?.query || next?.trigger !== menu?.trigger) setActive(0);
  };

  const choose = (option: TOption) => {
    if (!menu) return;
    const field = textarea();
    const caret = field?.selectionStart ?? body.length;
    const inserted = option.kind === "project" ? `/${option.identifier} ` : `@${option.label} `;
    const next = body.slice(0, menu.start) + inserted + body.slice(caret);
    setBody(next);
    setMenu(null);
    if (option.kind === "person" && !tagged.some((item) => item.id === option.id))
      setTagged((current) => [...current, option.person]);
    if (option.kind === "team" && !taggedTeams.some((item) => item.id === option.id))
      setTaggedTeams((current) => [...current, { id: option.id, name: option.label }]);
    const position = menu.start + inserted.length;
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(position, position);
    });
  };

  // The "@" and "/" buttons type the sign for people on phones, where it is hard to reach.
  const openMenu = (trigger: "@" | "/") => {
    const field = textarea();
    const caret = field?.selectionStart ?? body.length;
    const needsSpace = caret > 0 && !/\s/.test(body[caret - 1]);
    const inserted = `${needsSpace ? " " : ""}${trigger}`;
    const next = body.slice(0, caret) + inserted + body.slice(caret);
    setBody(next);
    setMenu({ trigger, start: caret + inserted.length - 1, query: "" });
    setActive(0);
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(caret + inserted.length, caret + inserted.length);
    });
  };

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next = [...files, ...Array.from(list)];
    const problem = fileLimitError(next);
    if (problem) return setFileError(problem);
    setFileError("");
    setFiles(next);
    if (input.current) input.current.value = "";
  };

  const send = async () => {
    if (!body.trim() && files.length === 0) return;
    setIsSending(true);
    try {
      await hub.send({
        body,
        parent: replyTo?.id ?? null,
        // Only the tags still written in the text count: a removed "@name" is not a tag any more.
        users: tagged.filter((person) => body.includes(`@${person.display_name}`)).map((person) => person.id),
        teams: taggedTeams.filter((team) => body.includes(`@${team.name}`)).map((team) => team.id),
        files,
      });
      setBody("");
      setFiles([]);
      setTagged([]);
      setTaggedTeams([]);
      setReplyTo(null);
      setMenu(null);
    } catch (error) {
      setToast({ type: "error", title: "Could not send", message: getErrorMessage(error) });
    } finally {
      setIsSending(false);
    }
  };

  const guard = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      setToast({ type: "error", title: "Something went wrong", message: getErrorMessage(error) });
    }
  };

  const shared = {
    onReply: setReplyTo,
    onEdit: (message: THubMessage, text: string) => guard(() => hub.edit(message.id, text)),
    onDelete: (message: THubMessage) => guard(() => hub.remove(message.id)),
    onOpenFile: hub.openFile,
  };

  // A day line above the first message of each day.
  const followsUp = (previous: THubMessage | undefined, message: THubMessage) =>
    !!previous &&
    previous.author.id === message.author.id &&
    !previous.is_deleted &&
    dayOf(previous.created_at) === dayOf(message.created_at) &&
    new Date(message.created_at).getTime() - new Date(previous.created_at).getTime() < 5 * 60 * 1000;

  const menuOpen = !!menu && options.length > 0;
  const iconButton =
    "inline-flex size-10 shrink-0 items-center justify-center rounded-full text-secondary hover:bg-layer-1 hover:text-primary";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-subtle px-4 py-3">
        <h2 className="text-body-md-medium text-primary">
          <span className="text-accent-primary">{KIND_LABEL[channel.kind]}</span> · {channel.name}
        </h2>
        <p className="text-caption-sm-regular text-tertiary">
          {hub.channel ? `${hub.channel.members.length} people can read this channel` : "Loading..."}
        </p>
      </header>

      <div
        ref={scroller}
        onScroll={(event) => {
          const box = event.currentTarget;
          nearBottom.current = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
          loadOlderIfAtTop(box);
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3"
        aria-live="polite"
      >
        {hub.hasMore ? (
          <p className="py-2 text-center text-caption-sm-regular text-tertiary">
            {hub.isLoadingOlder ? "Loading older messages..." : "Scroll up for older messages"}
          </p>
        ) : null}
        {hub.isLoading ? <p className="px-4 py-2 text-body-sm-regular text-tertiary">Loading messages...</p> : null}
        {!hub.isLoading && threads.length === 0 ? (
          <p className="px-4 py-6 text-center text-body-sm-regular text-tertiary">
            No messages yet. Say hello, type @ to tag a colleague, / for a project, or share a file.
          </p>
        ) : null}
        {threads.map(({ root, replies }, index) => {
          const previousRoot = index > 0 ? threads[index - 1] : undefined;
          const previous = previousRoot
            ? (previousRoot.replies[previousRoot.replies.length - 1] ?? previousRoot.root)
            : undefined;
          const newDay = !previous || dayOf(previous.created_at) !== dayOf(root.created_at);
          return (
            <div key={root.id}>
              {newDay ? (
                <div className="sticky top-0 z-[1] flex justify-center py-2">
                  <span className="rounded-full border border-subtle bg-surface-1 px-3 py-0.5 text-caption-sm-medium text-secondary shadow-raised-100">
                    {dayFormat.format(new Date(root.created_at))}
                  </span>
                </div>
              ) : null}
              <Message
                message={root}
                isOwn={root.author.id === currentUser?.id}
                isFollowUp={!newDay && !previousRoot?.replies.length && followsUp(previous, root)}
                tokens={tokensFor(root)}
                {...shared}
              />
              {replies.map((reply, replyIndex) => (
                <Message
                  key={reply.id}
                  message={reply}
                  isReply
                  isOwn={reply.author.id === currentUser?.id}
                  isFollowUp={replyIndex > 0 && followsUp(replies[replyIndex - 1], reply)}
                  tokens={tokensFor(reply)}
                  {...shared}
                />
              ))}
            </div>
          );
        })}
        <div ref={bottom} />
      </div>

      {!channel.can_post ? (
        <p className="border-t border-subtle p-3 text-body-xs-regular text-tertiary">
          Only admins can write here. Everyone can read.
        </p>
      ) : (
        <footer className="flex flex-col gap-2 border-t border-subtle p-2 sm:p-3">
          {replyTo ? (
            <p className="flex items-center justify-between gap-2 rounded-md border-l-2 border-accent-strong bg-layer-1 px-3 py-1.5 text-body-xs-regular text-secondary">
              <span className="truncate">
                Replying to{" "}
                <strong style={{ color: personColor(replyTo.author.id) }}>{replyTo.author.display_name}</strong>
                {replyTo.body ? `: ${replyTo.body.slice(0, 80)}` : ""}
              </span>
              <button
                type="button"
                className="min-h-8 px-2 text-accent-primary hover:underline"
                onClick={() => setReplyTo(null)}
              >
                Cancel
              </button>
            </p>
          ) : null}

          {tagged.length > 0 || taggedTeams.length > 0 || files.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {tagged.map((person) => (
                <li key={person.id}>
                  <button
                    type="button"
                    className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-layer-1 py-0.5 pr-2.5 pl-1 text-caption-sm-medium"
                    style={{ color: personColor(person.id) }}
                    onClick={() => setTagged((current) => current.filter((item) => item.id !== person.id))}
                    aria-label={`Remove tag ${person.display_name}`}
                  >
                    <PersonAvatar person={person} size="sm" />@{person.display_name} ×
                  </button>
                </li>
              ))}
              {taggedTeams.map((team) => (
                <li key={team.id}>
                  <button
                    type="button"
                    className="inline-flex min-h-8 items-center gap-1 rounded-full bg-accent-subtle px-2.5 py-0.5 text-caption-sm-medium text-accent-primary"
                    onClick={() => setTaggedTeams((current) => current.filter((item) => item.id !== team.id))}
                    aria-label={`Remove tag ${team.name}`}
                  >
                    <Users className="size-3.5" aria-hidden />@{team.name} ×
                  </button>
                </li>
              ))}
              {files.map((file, index) => (
                <li key={`${file.name}-${file.size}-${file.lastModified}`}>
                  <button
                    type="button"
                    className="inline-flex min-h-8 max-w-64 items-center gap-1.5 rounded-full bg-layer-1 py-0.5 pr-2.5 pl-0.5 text-caption-sm-medium text-secondary"
                    onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                    aria-label={`Remove file ${file.name}`}
                  >
                    <FileTypeIcon name={file.name} className="size-7 rounded-full" />
                    <span className="truncate">{file.name}</span> ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <div ref={composer} className="relative">
            {menuOpen ? (
              <ul
                role="listbox"
                aria-label={menu?.trigger === "/" ? "Projects" : "People and teams"}
                className="absolute right-0 bottom-full left-0 z-20 mb-2 max-h-72 overflow-y-auto rounded-lg border border-subtle bg-surface-1 p-1 shadow-raised-200"
              >
                <li className="px-3 pt-1 pb-1.5 text-caption-sm-medium text-tertiary">
                  {menu?.trigger === "/" ? "Mention a project" : "Tag a person, a team or everyone"}
                </li>
                {options.map((option, index) => (
                  <li key={`${option.kind}-${option.id}`} role="option" aria-selected={index === active}>
                    <button
                      type="button"
                      // Keep the focus in the text box while choosing.
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => choose(option)}
                      onMouseEnter={() => setActive(index)}
                      className={cn(
                        "flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-1.5 text-left",
                        index === active ? "bg-layer-1" : ""
                      )}
                    >
                      {option.kind === "person" ? <PersonAvatar person={option.person} size="sm" /> : null}
                      {option.kind === "team" || option.kind === "everyone" ? (
                        <span className="inline-flex size-6 items-center justify-center rounded-full bg-accent-subtle text-accent-primary">
                          <Users className="size-3.5" aria-hidden />
                        </span>
                      ) : null}
                      {option.kind === "project" ? (
                        <span
                          className="inline-flex size-6 items-center justify-center rounded-md text-white"
                          style={{ backgroundColor: "#0d9488" }}
                        >
                          <FolderKanban className="size-3.5" aria-hidden />
                        </span>
                      ) : null}
                      <span className="min-w-0 flex-1 truncate text-body-sm-medium text-primary">{option.label}</span>
                      <span className="text-caption-sm-regular text-tertiary">
                        {option.kind === "project"
                          ? `/${option.identifier}`
                          : option.kind === "team"
                            ? "Team"
                            : option.kind === "everyone"
                              ? `Everyone in this channel (${(hub.channel?.members ?? []).length})`
                              : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <TextAreaField
              size="lg"
              label="Message"
              value={body}
              rows={2}
              maxLength={5000}
              placeholder="Write a message. @ tags a person, a team or @everyone, / a project. Enter sends, Shift+Enter for a new line."
              onChange={(event) => {
                setBody(event.target.value);
                watchCaret(event.target.value, event.target.selectionStart ?? event.target.value.length);
              }}
              onClick={(event) => watchCaret(body, event.currentTarget.selectionStart ?? body.length)}
              onBlur={() => setMenu(null)}
              onKeyDown={(event) => {
                if (menuOpen) {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    const step = event.key === "ArrowDown" ? 1 : -1;
                    setActive((current) => (current + step + options.length) % options.length);
                    return;
                  }
                  if ((event.key === "Enter" || event.key === "Tab") && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    choose(options[Math.min(active, options.length - 1)]);
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setMenu(null);
                    return;
                  }
                }
                // Enter sends, Shift+Enter starts a new line. Not while a word is still being composed (IME).
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  if (!isSending) void send();
                }
              }}
            />
          </div>

          <div className="flex items-center gap-1">
            <input
              ref={input}
              id="hub-files"
              type="file"
              multiple
              accept={FILE_ACCEPT}
              className="sr-only"
              onChange={(event) => addFiles(event.target.files)}
            />
            <label htmlFor="hub-files" className={cn(iconButton, "cursor-pointer")} title="Attach files">
              <Paperclip className="size-5" aria-hidden />
              <span className="sr-only">Attach files</span>
            </label>
            <button type="button" className={iconButton} title="Tag a person or team" onClick={() => openMenu("@")}>
              <AtSign className="size-5" aria-hidden />
              <span className="sr-only">Tag a person or team</span>
            </button>
            <button type="button" className={iconButton} title="Mention a project" onClick={() => openMenu("/")}>
              <FolderKanban className="size-5" aria-hidden />
              <span className="sr-only">Mention a project</span>
            </button>
            <span className="hidden text-caption-sm-regular text-tertiary md:inline">
              Files open through a private link that works for 5 minutes.
            </span>
            <button
              type="button"
              onClick={() => void send()}
              disabled={isSending || (!body.trim() && files.length === 0)}
              className="ml-auto inline-flex h-10 items-center gap-2 rounded-full bg-accent-primary px-4 text-body-sm-medium text-on-color disabled:opacity-50"
            >
              <SendHorizontal className="size-4" aria-hidden />
              {isSending ? "Sending..." : "Send"}
            </button>
          </div>
          {fileError ? (
            <p role="alert" className="text-body-xs-regular text-danger-primary">
              {fileError}
            </p>
          ) : null}
        </footer>
      )}
    </div>
  );
});
