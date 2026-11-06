/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { formatMinutes, toDateKey } from "@plane/services";
import { cn, getFileURL } from "@plane/utils";
// hooks
import { useDayReport } from "@/hooks/team-ops/use-day-report";
// components
import { personColor } from "../hub/person-avatar";

type Props = {
  workspaceSlug: string;
  user: { id: string; display_name: string; first_name?: string; last_name?: string; avatar_url?: string | null };
  stats: [label: string, value: string][];
};

const initialsOf = (name: string) =>
  name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";

/** Today's Day Report in one line, so the first thing on Home says whether the day has been reported. */
const TodayStatus = observer(function TodayStatus({ workspaceSlug }: { workspaceSlug: string }) {
  const { report } = useDayReport(workspaceSlug, toDateKey(new Date()));
  const rows = report?.entries.length ?? 0;
  const sent = report?.status === "SUBMITTED";
  const empty = !report || rows === 0;
  const label = empty ? "Nothing logged yet" : sent ? "Sent" : "Draft, not sent";
  const tone = empty ? "bg-[#f59e0b]" : sent ? "bg-[#16a34a]" : "bg-[#3b82f6]";
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-subtle bg-surface-1 px-3 py-2.5">
      <p className="text-caption-sm-medium text-tertiary">Today</p>
      <p className="flex items-center gap-2 text-body-sm-medium text-primary">
        <span aria-hidden className={cn("size-2 rounded-full", tone)} />
        {report ? label : "Loading..."}
      </p>
      {!empty && report ? (
        <p className="text-caption-sm-regular text-secondary tabular-nums">
          {formatMinutes(report.total_minutes)} on {rows} row{rows === 1 ? "" : "s"}
        </p>
      ) : null}
    </div>
  );
});

/** Home's left column, as on a GitHub profile: a big picture, the name, the main action and the numbers. */
export function ProfileCard({ workspaceSlug, user, stats }: Props) {
  const [broken, setBroken] = useState(false);
  const src = user.avatar_url && !broken ? getFileURL(user.avatar_url) : undefined;
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ");
  return (
    <section aria-label="Profile" className="flex flex-col gap-4">
      <div className="mx-auto aspect-square w-48 max-w-full overflow-hidden rounded-full border border-subtle lg:w-full">
        {src ? (
          <img src={src} alt="" onError={() => setBroken(true)} className="size-full object-cover" />
        ) : (
          <span
            aria-hidden
            className="flex size-full items-center justify-center text-[88px] font-semibold text-white"
            style={{ backgroundColor: personColor(user.id) }}
          >
            {initialsOf(user.display_name)}
          </span>
        )}
      </div>
      <div className="text-center lg:text-left">
        <h1 className="text-h3-medium text-primary">{fullName || user.display_name}</h1>
        {fullName ? <p className="text-body-lg-regular text-secondary">{user.display_name}</p> : null}
      </div>
      <TodayStatus workspaceSlug={workspaceSlug} />
      <Link
        href={`/${workspaceSlug}/team-ops/workday/`}
        className="rounded-md bg-accent-primary px-4 py-2 text-center text-body-sm-medium text-on-color hover:opacity-90"
      >
        Open Day Report
      </Link>
      <h2 className="border-t border-subtle pt-3 text-caption-sm-medium text-tertiary">Last 90 days</h2>
      <dl className="flex flex-col divide-y divide-subtle">
        {stats.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3 py-2">
            <dt className="text-body-sm-regular text-secondary">{label}</dt>
            <dd className="text-body-md-medium text-primary tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
