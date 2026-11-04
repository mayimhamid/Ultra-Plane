/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
// plane helpers
import { useOutsideClickDetector } from "@plane/hooks";
import { useTranslation } from "@plane/i18n";
import { PreferencesOutline } from "@makeplane/propel/icons";
import { ScrollArea } from "@makeplane/propel/components/scroll-area";
// components
import { CustomizeNavigationDialog } from "@/components/navigation/customize-navigation-dialog";
// hooks
import { useAppTheme } from "@/hooks/store/use-app-theme";
import useSize from "@/hooks/use-window-size";
// plane web components
import { WorkspaceEditionBadge } from "@/components/workspace/edition-badge";
import { AppSidebarToggleButton } from "./sidebar-toggle-button";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { Icon } from "@makeplane/propel/components/icon";

type TSidebarWrapperProps = {
  title: string;
  children: React.ReactNode;
  quickActions?: React.ReactNode;
};

export const SidebarWrapper = observer(function SidebarWrapper(props: TSidebarWrapperProps) {
  const { title, children, quickActions } = props;
  // translation
  const { t } = useTranslation();
  // state
  const [isCustomizeNavDialogOpen, setIsCustomizeNavDialogOpen] = useState(false);
  // store hooks
  const { toggleSidebar, sidebarCollapsed } = useAppTheme();
  const windowSize = useSize();
  // refs
  const ref = useRef<HTMLDivElement>(null);

  useOutsideClickDetector(ref, () => {
    if (sidebarCollapsed === false && window.innerWidth < 768) {
      toggleSidebar();
    }
  });

  // Phones: a tap anywhere outside the open sidebar closes it. iOS sends no mouse event for a tap on a plain
  // area, so the click detector above misses it; pointer events cover touch.
  useEffect(() => {
    if (sidebarCollapsed !== false) return;
    const onPointer = (event: PointerEvent) => {
      if (window.innerWidth >= 768 || !ref.current) return;
      const target = event.target as Node;
      // Menus opened from the sidebar are rendered elsewhere (portals): tapping them must not close it.
      const inPortal = (target as Element).closest?.("[data-headlessui-portal], [role='menu'], [role='dialog']");
      if (!ref.current.contains(target) && !inPortal) toggleSidebar();
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
      <CustomizeNavigationDialog isOpen={isCustomizeNavDialogOpen} onClose={() => setIsCustomizeNavDialogOpen(false)} />
      <div ref={ref} className="flex h-full w-full animate-fade-in flex-col">
        <div className="flex flex-col gap-3 px-3">
          {/* Workspace switcher and settings */}

          <div className="flex items-center justify-between gap-2 px-2">
            <span className="pt-1 text-16 font-medium text-primary">{title}</span>
            <div className="flex items-center gap-2">
              {title === "Projects" && (
                <IconButton
                  size="sm"
                  variant="ghost"
                  icon={<Icon icon={PreferencesOutline} />}
                  aria-label={t("customize_navigation")}
                  onClick={() => setIsCustomizeNavDialogOpen(true)}
                />
              )}
              <AppSidebarToggleButton />
            </div>
          </div>
          {/* Quick actions */}
          {quickActions}
        </div>

        <ScrollArea orientation="vertical">
          <div className="flex flex-col gap-3 overflow-x-hidden px-3 pt-3 pb-0.5">{children}</div>
        </ScrollArea>
        {/* Help Section */}
        <div className="flex h-12 items-center justify-between border-t border-subtle bg-surface-1 p-3">
          <WorkspaceEditionBadge />
          {/* TODO: To be checked if we need this */}
          {/* <div className="flex items-center gap-2">
          {!shouldRenderAppRail && <HelpMenu />}
          {!isAppRailEnabled && <AppSidebarToggleButton />}
        </div> */}
        </div>
      </div>
    </>
  );
});
