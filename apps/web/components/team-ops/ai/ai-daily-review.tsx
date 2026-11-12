/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import { observer } from "mobx-react";
import useSWR from "swr";
import { setToast } from "@plane/blocks/toast";
import { toDateKey } from "@plane/services";
import type { TAIJob, TDailyReviewPerson, TDailyReviewResult, TDailyRowVerdict } from "@plane/types";
import { cn } from "@plane/utils";
// components
import { StatCard, hours } from "@/components/team-ops/control/report-shared";
// hooks
import { teamAIService, useAIStatus } from "@/hooks/team-ops/use-ai";
import { useOpsTeams } from "@/hooks/team-ops/use-work-calendar";
// local imports
import { getErrorMessage } from "../calendar/error-message";

const ROW: Record<TDailyRowVerdict, { label: string; style: string }> = {
  plausible: { label: "Fits the work", style: "bg-success-subtle text-success-primary" },
  inflated: { label: "Too long for the work", style: "bg-danger-subtle text-danger-primary" },
  vague: { label: "Says nothing concrete", style: "bg-warning-subtle text-warning-primary" },
  unrelated: { label: "Not this task", style: "bg-warning-subtle text-warning-primary" },
  unchecked: { label: "Not checked", style: "bg-layer-1 text-tertiary" },
};

const PERSON: Record<TDailyReviewPerson["verdict"], { label: string; style: string }> = {
  ok: { label: "OK", style: "bg-success-subtle text-success-primary" },
  check: { label: "Worth a question", style: "bg-warning-subtle text-warning-primary" },
  concern: { label: "Most of the day in question", style: "bg-danger-subtle text-danger-primary" },
};

function Rate({ onRate }: { onRate: (rating: 1 | -1, correction?: string) => Promise<void> }) {
  const [done, setDone] = useState<1 | -1 | null>(null);
  const rate = async (rating: 1 | -1) => {
    const correction = rating === -1 ? (window.prompt("What is the right judgement? (optional)") ?? "") : undefined;
    try {
      await onRate(rating, correction || undefined);
      setDone(rating);
    } catch (error) {
      setToast({ type: "error", title: "Not saved", message: getErrorMessage(error) });
    }
  };
  return (
    <span className="flex items-center gap-1" aria-label="Was the AI right?">
      <button
        type="button"
        aria-label="The AI was right"
        aria-pressed={done === 1}
        onClick={() => void rate(1)}
        className={cn("rounded p-1 hover:bg-layer-1", done === 1 ? "text-success-primary" : "text-tertiary")}
      >
        <ThumbsUp className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label="The AI was wrong"
        aria-pressed={done === -1}
        onClick={() => void rate(-1)}
        className={cn("rounded p-1 hover:bg-layer-1", done === -1 ? "text-danger-primary" : "text-tertiary")}
      >
        <ThumbsDown className="size-3.5" />
      </button>
    </span>
  );
}

function PersonCard({
  person,
  onRate,
}: {
  person: TDailyReviewPerson;
  onRate: (rating: 1 | -1, correction?: string) => Promise<void>;
}) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-subtle bg-surface-1 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-body-sm-medium text-primary">{person.name}</span>
        <span className={cn("rounded px-1.5 py-0.5 text-caption-sm-medium", PERSON[person.verdict].style)}>
          {PERSON[person.verdict].label}
        </span>
        <span className="text-caption-sm-regular text-tertiary tabular-nums">
          {hours(person.total_minutes)} reported
          {person.questioned_minutes ? ` · ${hours(person.questioned_minutes)} in question` : ""}
        </span>
        <span className="ml-auto">
          <Rate onRate={onRate} />
        </span>
      </div>
      <p className="text-body-sm-regular text-secondary">{person.summary}</p>
      <ul className="flex flex-col divide-y divide-subtle">
        {person.rows.map((row) => (
          <li key={row.id} className="flex flex-col gap-1 py-2">
            <span className="flex flex-wrap items-center gap-2 text-body-xs-regular">
              <span className="min-w-0 flex-1 truncate text-primary">
                {row.key ? <span className="text-tertiary">{row.key} </span> : null}
                {row.task}
              </span>
              <span className="text-secondary tabular-nums">
                {hours(row.minutes)}
                {row.expected_minutes !== null && row.verdict === "inflated"
                  ? ` · usually ~${hours(row.expected_minutes)}`
                  : ""}
              </span>
              <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", ROW[row.verdict].style)}>
                {ROW[row.verdict].label}
              </span>
            </span>
            <span className="text-caption-sm-regular text-tertiary">
              {row.note ? `“${row.note}” · ` : "No note · "}
              {row.reason}
              {row.source === "rules" ? " (from the numbers)" : ""}
            </span>
            {row.question ? (
              <span className="text-caption-sm-regular text-accent-primary">Ask: {row.question}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </li>
  );
}

type Props = { workspaceSlug: string };

/**
 * Dashboard › AI › Daily review: for one day, does the time on every Day Report row fit the work described?
 * "4 hours of LLM research" with no result, or a whole day for a config change, comes out as a question to ask.
 */
export const AIDailyReview = observer(function AIDailyReview({ workspaceSlug }: Props) {
  const [day, setDay] = useState(() => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return toDateKey(yesterday);
  });
  const [team, setTeam] = useState("");
  const { teams } = useOpsTeams(workspaceSlug);
  const { usable } = useAIStatus(workspaceSlug);
  const [running, setRunning] = useState<TAIJob<TDailyReviewResult> | null>(null);
  const [problem, setProblem] = useState("");
  const params = { date: day, team: team || undefined };
  const { data, mutate, error } = useSWR(`TEAM_OPS_AI_DAILY_${workspaceSlug}_${JSON.stringify(params)}`, () =>
    teamAIService.getDailyReview(workspaceSlug, params)
  );

  const reported = (data?.people ?? []).filter((person) => person.rows.length > 0);
  const review = data?.review?.status === "done" ? data.review : null;
  const result = review?.result;

  const run = async () => {
    setProblem("");
    try {
      const job = await teamAIService.startDailyReview(workspaceSlug, params);
      setRunning(job);
      await teamAIService.waitForJob(workspaceSlug, job, setRunning);
      await mutate();
    } catch (failure) {
      setProblem(getErrorMessage(failure));
    } finally {
      setRunning(null);
    }
  };

  const rate = (personId: string) => async (rating: 1 | -1, correction?: string) => {
    if (!review) return;
    await teamAIService.sendFeedback(workspaceSlug, review.id, { rating, item: personId, correction });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={day}
          max={toDateKey(new Date())}
          aria-label="Day"
          onChange={(event) => setDay(event.target.value)}
          className="h-9 rounded-md border border-subtle bg-layer-1 px-2 text-body-xs-medium text-primary"
        />
        <select
          value={team}
          aria-label="Team"
          onChange={(event) => setTeam(event.target.value)}
          className="h-9 rounded-md border border-subtle bg-layer-1 px-2 text-body-xs-medium text-primary"
        >
          <option value="">All teams</option>
          {(teams ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!usable || Boolean(running) || reported.length === 0}
          title={usable ? undefined : "AI is off or not set up."}
          onClick={() => void run()}
          className="ml-auto inline-flex min-h-9 items-center gap-2 rounded-md bg-accent-primary px-3 text-body-xs-medium text-on-color disabled:opacity-50"
        >
          <Sparkles className="size-4" aria-hidden />
          {running
            ? `Reviewing${running.progress ? ` (${running.progress})` : "..."}`
            : result
              ? "Review again"
              : "Review this day with AI"}
        </button>
      </div>

      {error ? (
        <p role="alert" className="text-body-sm-medium text-danger-primary">
          {getErrorMessage(error)}
        </p>
      ) : null}
      {problem ? (
        <p role="alert" className="text-body-sm-medium text-danger-primary">
          {problem}
        </p>
      ) : null}

      {data && reported.length === 0 ? (
        <p className="rounded-lg border border-dashed border-subtle p-4 text-body-sm-regular text-tertiary">
          Nobody sent a Day Report for this day.
        </p>
      ) : null}

      {result ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="People reviewed" value={result.team.people_reviewed} />
            <StatCard
              label="Most of the day in question"
              value={result.team.concern}
              tone={result.team.concern ? "bad" : "good"}
            />
            <StatCard label="Worth a question" value={result.team.check} tone={result.team.check ? "warn" : "good"} />
            <StatCard
              label="Time in question"
              value={hours(result.team.questioned_minutes)}
              hint={`of ${hours(result.team.reported_minutes)} reported`}
              tone={result.team.questioned_minutes ? "warn" : "good"}
            />
          </div>
          <p className="text-caption-sm-regular text-tertiary">
            Reviewed {review?.finished_at ? new Date(review.finished_at).toLocaleString() : ""} at {result.effort}{" "}
            effort. The AI compares the time with what the notes and Plane show; it can be wrong. Use the thumbs to
            correct it: rated answers train a better model.
          </p>
          <ul className="flex flex-col gap-3">
            {result.people.map((person) => (
              <PersonCard key={person.user_id} person={person} onRate={rate(person.user_id)} />
            ))}
          </ul>
        </>
      ) : reported.length ? (
        <section className="rounded-lg border border-subtle bg-surface-1 p-4">
          <h2 className="mb-2 text-body-sm-medium text-primary">Reports of this day (not reviewed yet)</h2>
          <ul className="flex flex-col divide-y divide-subtle">
            {reported.map((person) => (
              <li key={person.user_id} className="flex flex-col gap-1 py-2">
                <span className="text-body-sm-medium text-primary">
                  {person.name}{" "}
                  <span className="text-caption-sm-regular text-tertiary">
                    {hours(person.rows.reduce((sum, row) => sum + row.minutes, 0))}
                  </span>
                </span>
                {person.rows.map((row) => (
                  <span key={row.id} className="truncate text-caption-sm-regular text-secondary">
                    {hours(row.minutes)} · {row.key ? `${row.key} ` : ""}
                    {row.task} · {row.note || "no note"}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
});
