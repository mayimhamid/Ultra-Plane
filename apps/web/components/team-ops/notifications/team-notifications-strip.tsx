/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { cn } from "@plane/utils";
// hooks
import { useOpsNotifications } from "@/hooks/team-ops/use-workday";
// local imports
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
  if (items.length === 0) return <PushPrompt workspaceSlug={workspaceSlug} />;

  return (
    <>
      <PushPrompt workspaceSlug={workspaceSlug} />
      <section aria-label="Team notifications" className="border-b border-subtle bg-surface-1">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex w-full items-center justify-between gap-2 px-4 py-2 text-left"
        >
          <span className="text-body-sm-medium text-primary">
            Team notifications{unread > 0 ? ` (${unread} new)` : ""}
          </span>
          <span className="text-caption-sm-regular text-tertiary">{open ? "Hide" : "Show"}</span>
        </button>
        {open ? (
          <ul className="flex max-h-60 flex-col divide-y divide-subtle overflow-y-auto border-t border-subtle">
            {items.slice(0, 20).map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-2">
                <Link
                  href={item.link ? `/${workspaceSlug}/${item.link.replace(/^\/+/, "")}/` : "#"}
                  onClick={() => !item.read && void markRead(item.id)}
                  className={cn(
                    "min-w-0 truncate text-body-sm-regular hover:underline",
                    item.read ? "text-secondary" : "font-medium text-primary"
                  )}
                >
                  {item.title}
                </Link>
                <button
                  type="button"
                  className="shrink-0 text-caption-sm-medium text-tertiary hover:text-primary"
                  onClick={() => void markRead(item.id, !item.read)}
                >
                  {item.read ? "Mark unread" : "Mark read"}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </>
  );
});
