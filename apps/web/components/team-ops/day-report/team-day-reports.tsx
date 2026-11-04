/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { formatMinutes } from "@plane/services";
import { cn } from "@plane/utils";
// hooks
import { dayReportService, useTeamDayReports } from "@/hooks/team-ops/use-day-report";
// components
import { PersonAvatar } from "../hub/person-avatar";

type Props = { workspaceSlug: string; day: string };

/** For managers: everyone's report of the day. A tap opens it, with its changes. */
const FILTERS = [
  { value: "", label: "All" },
  { value: "REMOTE", label: "Remote" },
  { value: "ONSITE", label: "Onsite" },
  { value: "HYBRID", label: "Hybrid" },
];

const weekAgo = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d - 6);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export function TeamDayReports({ workspaceSlug, day }: Props) {
  const [place, setPlace] = useState("");
  const [from, setFrom] = useState(() => weekAgo(day));
  const [to, setTo] = useState(day);
  const { data, isLoading } = useTeamDayReports(workspaceSlug, day, true, place);
  const rows = data?.results ?? [];
  const sent = rows.filter((row) => row.status === "SUBMITTED").length;
  const exportLink = dayReportService.exportUrl(workspaceSlug, from, to, place || undefined);
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
      <div role="group" aria-label="Where they worked" className="flex flex-wrap gap-1">
        {FILTERS.map((item) => (
          <button
            key={item.value || "all"}
            type="button"
            aria-pressed={place === item.value}
            onClick={() => setPlace(item.value)}
            className={cn(
              "min-h-9 rounded-full border px-3 text-caption-sm-medium",
              place === item.value
                ? "border-accent-strong bg-accent-subtle text-accent-primary"
                : "border-subtle text-secondary hover:bg-layer-1"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      {!isLoading && rows.length === 0 ? (
        <p className="py-2 text-body-xs-regular text-tertiary">Nobody matches this day.</p>
      ) : null}
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
      {/* Export: the rows of a period as a spreadsheet, for the place chosen above (Remote only, for example). */}
      <div className="flex flex-wrap items-end gap-2 border-t border-subtle pt-3">
        <label className="flex flex-col gap-0.5 text-caption-sm-medium text-tertiary">
          From
          <input
            type="date"
            value={from}
            max={to}
            onChange={(event) => setFrom(event.target.value)}
            className="h-9 rounded-md border border-subtle bg-layer-1 px-2 text-body-xs-regular text-primary"
          />
        </label>
        <label className="flex flex-col gap-0.5 text-caption-sm-medium text-tertiary">
          To
          <input
            type="date"
            value={to}
            min={from}
            onChange={(event) => setTo(event.target.value)}
            className="h-9 rounded-md border border-subtle bg-layer-1 px-2 text-body-xs-regular text-primary"
          />
        </label>
        <a
          href={exportLink}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-subtle px-3 text-body-xs-medium text-primary hover:bg-layer-1"
        >
          <Download className="size-4" aria-hidden />
          Export {place ? FILTERS.find((item) => item.value === place)?.label.toLowerCase() : "all"} (CSV)
        </a>
      </div>
    </section>
  );
}
