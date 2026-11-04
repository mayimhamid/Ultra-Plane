/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  BookOpen,
  Building2,
  ChevronUp,
  Keyboard,
  LayoutList,
  LogOut,
  Mail,
  MessagesSquare,
  Settings,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { setToast } from "@plane/blocks/toast";
import { cn } from "@plane/utils";
// components
import { ProductUpdatesModal } from "@/components/global";
import { CustomizeNavigationDialog } from "@/components/navigation/customize-navigation-dialog";
// hooks
import { useAppTheme } from "@/hooks/store/use-app-theme";
import { useCommandPalette } from "@/hooks/store/use-command-palette";
import { usePowerK } from "@/hooks/store/use-power-k";
import { useUser } from "@/hooks/store/user";

const rowClass =
  "flex min-h-10 w-full items-center gap-3 rounded-md px-2 text-left text-body-sm-regular text-secondary hover:bg-layer-1 hover:text-primary";

function Row({
  icon: Icon,
  label,
  href,
  onClick,
  danger,
}: {
  icon: LucideIcon;
  label: string;
  href?: string;
  onClick?: () => void;
  danger?: boolean;
}) {
  const content = (
    <>
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
    </>
  );
  const className = cn(rowClass, danger && "text-danger-primary hover:text-danger-primary");
  return href ? (
    <Link href={href} onClick={onClick} className={className}>
      {content}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  );
}

/**
 * The bottom of the sidebar: one "Settings" entry that opens, in place, everything that used to be in the top
 * bar and the account menus: workspace and account settings, help and documentation, and signing out.
 */
export const SettingsSection = observer(function SettingsSection() {
  const { workspaceSlug } = useParams();
  const [open, setOpen] = useState(false);
  const [isCustomizeOpen, setIsCustomizeOpen] = useState(false);
  const [isUpdatesOpen, setIsUpdatesOpen] = useState(false);
  const { toggleSidebar } = useAppTheme();
  const { toggleProfileSettingsModal } = useCommandPalette();
  const { toggleShortcutsListModal } = usePowerK();
  const { signOut } = useUser();
  const slug = workspaceSlug?.toString() ?? "";

  // On a phone, leaving for another page closes the sidebar, like the other menu items.
  const leave = () => {
    setOpen(false);
    if (window.innerWidth < 768) toggleSidebar();
  };
  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div className="flex flex-col gap-0.5">
      <CustomizeNavigationDialog isOpen={isCustomizeOpen} onClose={() => setIsCustomizeOpen(false)} />
      <ProductUpdatesModal isOpen={isUpdatesOpen} handleClose={() => setIsUpdatesOpen(false)} />
      {open ? (
        <div className="flex max-h-[60dvh] flex-col gap-0.5 overflow-y-auto overscroll-contain pb-1">
          <p className="px-2 pt-1 text-caption-sm-medium text-tertiary">Workspace</p>
          <Row icon={Building2} label="Workspace settings" href={`/${slug}/settings`} onClick={leave} />
          <Row icon={Users} label="Members and invites" href={`/${slug}/settings/members`} onClick={leave} />
          <Row icon={LayoutList} label="Customize the sidebar" onClick={run(() => setIsCustomizeOpen(true))} />
          <Row icon={Mail} label="My workspace invitations" href="/invitations" onClick={leave} />
          <p className="px-2 pt-2 text-caption-sm-medium text-tertiary">Account</p>
          <Row
            icon={UserRound}
            label="Account settings"
            onClick={run(() => toggleProfileSettingsModal({ activeTab: "general", isOpen: true }))}
          />
          <Row
            icon={SlidersHorizontal}
            label="Preferences (theme, language)"
            onClick={run(() => toggleProfileSettingsModal({ activeTab: "preferences", isOpen: true }))}
          />
          <p className="px-2 pt-2 text-caption-sm-medium text-tertiary">Help</p>
          <Row
            icon={BookOpen}
            label="Documentation"
            onClick={run(() => window.open("https://go.plane.so/p-docs", "_blank", "noopener,noreferrer"))}
          />
          <Row icon={Keyboard} label="Keyboard shortcuts" onClick={run(() => toggleShortcutsListModal(true))} />
          <Row icon={Sparkles} label="What's new" onClick={run(() => setIsUpdatesOpen(true))} />
          <Row
            icon={MessagesSquare}
            label="Forum"
            onClick={run(() => window.open("https://forum.plane.so", "_blank", "noopener,noreferrer"))}
          />
          <div className="my-1 h-px bg-layer-1" />
          <Row
            icon={LogOut}
            label="Sign out"
            danger
            onClick={run(() => {
              signOut().catch(() =>
                setToast({ type: "error", title: "Could not sign out", message: "Try again in a moment." })
              );
            })}
          />
        </div>
      ) : null}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(rowClass, "font-medium", open && "bg-layer-1 text-primary")}
      >
        <Settings className="size-4 shrink-0" aria-hidden />
        <span className="flex-1">Settings</span>
        <ChevronUp aria-hidden className={cn("size-4 transition-transform", !open && "rotate-180")} />
      </button>
    </div>
  );
});
