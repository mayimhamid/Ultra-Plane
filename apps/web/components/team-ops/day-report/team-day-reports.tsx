/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import Link from "next/link";
import { formatMinutes } from "@plane/services";
import { cn } from "@plane/utils";
// hooks
import { useTeamDayReports } from "@/hooks/team-ops/use-day-report";
// components
import { PersonAvatar } from "../hub/person-avatar";

type Props = { workspaceSlug: string; day: string };

/** For managers: everyone's report of the day. A tap opens it, with its changes. */
export function TeamDayReports({ workspaceSlug, day }: Props) {
  const { data } = useTeamDayReports(workspaceSlug, day, true);
  const rows = data?.results ?? [];
  if (rows.length === 0) return null;
  const sent = rows.filter((row) => row.status === "SUBMITTED").length;
  return (
    <section
      aria-label="Team day reports"
      className="flex flex-col gap-2 rounded-lg border border-subtle bg-surface-1 p-4"
    >
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="text-body-md-medium text-primary">Team reports</h3>
        <span className="text-caption-sm-regular text-tertiary">
          {sent} of {rows.length} sent
        </span>
      </header>
      <ul className="flex flex-col divide-y divide-subtle">
        {rows.map((row) => (
          <li key={row.user.id}>
            <Link
              href={`/${workspaceSlug}/team-ops/workday/?date=${day}&user=${row.user.id}`}
              className="flex min-h-12 items-center gap-3 py-2 hover:bg-layer-1"
            >
              <PersonAvatar person={row.user} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body-sm-medium text-primary">{row.user.display_name}</span>
                <span className="text-caption-sm-regular text-tertiary">
                  {row.mode ? `${row.mode.charAt(0)}${row.mode.slice(1).toLowerCase()} · ` : ""}
                  {row.edit_count > 0 ? `edited ${row.edit_count}× · ` : ""}
                  {row.is_late ? "late" : ""}
                </span>
              </span>
              <span className="text-body-sm-medium text-primary tabular-nums">{formatMinutes(row.total_minutes)}</span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-caption-sm-medium",
                  row.status === "SUBMITTED"
                    ? "bg-success-subtle text-success-primary"
                    : row.status === "DRAFT"
                      ? "bg-warning-subtle text-warning-primary"
                      : "bg-layer-1 text-tertiary"
                )}
              >
                {row.status === "SUBMITTED" ? "Sent" : row.status === "DRAFT" ? "Draft" : "Not yet"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
