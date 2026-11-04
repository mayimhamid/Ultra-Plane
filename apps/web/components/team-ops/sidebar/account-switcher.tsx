/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { Check, ChevronDown, Plus } from "lucide-react";
import type { IWorkspace } from "@plane/types";
import { cn, orderWorkspacesList } from "@plane/utils";
// hooks
import { useAppTheme } from "@/hooks/store/use-app-theme";
import { useInstance } from "@/hooks/store/use-instance";
import { useWorkspace } from "@/hooks/store/use-workspace";
import { useUser, useUserProfile } from "@/hooks/store/user";
// components
import { WorkspaceLogo } from "@/components/workspace/logo";
import { PersonAvatar } from "../hub/person-avatar";

/**
 * The top of the sidebar, like a messenger: your round picture, your name and the workspace you are in. The
 * arrow opens the list of your workspaces right here (no pop-up, so it works well with a finger).
 */
export const AccountSwitcher = observer(function AccountSwitcher() {
  const [open, setOpen] = useState(false);
  const { data: currentUser } = useUser();
  const { updateUserProfile } = useUserProfile();
  const { currentWorkspace, workspaces } = useWorkspace();
  const { config } = useInstance();
  const { toggleSidebar } = useAppTheme();
  const list = orderWorkspacesList(Object.values(workspaces ?? {}));
  const canCreate = !(config?.is_workspace_creation_disabled ?? false);

  const choose = (workspace: IWorkspace) => {
    void updateUserProfile({ last_workspace_id: workspace.id });
    setOpen(false);
    if (window.innerWidth < 768) toggleSidebar();
  };

  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-label="Your account and workspaces"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-end gap-3 rounded-lg p-2 text-left hover:bg-layer-1"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-2">
          {currentUser ? (
            <PersonAvatar
              person={{
                id: currentUser.id,
                display_name: currentUser.display_name,
                avatar_url: currentUser.avatar_url,
              }}
              className="size-12 text-[18px]"
            />
          ) : null}
          <span className="min-w-0">
            <span className="block truncate text-body-sm-semibold text-primary">{currentUser?.display_name ?? ""}</span>
            <span className="block truncate text-caption-sm-regular text-accent-primary">
              {currentWorkspace?.name ?? ""}
            </span>
          </span>
        </span>
        <ChevronDown
          aria-hidden
          className={cn("mb-1 size-5 shrink-0 text-tertiary transition-transform", open && "rotate-180")}
        />
      </button>

      {open ? (
        <ul aria-label="Workspaces" className="mt-1 flex flex-col gap-0.5">
          {list.map((workspace) => {
            const active = workspace.id === currentWorkspace?.id;
            return (
              <li key={workspace.id}>
                <Link
                  href={`/${workspace.slug}`}
                  onClick={() => choose(workspace)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center gap-3 rounded-lg px-2 py-1.5",
                    active ? "bg-layer-1" : "hover:bg-layer-1"
                  )}
                >
                  <WorkspaceLogo
                    logo={workspace.logo_url}
                    name={workspace.name}
                    classNames="size-8 shrink-0 rounded-full border border-subtle"
                  />
                  <span className="min-w-0 flex-1 truncate text-body-sm-medium text-primary">{workspace.name}</span>
                  {active ? <Check aria-hidden className="size-4 shrink-0 text-accent-primary" /> : null}
                </Link>
              </li>
            );
          })}
          {canCreate ? (
            <li>
              <Link
                href="/create-workspace"
                className="flex min-h-11 items-center gap-3 rounded-lg px-2 py-1.5 text-body-sm-medium text-secondary hover:bg-layer-1"
              >
                <span className="inline-flex size-8 items-center justify-center rounded-full border border-dashed border-strong">
                  <Plus className="size-4" aria-hidden />
                </span>
                Create a workspace
              </Link>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
});
