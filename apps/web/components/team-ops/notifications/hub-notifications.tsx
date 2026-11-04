/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { AtSign, ChevronDown, MessagesSquare } from "lucide-react";
import { cn } from "@plane/utils";
// hooks
import { useHubChannels } from "@/hooks/team-ops/use-hub";
import { useOpsNotifications } from "@/hooks/team-ops/use-workday";
// local imports
import { NotificationItem } from "./notification-item";

/**
 * The top of the Notifications list: unread Hub conversations (with a tap straight into the chat), mentions,
 * and the Team Ops notifications (tasks given, check-ins, freezes, leave, reports). Shown on phones as well.
 */
export const HubNotifications = observer(function HubNotifications({ workspaceSlug }: { workspaceSlug: string }) {
  const { channels, unreadMentions } = useHubChannels(workspaceSlug);
  const { notifications, unread, markRead } = useOpsNotifications(workspaceSlug);
  const [showTeam, setShowTeam] = useState(true);
  const unreadChannels = (channels ?? []).filter((channel) => channel.unread > 0);
  const team = (notifications ?? []).slice(0, 15);

  return (
    <div className="flex flex-col gap-1 border-b border-subtle px-3 py-2">
      <p className="flex items-center justify-between px-1 text-caption-sm-medium text-tertiary">
        <span>Hub</span>
        <Link href={`/${workspaceSlug}/team-ops/hub/`} className="min-h-8 content-center text-accent-primary">
          Open Hub
        </Link>
      </p>
      {unreadMentions > 0 ? (
        <Link
          href={`/${workspaceSlug}/team-ops/hub/?section=mentions`}
          className="flex min-h-11 items-center gap-3 rounded-md px-1 hover:bg-layer-1"
        >
          <span className="inline-flex size-8 items-center justify-center rounded-full bg-[color-mix(in_oklab,#ea580c_15%,transparent)] text-[#ea580c]">
            <AtSign className="size-4" aria-hidden />
          </span>
          <span className="flex-1 text-body-sm-medium text-primary">You were mentioned</span>
          <span className="rounded-full bg-accent-primary px-2 text-caption-sm-medium text-on-color">
            {unreadMentions}
          </span>
        </Link>
      ) : null}
      {unreadChannels.map((channel) => (
        <Link
          key={channel.id}
          href={`/${workspaceSlug}/team-ops/hub/?channel=${channel.id}`}
          className="flex min-h-11 items-center gap-3 rounded-md px-1 hover:bg-layer-1"
        >
          <span className="inline-flex size-8 items-center justify-center rounded-full bg-[color-mix(in_oklab,#2563eb_15%,transparent)] text-[#2563eb]">
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
      {unreadMentions === 0 && unreadChannels.length === 0 ? (
        <p className="px-1 pb-1 text-body-xs-regular text-tertiary">No new messages.</p>
      ) : null}

      {team.length > 0 ? (
        <>
          <button
            type="button"
            aria-expanded={showTeam}
            onClick={() => setShowTeam((value) => !value)}
            className="mt-1 flex min-h-8 items-center justify-between px-1 text-caption-sm-medium text-tertiary"
          >
            <span>Team{unread > 0 ? <span className="ml-1 text-accent-primary">({unread} new)</span> : null}</span>
            <ChevronDown aria-hidden className={cn("size-4 transition-transform", showTeam && "rotate-180")} />
          </button>
          {showTeam ? (
            <ul className="flex max-h-80 flex-col divide-y divide-subtle overflow-y-auto overscroll-contain">
              {team.map((item) => (
                <li key={item.id}>
                  <NotificationItem
                    workspaceSlug={workspaceSlug}
                    item={item}
                    compact
                    onOpen={() => !item.read && void markRead(item.id)}
                    action={{
                      label: item.read ? "Unread" : "Read",
                      onClick: () => void markRead(item.id, !item.read),
                    }}
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
});
