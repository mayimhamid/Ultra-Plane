/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
import { Badge } from "@makeplane/propel/components/badge";
import { SelectField } from "@makeplane/propel/components/select-field";
import { controlRange, formatHm, toDateKey } from "@plane/services";
import type { TControlPreset } from "@plane/services";
import { cn } from "@plane/utils";
// hooks
import { controlService } from "@/hooks/team-ops/use-control";

type Props = { workspaceSlug: string };

const PRESETS: { value: TControlPreset; label: string }[] = [
  { value: "week", label: "This week" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

const MEDAL = ["🥇", "🥈", "🥉"];
const BADGE_VARIANT: Record<string, "brand" | "success" | "warning" | "neutral"> = {
  "Most tasks": "brand",
  "Most hours": "success",
  Hyperactive: "warning",
  "Most consistent": "neutral",
};

/** Who finished the most tasks and the most hours, with a few badges. Parallel work is shown, never added to hours. */
export const RankingControl = observer(function RankingControl({ workspaceSlug }: Props) {
  const [preset, setPreset] = useState<TControlPreset>("30");
  const [by, setBy] = useState<"tasks" | "hours">("tasks");
  const range = useMemo(() => controlRange(preset, toDateKey(new Date())), [preset]);
  const { data } = useSWR(`TEAM_OPS_CONTROL_RANKING_${workspaceSlug}_${preset}`, () =>
    controlService.getRanking(workspaceSlug, range)
  );
  const rows = useMemo(() => {
    const field = by === "tasks" ? "rank_tasks" : "rank_hours";
    return [...(data ?? [])].sort(
      (a, b) => (a[field] ?? 999) - (b[field] ?? 999) || a.user.display_name.localeCompare(b.user.display_name)
    );
  }, [data, by]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44 [&_button]:min-w-0">
          <SelectField
            size="lg"
            label="Period"
            options={PRESETS}
            value={preset}
            onValueChange={(value) => setPreset((value ?? "30") as TControlPreset)}
          />
        </div>
        <div role="group" aria-label="Rank by" className="flex gap-1 rounded-lg border border-subtle p-0.5">
          {(["tasks", "hours"] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={by === item}
              onClick={() => setBy(item)}
              className={cn(
                "rounded-md px-3 py-1.5 text-body-xs-medium",
                by === item ? "bg-accent-subtle text-accent-primary" : "text-tertiary hover:text-secondary"
              )}
            >
              By {item}
            </button>
          ))}
        </div>
      </div>
      <ol className="flex flex-col gap-2">
        {rows.map((row) => {
          const rank = by === "tasks" ? row.rank_tasks : row.rank_hours;
          return (
            <li
              key={row.user.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-subtle bg-surface-1 px-4 py-3"
            >
              <span className="w-8 text-center text-h5-medium text-primary">
                {rank === null ? "–" : rank <= 3 ? MEDAL[rank - 1] : rank}
              </span>
              <div className="min-w-40 flex-1">
                <p className="text-body-sm-medium text-primary">{row.user.display_name}</p>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {row.badges.map((badge) => (
                    <Badge key={badge} variant={BADGE_VARIANT[badge] ?? "neutral"} size="sm" label={badge} />
                  ))}
                </div>
              </div>
              <dl className="flex flex-wrap gap-x-6 gap-y-1 text-body-xs-regular text-secondary">
                <div>
                  <dt className="text-tertiary">Tasks</dt>
                  <dd className="text-primary tabular-nums">{row.tasks}</dd>
                </div>
                <div>
                  <dt className="text-tertiary">Finished</dt>
                  <dd className="text-primary tabular-nums">{row.finished}</dd>
                </div>
                <div>
                  <dt className="text-tertiary">Hours</dt>
                  <dd className="text-primary tabular-nums">{formatHm(row.seconds)}</dd>
                </div>
                <div>
                  <dt className="text-tertiary">Parallel</dt>
                  <dd className="tabular-nums" style={{ color: row.parallel_seconds > 0 ? "#8b5cf6" : undefined }}>
                    {formatHm(row.parallel_seconds)}
                  </dd>
                </div>
                <div>
                  <dt className="text-tertiary">Active days</dt>
                  <dd className="text-primary tabular-nums">{row.active_days}</dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ol>
    </div>
  );
});
