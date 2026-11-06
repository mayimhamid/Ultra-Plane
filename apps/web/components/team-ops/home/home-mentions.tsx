/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import Link from "next/link";
import { AtSign } from "lucide-react";
import { cn } from "@plane/utils";
// hooks
import { useHubMentions } from "@/hooks/team-ops/use-hub";
// components
import { PersonAvatar } from "../hub/person-avatar";

const when = (stamp: string) =>
  new Date(stamp).toLocaleString("en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Home starts with where the person was tagged in the Hub, the unread ones highlighted. */
export const HomeMentions = observer(function HomeMentions({ workspaceSlug }: { workspaceSlug: string }) {
  const { mentions, markAllRead } = useHubMentions(workspaceSlug, true);
  const list = (mentions ?? []).slice(0, 5);
  const unread = (mentions ?? []).filter((mention) => !mention.read).length;

  return (
    <section aria-label="Mentions" className="flex flex-col gap-1 rounded-lg border border-subtle bg-surface-1 p-3">
      <header className="flex flex-wrap items-center justify-between gap-x-2">
        <h2 className="flex items-center gap-2 text-body-sm-medium text-primary">
          <AtSign className="size-4 text-[#ea580c]" aria-hidden />
          Mentions
          {unread > 0 ? (
            <span className="rounded-full bg-accent-primary px-2 py-0.5 text-caption-sm-medium text-on-color">
              {unread} new
            </span>
          ) : null}
        </h2>
        <div className="flex items-center gap-3">
          {unread > 0 ? (
            <button
              type="button"
              onClick={() => void markAllRead()}
              className="min-h-8 text-body-xs-medium text-accent-primary hover:underline"
            >
              Mark all read
            </button>
          ) : null}
          <Link
            href={`/${workspaceSlug}/team-ops/hub/?section=mentions`}
            className="min-h-8 content-center text-body-xs-medium text-accent-primary hover:underline"
          >
            All
          </Link>
        </div>
      </header>
      {list.length === 0 ? (
        <p className="text-body-sm-regular text-tertiary">Nobody has tagged you yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-subtle">
          {list.map((mention) => (
            <li key={mention.id}>
              <Link
                href={`/${workspaceSlug}/team-ops/hub/?channel=${mention.channel}`}
                className={cn(
                  "flex min-h-11 items-start gap-2 rounded-md px-1.5 py-2 hover:bg-layer-1",
                  !mention.read && "bg-accent-subtle"
                )}
              >
                <PersonAvatar person={mention.author} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className={cn("text-body-sm-medium text-primary", !mention.read && "font-semibold")}>
                      {mention.author.display_name}
                    </span>
                    <span className="text-caption-sm-regular text-tertiary">{when(mention.created_at)}</span>
                    {mention.kind === "ATTENTION" ? (
                      <span className="text-caption-sm-medium text-warning-primary">Needs attention</span>
                    ) : null}
                  </span>
                  <span className="line-clamp-2 text-body-xs-regular text-secondary">{mention.body}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
});
