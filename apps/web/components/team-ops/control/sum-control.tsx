/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import useSWR, { mutate } from "swr";
import { Button } from "@makeplane/propel/components/button";
import { CheckboxField } from "@makeplane/propel/components/checkbox-field";
import { InputField } from "@makeplane/propel/components/input-field";
import { setToast } from "@plane/blocks/toast";
import { addDays, formatHm, toDateKey } from "@plane/services";
import { cn } from "@plane/utils";
// hooks
import { controlService } from "@/hooks/team-ops/use-control";
// local imports
import { getErrorMessage } from "../calendar/error-message";

type Props = { workspaceSlug: string };

const monthStart = () => {
  const now = new Date();
  return toDateKey(new Date(now.getFullYear(), now.getMonth(), 1));
};

/** Everyone's time between two dates as one number, with the frozen time an admin chooses to count, as an Excel file. */
export const SumControl = observer(function SumControl({ workspaceSlug }: Props) {
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(() => toDateKey(new Date()));
  const [double, setDouble] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const valid = from <= to && to <= addDays(from, 365);
  const params = { from, to, parallel_double: double };
  const key = `TEAM_OPS_CONTROL_SUM_${workspaceSlug}_${JSON.stringify(params)}`;
  const { data } = useSWR(valid ? key : null, () => controlService.getSum(workspaceSlug, params));

  const credit = async (user: string, credited: boolean) => {
    setBusy(user);
    try {
      await controlService.creditFreeze(workspaceSlug, { user, from, to, credited });
      await mutate(key);
    } catch (error) {
      setToast({ type: "error", title: "Could not save", message: getErrorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  const creditEveryone = async () => {
    setBusy("all");
    try {
      for (const row of data?.results ?? []) {
        if (row.frozen_seconds > row.credited_frozen_seconds) {
          await controlService.creditFreeze(workspaceSlug, { user: row.user.id, from, to, credited: true });
        }
      }
      await mutate(key);
    } catch (error) {
      setToast({ type: "error", title: "Could not save", message: getErrorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  const download = async () => {
    setBusy("export");
    try {
      const blob = await controlService.exportSum(workspaceSlug, params, "xlsx");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `sum-time-${from}-${to}.xlsx`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setToast({ type: "error", title: "Could not export", message: getErrorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44">
          <InputField
            type="date"
            size="lg"
            orientation="vertical"
            value={from}
            max={to}
            onChange={(event) => setFrom(event.target.value)}
            aria-label="From"
          />
        </div>
        <div className="w-44">
          <InputField
            type="date"
            size="lg"
            orientation="vertical"
            value={to}
            min={from}
            onChange={(event) => setTo(event.target.value)}
            aria-label="To"
          />
        </div>
        <Button
          variant="secondary"
          size="md"
          stretch="auto"
          label="Export Excel"
          loading={busy === "export"}
          disabled={!valid}
          onClick={download}
        />
        <Button
          variant="primary"
          size="md"
          stretch="auto"
          label="Count everyone's frozen time"
          loading={busy === "all"}
          disabled={!valid}
          onClick={creditEveryone}
        />
        <button
          type="button"
          className="pb-2 text-body-xs-medium text-accent-primary hover:underline"
          onClick={() => setAdvanced(!advanced)}
        >
          {advanced ? "Hide advanced options" : "Advanced options"}
        </button>
      </div>
      {!valid ? (
        <p className="text-body-xs-regular text-danger-primary">Choose a start before the end, within a year.</p>
      ) : null}
      {advanced ? (
        <div className="rounded-lg border border-subtle bg-layer-1 p-3">
          <CheckboxField
            size="lg"
            label="Count parallel work twice (a task worked beside the main one counts double)"
            checked={double}
            onCheckedChange={(checked) => setDouble(Boolean(checked))}
          />
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-subtle bg-surface-1">
        <table className="w-full min-w-176 text-left text-body-sm-regular">
          <thead className="border-b border-subtle bg-layer-1 text-caption-sm-medium text-tertiary">
            <tr>
              {["Person", "Main hours", "Onsite", "Remote", "Parallel", "Frozen", "Frozen counted", "Total", ""].map(
                (label) => (
                  <th key={label} scope="col" className="px-3 py-2 font-medium">
                    {label}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-subtle">
            {(data?.results ?? []).map((row) => {
              const counted = row.frozen_seconds > 0 && row.credited_frozen_seconds >= row.frozen_seconds;
              return (
                <tr key={row.user.id}>
                  <td className="px-3 py-2 font-medium text-primary">{row.user.display_name}</td>
                  <td className="px-3 py-2 tabular-nums">{formatHm(row.main_seconds)}</td>
                  <td className="px-3 py-2 text-secondary tabular-nums">{formatHm(row.onsite_seconds)}</td>
                  <td className="px-3 py-2 text-secondary tabular-nums">{formatHm(row.remote_seconds)}</td>
                  <td
                    className="px-3 py-2 tabular-nums"
                    style={{ color: row.parallel_seconds > 0 ? "#8b5cf6" : undefined }}
                  >
                    {formatHm(row.parallel_seconds)}
                  </td>
                  <td className={cn("px-3 py-2 tabular-nums", row.frozen_seconds > 0 && "text-danger-primary")}>
                    {formatHm(row.frozen_seconds)}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{formatHm(row.credited_frozen_seconds)}</td>
                  <td className="px-3 py-2 font-medium text-primary tabular-nums">{formatHm(row.total_seconds)}</td>
                  <td className="px-3 py-2">
                    {row.frozen_seconds > 0 ? (
                      <button
                        type="button"
                        disabled={busy === row.user.id}
                        className="text-body-xs-medium text-accent-primary hover:underline"
                        onClick={() => void credit(row.user.id, !counted)}
                      >
                        {counted ? "Stop counting frozen" : "Count frozen"}
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t border-subtle bg-layer-1">
            <tr>
              <td className="px-3 py-2 font-medium text-primary" colSpan={7}>
                Everyone{data?.parallel_double ? " (parallel counted twice)" : ""}
              </td>
              <td className="px-3 py-2 font-medium text-primary tabular-nums">{formatHm(data?.total_seconds ?? 0)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-caption-sm-regular text-tertiary">
        Total = main hours + parallel hours{double ? " (twice)" : ""} + the frozen time you chose to count. Frozen time
        is never added unless you count it.
      </p>
    </div>
  );
});
