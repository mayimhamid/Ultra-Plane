/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { observer } from "mobx-react";
// hooks
import { teamAIService, useAIStatus } from "@/hooks/team-ops/use-ai";
// local imports
import { getErrorMessage } from "../calendar/error-message";
import { AIMarkdown } from "./ai-markdown";

type Props = { workspaceSlug: string; issueId: string };

/** "Summarize with AI" in a work item's sidebar: its state, what is done and left, from the description and
 * comments. Hidden when the workspace has no AI. */
export const AIIssueSummary = observer(function AIIssueSummary({ workspaceSlug, issueId }: Props) {
  const { usable } = useAIStatus(workspaceSlug);
  const [summary, setSummary] = useState<{ issueId: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  if (!usable) return null;
  const current = summary?.issueId === issueId ? summary.text : "";

  const run = async () => {
    setBusy(true);
    setProblem("");
    try {
      const data = await teamAIService.summarize(workspaceSlug, { kind: "issue", issue: issueId });
      setSummary({ issueId, text: data.summary });
    } catch (error) {
      setProblem(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="AI summary" className="flex flex-col gap-2 py-4">
      <button
        type="button"
        disabled={busy}
        onClick={() => void run()}
        className="inline-flex min-h-8 items-center gap-2 self-start rounded-md border border-subtle px-3 text-body-xs-medium text-secondary hover:bg-layer-1 disabled:opacity-60"
      >
        <Sparkles className="size-4 text-accent-primary" aria-hidden />
        {busy ? "Reading the work item..." : current ? "Summarize again" : "Summarize with AI"}
      </button>
      {problem ? <p className="text-caption-sm-regular text-danger-primary">{problem}</p> : null}
      {current ? <AIMarkdown source={current} className="text-body-xs-regular text-secondary" /> : null}
    </section>
  );
});
