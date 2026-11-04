/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// components
import { observer } from "mobx-react";
import { cn } from "@plane/utils";
import { TopNavPowerK } from "@/components/navigation";
import { HelpMenuRoot } from "@/components/workspace/sidebar/help-section/root";
import { UserMenuRoot } from "@/components/workspace/sidebar/user-menu-root";
import { WorkspaceMenuRoot } from "@/components/workspace/sidebar/workspace-menu-root";
import { useAppRailPreferences } from "@/hooks/use-navigation-preferences";
// local imports

export const TopNavigationRoot = observer(function TopNavigationRoot() {
  // store hooks
  const { preferences } = useAppRailPreferences();

  const showLabel = preferences.displayMode === "icon_with_label";

  return (
    <div
      className={cn("z-[27] flex min-h-10 w-full items-center bg-canvas px-3.5 transition-all duration-300", {
        "px-2": !showLabel,
      })}
    >
      {/* Workspace Menu */}
      <div className="min-w-fit flex-1 shrink-0">
        <WorkspaceMenuRoot variant="top-navigation" />
      </div>
      {/* Power K Search */}
      {/* Phones: no command search here (it crowded the bar). Notifications are in the sidebar. */}
      <div className="top-nav-search hidden min-w-0 shrink sm:block [&>div]:min-w-0 [&>div>div:first-child]:max-w-full">
        <TopNavPowerK />
      </div>
      {/* Additional Actions */}
      <div className="flex min-w-fit flex-1 shrink-0 items-center justify-end gap-1">
        <HelpMenuRoot />
        <div className="flex size-8 items-center justify-center rounded-md hover:bg-layer-1-hover">
          <UserMenuRoot />
        </div>
      </div>
    </div>
  );
});
