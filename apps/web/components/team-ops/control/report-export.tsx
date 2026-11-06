/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { Download } from "lucide-react";
import { toDateKey } from "@plane/services";
import type { TReportPersonSummary } from "@plane/types";
// hooks
import { dayReportService } from "@/hooks/team-ops/use-day-report";
import { useOpsTeams } from "@/hooks/team-ops/use-work-calendar";
// components
import { PersonAvatar } from "../hub/person-avatar";
// local imports
import { hours, useReportSummary } from "./report-shared";

const monthStart = () => {
  const now = new Date();
  return toDateKey(new Date(now.getFullYear(), now.getMonth(), 1));
};

const field = "h-9 rounded-md border border-subtle bg-layer-1 px-2 text-body-xs-regular text-primary";

const quote = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;

/** Everyone's totals as a spreadsheet (Excel opens the CSV). */
const totalsCsv = (people: TReportPersonSummary[], from: string, to: string) => {
  const head = ["Person", "Hours", "Remote hours", "Onsite hours", "Days reported", "Reports missing", "Late", "Edits"];
  const lines = people.map((p) =>
    [
      p.user.display_name,
      (p.total_minutes / 60).toFixed(2),
      (p.remote_minutes / 60).toFixed(2),
      (p.onsite_minutes / 60).toFixed(2),
      Object.keys(p.days).length,
      p.reports_missing,
      p.reports_late,
      p.edits,
    ]
      .map(quote)
      .join(",")
  );
  const blob = new Blob([`﻿${[head.map(quote).join(","), ...lines].join("\n")}`], {
    type: "text/csv;charset=utf-8",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `team-hours-${from}-${to}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
};

/** Control, Export: everyone's hours between two dates, and every report row, to Excel. */
export const ReportExport = observer(function ReportExport({ workspaceSlug }: { workspaceSlug: string }) {
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(() => toDateKey(new Date()));
  const [team, setTeam] = useState("");
  const [place, setPlace] = useState("");
  const { teams } = useOpsTeams(workspaceSlug);
  const valid = from <= to;
  const { data } = useReportSummary(workspaceSlug, { from, to, team, place }, valid);
  const people = data?.people ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5 text-caption-sm-medium text-tertiary">
          From
          <input
            type="date"
            value={from}
            max={to}
            onChange={(event) => setFrom(event.target.value)}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-0.5 text-caption-sm-medium text-tertiary">
          To
          <input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-0.5 text-caption-sm-medium text-tertiary">
          Team
          <select value={team} onChange={(event) => setTeam(event.target.value)} className={field}>
            <option value="">All teams</option>
            {(teams ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-caption-sm-medium text-tertiary">
          Place
          <select value={place} onChange={(event) => setPlace(event.target.value)} className={field}>
            <option value="">All</option>
            <option value="REMOTE">Remote only</option>
            <option value="ONSITE">Onsite only</option>
            <option value="HYBRID">Hybrid days</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!people.length}
          onClick={() => totalsCsv(people, from, to)}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-accent-primary px-4 text-body-sm-medium text-on-color disabled:opacity-50"
        >
          <Download className="size-4" aria-hidden />
          Totals per person (CSV)
        </button>
        <a
          href={valid ? dayReportService.exportUrl(workspaceSlug, from, to, place || undefined) : undefined}
          aria-disabled={!valid}
          className="inline-flex h-10 items-center gap-2 rounded-md border border-subtle px-4 text-body-sm-medium text-primary hover:bg-layer-1"
        >
          <Download className="size-4" aria-hidden />
          Every report row (CSV)
        </a>
      </div>

      <div className="overflow-x-auto rounded-lg border border-subtle bg-surface-1">
        <table className="w-full min-w-[40rem] text-left">
          <thead className="border-b border-subtle bg-layer-1 text-caption-sm-medium text-tertiary">
            <tr>
              {["Person", "Hours", "Remote", "Onsite", "Days", "Missing", "Late", "Edits"].map((head) => (
                <th key={head} scope="col" className="px-3 py-2">
                  {head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-subtle text-body-sm-regular text-primary">
            {people.map((person) => (
              <tr key={person.user.id}>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-2">
                    <PersonAvatar person={person.user} size="sm" />
                    {person.user.display_name}
                  </span>
                </td>
                <td className="px-3 py-2 font-semibold tabular-nums">{hours(person.total_minutes)}</td>
                <td className="px-3 py-2 tabular-nums">{hours(person.remote_minutes)}</td>
                <td className="px-3 py-2 tabular-nums">{hours(person.onsite_minutes)}</td>
                <td className="px-3 py-2 tabular-nums">{Object.keys(person.days).length}</td>
                <td className="px-3 py-2 tabular-nums">{person.reports_missing || "–"}</td>
                <td className="px-3 py-2 tabular-nums">{person.reports_late || "–"}</td>
                <td className="px-3 py-2 tabular-nums">{person.edits || "–"}</td>
              </tr>
            ))}
          </tbody>
          {data ? (
            <tfoot className="border-t border-subtle text-body-sm-semibold text-primary">
              <tr>
                <td className="px-3 py-2">Everyone</td>
                <td className="px-3 py-2 tabular-nums">{hours(data.totals.minutes)}</td>
                <td className="px-3 py-2 tabular-nums">{hours(data.totals.remote_minutes)}</td>
                <td className="px-3 py-2 tabular-nums">{hours(data.totals.onsite_minutes)}</td>
                <td className="px-3 py-2" />
                <td className="px-3 py-2 tabular-nums">{data.totals.reports_missing || "–"}</td>
                <td className="px-3 py-2 tabular-nums">{data.totals.reports_late || "–"}</td>
                <td className="px-3 py-2 tabular-nums">{data.totals.edits || "–"}</td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
});
