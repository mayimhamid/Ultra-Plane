/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { InboxOutline } from "@makeplane/propel/icons";
import { cn } from "@plane/utils";
// hooks
import { useWorkspaceNotifications } from "@/hooks/store/notifications";
import { useOpsUnread } from "@/hooks/team-ops/use-ops-unread";

/** The Notifications item of the sidebar: Plane's and Team Ops' unread notifications as one red dot. */
export const NotificationsNavIcon = observer(function NotificationsNavIcon({ className }: { className?: string }) {
  const { workspaceSlug } = useParams();
  const { unreadNotificationsCount, getUnreadNotificationsCount } = useWorkspaceNotifications();
  useSWR(
    workspaceSlug ? "WORKSPACE_UNREAD_NOTIFICATION_COUNT" : null,
    workspaceSlug ? () => getUnreadNotificationsCount(workspaceSlug.toString()) : null
  );
  const opsUnread = useOpsUnread(workspaceSlug?.toString());
  const total =
    (unreadNotificationsCount.mention_unread_notifications_count > 0
      ? unreadNotificationsCount.mention_unread_notifications_count
      : unreadNotificationsCount.total_unread_notifications_count) + opsUnread;
  return (
    <span className="relative inline-flex">
      <InboxOutline className={cn("size-4 flex-shrink-0", className)} />
      {total > 0 ? (
        <span
          aria-label={`${total} unread`}
          className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-danger-primary"
        />
      ) : null}
    </span>
  );
});
