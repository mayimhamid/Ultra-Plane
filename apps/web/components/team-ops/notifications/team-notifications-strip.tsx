/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
// hooks
import { useOpsNotifications } from "@/hooks/team-ops/use-workday";
// local imports
import { NotificationItem } from "./notification-item";
import { PushPrompt } from "./push-prompt";

/**
 * Team Ops notifications, on Plane's own notifications page, so there is one place to look. A thin bar that
 * opens into the list; it is not there at all for people who have none.
 */
export const TeamNotificationsStrip = observer(function TeamNotificationsStrip({
  workspaceSlug,
}: {
  workspaceSlug: string;
}) {
  const [open, setOpen] = useState(false);
  const { notifications, unread, markRead } = useOpsNotifications(workspaceSlug);
  const items = notifications ?? [];
  if (items.length === 0) return <PushPrompt workspaceSlug={workspaceSlug} mode="settings" />;

  return (
    <>
      <PushPrompt workspaceSlug={workspaceSlug} mode="settings" />
      <section aria-label="Team notifications" className="border-b border-subtle bg-surface-1">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex w-full items-center justify-between gap-2 px-4 py-2 text-left"
        >
          <span className="flex items-center gap-2 text-body-sm-medium text-primary">
            Team notifications
            {unread > 0 ? (
              <span className="rounded-full bg-accent-primary px-2 py-0.5 text-caption-sm-medium text-on-color">
                {unread} new
              </span>
            ) : null}
          </span>
          <span className="text-caption-sm-regular text-tertiary">{open ? "Hide" : "Show"}</span>
        </button>
        {open ? (
          <ul className="flex max-h-80 flex-col divide-y divide-subtle overflow-y-auto border-t border-subtle px-4">
            {items.slice(0, 30).map((item) => (
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
        ) : null}
      </section>
    </>
  );
});
