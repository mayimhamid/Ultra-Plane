/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import useSWR, { mutate } from "swr";
import { Button } from "@makeplane/propel/components/button";
import { setToast } from "@plane/blocks/toast";
import { WorkdayService, formatHm } from "@plane/services";
// local imports
import { getErrorMessage } from "../calendar/error-message";

const workdayService = new WorkdayService();

type Props = { workspaceSlug: string; issueId: string };

/**
 * On the work item page: how long people have worked on it, in which flows, and a button to start working on it.
 * It stays out of the way: a person without Team Ops, or a work item with no time yet, still gets the button.
 */
export const WorkItemTimePanel = observer(function WorkItemTimePanel({ workspaceSlug, issueId }: Props) {
  const [isStarting, setIsStarting] = useState(false);
  const key = `TEAM_OPS_WORK_ITEM_PANEL_${workspaceSlug}_${issueId}`;
  const { data, error } = useSWR(key, () => workdayService.getTasks(workspaceSlug, { issue: issueId }), {
    shouldRetryOnError: false,
  });
  const task = data?.results[0];
  // Not allowed (guests) or the feature is off: show nothing.
  if (error || !data) return null;

  const start = async () => {
    setIsStarting(true);
    try {
      await workdayService.startWork(workspaceSlug, issueId);
      await mutate((k) => typeof k === "string" && k.startsWith("TEAM_OPS_"));
      setToast({ type: "success", title: "Timer started", message: "It runs in Workday." });
    } catch (failure) {
      setToast({ type: "error", title: "Could not start", message: getErrorMessage(failure) });
    } finally {
      setIsStarting(false);
    }
  };

  const people = (task?.forks ?? []).filter((fork) => fork.kind === "person" && fork.seconds > 0);

  return (
    <section aria-label="Time on this work item" className="mt-4 flex flex-col gap-2 border-t border-subtle pt-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-body-sm-medium text-primary">Time</h4>
        <span className="text-body-sm-medium text-primary tabular-nums">{formatHm(task?.seconds ?? 0)}</span>
      </div>
      {people.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {people.map((fork) =>
            fork.kind === "person" ? (
              <li key={fork.user.id} className="flex justify-between gap-2 text-caption-sm-regular text-secondary">
                <span className="truncate">{fork.user.display_name}</span>
                <span className="tabular-nums">{formatHm(fork.seconds)}</span>
              </li>
            ) : null
          )}
        </ul>
      ) : (
        <p className="text-caption-sm-regular text-tertiary">Nobody has logged time here yet.</p>
      )}
      {(task?.flows ?? []).length > 0 ? (
        <p className="text-caption-sm-regular text-tertiary">
          {(task?.flows ?? []).map((flow) => `${flow.name}${flow.side ? " (side task)" : ""}`).join(", ")}
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          stretch="auto"
          label="Start working"
          loading={isStarting}
          onClick={start}
        />
        <Link
          className="text-caption-sm-medium text-accent-primary hover:underline"
          href={`/${workspaceSlug}/team-ops/workday/`}
        >
          Open Workday
        </Link>
      </div>
    </section>
  );
});
