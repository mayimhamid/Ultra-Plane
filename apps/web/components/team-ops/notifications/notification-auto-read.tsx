/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { useLocation } from "react-router";
// hooks
import { useOpsNotifications } from "@/hooks/team-ops/use-workday";
// local imports
import { notificationHref } from "./notification-item";

/**
 * A notification is read as soon as the page it is about is open: the Hub channel of a message, the Day Report of
 * a day, the work item that was given to you. It also covers a tapped push notification, which opens that page.
 */
export function NotificationAutoRead({ workspaceSlug }: { workspaceSlug: string }) {
  const { pathname, search } = useLocation();
  const { notifications, markSeen } = useOpsNotifications(workspaceSlug);

  useEffect(() => {
    const here = `${pathname}${search}`;
    for (const item of notifications ?? []) {
      if (!item.read && item.link && notificationHref(workspaceSlug, item.link) === here) markSeen(item.id);
    }
  }, [notifications, pathname, search, workspaceSlug, markSeen]);

  return null;
}
