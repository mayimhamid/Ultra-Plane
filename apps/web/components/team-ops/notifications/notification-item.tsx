/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef } from "react";
import Link from "next/link";
import {
  AlarmClock,
  AtSign,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  CornerUpLeft,
  FileClock,
  KeyRound,
  Megaphone,
  MessageCircle,
  Snowflake,
  TriangleAlert,
  Workflow,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { TOpsNotification } from "@plane/types";
import { cn } from "@plane/utils";

type TKindStyle = { icon: LucideIcon; color: string; label: string };

/** Each kind of notification has its own icon and color, so the important ones stand out. */
export const NOTIFICATION_KIND: Record<TOpsNotification["kind"], TKindStyle> = {
  ASSIGN: { icon: ClipboardCheck, color: "#16a34a", label: "New task" },
  MENTION: { icon: AtSign, color: "#2563eb", label: "Tagged" },
  REPLY: { icon: CornerUpLeft, color: "#0284c7", label: "Reply" },
  DIRECT: { icon: MessageCircle, color: "#0d9488", label: "Message" },
  ATTENTION: { icon: TriangleAlert, color: "#d97706", label: "Needs attention" },
  CHECKIN: { icon: AlarmClock, color: "#ea580c", label: "Check-in" },
  FREEZE: { icon: Snowflake, color: "#dc2626", label: "Frozen" },
  FLOW: { icon: Workflow, color: "#7c3aed", label: "Teamflow" },
  NEWS: { icon: Megaphone, color: "#c026d3", label: "News" },
  SECRET: { icon: KeyRound, color: "#475569", label: "Secret" },
  LEAVE: { icon: CalendarDays, color: "#0891b2", label: "Leave" },
  REPORT: { icon: FileClock, color: "#b45309", label: "Report changed" },
  REMIND: { icon: ClipboardList, color: "#e11d48", label: "Log your tasks" },
};

const FALLBACK: TKindStyle = { icon: MessageCircle, color: "#6b7280", label: "Notice" };

const ago = (stamp: string) => {
  const seconds = Math.max(0, (Date.now() - new Date(stamp).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return new Date(stamp).toLocaleDateString("en-US", { day: "numeric", month: "short" });
};

/** The page of a notification; a link with a query (`team-ops/workday?date=...`) keeps it after the slash. */
export const notificationHref = (workspaceSlug: string, link: string) => {
  if (!link) return "#";
  const [path, query] = link.replace(/^\/+/, "").split("?");
  return `/${workspaceSlug}/${path.replace(/\/+$/, "")}/${query ? `?${query}` : ""}`;
};

// A notification counts as seen when most of it has been on screen for this long.
const SEEN_AFTER_MS = 1000;
const SEEN_SHARE = 0.6;

/** Calls `onSeen` once when the element has been mostly visible for a second (not while scrolling past). */
const useSeen = (enabled: boolean, onSeen: () => void) => {
  const box = useRef<HTMLDivElement>(null);
  const callback = useRef(onSeen);
  callback.current = onSeen;
  useEffect(() => {
    const element = box.current;
    if (!enabled || !element || typeof IntersectionObserver === "undefined") return;
    let timer: number | undefined;
    const watch = new IntersectionObserver(
      ([entry]) => {
        window.clearTimeout(timer);
        if (entry?.isIntersecting && document.visibilityState === "visible") {
          timer = window.setTimeout(() => {
            callback.current();
            watch.disconnect();
          }, SEEN_AFTER_MS);
        }
      },
      { threshold: SEEN_SHARE }
    );
    watch.observe(element);
    return () => {
      window.clearTimeout(timer);
      watch.disconnect();
    };
  }, [enabled]);
  return box;
};

type Props = {
  workspaceSlug: string;
  item: TOpsNotification;
  onOpen: () => void;
  /** Called once when the notification has been seen on screen; it is then marked read. */
  onSeen?: () => void;
  /** The small button on the right: mark read or unread, or dismiss. */
  action?: { label: string; onClick: () => void };
  compact?: boolean;
};

/** One notification: a colored icon for its kind, the title (bold while unread), the detail and when. */
export function NotificationItem({ workspaceSlug, item, onOpen, onSeen, action, compact = false }: Props) {
  const seen = useSeen(Boolean(onSeen) && !item.read, () => onSeen?.());
  const kind = NOTIFICATION_KIND[item.kind] ?? FALLBACK;
  const Icon = kind.icon;
  return (
    <div ref={seen} className={cn("flex items-start gap-3", compact ? "py-2" : "py-2.5")}>
      <span
        aria-hidden
        className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: `color-mix(in oklab, ${kind.color} 16%, transparent)`, color: kind.color }}
      >
        <Icon className="size-4" />
      </span>
      <Link href={notificationHref(workspaceSlug, item.link)} onClick={onOpen} className="group min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2">
          <span className="text-caption-sm-medium" style={{ color: kind.color }}>
            {kind.label}
          </span>
          <span className="text-caption-sm-regular text-tertiary">{ago(item.created_at)}</span>
          {!item.read ? <span aria-label="unread" className="size-2 rounded-full bg-accent-primary" /> : null}
        </span>
        <span
          className={cn(
            "block text-body-sm-regular group-hover:underline",
            item.read ? "text-secondary" : "font-semibold text-primary"
          )}
        >
          {item.title}
        </span>
        {item.body && !compact ? (
          <span className="line-clamp-2 block text-body-xs-regular text-tertiary">{item.body}</span>
        ) : null}
      </Link>
      {action ? (
        <button
          type="button"
          className="min-h-8 shrink-0 rounded-md px-2 text-caption-sm-medium text-tertiary hover:bg-layer-1 hover:text-primary"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
