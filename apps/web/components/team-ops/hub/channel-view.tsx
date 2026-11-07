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
import {
  ArrowUp,
  AtSign,
  ChevronLeft,
  ChevronRight,
  CornerUpLeft,
  FolderKanban,
  Paperclip,
  Pencil,
  Plus,
  Trash2,
  Users,
  X,
} from "lucide-react";
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

// Messages less than this far apart sit together without a time line between them.
// How long a new message takes to slide into view; the end of the list is not re-pinned meanwhile.
const SMOOTH_MS = 450;
const GAP_MS = 60 * 60 * 1000;
// Within a group, a new bubble from the same person this soon has no tail and no name above it.
const GROUP_MS = 5 * 60 * 1000;

const stamp = (value: string) => {
  const date = new Date(value);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  const day = date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return new Date().toDateString() === date.toDateString() ? `Today at ${time}` : `${day} at ${time}`;
};
const clock = (value: string) => new Date(value).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** One to three emojis and nothing else: shown large, without a bubble. */
const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*\s*){1,3}$/u;
const isEmojiOnly = (text: string) => !!text.trim() && EMOJI_ONLY.test(text.trim());
// Persian, Arabic and Hebrew text reads right to left inside its bubble.
const RTL = /[֐-ࣿיִ-ﻼ]/;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type TToken = { text: string; color?: string; href?: string };

/** The message text with tagged people, teams and projects picked out (projects are links). */
const renderBody = (body: string, tokens: TToken[], isOwn: boolean): ReactNode => {
  // Longest first, so "@Ann Lee" wins over "@Ann".
  const known = sortBy(
    tokens.filter((token) => token.text.length > 1),
    (token) => -token.text.length
  );
  if (known.length === 0) return body;
  const pattern = new RegExp(`(${known.map((token) => escape(token.text)).join("|")})`, "g");
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
    const className = cn("font-semibold", isOwn ? "text-white underline decoration-white/40" : "");
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

// The bubble colours: mine blue, theirs a soft grey that works in light and dark themes.
const MINE = "bg-[#0a84ff] text-white";
const THEIRS = "bg-[color-mix(in_oklab,var(--text-color-primary)_10%,var(--background-color-surface-1))] text-primary";

/** The little curl at the bottom corner of the last bubble in a group, like a messenger's. */
function Tail({ isOwn }: { isOwn: boolean }) {
  return (
    <span
      aria-hidden
      className={cn("absolute bottom-0 h-4 w-3", isOwn ? "-right-1.5" : "-left-1.5")}
      style={{
        backgroundColor: isOwn
          ? "#0a84ff"
          : "color-mix(in oklab, var(--text-color-primary) 10%, var(--background-color-surface-1))",
        clipPath: isOwn
          ? "path('M0 0 C 0 8, 4 14, 12 16 C 6 16, 2 15, 0 13 Z')"
          : "path('M12 0 C 12 8, 8 14, 0 16 C 6 16, 10 15, 12 13 Z')",
      }}
    />
  );
}

type MessageProps = {
  message: THubMessage;
  isOwn: boolean;
  /** Group chats show the sender's name above their first bubble and picture beside the last one. */
  showName: boolean;
  showAvatar: boolean;
  isGroupChat: boolean;
  /** Last bubble of a run from the same person: it gets the tail. */
  isLast: boolean;
  parent?: THubMessage;
  replyCount: number;
  tokens: TToken[];
  onReply: (message: THubMessage) => void;
  onOpenThread: (rootId: string) => void;
  onEdit: (message: THubMessage, body: string) => Promise<void>;
  onDelete: (message: THubMessage) => Promise<void>;
  onOpenFile: (fileId: string) => Promise<void>;
};

const actionClass =
  "inline-flex min-h-8 items-center gap-1 rounded-full px-2.5 text-caption-sm-medium text-secondary hover:bg-layer-1 hover:text-primary";

function Message(props: MessageProps) {
  const { message, isOwn, showName, showAvatar, isGroupChat, isLast, parent, replyCount, tokens } = props;
  const { onReply, onOpenThread, onEdit, onDelete, onOpenFile } = props;
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);
  // On a phone the Reply / Edit / Delete row shows only for the message that was tapped.
  const [showActions, setShowActions] = useState(false);

  if (message.is_deleted) {
    return (
      <p className={cn("px-4 py-0.5 text-caption-sm-regular text-tertiary italic", isOwn ? "text-right" : "text-left")}>
        Message deleted
      </p>
    );
  }

  const emojiOnly = !message.attachments.length && isEmojiOnly(message.body);
  const isAttention = message.kind === "ATTENTION";
  const rtl = RTL.test(message.body);
  const rootId = message.parent ?? message.id;

  return (
    <article
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button, a, textarea, input")) return;
        setShowActions((open) => !open);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setShowActions(false);
      }}
      title={stamp(message.created_at)}
      className={cn(
        "group flex items-end gap-2 px-3",
        isOwn ? "flex-row-reverse" : "flex-row",
        isLast ? "pb-1.5" : "pb-0.5"
      )}
    >
      {!isOwn && isGroupChat ? (
        showAvatar ? (
          <PersonAvatar person={message.author} size="sm" className="mb-0.5" />
        ) : (
          <span className="w-6 shrink-0" />
        )
      ) : null}
      <div className={cn("flex max-w-[min(78%,36rem)] min-w-0 flex-col", isOwn ? "items-end" : "items-start")}>
        {showName && !isOwn ? (
          <span className="mb-0.5 px-3 text-caption-sm-medium" style={{ color: personColor(message.author.id) }}>
            {message.author.display_name}
          </span>
        ) : null}

        {/* A reply shows the message it answers, small and outlined, joined to it by a curved line. */}
        {parent ? (
          <button
            type="button"
            onClick={() => onOpenThread(rootId)}
            className={cn("flex max-w-full flex-col", isOwn ? "items-end" : "items-start")}
          >
            <span
              className={cn(
                "line-clamp-2 max-w-full rounded-2xl border px-3 py-1 text-left text-caption-sm-regular",
                isOwn ? "border-[#0a84ff]/60 text-[#0a84ff]" : "border-subtle text-secondary"
              )}
              dir={RTL.test(parent.body) ? "rtl" : undefined}
            >
              {parent.is_deleted ? "Message deleted" : parent.body || "A file"}
            </span>
            <span
              aria-hidden
              className={cn(
                "h-3 w-3 border-subtle",
                isOwn ? "mr-5 rounded-tr-xl border-t-2 border-r-2" : "ml-5 rounded-tl-xl border-t-2 border-l-2"
              )}
            />
          </button>
        ) : null}

        {isEditing ? (
          <div className="flex w-[min(80vw,30rem)] flex-col gap-2 rounded-2xl border border-subtle bg-surface-1 p-2">
            <textarea
              value={draft}
              rows={3}
              aria-label="Edit message"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && draft.trim()) {
                  event.preventDefault();
                  void onEdit(message, draft).then(() => setIsEditing(false));
                } else if (event.key === "Escape") {
                  setIsEditing(false);
                }
              }}
              className="resize-none rounded-xl bg-layer-1 px-3 py-2 text-body-sm-regular text-primary outline-none"
            />
            <div className="flex justify-end gap-2">
              <button type="button" className={actionClass} onClick={() => setIsEditing(false)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={!draft.trim()}
                onClick={() => void onEdit(message, draft).then(() => setIsEditing(false))}
                className="inline-flex min-h-8 items-center rounded-full bg-[#0a84ff] px-3 text-caption-sm-medium text-white disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        ) : emojiOnly ? (
          <span className="px-1 text-[44px] leading-tight select-text" aria-label={message.body}>
            {message.body.trim()}
          </span>
        ) : message.body ? (
          <div
            dir={rtl ? "rtl" : undefined}
            className={cn(
              "relative rounded-[20px] px-3.5 py-2 text-body-md-regular leading-snug break-words whitespace-pre-wrap",
              isOwn ? MINE : THEIRS,
              isAttention && "ring-2 ring-warning-strong",
              message.mentions_me && !isOwn && "ring-2 ring-[#0a84ff]/70"
            )}
          >
            {renderBody(message.body, tokens, isOwn)}
            {isLast ? <Tail isOwn={isOwn} /> : null}
          </div>
        ) : null}

        {message.attachments.length > 0 ? (
          <ul className={cn("mt-1 flex flex-col gap-1", isOwn ? "items-end" : "items-start")}>
            {message.attachments.map((file) => {
              const kind = fileKind(file.name);
              return (
                <li key={file.id}>
                  <button
                    type="button"
                    className="flex max-w-[min(75vw,20rem)] min-w-0 items-center gap-3 rounded-2xl border border-subtle bg-surface-1 py-2 pr-4 pl-2 text-left hover:bg-layer-1"
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

        {isAttention || message.edited_at ? (
          <span className="mt-0.5 px-2 text-[11px] text-tertiary">
            {isAttention ? <span className="text-warning-primary">Needs attention</span> : null}
            {isAttention && message.edited_at ? " · " : null}
            {message.edited_at ? "Edited" : null}
          </span>
        ) : null}

        {replyCount > 0 ? (
          <button
            type="button"
            onClick={() => onOpenThread(message.id)}
            className="mt-0.5 px-2 text-caption-sm-medium text-[#0a84ff] hover:underline"
          >
            {replyCount} {replyCount === 1 ? "Reply" : "Replies"}
          </button>
        ) : null}

        <footer
          className={cn(
            // Touch: hidden until the message is tapped. Mouse: appears on hover.
            showActions ? "flex" : "hidden",
            "mt-0.5 items-center gap-0.5 transition-opacity [@media(hover:hover)]:flex [@media(hover:hover)]:opacity-0",
            "[@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100",
            isOwn && "flex-row-reverse"
          )}
        >
          <span className="px-1.5 text-[11px] text-tertiary">{clock(message.created_at)}</span>
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

type Props = { workspaceSlug: string; channel: THubChannel; onRead: () => void; onBack?: () => void };

export const ChannelView = observer(function ChannelView({ workspaceSlug, channel, onRead, onBack }: Props) {
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
  const [plusOpen, setPlusOpen] = useState(false);
  const [thread, setThread] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLDivElement>(null);
  // hooks
  const { data: currentUser } = useUser();
  const { teams } = useOpsTeams(workspaceSlug);
  const { joinedProjectIds, getPartialProjectById } = useProject();
  const hub = useHubChannel(workspaceSlug, channel.id, onRead);

  const isGroupChat = channel.kind !== "DM";
  const members = hub.channel?.members ?? [];
  const other = channel.kind === "DM" ? members.find((person) => person.id !== currentUser?.id) : undefined;

  // Every message in time order; replies show the message they answer. A thread shows one conversation.
  const byId = useMemo(() => new Map((hub.messages ?? []).map((message) => [message.id, message])), [hub.messages]);
  const replyCounts = useMemo(() => {
    const counts = new Map<string, number>();
    (hub.messages ?? []).forEach((message) => {
      if (message.parent && !message.is_deleted) counts.set(message.parent, (counts.get(message.parent) ?? 0) + 1);
    });
    return counts;
  }, [hub.messages]);
  const shown = useMemo(
    () => (hub.messages ?? []).filter((message) => !thread || message.id === thread || message.parent === thread),
    [hub.messages, thread]
  );

  // Scrolling: the newest message stays in view while reading the end; reading older ones is not disturbed.
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const olderAnchor = useRef<{ height: number; top: number } | null>(null);
  const lastMessage = hub.messages?.[hub.messages.length - 1];
  const firstId = hub.messages?.[0]?.id;

  useEffect(() => {
    nearBottom.current = true;
  }, [channel.id, thread]);

  // A message that arrives while the channel is open slides into view; opening a channel jumps to the end.
  const seen = useRef<{ channel: string; id: string } | null>(null);
  const smoothUntil = useRef(0);
  useEffect(() => {
    if (!lastMessage) return;
    const arrived = seen.current?.channel === channel.id && seen.current.id !== lastMessage.id;
    seen.current = { channel: channel.id, id: lastMessage.id };
    if (nearBottom.current || lastMessage.author.id === currentUser?.id) {
      if (arrived) smoothUntil.current = Date.now() + SMOOTH_MS;
      bottom.current?.scrollIntoView?.({ block: "end", behavior: arrived ? "smooth" : "auto" });
    }
  }, [lastMessage, channel.id, currentUser?.id, thread]);

  // Avatars and pictures load after the messages: keep the end in view while the reader is at the end.
  useEffect(() => {
    const box = scroller.current;
    const inner = content.current;
    if (!box || !inner || typeof ResizeObserver === "undefined") return;
    const keep = new ResizeObserver(() => {
      // While a message is sliding in, the slide is the scroll: jumping now would cut it short.
      if (nearBottom.current && !olderAnchor.current && Date.now() > smoothUntil.current)
        box.scrollTop = box.scrollHeight;
    });
    keep.observe(inner);
    return () => keep.disconnect();
  }, [channel.id, hub.isLoading]);

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
    if (thread || box.scrollTop > 200 || !hub.hasMore || hub.isLoadingOlder || olderAnchor.current) return;
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

  const people = members.filter((person) => person.id !== currentUser?.id);
  const projects = joinedProjectIds
    .map((id) => getPartialProjectById(id))
    .filter((project): project is NonNullable<typeof project> => !!project);

  // People, teams and projects that are picked out in message text.
  const sharedTokens: TToken[] = [
    { text: "@everyone", color: "#0a84ff" },
    ...(teams ?? []).map((team) => ({ text: `@${team.name}`, color: "#0a84ff" })),
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

  // The text box grows with what is typed, up to about five lines.
  useLayoutEffect(() => {
    const field = textarea();
    if (!field) return;
    field.style.height = "auto";
    // Not measured yet (the chat is still hidden): leave it at its natural one-line height.
    if (field.scrollHeight > 0) field.style.height = `${Math.min(field.scrollHeight, 132)}px`;
  }, [body]);

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

  // The "+" menu types "@" or "/" for people on phones, where they are hard to reach.
  const openMenu = (trigger: "@" | "/") => {
    setPlusOpen(false);
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
        // Inside a thread every message answers it.
        parent: replyTo?.id ?? thread ?? null,
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
    onReply: (message: THubMessage) => {
      // Replies always hang on the first message of a conversation, one level deep.
      setReplyTo(message.parent ? (byId.get(message.parent) ?? message) : message);
      requestAnimationFrame(() => textarea()?.focus());
    },
    onOpenThread: setThread,
    onEdit: (message: THubMessage, text: string) => guard(() => hub.edit(message.id, text)),
    onDelete: (message: THubMessage) => guard(() => hub.remove(message.id)),
    onOpenFile: hub.openFile,
  };

  const menuOpen = !!menu && options.length > 0;
  const canSend = !isSending && (!!body.trim() || files.length > 0);
  const threadRoot = thread ? byId.get(thread) : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-1">
      {/* Header: back, then the round picture and the name in a pill, centred. */}
      <header className="relative flex flex-col items-center gap-1 border-b border-subtle px-12 pt-2 pb-2">
        {onBack ? (
          <button
            type="button"
            aria-label="Back to the Hub"
            onClick={onBack}
            className="absolute top-3 left-3 inline-flex size-10 items-center justify-center rounded-full bg-layer-1 text-primary md:hidden"
          >
            <ChevronLeft className="size-5" />
          </button>
        ) : null}
        {other ? (
          <PersonAvatar person={other} className="size-12 text-[18px]" />
        ) : (
          <span
            aria-hidden
            className="inline-flex size-12 items-center justify-center rounded-full text-[18px] font-semibold text-white"
            style={{ backgroundColor: personColor(channel.id) }}
          >
            {channel.kind === "GENERAL" || channel.kind === "NEWS" ? (
              <Users className="size-5" />
            ) : (
              channel.name.trim().charAt(0).toUpperCase()
            )}
          </span>
        )}
        <span
          className="inline-flex max-w-full items-center gap-1 rounded-full bg-layer-1 px-3 py-1 text-body-sm-semibold text-primary"
          title={hub.channel ? `${members.length} people can read this` : undefined}
        >
          <span className="truncate">{channel.name}</span>
          <ChevronRight className="size-3.5 shrink-0 text-tertiary" aria-hidden />
        </span>
        {isGroupChat ? (
          <span className="text-[11px] text-tertiary">
            {KIND_LABEL[channel.kind]}
            {hub.channel ? ` · ${members.length} people` : ""}
          </span>
        ) : null}
      </header>

      {thread ? (
        <div className="flex items-center justify-between gap-2 border-b border-subtle bg-layer-1 px-3 py-1.5">
          <span className="truncate text-caption-sm-medium text-secondary">
            Thread · {replyCounts.get(thread) ?? 0} {replyCounts.get(thread) === 1 ? "reply" : "replies"}
            {threadRoot?.body ? ` · ${threadRoot.body.slice(0, 50)}` : ""}
          </span>
          <button
            type="button"
            onClick={() => setThread(null)}
            className="min-h-8 shrink-0 rounded-full px-3 text-caption-sm-medium text-[#0a84ff] hover:bg-layer-2"
          >
            All messages
          </button>
        </div>
      ) : null}

      <div
        ref={scroller}
        onScroll={(event) => {
          const box = event.currentTarget;
          nearBottom.current = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
          loadOlderIfAtTop(box);
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-2 pb-2 [will-change:scroll-position] [-webkit-overflow-scrolling:touch]"
        aria-live="polite"
      >
        <div ref={content}>
          {hub.hasMore && !thread ? (
            <p className="py-2 text-center text-caption-sm-regular text-tertiary">
              {hub.isLoadingOlder ? "Loading older messages..." : "Scroll up for older messages"}
            </p>
          ) : null}
          {hub.isLoading ? <p className="px-4 py-2 text-body-sm-regular text-tertiary">Loading messages...</p> : null}
          {!hub.isLoading && shown.length === 0 ? (
            <p className="px-4 py-6 text-center text-body-sm-regular text-tertiary">No messages yet. Say hello.</p>
          ) : null}
          {shown.map((message, index) => {
            const previous = shown[index - 1];
            const next = shown[index + 1];
            const time = new Date(message.created_at).getTime();
            const separator = !previous || time - new Date(previous.created_at).getTime() > GAP_MS;
            const nextSeparated = !next || new Date(next.created_at).getTime() - time > GAP_MS;
            const sameAsPrevious =
              !!previous &&
              !separator &&
              previous.author.id === message.author.id &&
              time - new Date(previous.created_at).getTime() < GROUP_MS;
            const sameAsNext =
              !!next &&
              !nextSeparated &&
              next.author.id === message.author.id &&
              new Date(next.created_at).getTime() - time < GROUP_MS &&
              !next.parent;
            const isOwn = message.author.id === currentUser?.id;
            const parent = message.parent && !thread ? byId.get(message.parent) : undefined;
            return (
              <Fragment key={message.id}>
                {separator ? (
                  <p className="py-2 text-center text-[11px] font-medium text-tertiary">{stamp(message.created_at)}</p>
                ) : null}
                <div className="message-in">
                  <Message
                    message={message}
                    isOwn={isOwn}
                    isGroupChat={isGroupChat}
                    showName={isGroupChat && (!sameAsPrevious || !!message.parent)}
                    showAvatar={!sameAsNext}
                    isLast={!sameAsNext}
                    parent={parent}
                    replyCount={thread ? 0 : (replyCounts.get(message.id) ?? 0)}
                    tokens={tokensFor(message)}
                    {...shared}
                  />
                </div>
              </Fragment>
            );
          })}
          <div ref={bottom} />
        </div>
      </div>

      {!channel.can_post ? (
        <p className="border-t border-subtle p-3 text-center text-body-xs-regular text-tertiary">
          Only admins can write here. Everyone can read.
        </p>
      ) : (
        <footer className="flex flex-col gap-2 px-2 pt-1 pb-2 sm:px-3">
          {replyTo ? (
            <div className="flex items-center gap-2 rounded-2xl border border-subtle px-3 py-1.5">
              <CornerUpLeft className="size-4 shrink-0 text-[#0a84ff]" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-caption-sm-regular text-secondary">
                <strong style={{ color: personColor(replyTo.author.id) }}>{replyTo.author.display_name}</strong>
                {replyTo.body ? `: ${replyTo.body.slice(0, 80)}` : ""}
              </span>
              <button
                type="button"
                aria-label="Cancel the reply"
                onClick={() => setReplyTo(null)}
                className="inline-flex size-7 items-center justify-center rounded-full hover:bg-layer-1"
              >
                <X className="size-4" />
              </button>
            </div>
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

          <div ref={composer} className="relative flex items-end gap-2">
            {menuOpen ? (
              <ul
                role="listbox"
                aria-label={menu?.trigger === "/" ? "Projects" : "People and teams"}
                className="absolute right-0 bottom-full left-0 z-20 mb-2 max-h-72 overflow-y-auto rounded-2xl border border-subtle bg-surface-1 p-1 shadow-raised-200"
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
                        "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-1.5 text-left",
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
                        <span className="inline-flex size-6 items-center justify-center rounded-md bg-[#0d9488] text-white">
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
                              ? `Everyone (${members.length})`
                              : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {plusOpen ? (
              <div
                role="menu"
                aria-label="Add to the message"
                className="absolute bottom-full left-0 z-20 mb-2 flex w-60 flex-col rounded-2xl border border-subtle bg-surface-1 p-1 shadow-raised-200"
              >
                <label
                  htmlFor="hub-files"
                  role="menuitem"
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-body-sm-regular text-primary hover:bg-layer-1"
                >
                  <Paperclip className="size-5 text-[#0a84ff]" aria-hidden /> Attach files
                </label>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => openMenu("@")}
                  className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-left text-body-sm-regular text-primary hover:bg-layer-1"
                >
                  <AtSign className="size-5 text-[#ea580c]" aria-hidden /> Tag a person or team
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => openMenu("/")}
                  className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-left text-body-sm-regular text-primary hover:bg-layer-1"
                >
                  <FolderKanban className="size-5 text-[#0d9488]" aria-hidden /> Mention a project
                </button>
                <p className="px-3 pt-1 pb-1.5 text-[11px] text-tertiary">
                  Files open through a private 5-minute link.
                </p>
              </div>
            ) : null}

            <input
              ref={input}
              id="hub-files"
              type="file"
              multiple
              accept={FILE_ACCEPT}
              className="sr-only"
              onChange={(event) => {
                setPlusOpen(false);
                addFiles(event.target.files);
              }}
            />
            <button
              type="button"
              aria-label="Attach, tag or mention"
              aria-expanded={plusOpen}
              onClick={() => setPlusOpen((open) => !open)}
              className={cn(
                "inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-layer-1 text-secondary transition-transform hover:text-primary",
                plusOpen && "rotate-45"
              )}
            >
              <Plus className="size-5" />
            </button>

            <div className="flex min-h-10 min-w-0 flex-1 items-end rounded-[22px] border border-subtle bg-surface-1 py-1 pr-1 pl-3.5 focus-within:border-strong">
              <textarea
                value={body}
                rows={1}
                maxLength={5000}
                aria-label="Message"
                placeholder="Type a message"
                dir="auto"
                onFocus={() => setPlusOpen(false)}
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
                className="max-h-[132px] min-w-0 flex-1 resize-none bg-transparent py-1.5 text-body-md-regular leading-snug text-primary outline-none placeholder:text-placeholder"
              />
              <button
                type="button"
                aria-label="Send"
                onClick={() => void send()}
                disabled={!canSend}
                className={cn(
                  "mb-0.5 ml-1 inline-flex size-8 shrink-0 items-center justify-center rounded-full text-white transition-opacity",
                  canSend ? "bg-[#0a84ff]" : "bg-[#0a84ff]/40"
                )}
              >
                <ArrowUp className="size-5" strokeWidth={2.5} />
              </button>
            </div>
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
