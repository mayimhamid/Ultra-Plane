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
import { AIAsk } from "./ai-ask";
import { AIDailyReview } from "./ai-daily-review";
import { AIQuality } from "./ai-quality";
import { AISettingsCard } from "./ai-settings-card";
import { AITeamTab } from "./ai-team-tab";

const SECTIONS = [
  { key: "quality", label: "Quality" },
  { key: "evidence", label: "Evidence" },
  { key: "daily", label: "Daily review" },
  { key: "ask", label: "Ask" },
] as const;

type TSection = (typeof SECTIONS)[number]["key"];
type Props = { workspaceSlug: string };

/** Dashboard › AI for managers: Quality and Evidence (no AI needed), Daily review and Ask, with the AI settings on top. */
export const AIManagersTab = observer(function AIManagersTab({ workspaceSlug }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { permissions } = useCalendarSettings(workspaceSlug);
  const requested = searchParams.get("ai");
  const section: TSection = SECTIONS.find((item) => item.key === requested)?.key ?? "quality";

  if (!permissions) return null;
  if (!permissions.can_view_team) {
    return (
      <div className="mx-auto w-full max-w-3xl p-6">
        <p className="rounded-lg border border-dashed border-subtle p-4 text-body-sm-regular text-tertiary">
          The AI tab is only open to the people your workspace admins chose.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <AISettingsCard workspaceSlug={workspaceSlug} />
      <div role="tablist" aria-label="AI" className="flex gap-1">
        {SECTIONS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={section === item.key}
            onClick={() => setSearchParams({ view: "ai", ai: item.key })}
            className={cn(
              "min-h-9 rounded-md px-3 text-body-xs-medium",
              section === item.key ? "bg-layer-1 text-primary" : "text-tertiary hover:text-secondary"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      {section === "quality" ? <AIQuality workspaceSlug={workspaceSlug} /> : null}
      {section === "evidence" ? <AITeamTab workspaceSlug={workspaceSlug} /> : null}
      {section === "daily" ? <AIDailyReview workspaceSlug={workspaceSlug} /> : null}
      {section === "ask" ? <AIAsk workspaceSlug={workspaceSlug} /> : null}
    </div>
  );
});
