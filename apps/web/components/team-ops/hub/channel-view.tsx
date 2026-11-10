/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { sortBy } from "lodash-es";
import { observer } from "mobx-react";
import Link from "next/link";
import {
  ArrowUp,
  AtSign,
  ChevronLeft,
  Copy,
  CornerUpLeft,
  FolderKanban,
  MessagesSquare,
  Paperclip,
  Pencil,
  Pin,
  PinOff,
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
  isEditing: boolean;
  isMenuOpen: boolean;
  onReply: (message: THubMessage) => void;
  onReact: (message: THubMessage, emoji: string) => void;
  onOpenThread: (rootId: string) => void;
  onOpenMenu: (message: THubMessage, x: number, y: number) => void;
  onEdit: (message: THubMessage, body: string) => Promise<void>;
  onEditDone: () => void;
  onOpenFile: (fileId: string) => Promise<void>;
};

const actionClass =
  "inline-flex min-h-8 items-center gap-1 rounded-full px-2.5 text-caption-sm-medium text-secondary hover:bg-layer-1 hover:text-primary";

// Swipe right this far to reply; past it the message moves slower, like it is on a spring.
const SWIPE_TRIGGER = 64;
const SWIPE_MAX = 110;
// Holding a finger this long on a message opens its menu.
const LONG_PRESS_MS = 450;
const SPRING = "cubic-bezier(0.22, 1, 0.36, 1)";

const buzz = (ms: number) => {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(ms);
};

function EditBox({
  message,
  onEdit,
  onDone,
}: {
  message: THubMessage;
  onEdit: MessageProps["onEdit"];
  onDone: () => void;
}) {
  const [draft, setDraft] = useState(message.body);
  const save = () => {
    if (draft.trim()) void onEdit(message, draft).then(onDone);
  };
  return (
    <div className="flex w-[min(80vw,30rem)] flex-col gap-2 rounded-2xl border border-subtle bg-surface-1 p-2">
      <textarea
        value={draft}
        rows={3}
        aria-label="Edit message"
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- the box opens because the person chose Edit
        autoFocus
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            save();
          } else if (event.key === "Escape") {
            onDone();
          }
        }}
        className="resize-none rounded-xl bg-layer-1 px-3 py-2 text-body-sm-regular text-primary outline-none"
      />
      <div className="flex justify-end gap-2">
        <button type="button" className={actionClass} onClick={onDone}>
          Cancel
        </button>
        <button
          type="button"
          disabled={!draft.trim()}
          onClick={save}
          className="inline-flex min-h-8 items-center rounded-full bg-[#0a84ff] px-3 text-caption-sm-medium text-white disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </div>
  );
}

type TGesture = { x: number; y: number; mode: "wait" | "swipe" | "none"; armed: boolean; timer?: number };

function Message(props: MessageProps) {
  const { message, isOwn, showName, showAvatar, isGroupChat, isLast, parent, replyCount, tokens } = props;
  const { isEditing, isMenuOpen, onReply, onReact, onOpenThread, onOpenMenu, onEdit, onEditDone, onOpenFile } = props;
  const row = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLSpanElement>(null);
  const gesture = useRef<TGesture | null>(null);

  const article = useRef<HTMLElement>(null);
  const latest = useRef({ message, onReply, onOpenMenu });
  useEffect(() => {
    latest.current = { message, onReply, onOpenMenu };
  });

  // Moves the message sideways while it is dragged; the reply arrow fades in behind it.
  const shift = useCallback((dx: number, animate: boolean) => {
    const transition = animate ? `transform 280ms ${SPRING}, opacity 200ms ease-out` : "none";
    if (row.current) {
      row.current.style.transition = transition;
      row.current.style.transform = dx ? `translate3d(${dx}px, 0, 0)` : "";
    }
    if (hint.current) {
      const progress = Math.min(dx / SWIPE_TRIGGER, 1);
      hint.current.style.transition = transition;
      hint.current.style.opacity = String(progress);
      hint.current.style.transform = `scale(${0.4 + 0.6 * progress})`;
    }
  }, []);

  const endGesture = useCallback(
    (released: boolean) => {
      const current = gesture.current;
      if (!current) return;
      window.clearTimeout(current.timer);
      if (current.mode === "swipe") {
        if (released && current.armed) latest.current.onReply(latest.current.message);
        shift(0, true);
      }
      gesture.current = null;
    },
    [shift]
  );

  // Touch: hold for the menu, swipe right to reply. Up and down still scroll the chat. These are touch events
  // (not pointer events) so a swipe that starts on text, a bubble or a picture works the same in every browser,
  // and a sideways swipe is not taken over by the browser (back gesture, page scroll).
  useEffect(() => {
    const element = article.current;
    if (!element || isEditing) return;
    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || (event.target as HTMLElement).closest("textarea, input")) return;
      const { clientX: x, clientY: y } = event.touches[0];
      window.clearTimeout(gesture.current?.timer);
      const timer = window.setTimeout(() => {
        if (gesture.current?.mode !== "wait") return;
        gesture.current.mode = "none";
        buzz(10);
        latest.current.onOpenMenu(latest.current.message, x, y);
      }, LONG_PRESS_MS);
      gesture.current = { x, y, mode: "wait", armed: false, timer };
    };
    const onMove = (event: TouchEvent) => {
      const current = gesture.current;
      if (!current || event.touches.length !== 1) return;
      const dx = event.touches[0].clientX - current.x;
      const dy = event.touches[0].clientY - current.y;
      if (current.mode === "wait") {
        // Small wobbles of a held finger are not a swipe or a scroll yet.
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        window.clearTimeout(current.timer);
        current.mode = dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.2 ? "swipe" : "none";
      }
      if (current.mode !== "swipe") return;
      if (event.cancelable) event.preventDefault();
      const pulled = Math.max(0, dx);
      const moved = Math.min(
        pulled <= SWIPE_TRIGGER ? pulled : SWIPE_TRIGGER + (pulled - SWIPE_TRIGGER) * 0.3,
        SWIPE_MAX
      );
      shift(moved, false);
      if (moved >= SWIPE_TRIGGER && !current.armed) {
        current.armed = true;
        buzz(8);
      } else if (moved < SWIPE_TRIGGER) {
        current.armed = false;
      }
    };
    const onEnd = () => endGesture(true);
    const onCancel = () => endGesture(false);
    element.addEventListener("touchstart", onStart, { passive: true });
    element.addEventListener("touchmove", onMove, { passive: false });
    element.addEventListener("touchend", onEnd);
    element.addEventListener("touchcancel", onCancel);
    return () => {
      element.removeEventListener("touchstart", onStart);
      element.removeEventListener("touchmove", onMove);
      element.removeEventListener("touchend", onEnd);
      element.removeEventListener("touchcancel", onCancel);
    };
  }, [isEditing, shift, endGesture, message.is_deleted]);

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
      ref={article}
      title={stamp(message.created_at)}
      // Right click (or a long press on Android) opens this message's menu instead of the browser's.
      onContextMenu={(event) => {
        if ((event.target as HTMLElement).closest("textarea, input")) return;
        event.preventDefault();
        endGesture(false);
        onOpenMenu(message, event.clientX, event.clientY);
      }}
      onKeyDown={(event) => {
        if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
          event.preventDefault();
          const box = event.currentTarget.getBoundingClientRect();
          onOpenMenu(message, box.left + box.width / 2, box.top + box.height / 2);
        }
      }}
      className={cn(
        "relative touch-pan-y [-webkit-touch-callout:none] [@media(pointer:coarse)]:select-none",
        isLast ? "pb-1.5" : "pb-0.5",
        isMenuOpen && "z-10"
      )}
    >
      <span
        ref={hint}
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-2 -mt-4 inline-flex size-8 items-center justify-center rounded-full bg-layer-1 text-secondary opacity-0"
      >
        <CornerUpLeft className="size-4" />
      </span>
      <div
        ref={row}
        className={cn(
          "flex items-end gap-2 px-3 will-change-transform",
          isOwn ? "flex-row-reverse" : "flex-row",
          isMenuOpen && "scale-[1.02] transition-transform"
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
            <EditBox message={message} onEdit={onEdit} onDone={onEditDone} />
          ) : emojiOnly ? (
            <span className="px-1 text-[44px] leading-tight" aria-label={message.body}>
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

          {message.reactions.length > 0 ? (
            <ul className={cn("mt-0.5 flex flex-wrap gap-1 px-1.5", isOwn ? "justify-end" : "justify-start")}>
              {message.reactions.map((reaction) => (
                <li key={reaction.emoji}>
                  <button
                    type="button"
                    onClick={() => onReact(message, reaction.emoji)}
                    title={reaction.people.join(", ")}
                    aria-pressed={reaction.mine}
                    aria-label={`${reaction.emoji} ${reaction.count}: ${reaction.people.join(", ")}`}
                    className={cn(
                      "inline-flex min-h-6 items-center gap-1 rounded-full border px-1.5 text-caption-sm-medium",
                      reaction.mine
                        ? "border-[#0a84ff] bg-[#0a84ff]/15 text-[#0a84ff]"
                        : "border-subtle bg-surface-1 text-secondary hover:bg-layer-1"
                    )}
                  >
                    <span className="text-[14px] leading-none">{reaction.emoji}</span>
                    {reaction.count > 1 ? <span>{reaction.count}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {isAttention || message.edited_at || message.pinned_at ? (
            <span className="mt-0.5 px-2 text-[11px] text-tertiary">
              {isAttention ? <span className="text-warning-primary">Needs attention</span> : null}
              {isAttention && (message.edited_at || message.pinned_at) ? " · " : null}
              {message.pinned_at ? (
                <span className="inline-flex items-center gap-0.5">
                  <Pin className="size-3" aria-hidden />
                  Pinned
                </span>
              ) : null}
              {message.pinned_at && message.edited_at ? " · " : null}
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
        </div>
      </div>
    </article>
  );
}

type TActionMenu = { message: THubMessage; x: number; y: number };

type ActionMenuProps = {
  menu: TActionMenu;
  isOwn: boolean;
  replyCount: number;
  onClose: () => void;
  onReply: () => void;
  onReact: (emoji: string) => void;
  canPin: boolean;
  onPin: () => void;
  onThread: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

const menuItemClass =
  "flex min-h-11 w-full items-center justify-between gap-6 rounded-xl px-3 text-left text-body-sm-regular text-primary hover:bg-layer-1 focus-visible:bg-layer-1 focus-visible:outline-none";

/** The menu of one message, where it was right-clicked or held. On phones the chat dims behind it. */
function ActionMenu({
  menu,
  isOwn,
  replyCount,
  onClose,
  onReply,
  onReact,
  canPin,
  onPin,
  onThread,
  onEdit,
  onDelete,
}: ActionMenuProps) {
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const { message } = menu;

  // Keep the whole menu on the screen.
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    const left = Math.max(8, Math.min(menu.x, window.innerWidth - width - 8));
    const top = menu.y + height + 8 > window.innerHeight ? Math.max(8, menu.y - height) : menu.y;
    setPlace({ left, top });
    element.querySelector("button")?.focus();
  }, [menu.x, menu.y]);

  useEffect(() => {
    const close = () => onClose();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const pick = (action: () => void) => () => {
    onClose();
    action();
  };
  const copy = () =>
    void navigator.clipboard
      ?.writeText(message.body)
      .then(() => setToast({ type: "success", title: "Copied" }))
      .catch(() => setToast({ type: "error", title: "Could not copy" }));

  return createPortal(
    <div className="fixed inset-0 z-[60]">
      <div
        aria-hidden
        className="message-in absolute inset-0 [@media(pointer:coarse)]:bg-black/30 [@media(pointer:coarse)]:backdrop-blur-[2px]"
        onPointerDown={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        ref={box}
        role="menu"
        aria-label="Message actions"
        className="message-in absolute flex w-56 flex-col rounded-2xl border border-subtle bg-surface-1 p-1 shadow-raised-200"
        style={place ? { left: place.left, top: place.top } : { left: menu.x, top: menu.y, visibility: "hidden" }}
      >
        {/* On a phone the chat is blurred behind the menu: show which message was held. */}
        {message.body ? (
          <p
            dir={RTL.test(message.body) ? "rtl" : undefined}
            className={cn(
              "m-1 line-clamp-3 rounded-[16px] px-3 py-1.5 text-body-sm-regular whitespace-pre-wrap [@media(pointer:fine)]:hidden",
              isOwn ? MINE : THEIRS
            )}
          >
            {message.body}
          </p>
        ) : null}
        <div role="group" aria-label="React" className="flex justify-between gap-0.5 px-1 pt-1">
          {REACTIONS.map((emoji) => {
            const mine = message.reactions.some((reaction) => reaction.emoji === emoji && reaction.mine);
            return (
              <button
                key={emoji}
                type="button"
                aria-label={`React with ${emoji}`}
                aria-pressed={mine}
                onClick={pick(() => onReact(emoji))}
                className={cn(
                  "inline-flex size-9 items-center justify-center rounded-full text-[20px] leading-none hover:bg-layer-1 focus-visible:bg-layer-1 focus-visible:outline-none active:scale-90",
                  mine && "bg-[#0a84ff]/15"
                )}
              >
                {emoji}
              </button>
            );
          })}
        </div>
        <p className="px-3 pt-1.5 pb-1 text-[11px] text-tertiary">{stamp(message.created_at)}</p>
        <button type="button" role="menuitem" className={menuItemClass} onClick={pick(onReply)}>
          Reply <CornerUpLeft className="size-4 text-secondary" aria-hidden />
        </button>
        {canPin ? (
          <button type="button" role="menuitem" className={menuItemClass} onClick={pick(onPin)}>
            {message.pinned_at ? "Unpin" : "Pin"}
            {message.pinned_at ? (
              <PinOff className="size-4 text-secondary" aria-hidden />
            ) : (
              <Pin className="size-4 text-secondary" aria-hidden />
            )}
          </button>
        ) : null}
        {replyCount > 0 ? (
          <button type="button" role="menuitem" className={menuItemClass} onClick={pick(onThread)}>
            View {replyCount} {replyCount === 1 ? "reply" : "replies"}
            <MessagesSquare className="size-4 text-secondary" aria-hidden />
          </button>
        ) : null}
        {message.body ? (
          <button type="button" role="menuitem" className={menuItemClass} onClick={pick(copy)}>
            Copy <Copy className="size-4 text-secondary" aria-hidden />
          </button>
        ) : null}
        {isOwn && message.body ? (
          <button type="button" role="menuitem" className={menuItemClass} onClick={pick(onEdit)}>
            Edit <Pencil className="size-4 text-secondary" aria-hidden />
          </button>
        ) : null}
        {isOwn ? (
          <button
            type="button"
            role="menuitem"
            className={cn(menuItemClass, "text-danger-primary")}
            onClick={pick(onDelete)}
          >
            Delete <Trash2 className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>
    </div>,
    document.body
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
  // The message whose menu is open (right click, or a long press on a phone), and the one being edited.
  const [actionMenu, setActionMenu] = useState<TActionMenu | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
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

  // Pinned messages, like Telegram: the bar shows one pin with its number (#1 is the first pinned); tapping it
  // jumps to that message and moves on to the previous pin, and after #1 it starts again from the newest.
  const pins = hub.pins;
  const [pinCursor, setPinCursor] = useState<number | null>(null);
  const cursor = pins.length === 0 ? -1 : pinCursor !== null && pinCursor < pins.length ? pinCursor : pins.length - 1;
  useEffect(() => setPinCursor(null), [channel.id]);

  const jumpToPin = () => {
    const target = pins[cursor];
    if (!target) return;
    const find = () => document.getElementById(`message-${target.id}`);
    const go = (attempt: number) => {
      const element = find();
      if (!element) {
        if (attempt < 5) requestAnimationFrame(() => go(attempt + 1));
        return;
      }
      element.scrollIntoView({ block: "center", behavior: "smooth" });
      element.animate?.([{ backgroundColor: "rgba(10, 132, 255, 0.22)" }, { backgroundColor: "transparent" }], {
        duration: 1600,
        easing: "ease-out",
      });
    };
    // A pin older than the loaded page is added to the list first.
    if (!find()) hub.addMessages([target]);
    go(0);
    setPinCursor(cursor > 0 ? cursor - 1 : pins.length - 1);
  };

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
    onReact: (message: THubMessage, emoji: string) => guard(() => hub.react(message.id, emoji)),
    onOpenThread: setThread,
    onOpenMenu: (message: THubMessage, x: number, y: number) => setActionMenu({ message, x, y }),
    onEdit: (message: THubMessage, text: string) => guard(() => hub.edit(message.id, text)),
    onEditDone: () => setEditingId(null),
    onOpenFile: hub.openFile,
  };
  const closeActionMenu = useCallback(() => setActionMenu(null), []);

  const menuOpen = !!menu && options.length > 0;
  const canSend = !isSending && (!!body.trim() || files.length > 0);
  const threadRoot = thread ? byId.get(thread) : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-1">
      {/* Header: back, then the picture and the name in one row. Only who the chat is with. */}
      <header className="flex min-h-14 items-center gap-2.5 border-b border-subtle px-2 py-2 md:px-4">
        {onBack ? (
          <button
            type="button"
            aria-label="Back to the Hub"
            onClick={onBack}
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-primary active:bg-layer-1 md:hidden"
          >
            <ChevronLeft className="size-6" />
          </button>
        ) : null}
        {other ? (
          <PersonAvatar person={other} className="size-10 shrink-0 text-[15px]" />
        ) : (
          <span
            aria-hidden
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold text-white"
            style={{ backgroundColor: personColor(channel.id) }}
          >
            {channel.kind === "GENERAL" || channel.kind === "NEWS" ? (
              <Users className="size-5" />
            ) : (
              channel.name.trim().charAt(0).toUpperCase()
            )}
          </span>
        )}
        <h2 className="min-w-0 flex-1 truncate text-body-md-semibold text-primary">{channel.name}</h2>
      </header>

      {!thread && cursor >= 0 ? (
        <button
          type="button"
          onClick={jumpToPin}
          aria-label={`Go to pinned message ${pins.length > 1 ? `#${cursor + 1}` : ""}`}
          className="flex min-h-11 w-full items-center gap-2.5 border-b border-subtle bg-surface-1 px-3 py-1 text-left active:bg-layer-1 md:hover:bg-layer-1"
        >
          {/* One segment for each pin, the one that will be opened lit up, as in Telegram. */}
          <span aria-hidden className="flex h-8 w-0.5 shrink-0 flex-col gap-px">
            {pins.slice(-4).map((pin, index, shownPins) => {
              const position = pins.length - shownPins.length + index;
              return (
                <span
                  key={pin.id}
                  className={cn("w-full flex-1 rounded-full", position === cursor ? "bg-[#0a84ff]" : "bg-[#0a84ff]/30")}
                />
              );
            })}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-caption-sm-medium text-[#0a84ff]">
              Pinned message{pins.length > 1 ? ` #${cursor + 1}` : ""}
            </span>
            <span
              className="truncate text-body-xs-regular text-secondary"
              dir={RTL.test(pins[cursor].body) ? "rtl" : undefined}
            >
              {pins[cursor].body || (pins[cursor].attachments.length > 0 ? "A file" : "")}
            </span>
          </span>
          <Pin className="size-4 shrink-0 text-tertiary" aria-hidden />
        </button>
      ) : null}

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
                <div id={`message-${message.id}`} className="message-in">
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
                    isEditing={editingId === message.id}
                    isMenuOpen={actionMenu?.message.id === message.id}
                    {...shared}
                  />
                </div>
              </Fragment>
            );
          })}
          <div ref={bottom} />
        </div>
      </div>

      {actionMenu ? (
        <ActionMenu
          menu={actionMenu}
          isOwn={actionMenu.message.author.id === currentUser?.id}
          replyCount={thread ? 0 : (replyCounts.get(actionMenu.message.id) ?? 0)}
          onClose={closeActionMenu}
          onReply={() => shared.onReply(actionMenu.message)}
          onReact={(emoji) => shared.onReact(actionMenu.message, emoji)}
          canPin={channel.can_post}
          onPin={() => void guard(() => hub.pin(actionMenu.message.id, !actionMenu.message.pinned_at))}
          onThread={() => setThread(actionMenu.message.id)}
          onEdit={() => setEditingId(actionMenu.message.id)}
          onDelete={() => void guard(() => hub.remove(actionMenu.message.id))}
        />
      ) : null}

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
