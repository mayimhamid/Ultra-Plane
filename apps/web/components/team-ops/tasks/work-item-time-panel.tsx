/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import useSWR from "swr";
import { setToast } from "@plane/blocks/toast";
import { formatMinutes } from "@plane/services";
import type { TPlanUnit } from "@plane/types";
// hooks
import { dayReportService, refreshTeamOps } from "@/hooks/team-ops/use-day-report";
// local imports
import { getErrorMessage } from "../calendar/error-message";
import { VerdictBadge } from "../day-report/verdict-badge";

type Props = { workspaceSlug: string; issueId: string };

/**
 * On the work item page: how long it is planned to take, how much time people reported on it in their Day
 * Reports, and whether it is Speedy, On time or OverTime. Project members set the planned time here.
 */
export const WorkItemTimePanel = observer(function WorkItemTimePanel({ workspaceSlug, issueId }: Props) {
  const key = `TEAM_OPS_TASK_PLAN_${workspaceSlug}_${issueId}`;
  const { data, error, mutate } = useSWR(key, () => dayReportService.getPlan(workspaceSlug, issueId), {
    shouldRetryOnError: false,
  });
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState<TPlanUnit>("HOURS");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    setAmount(data.planned_amount === null ? "" : String(data.planned_amount));
    setUnit(data.unit);
  }, [data]);

  // Not allowed (guests) or the feature is off: show nothing.
  if (error || !data) return null;

  const changed = amount !== (data.planned_amount === null ? "" : String(data.planned_amount)) || unit !== data.unit;

  const save = async () => {
    setIsSaving(true);
    try {
      const next = await dayReportService.setPlan(workspaceSlug, issueId, amount.trim() ? Number(amount) : "", unit);
      await mutate(next, { revalidate: false });
      await refreshTeamOps();
      setToast({ type: "success", title: "Planned time saved", message: "Day Reports compare against it." });
    } catch (failure) {
      setToast({ type: "error", title: "Could not save", message: getErrorMessage(failure) });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section aria-label="Planned time" className="mt-4 flex flex-col gap-2 border-t border-subtle pt-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-body-sm-medium text-primary">Planned time</h4>
        <VerdictBadge status={data.status} />
      </div>
      {data.can_edit ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            placeholder="e.g. 4"
            aria-label="Planned amount"
            onChange={(event) => setAmount(event.target.value)}
            className="h-9 w-20 rounded-md border border-subtle bg-layer-1 px-2 text-body-sm-regular text-primary outline-none focus:border-accent-strong"
          />
          <select
            value={unit}
            aria-label="Unit"
            onChange={(event) => setUnit(event.target.value as TPlanUnit)}
            className="h-9 rounded-md border border-subtle bg-layer-1 px-2 text-body-sm-regular text-primary"
          >
            <option value="HOURS">hours</option>
            <option value="DAYS">days</option>
          </select>
          {changed ? (
            <button
              type="button"
              disabled={isSaving || (amount.trim() !== "" && !(Number(amount) > 0))}
              onClick={() => void save()}
              className="h-9 rounded-md bg-accent-primary px-3 text-body-xs-medium text-on-color disabled:opacity-50"
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
          ) : null}
        </div>
      ) : (
        <p className="text-body-sm-regular text-primary">
          {data.planned_amount === null
            ? "Not planned"
            : `${data.planned_amount} ${data.unit === "DAYS" ? "days" : "hours"}`}
        </p>
      )}
      <p className="text-caption-sm-regular text-tertiary">
        Reported in Day Reports:{" "}
        <span className="text-secondary tabular-nums">{formatMinutes(data.reported_minutes)}</span>
        {data.finished ? " · finished" : ""}
      </p>
      <Link
        href={`/${workspaceSlug}/team-ops/workday/`}
        className="self-start text-caption-sm-medium text-accent-primary hover:underline"
      >
        Open my Day Report
      </Link>
    </section>
  );
});
