/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { ChevronRight, Sparkles } from "lucide-react";
import { observer } from "mobx-react";
import type { TAIMemberReview, TAITeamReview, TAIVerdict, TEvidenceLevel, TEvidencePerson } from "@plane/types";
import { cn } from "@plane/utils";
// components
import { ReportFilters, StatCard, hours, usePeriod } from "@/components/team-ops/control/report-shared";
import { PersonAvatar } from "@/components/team-ops/hub/person-avatar";
// hooks
import { teamAIService, useAIStatus, useWorkEvidence } from "@/hooks/team-ops/use-ai";
import { useCalendarSettings } from "@/hooks/team-ops/use-work-calendar";
// local imports
import { getErrorMessage } from "../calendar/error-message";
import { AIMarkdown } from "./ai-markdown";

const LEVEL: Record<TEvidenceLevel, { label: string; style: string }> = {
  STRONG: { label: "Well supported", style: "bg-success-subtle text-success-primary" },
  PARTIAL: { label: "Partly supported", style: "bg-warning-subtle text-warning-primary" },
  WEAK: { label: "Weakly supported", style: "bg-danger-subtle text-danger-primary" },
  NO_DATA: { label: "Nothing reported", style: "bg-layer-1 text-tertiary" },
};

const VERDICT: Record<TAIVerdict, TEvidenceLevel> = {
  well_supported: "STRONG",
  partly_supported: "PARTIAL",
  weakly_supported: "WEAK",
  no_data: "NO_DATA",
};

function LevelBadge({ level }: { level: TEvidenceLevel }) {
  return (
    <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-caption-sm-medium", LEVEL[level].style)}>
      {LEVEL[level].label}
    </span>
  );
}

function ScoreBar({ score, level }: { score: number; level: TEvidenceLevel }) {
  const color =
    level === "STRONG" ? "bg-success-primary" : level === "PARTIAL" ? "bg-warning-primary" : "bg-danger-primary";
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-layer-1" aria-hidden>
        <span className={cn("block h-full rounded-full", color)} style={{ width: `${score}%` }} />
      </span>
      <span className="text-body-xs-medium text-primary tabular-nums">{level === "NO_DATA" ? "–" : score}</span>
    </span>
  );
}

const Yes = ({ on, label }: { on: boolean; label: string }) => (
  <span
    className={cn(
      "rounded px-1 text-[11px]",
      on ? "bg-success-subtle text-success-primary" : "bg-layer-1 text-tertiary"
    )}
  >
    {on ? "✓" : "✗"} {label}
  </span>
);

function PersonRow({ person, review }: { person: TEvidencePerson; review?: TAIMemberReview }) {
  const [open, setOpen] = useState(false);
  const { facts } = person;
  return (
    <li className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex flex-wrap items-center gap-3 px-3 py-3 text-left hover:bg-layer-1"
      >
        <ChevronRight
          className={cn("size-4 shrink-0 text-tertiary transition-transform", open && "rotate-90")}
          aria-hidden
        />
        <span className="flex min-w-40 flex-1 items-center gap-2">
          <PersonAvatar person={person.user} size="sm" />
          <span className="truncate text-body-sm-medium text-primary">{person.user.display_name}</span>
        </span>
        <ScoreBar score={person.score} level={person.level} />
        <span className="w-28 text-right text-caption-sm-regular text-tertiary tabular-nums">
          {hours(facts.reported_minutes)} reported
        </span>
        <span className="w-28 text-right text-caption-sm-regular text-tertiary tabular-nums">
          {facts.hours_without_any_trace ? `${facts.hours_without_any_trace}h no trace` : "all traced"}
        </span>
        <LevelBadge level={review ? VERDICT[review.verdict] : person.level} />
      </button>
      {open ? (
        <div className="flex flex-col gap-3 border-t border-subtle bg-layer-1/40 px-4 py-3 sm:pl-10">
          {review ? (
            <div className="flex flex-col gap-1 rounded-md border border-subtle bg-surface-1 p-3">
              <span className="flex items-center gap-1 text-caption-sm-medium text-tertiary">
                <Sparkles className="size-3.5" aria-hidden />
                {review.source === "ai" ? "AI review" : "Review from the numbers (clear case, no AI needed)"}
              </span>
              <AIMarkdown source={review.explanation} />
              {review.questions.length ? (
                <ul className="list-disc pl-5 text-body-xs-regular text-secondary">
                  {review.questions.map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {person.flags.length ? (
            <ul className="flex flex-col gap-1">
              {person.flags.map((flag) => (
                <li key={flag} className="text-body-xs-regular text-warning-primary">
                  • {flag}
                </li>
              ))}
            </ul>
          ) : person.level !== "NO_DATA" ? (
            <p className="text-body-xs-regular text-success-primary">Every reported row has a trace in Plane.</p>
          ) : null}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-caption-sm-regular text-secondary sm:grid-cols-4">
            {(
              [
                ["Reports sent", facts.reports_sent],
                ["Tasks reported", facts.reported_tasks],
                ["Rows with activity", `${facts.rows_with_activity} / ${facts.work_item_rows}`],
                ["Rows with a document", facts.rows_with_document],
                ["Rows with a note", facts.rows_with_note],
                ["Marked done", facts.marked_done],
                ["Done but still open", facts.marked_done_still_open],
                ["Micro task hours", facts.micro_task_hours],
                ["Days over 12h", facts.days_over_12h],
                ["Late reports", facts.late_reports],
                ["Changed after sending", facts.changed_reports],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="flex justify-between gap-2">
                <dt className="text-tertiary">{label}</dt>
                <dd className="tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          {person.items.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-left text-caption-sm-regular">
                <caption className="pb-1 text-left text-caption-sm-medium text-tertiary">
                  Rows with the least evidence first
                </caption>
                <tbody className="divide-y divide-subtle">
                  {person.items.map((item, index) => (
                    // eslint-disable-next-line react/no-array-index-key -- rows have no id and never reorder
                    <tr key={`${item.date}-${item.key}-${index}`}>
                      <td className="py-1.5 pr-2 text-tertiary tabular-nums">{item.date.slice(5)}</td>
                      <td className="max-w-64 truncate py-1.5 pr-2 text-primary">
                        {item.key ? <span className="text-tertiary">{item.key} </span> : null}
                        {item.name}
                        {item.finished ? <span className="text-tertiary"> · marked done</span> : null}
                      </td>
                      <td className="py-1.5 pr-2 tabular-nums">{hours(item.minutes)}</td>
                      <td className="py-1.5 pr-2">
                        <span className="flex flex-wrap gap-1">
                          {item.kind === "issue" ? (
                            <>
                              <Yes on={item.evidence.activity} label="activity" />
                              <Yes on={item.evidence.document} label="document" />
                            </>
                          ) : (
                            <span className="text-tertiary">micro task</span>
                          )}
                          <Yes on={item.evidence.note} label="note" />
                          {item.done_but_open ? (
                            <span className="rounded bg-danger-subtle px-1 text-[11px] text-danger-primary">
                              still open
                            </span>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

type Props = { workspaceSlug: string };

/**
 * Dashboard › AI: does what people reported match what Plane recorded? The numbers come from Plane itself and
 * work without AI; "Explain with AI" asks Plane AI to read them and say what stands out, person by person.
 */
export const AITeamTab = observer(function AITeamTab({ workspaceSlug }: Props) {
  const periodState = usePeriod("week");
  const { period } = periodState;
  const [team, setTeam] = useState("");
  const [review, setReview] = useState<{ key: string; data: TAITeamReview } | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [problem, setProblem] = useState("");
  const { permissions } = useCalendarSettings(workspaceSlug);
  const { usable } = useAIStatus(workspaceSlug);
  const canView = permissions?.can_view_team ?? false;
  const params = { from: period.from, to: period.to, team: team || undefined };
  const key = JSON.stringify(params);
  const { evidence, error } = useWorkEvidence(workspaceSlug, canView, params);
  const current = review?.key === key ? review.data : undefined;
  const byUser = new Map((current?.members ?? []).map((member) => [member.user_id, member]));

  if (!permissions) return null;
  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-3xl p-6">
        <p className="rounded-lg border border-dashed border-subtle p-4 text-body-sm-regular text-tertiary">
          The AI tab is only open to the people your workspace admins chose.
        </p>
      </div>
    );
  }

  const explain = async () => {
    setBusy(true);
    setProblem("");
    try {
      const job = await teamAIService.reviewTeam(workspaceSlug, params);
      const data = await teamAIService.waitForJob(workspaceSlug, job, (state) => setProgress(state.progress));
      setReview({ key, data });
    } catch (failure) {
      setProblem(getErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ReportFilters workspaceSlug={workspaceSlug} periodState={periodState} team={team} setTeam={setTeam} />
        <button
          type="button"
          disabled={!usable || busy || !evidence}
          title={usable ? undefined : "AI is off or not set up. The evidence below works without it."}
          onClick={() => void explain()}
          className="inline-flex min-h-9 items-center gap-2 rounded-md bg-accent-primary px-3 text-body-xs-medium text-on-color disabled:opacity-50"
        >
          <Sparkles className="size-4" aria-hidden />
          {busy
            ? `Reading the reports${progress ? ` (${progress})` : "..."}`
            : current
              ? "Explain again"
              : "Explain with AI"}
        </button>
      </div>

      {error ? (
        <p role="alert" className="text-body-sm-medium text-danger-primary">
          The evidence could not be loaded. Reload the page to try again.
        </p>
      ) : null}
      {problem ? (
        <p role="alert" className="text-body-sm-medium text-danger-primary">
          {problem}
        </p>
      ) : null}

      {evidence ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatCard
            label="People reporting"
            value={`${evidence.team.people_reporting} / ${evidence.team.people}`}
            hint={`${evidence.team.reported_hours}h reported`}
          />
          <StatCard
            label="Average evidence"
            value={evidence.team.people_reporting ? evidence.team.average_score : "–"}
            hint="0-100, weighted by hours"
            tone={evidence.team.average_score >= 70 ? "good" : evidence.team.average_score >= 40 ? "warn" : "bad"}
          />
          <StatCard label="Weakly supported" value={evidence.team.weak} tone={evidence.team.weak ? "bad" : "good"} />
          <StatCard
            label="Partly supported"
            value={evidence.team.partial}
            tone={evidence.team.partial ? "warn" : "good"}
          />
          <StatCard
            label="Hours without a trace"
            value={`${evidence.team.hours_without_any_trace}h`}
            tone={evidence.team.hours_without_any_trace ? "warn" : "good"}
          />
          <StatCard
            label="Done but still open"
            value={evidence.team.marked_done_still_open}
            tone={evidence.team.marked_done_still_open ? "warn" : "good"}
          />
        </div>
      ) : null}

      {current ? (
        <section aria-label="AI summary" className="rounded-lg border border-subtle bg-surface-1 p-4">
          <h2 className="mb-2 flex items-center gap-2 text-body-sm-medium text-primary">
            <Sparkles className="size-4 text-accent-primary" aria-hidden />
            What stands out
            <span className="text-caption-sm-regular text-tertiary">
              {current.summary_source === "ai" ? `AI, ${current.effort} effort` : "from the numbers"}
              {current.cached ? " · saved answer" : ""}
            </span>
          </h2>
          <ul className="list-disc pl-5 text-body-sm-regular text-secondary">
            {current.summary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {evidence ? (
        <section aria-label="People" className="rounded-lg border border-subtle bg-surface-1">
          <h2 className="border-b border-subtle px-4 py-3 text-body-sm-medium text-primary">
            Reported work against recorded activity
          </h2>
          {evidence.people.length === 0 ? (
            <p className="p-4 text-body-sm-regular text-tertiary">Nobody to show.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-subtle">
              {evidence.people.map((person) => (
                <PersonRow key={person.user.id} person={person} review={byUser.get(person.user.id)} />
              ))}
            </ul>
          )}
        </section>
      ) : null}
      {evidence ? <p className="text-caption-sm-regular text-tertiary">{evidence.notice}</p> : null}
    </div>
  );
});
