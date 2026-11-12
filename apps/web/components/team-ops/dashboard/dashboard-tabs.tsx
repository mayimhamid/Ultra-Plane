/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import Link from "next/link";
import { cn } from "@plane/utils";
// hooks
import { useAIStatus } from "@/hooks/team-ops/use-ai";
import { useCalendarSettings } from "@/hooks/team-ops/use-work-calendar";

export type TDashboardTab = "overview" | "tasks" | "control" | "ai" | "assistant" | "views" | "analytics" | "archives";

const TABS: { key: TDashboardTab; label: string; managers: boolean; path: string; needsAI?: boolean }[] = [
  { key: "overview", label: "Overview", managers: true, path: "team-ops/dashboard/" },
  { key: "tasks", label: "Tasks", managers: false, path: "team-ops/dashboard/?view=tasks" },
  { key: "control", label: "Control", managers: true, path: "team-ops/dashboard/?view=control" },
  // Work evidence works without AI, so managers always have this tab.
  { key: "ai", label: "AI", managers: true, path: "team-ops/dashboard/?view=ai" },
  { key: "assistant", label: "Assistant", managers: false, path: "team-ops/dashboard/?view=assistant", needsAI: true },
  { key: "views", label: "Views", managers: false, path: "workspace-views/all-issues/" },
  { key: "analytics", label: "Analytics", managers: false, path: "analytics/overview/" },
  { key: "archives", label: "Archives", managers: false, path: "projects/archives/" },
];

type Props = { workspaceSlug: string; active: TDashboardTab };

/**
 * The tabs of the Dashboard. They are on the Dashboard and also on the Views, Analytics and Archives pages it
 * links to, so a person who opens one of them can always go back, whether they are an admin or a member.
 */
export const DashboardTabs = observer(function DashboardTabs({ workspaceSlug, active }: Props) {
  const { permissions } = useCalendarSettings(workspaceSlug);
  const { usable } = useAIStatus(workspaceSlug);
  const showControl = (permissions?.can_view_team ?? false) || (permissions?.can_manage ?? false);
  // People who may not see the team have no Overview or Control; their Dashboard opens on Tasks.
  // The Assistant only shows when the workspace has AI.
  const tabs = TABS.filter((tab) => (!tab.managers || showControl) && (!tab.needsAI || usable));

  return (
    <nav
      aria-label="Dashboard"
      className="mx-auto flex w-full max-w-6xl shrink-0 gap-1 overflow-x-auto border-b border-subtle px-4 pt-4 sm:px-6"
    >
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={`/${workspaceSlug}/${tab.path}`}
          aria-current={active === tab.key ? "page" : undefined}
          className={cn(
            "-mb-px shrink-0 border-b-2 px-3 py-2 text-body-sm-medium whitespace-nowrap",
            active === tab.key
              ? "border-accent-strong text-primary"
              : "border-transparent text-tertiary hover:text-secondary"
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
});
