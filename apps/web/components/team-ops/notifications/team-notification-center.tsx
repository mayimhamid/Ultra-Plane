/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { AtSign, Bell, MessagesSquare } from "lucide-react";
import type { TOpsNotification } from "@plane/types";
import { cn } from "@plane/utils";
// hooks
import { useHubChannels } from "@/hooks/team-ops/use-hub";
import { useOpsNotifications } from "@/hooks/team-ops/use-workday";
// local imports
import { NotificationItem } from "./notification-item";

type TFilter = "all" | "unread" | "tasks" | "messages" | "planning";

const KINDS: Record<Exclude<TFilter, "all" | "unread">, TOpsNotification["kind"][]> = {
  tasks: ["ASSIGN", "REMIND", "REPORT", "CHECKIN", "FREEZE"],
  messages: ["MENTION", "REPLY", "DIRECT", "ATTENTION", "NEWS", "SECRET"],
  planning: ["FLOW", "LEAVE"],
};

const FILTERS: { key: TFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "tasks", label: "Tasks" },
  { key: "messages", label: "Messages and tags" },
  { key: "planning", label: "Planning" },
];

const CHART_DAYS = 14;
const DAY_MS = 86_400_000;
const dayFormat = new Intl.DateTimeFormat("en-US", { weekday: "long", day: "numeric", month: "long" });

const startOfDay = (value: number | Date) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

/** "Today", "Yesterday" or the date: the heading a notification is listed under. */
const dayLabel = (stamp: string) => {
  const days = Math.round((startOfDay(Date.now()) - startOfDay(new Date(stamp))) / DAY_MS);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return dayFormat.format(new Date(stamp));
};

const matches = (item: TOpsNotification, filter: TFilter) => {
  if (filter === "all") return true;
  if (filter === "unread") return !item.read;
  return KINDS[filter].includes(item.kind);
};

function Tile({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="flex min-w-32 flex-1 flex-col gap-0.5 rounded-lg border border-subtle bg-surface-1 px-4 py-3">
      <span className="text-caption-sm-regular text-tertiary">{label}</span>
      <span className={cn("text-h4-medium tabular-nums", value > 0 && tone ? tone : "text-primary")}>{value}</span>
    </div>
  );
}

/** The last two weeks as bars, one per day: how busy the notifications have been. */
function ActivityBars({ items }: { items: TOpsNotification[] }) {
  const today = startOfDay(Date.now());
  const days = Array.from({ length: CHART_DAYS }, (_, index) => {
    const start = today - (CHART_DAYS - 1 - index) * DAY_MS;
    const count = items.filter((item) => {
      const at = new Date(item.created_at).getTime();
      return at >= start && at < start + DAY_MS;
    }).length;
    return { start, count };
  });
  const peak = Math.max(1, ...days.map((day) => day.count));
  return (
    <div className="flex min-w-48 flex-1 flex-col gap-2 rounded-lg border border-subtle bg-surface-1 px-4 py-3">
      <span className="text-caption-sm-regular text-tertiary">Last {CHART_DAYS} days</span>
      <div className="flex h-10 items-end gap-1" role="img" aria-label="Notifications per day">
        {days.map((day) => (
          <span
            key={day.start}
            title={`${new Date(day.start).toLocaleDateString("en-US", { day: "numeric", month: "short" })}: ${day.count}`}
            className={cn("flex-1 rounded-sm", day.count > 0 ? "bg-accent-primary" : "bg-layer-1")}
            style={{ height: `${Math.max(8, Math.round((day.count / peak) * 100))}%` }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Notifications page, right side: everything Team Ops tells the person, spread over the whole page. What needs a
 * look now (the Hub), then the notifications by day with a filter. A work item opened from the list on the left
 * takes this place and gives it back when closed.
 */
export const TeamNotificationCenter = observer(function TeamNotificationCenter({
  workspaceSlug,
}: {
  workspaceSlug: string;
}) {
  const [filter, setFilter] = useState<TFilter>("all");
  const { channels, unreadMentions } = useHubChannels(workspaceSlug);
  const { notifications, unread, markRead } = useOpsNotifications(workspaceSlug);
  const items = useMemo(() => notifications ?? [], [notifications]);
  const unreadChannels = (channels ?? []).filter((channel) => channel.unread > 0);
  const unreadMessages = unreadChannels.reduce((sum, channel) => sum + channel.unread, 0);

  const groups = useMemo(() => {
    const byDay = new Map<string, TOpsNotification[]>();
    for (const item of items.filter((entry) => matches(entry, filter))) {
      const label = dayLabel(item.created_at);
      byDay.set(label, [...(byDay.get(label) ?? []), item]);
    }
    return [...byDay.entries()];
  }, [items, filter]);

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-6 overflow-y-auto p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-h4-medium text-primary">
            <Bell className="size-5 text-accent-primary" aria-hidden />
            Team notifications
          </h1>
          <p className="text-body-sm-regular text-secondary">
            Tasks given to you, tags, messages, reminders and reports, in one place.
          </p>
        </div>
        {unread > 0 ? (
          <button
            type="button"
            onClick={() => void markRead()}
            className="min-h-9 rounded-md border border-subtle px-3 text-body-xs-medium text-primary hover:bg-layer-1"
          >
            Mark all read
          </button>
        ) : null}
      </header>

      <div className="flex flex-wrap gap-3">
        <Tile label="Unread notifications" value={unread} tone="text-accent-primary" />
        <Tile label="Unread tags" value={unreadMentions} tone="text-[#ea580c]" />
        <Tile label="New Hub messages" value={unreadMessages} tone="text-[#2563eb]" />
        <ActivityBars items={items} />
      </div>

      {unreadMentions > 0 || unreadChannels.length > 0 ? (
        <section aria-label="Hub" className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-body-md-medium text-primary">Hub</h2>
            <Link href={`/${workspaceSlug}/team-ops/hub/`} className="text-body-xs-medium text-accent-primary">
              Open Hub
            </Link>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
            {unreadMentions > 0 ? (
              <Link
                href={`/${workspaceSlug}/team-ops/hub/?section=mentions`}
                className="flex items-center gap-3 rounded-lg border border-subtle bg-surface-1 px-4 py-3 hover:bg-layer-1"
              >
                <span className="inline-flex size-9 items-center justify-center rounded-full bg-[color-mix(in_oklab,#ea580c_15%,transparent)] text-[#ea580c]">
                  <AtSign className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-body-sm-semibold text-primary">You were tagged</span>
                  <span className="text-caption-sm-regular text-tertiary">{unreadMentions} new</span>
                </span>
              </Link>
            ) : null}
            {unreadChannels.map((channel) => (
              <Link
                key={channel.id}
                href={`/${workspaceSlug}/team-ops/hub/?channel=${channel.id}`}
                className="flex items-center gap-3 rounded-lg border border-subtle bg-surface-1 px-4 py-3 hover:bg-layer-1"
              >
                <span className="inline-flex size-9 items-center justify-center rounded-full bg-[color-mix(in_oklab,#2563eb_15%,transparent)] text-[#2563eb]">
                  <MessagesSquare className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-sm-semibold text-primary">{channel.name}</span>
                  <span className="text-caption-sm-regular text-tertiary">
                    {channel.unread} new message{channel.unread === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="rounded-full bg-accent-primary px-2 text-caption-sm-medium text-on-color">
                  {channel.unread}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section aria-label="Notifications" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={filter === option.key}
              onClick={() => setFilter(option.key)}
              className={cn(
                "min-h-8 rounded-full border px-3 text-caption-sm-medium",
                filter === option.key
                  ? "border-accent-strong bg-accent-subtle text-accent-primary"
                  : "border-subtle text-secondary hover:bg-layer-1"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        {groups.length === 0 ? (
          <p className="rounded-lg border border-subtle bg-surface-1 px-5 py-8 text-center text-body-sm-regular text-tertiary">
            {items.length === 0 ? "Nothing yet. Notifications will appear here." : "Nothing matches this filter."}
          </p>
        ) : (
          groups.map(([label, list]) => (
            <div key={label} className="overflow-hidden rounded-lg border border-subtle bg-surface-1">
              <p className="border-b border-subtle bg-layer-1/50 px-5 py-2 text-caption-sm-medium text-tertiary">
                {label}
              </p>
              <ul className="flex flex-col divide-y divide-subtle px-5">
                {list.map((item) => (
                  <li key={item.id}>
                    <NotificationItem
                      workspaceSlug={workspaceSlug}
                      item={item}
                      onOpen={() => !item.read && void markRead(item.id)}
                      action={{
                        label: item.read ? "Mark unread" : "Mark read",
                        onClick: () => void markRead(item.id, !item.read),
                      }}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </div>
  );
});
