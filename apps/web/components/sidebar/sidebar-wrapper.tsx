/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef } from "react";
import { observer } from "mobx-react";
// plane helpers
import { ScrollArea } from "@makeplane/propel/components/scroll-area";
// components
// hooks
import { useAppTheme } from "@/hooks/store/use-app-theme";
import useSize from "@/hooks/use-window-size";
// plane web components
import { AccountSwitcher } from "@/components/team-ops/sidebar/account-switcher";
import { SettingsSection } from "@/components/team-ops/sidebar/settings-section";
import { AppSidebarToggleButton } from "./sidebar-toggle-button";

type TSidebarWrapperProps = {
  title: string;
  children: React.ReactNode;
  quickActions?: React.ReactNode;
};

export const SidebarWrapper = observer(function SidebarWrapper(props: TSidebarWrapperProps) {
  const { title, children, quickActions } = props;
  // store hooks
  const { toggleSidebar, sidebarCollapsed } = useAppTheme();
  const windowSize = useSize();
  // refs
  const ref = useRef<HTMLDivElement>(null);

  // Phones: a tap anywhere outside the open sidebar closes it. The page has two copies of the sidebar (the
  // docked one and the one that slides over the page); a tap inside either is inside, otherwise one copy closed
  // the sidebar before the tapped item could open (the "items do not react" problem). Pointer events also
  // cover taps on plain areas, which iOS reports without any mouse event.
  useEffect(() => {
    if (sidebarCollapsed !== false) return;
    const onPointer = (event: PointerEvent) => {
      if (window.innerWidth >= 768) return;
      const target = event.target as Element | null;
      if (!target?.closest) return;
      const inside = target.closest(
        "[data-app-sidebar], [data-headlessui-portal], [role='menu'], [role='dialog'], [role='listbox'], [aria-label*='sidebar' i]"
      );
      if (!inside) toggleSidebar();
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [sidebarCollapsed, toggleSidebar]);

  useEffect(() => {
    if (windowSize[0] < 768 && !sidebarCollapsed) toggleSidebar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowSize]);

  return (
    <>
      <div ref={ref} data-app-sidebar className="flex h-full w-full animate-fade-in flex-col">
        <div className="flex flex-col gap-3 px-3">
          {/* Account and workspaces (Team Ops): replaces the top bar's workspace and account menus. */}
          <div className="flex items-start gap-1">
            <div className="min-w-0 flex-1">
              {title === "Projects" ? (
                <AccountSwitcher />
              ) : (
                <span className="block px-2 pt-1 text-16 font-medium text-primary">{title}</span>
              )}
            </div>
            <div className="pt-2">
              <AppSidebarToggleButton />
            </div>
          </div>
          {/* Quick actions */}
          {quickActions}
        </div>

        <ScrollArea orientation="vertical">
          <div className="flex flex-col gap-3 overflow-x-hidden px-3 pt-3 pb-0.5">{children}</div>
        </ScrollArea>
        {/* Settings: workspace, account, help and sign out, all in one place at the bottom. */}
        <div className="border-t border-subtle bg-surface-1 px-3 py-2">
          <SettingsSection />
        </div>
      </div>
    </>
  );
});
