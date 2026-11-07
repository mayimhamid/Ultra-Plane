/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { setToast } from "@plane/blocks/toast";
import { formatMinutes, toDateKey } from "@plane/services";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useProject } from "@/hooks/store/use-project";
import { useProjectState } from "@/hooks/store/use-project-state";
import { dayReportService, refreshTeamOps } from "@/hooks/team-ops/use-day-report";
// local imports
import { getErrorMessage } from "../calendar/error-message";
import { FinishTaskDialog } from "./finish-task-dialog";
import type { TFinishedWork } from "./finish-task-dialog";

type TDone = { workspaceSlug: string; projectId: string; issueId: string; stateId: string; previousStateId?: string };

/**
 * When a work item is moved to a Done state in its project (list, board or its page), this asks how long it took,
 * like a Day Report row, and adds it to that day's report with "Task done". A task finished long ago can be
 * skipped with "Done earlier, do not add it", so nothing is reported for it.
 */
export const DonePrompt = observer(function DonePrompt() {
  const [done, setDone] = useState<TDone | null>(null);
  const { getStateById } = useProjectState();
  const {
    issue: { getIssueById },
  } = useIssueDetail();
  const { getPartialProjectById } = useProject();

  useEffect(() => {
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<TDone>).detail;
      const next = getStateById(detail.stateId);
      const before = detail.previousStateId ? getStateById(detail.previousStateId) : undefined;
      // Only a move into Done (not between two Done states, not out of Done).
      if (next?.group !== "completed" || before?.group === "completed") return;
      setDone(detail);
    };
    window.addEventListener("team-ops:state-changed", onChange);
    return () => window.removeEventListener("team-ops:state-changed", onChange);
  }, [getStateById]);

  if (!done) return null;

  const issue = getIssueById(done.issueId);
  const project = getPartialProjectById(done.projectId);
  const key = issue && project ? `${project.identifier}-${issue.sequence_id}` : "";
  const close = () => setDone(null);

  const submit = async ({ day, minutes, start, end, place, note }: TFinishedWork) => {
    try {
      await dayReportService.addRow(done.workspaceSlug, day, {
        issue: done.issueId,
        minutes,
        ...(start && end ? { start, end } : {}),
        location: place,
        finished: true,
        note,
      });
      await refreshTeamOps();
      setToast({
        type: "success",
        title: "Added to the Day Report",
        message: `${key} · ${formatMinutes(minutes)}${day === toDateKey(new Date()) ? " today" : ` on ${day}`}.`,
      });
      close();
    } catch (error) {
      setToast({ type: "error", title: "Could not add it", message: getErrorMessage(error) });
      throw error;
    }
  };

  return (
    <FinishTaskDialog
      key={done.issueId}
      label={key}
      name={issue?.name ?? ""}
      onSubmit={submit}
      onSkip={close}
      onClose={close}
    />
  );
});
