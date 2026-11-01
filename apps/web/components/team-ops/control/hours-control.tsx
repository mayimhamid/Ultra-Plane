/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useState } from "react";
import { observer } from "mobx-react";
import useSWR, { mutate } from "swr";
import { Badge } from "@makeplane/propel/components/badge";
import { Button } from "@makeplane/propel/components/button";
import { SelectField } from "@makeplane/propel/components/select-field";
import { setToast } from "@plane/blocks/toast";
import { controlRange, formatHm, toDateKey } from "@plane/services";
import type { TControlPreset } from "@plane/services";
import { cn } from "@plane/utils";
// hooks
import { controlService } from "@/hooks/team-ops/use-control";
import { useOpsTeams } from "@/hooks/team-ops/use-work-calendar";
// local imports
import { getErrorMessage } from "../calendar/error-message";
import { HoursChart } from "./hours-chart";

type Props = { workspaceSlug: string };

const PRESETS: { value: TControlPreset; label: string }[] = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

const dayFormat = new Intl.DateTimeFormat("en-US", { weekday: "short", day: "numeric", month: "short" });
const parse = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** Hours of everyone per day, by place, and the admin's confirmation of each person's days. */
export const HoursControl = observer(function HoursControl({ workspaceSlug }: Props) {
  const [preset, setPreset] = useState<TControlPreset>("30");
  const [teamId, setTeamId] = useState("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { teams } = useOpsTeams(workspaceSlug);
  const range = useMemo(() => controlRange(preset, toDateKey(new Date())), [preset]);
  const params = { ...range, team: teamId === "all" ? undefined : teamId };
  const key = `TEAM_OPS_CONTROL_HOURS_${workspaceSlug}_${JSON.stringify(params)}`;
  const { data } = useSWR(key, () => controlService.getHours(workspaceSlug, params), { refreshInterval: 30_000 });

  const approve = async (user: string, from: string, to: string, approved = true) => {
    setBusy(true);
    try {
      await controlService.setApproval(workspaceSlug, { user, from, to, approved });
      await mutate(key);
    } catch (error) {
      setToast({ type: "error", title: "Could not save", message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const approveEveryone = async () => {
    setBusy(true);
    try {
      for (const person of data?.people ?? []) {
        if (person.pending_days > 0)
          await controlService.setApproval(workspaceSlug, { user: person.user.id, ...range });
      }
      await mutate(key);
    } catch (error) {
      setToast({ type: "error", title: "Could not save", message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const open = data?.people.find((person) => person.user.id === openId) ?? null;

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
        <div className="w-44 [&_button]:min-w-0">
          <SelectField
            size="lg"
            label="Team"
            options={[
              { value: "all", label: "All teams" },
              ...(teams ?? []).map((item) => ({ value: item.id, label: item.name })),
            ]}
            value={teamId}
            onValueChange={(value) => setTeamId(value ?? "all")}
          />
        </div>
        {data?.can_approve && data.pending_days > 0 ? (
          <Button
            variant="primary"
            size="md"
            stretch="auto"
            label={`Approve all ${data.pending_days} pending day(s)`}
            loading={busy}
            onClick={approveEveryone}
          />
        ) : null}
      </div>

      <section className="rounded-lg border border-subtle bg-surface-1 p-4" aria-label="Team hours">
        <h3 className="mb-3 text-body-md-medium text-primary">Team hours per day</h3>
        <HoursChart days={data?.team ?? []} height={180} />
      </section>

      <div className="overflow-x-auto rounded-lg border border-subtle bg-surface-1">
        <table className="w-full min-w-144 text-left text-body-sm-regular">
          <thead className="border-b border-subtle bg-layer-1 text-caption-sm-medium text-tertiary">
            <tr>
              {["Person", "Pending approval", "Onsite", "Remote", "Parallel", "Frozen", ""].map((label) => (
                <th key={label} scope="col" className="px-3 py-2 font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-subtle">
            {(data?.people ?? []).map((person) => {
              const sum = (field: "onsite_seconds" | "remote_seconds" | "parallel_seconds" | "frozen_seconds") =>
                person.days.reduce((total, day) => total + day[field], 0);
              return (
                <tr key={person.user.id} className={cn(openId === person.user.id && "bg-accent-subtle")}>
                  <td className="px-3 py-2 font-medium text-primary">
                    <button type="button" onClick={() => setOpenId(openId === person.user.id ? null : person.user.id)}>
                      {person.user.display_name}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    {person.pending_days > 0 ? (
                      <Badge variant="warning" size="sm" label={`${person.pending_days} day(s)`} />
                    ) : (
                      <span className="text-success-primary">All approved</span>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{formatHm(sum("onsite_seconds"))}</td>
                  <td className="px-3 py-2 tabular-nums">{formatHm(sum("remote_seconds"))}</td>
                  <td className="px-3 py-2 tabular-nums">{formatHm(sum("parallel_seconds"))}</td>
                  <td className={cn("px-3 py-2 tabular-nums", sum("frozen_seconds") > 0 && "text-danger-primary")}>
                    {formatHm(sum("frozen_seconds"))}
                  </td>
                  <td className="px-3 py-2">
                    {data?.can_approve && person.pending_days > 0 ? (
                      <button
                        type="button"
                        disabled={busy}
                        className="text-body-xs-medium text-accent-primary hover:underline"
                        onClick={() => void approve(person.user.id, range.from, range.to)}
                      >
                        Approve
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {open ? (
        <section
          aria-label={`Hours of ${open.user.display_name}`}
          className="flex flex-col gap-3 rounded-lg border border-accent-strong bg-surface-1 p-4"
        >
          <h3 className="text-body-md-medium text-primary">{open.user.display_name}</h3>
          <HoursChart days={open.days} />
          <ul className="flex flex-col divide-y divide-subtle">
            {open.days
              .filter((day) => day.approved !== null)
              .reverse()
              .map((day) => (
                <li
                  key={day.date}
                  className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-body-xs-regular"
                >
                  <span className="text-primary">{dayFormat.format(parse(day.date))}</span>
                  <span className="text-secondary tabular-nums">
                    {formatHm(day.onsite_seconds)} onsite · {formatHm(day.remote_seconds)} remote
                    {day.parallel_seconds > 0 ? ` · ${formatHm(day.parallel_seconds)} parallel` : ""}
                    {day.frozen_seconds > 0 ? ` · ${formatHm(day.frozen_seconds)} frozen` : ""}
                  </span>
                  {data?.can_approve ? (
                    <button
                      type="button"
                      disabled={busy}
                      className={cn(
                        "rounded px-2 py-0.5 text-caption-sm-medium",
                        day.approved
                          ? "bg-success-subtle text-success-primary"
                          : "bg-warning-subtle text-warning-primary"
                      )}
                      onClick={() => void approve(open.user.id, day.date, day.date, !day.approved)}
                    >
                      {day.approved ? "Approved (undo)" : "Approve"}
                    </button>
                  ) : (
                    <span className={day.approved ? "text-success-primary" : "text-warning-primary"}>
                      {day.approved ? "Approved" : "Waiting"}
                    </span>
                  )}
                </li>
              ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
});
