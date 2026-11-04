/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import useSWR from "swr";
import { Badge } from "@makeplane/propel/components/badge";
import { cn } from "@plane/utils";
// hooks
import { controlService } from "@/hooks/team-ops/use-control";
import { useOpsNotifications } from "@/hooks/team-ops/use-workday";
// components
import { NotificationItem } from "../notifications/notification-item";

/** The caller's own notifications. Click one to open it; the small button marks it read or unread. */
export const NotificationsBox = observer(function NotificationsBox({
  workspaceSlug,
  title = "My notifications",
}: {
  workspaceSlug: string;
  title?: string;
}) {
  const { notifications, unread, markRead } = useOpsNotifications(workspaceSlug);
  return (
    <section aria-label={title} className="flex flex-col gap-2 rounded-lg border border-subtle bg-surface-1 p-4">
      <header className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-body-md-medium text-primary">
          {title}
          {unread > 0 ? <Badge variant="warning" size="sm" label={`${unread} new`} /> : null}
        </h3>
        {unread > 0 ? (
          <button
            type="button"
            className="text-body-xs-medium text-accent-primary hover:underline"
            onClick={() => markRead()}
          >
            Mark all read
          </button>
        ) : null}
      </header>
      {(notifications ?? []).length === 0 ? (
        <p className="text-body-sm-regular text-tertiary">Nothing yet.</p>
      ) : (
        <ul className="flex max-h-80 flex-col divide-y divide-subtle overflow-y-auto">
          {(notifications ?? []).slice(0, 20).map((item) => (
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
      )}
    </section>
  );
});

/** What one person was told and whether they have read it. For managers; titles only. */
export function PersonNotifications({ workspaceSlug, userId }: { workspaceSlug: string; userId: string }) {
  const { data } = useSWR(`TEAM_OPS_CONTROL_PERSON_NOTIFICATIONS_${workspaceSlug}_${userId}`, () =>
    controlService.getPersonNotifications(workspaceSlug, userId)
  );
  return (
    <section
      aria-label="Notifications of this person"
      className="flex flex-col gap-2 rounded-lg border border-subtle p-4"
    >
      <h4 className="text-body-md-medium text-primary">Notifications</h4>
      {(data ?? []).length === 0 ? (
        <p className="text-body-sm-regular text-tertiary">None.</p>
      ) : (
        <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
          {(data ?? []).map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2 text-body-xs-regular">
              <span className="min-w-0 truncate text-primary">{item.title}</span>
              <span className={cn("shrink-0", item.read ? "text-success-primary" : "text-warning-primary")}>
                {item.read ? "Read" : "Not read"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
