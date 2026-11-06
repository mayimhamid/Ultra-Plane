/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useSearchParams } from "react-router";
import { cn } from "@plane/utils";
// hooks
import { useCalendarSettings } from "@/hooks/team-ops/use-work-calendar";
// local imports
import { FlowControl } from "./flow-control";
import { HubControl } from "./hub-control";
import { ReportExport } from "./report-export";
import { ReportHours } from "./report-hours";
import { ReportRanking } from "./report-ranking";

type Props = { workspaceSlug: string; /** Inside the Dashboard: no title of its own. */ embedded?: boolean };

/**
 * Control: what the team reported in their Day Reports (hours per person and day, by week or month, with each
 * day's tasks a tap away), the ranking and the export; admins also watch the Hub and the flows.
 */
export const ControlRoot = observer(function ControlRoot({ workspaceSlug, embedded = false }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { permissions, isLoading } = useCalendarSettings(workspaceSlug);
  const canTeam = permissions?.can_view_team ?? false;
  const isAdmin = permissions?.can_manage ?? false;

  const tabs = [
    ...(canTeam
      ? [
          { key: "hours", label: "Hours", hint: "Reported hours per person and day, by week or month" },
          { key: "ranking", label: "Ranking", hint: "Hours, tasks done and on time" },
          { key: "export", label: "Export", hint: "Everyone's hours between two dates, to Excel" },
        ]
      : []),
    ...(isAdmin
      ? [
          { key: "hub", label: "Hub control", hint: "Channels and messages" },
          { key: "flows", label: "Teamflow control", hint: "Project flows and hand-offs" },
        ]
      : []),
  ];
  const requested = searchParams.get("tab");
  const tab = tabs.find((item) => item.key === requested)?.key ?? tabs[0]?.key;

  if (!isLoading && tabs.length === 0) {
    return (
      <p className="mx-auto max-w-xl p-6 text-body-sm-regular text-secondary">
        Control is for admins and team leads. Ask an admin if you need to see how the team is working.
      </p>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 sm:p-6">
      {embedded ? null : (
        <header>
          <h1 className="text-h4-medium text-primary">Control</h1>
          <p className="text-body-sm-regular text-secondary">
            What the team reported: hours per person and day, the tasks behind them, and how they went.
          </p>
        </header>
      )}
      <nav aria-label="Control" className="flex gap-1 overflow-x-auto border-b border-subtle">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            aria-current={tab === item.key ? "page" : undefined}
            title={item.hint}
            onClick={() =>
              setSearchParams((previous) => {
                const next = new URLSearchParams(previous);
                if (item.key === tabs[0].key) next.delete("tab");
                else next.set("tab", item.key);
                return next;
              })
            }
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 py-2 text-body-sm-medium whitespace-nowrap transition-colors",
              tab === item.key
                ? "border-accent-strong text-primary"
                : "border-transparent text-tertiary hover:text-secondary"
            )}
          >
            {item.label}
          </button>
        ))}
      </nav>
      {tab === "hours" ? <ReportHours workspaceSlug={workspaceSlug} /> : null}
      {tab === "ranking" ? <ReportRanking workspaceSlug={workspaceSlug} /> : null}
      {tab === "export" ? <ReportExport workspaceSlug={workspaceSlug} /> : null}
      {tab === "hub" ? <HubControl workspaceSlug={workspaceSlug} /> : null}
      {tab === "flows" ? <FlowControl workspaceSlug={workspaceSlug} /> : null}
    </div>
  );
});
