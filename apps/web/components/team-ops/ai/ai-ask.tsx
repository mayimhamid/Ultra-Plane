/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { CircleCheck, CircleHelp, Send, ThumbsDown, ThumbsUp } from "lucide-react";
import { observer } from "mobx-react";
import useSWR from "swr";
import { setToast } from "@plane/blocks/toast";
import type { TAIJob, TAskResult } from "@plane/types";
import { cn } from "@plane/utils";
// components
import { ReportFilters, usePeriod } from "@/components/team-ops/control/report-shared";
// hooks
import { teamAIService, useAIStatus } from "@/hooks/team-ops/use-ai";
// local imports
import { getErrorMessage } from "../calendar/error-message";

const EXAMPLES = [
  "Who reported the most hours, and who the fewest?",
  "Which reports this week have hours without any trace in Plane?",
  "Who spent long hours on research or config changes, and what did they write?",
  "Which tasks are overdue, and who has them?",
  "Who is overloaded and who has room for more work?",
];

const SECTION_LABEL: Record<string, string> = {
  people: "hours per person",
  daily_notes: "Day Report notes",
  evidence: "evidence of work",
  risks: "tasks at risk",
  workload: "workload",
  docs: "work items and documents",
};

function Answer({ workspaceSlug, job }: { workspaceSlug: string; job: TAIJob<TAskResult> }) {
  const [rated, setRated] = useState<1 | -1 | null>(null);
  const result = job.result;
  if (!result) return null;

  const rate = async (rating: 1 | -1) => {
    const correction = rating === -1 ? (window.prompt("What is the right answer? (optional)") ?? "") : undefined;
    try {
      await teamAIService.sendFeedback(workspaceSlug, job.id, { rating, correction: correction || undefined });
      setRated(rating);
    } catch (error) {
      setToast({ type: "error", title: "Not saved", message: getErrorMessage(error) });
    }
  };

  return (
    <article className="flex flex-col gap-2 rounded-lg border border-subtle bg-surface-1 p-4">
      <p className="text-body-sm-medium text-primary">{result.question}</p>
      <p className="text-body-sm-regular whitespace-pre-wrap text-secondary">{result.answer}</p>
      <div className="flex flex-wrap items-center gap-2 text-caption-sm-regular text-tertiary">
        {result.verified ? (
          <span className="inline-flex items-center gap-1 text-success-primary">
            <CircleCheck className="size-3.5" aria-hidden />
            Every number is from Plane&apos;s data
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-warning-primary">
            <CircleHelp className="size-3.5" aria-hidden />
            Check these numbers: {result.unverified_numbers.join(", ")}
          </span>
        )}
        <span>· read: {result.sections.map((name) => SECTION_LABEL[name] ?? name).join(", ")}</span>
        <span>· {result.effort} effort</span>
        <span className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-label="Right answer"
            aria-pressed={rated === 1}
            onClick={() => void rate(1)}
            className={cn("rounded p-1 hover:bg-layer-1", rated === 1 ? "text-success-primary" : "text-tertiary")}
          >
            <ThumbsUp className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Wrong answer"
            aria-pressed={rated === -1}
            onClick={() => void rate(-1)}
            className={cn("rounded p-1 hover:bg-layer-1", rated === -1 ? "text-danger-primary" : "text-tertiary")}
          >
            <ThumbsDown className="size-3.5" />
          </button>
        </span>
      </div>
    </article>
  );
}

type Props = { workspaceSlug: string };

/** Dashboard › AI › Ask: questions about the team, answered only from Plane's data for the chosen period. */
export const AIAsk = observer(function AIAsk({ workspaceSlug }: Props) {
  const periodState = usePeriod("week");
  const { period } = periodState;
  const [team, setTeam] = useState("");
  const [question, setQuestion] = useState("");
  const [running, setRunning] = useState<TAIJob<TAskResult> | null>(null);
  const { usable } = useAIStatus(workspaceSlug);
  const { data: history, mutate } = useSWR(usable ? `TEAM_OPS_AI_ASK_${workspaceSlug}` : null, () =>
    teamAIService.listQuestions(workspaceSlug)
  );

  const ask = async () => {
    const text = question.trim();
    if (!text || running) return;
    try {
      const job = await teamAIService.ask(workspaceSlug, {
        question: text,
        from: period.from,
        to: period.to,
        team: team || undefined,
      });
      setRunning(job);
      setQuestion("");
      await teamAIService.waitForJob(workspaceSlug, job, setRunning);
      await mutate();
    } catch (error) {
      setToast({ type: "error", title: "No answer", message: getErrorMessage(error) });
    } finally {
      setRunning(null);
    }
  };

  if (!usable) {
    return (
      <p className="rounded-lg border border-dashed border-subtle p-4 text-body-sm-regular text-tertiary">
        Ask and Answer needs Plane AI. It is off or not set up on this server.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ReportFilters workspaceSlug={workspaceSlug} periodState={periodState} team={team} setTeam={setTeam} />
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void ask();
        }}
      >
        <textarea
          value={question}
          rows={2}
          aria-label="Question"
          placeholder={`Ask about the team in ${period.label}`}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void ask();
            }
          }}
          className="min-h-11 flex-1 resize-none rounded-md border border-subtle bg-layer-1 p-2 text-body-sm-regular text-primary outline-none focus:border-accent-strong"
        />
        <button
          type="submit"
          aria-label="Ask"
          disabled={!question.trim() || Boolean(running)}
          className="inline-flex size-11 items-center justify-center rounded-md bg-accent-primary text-on-color disabled:opacity-50"
        >
          <Send className="size-4" aria-hidden />
        </button>
      </form>
      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => setQuestion(example)}
            className="rounded-full border border-subtle px-3 py-1 text-body-xs-regular text-secondary hover:bg-layer-1"
          >
            {example}
          </button>
        ))}
      </div>
      {running ? (
        <p className="text-body-sm-regular text-tertiary" aria-live="polite">
          {running.status === "queued"
            ? "Waiting for the AI..."
            : `Thinking${running.progress ? ` (${running.progress})` : "..."}`}
        </p>
      ) : null}
      <div className="flex flex-col gap-3">
        {(history ?? [])
          .filter((job) => job.status === "done")
          .map((job) => (
            <Answer key={job.id} workspaceSlug={workspaceSlug} job={job} />
          ))}
      </div>
    </div>
  );
});
