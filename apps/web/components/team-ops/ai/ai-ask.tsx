/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import {
  CircleAlert,
  CircleCheck,
  CircleHelp,
  History,
  MessageSquarePlus,
  Search,
  Send,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { observer } from "mobx-react";
import { useSearchParams } from "react-router";
import useSWR from "swr";
import { setToast } from "@plane/blocks/toast";
import type { TAIJob, TAskResult } from "@plane/types";
import { calculateTimeAgo, cn } from "@plane/utils";
// components
import { ReportFilters, usePeriod } from "@/components/team-ops/control/report-shared";
// hooks
import { teamAIService, useAIStatus } from "@/hooks/team-ops/use-ai";
// local imports
import { getErrorMessage } from "../calendar/error-message";
import { AIMarkdown } from "./ai-markdown";

/** What a manager asks about their team, grouped by what they want to find out. */
const EXAMPLES: { group: string; questions: string[] }[] = [
  {
    group: "Who did what",
    questions: [
      "Who reported the most hours and who the fewest, and what did each of them finish?",
      "این هفته هر کس روی چه پروژه‌هایی وقت گذاشته؟",
    ],
  },
  {
    group: "Quality",
    questions: [
      "Whose finished work came back (reopened), and on which tasks?",
      "چه کسی بیشتر تسک‌هایش را دیر تحویل داده و چقدر دیر؟",
      "Who keeps going over their planned time, and by how much?",
    ],
  },
  {
    group: "Real work or not",
    questions: [
      "Which reports have hours with no trace in Plane (no activity, document or note)?",
      "چه کسی ساعت‌های زیادی برای تحقیق یا تغییر کانفیگ نوشته و توضیحش چه بوده؟",
      "Who marked tasks done that are still open?",
    ],
  },
  {
    group: "Focus and load",
    questions: [
      "Who spends the most time in meetings, and who jumps between too many tasks a day?",
      "Who is overloaded, and who has room for more work?",
    ],
  },
  {
    group: "Trend and next steps",
    questions: [
      "Who got better or worse compared with the period before?",
      "Which tasks are overdue or blocked, and who should I talk to first?",
    ],
  },
];

const SECTION_LABEL: Record<string, string> = {
  person: "the person's record",
  people: "hours per person",
  daily_notes: "Day Report notes",
  evidence: "evidence of work",
  quality: "work quality",
  projects: "projects",
  risks: "tasks at risk",
  workload: "workload",
  docs: "work items and documents",
};

/** One question and what became of it: still running, answered, or failed. */
type TTurn = { key: string; question: string; job: TAIJob<TAskResult> | null; error?: string };

function AIAvatar() {
  return (
    <span
      aria-hidden
      className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-primary/10 text-accent-primary"
    >
      <Sparkles className="size-4" />
    </span>
  );
}

function Question({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p
        dir="auto"
        className="max-w-[80%] rounded-2xl rounded-ee-sm bg-accent-primary px-4 py-2 text-body-sm-regular whitespace-pre-wrap text-on-color"
      >
        {text}
      </p>
    </div>
  );
}

function Thinking({ job }: { job: TAIJob<TAskResult> | null }) {
  const label =
    !job || job.status === "queued" ? "Waiting for the AI (another request is running)" : "Reading the data";
  return (
    <div className="flex gap-3" aria-live="polite">
      <AIAvatar />
      <div className="flex items-center gap-3 rounded-2xl rounded-ss-sm bg-layer-1 px-4 py-3">
        <span className="flex gap-1" aria-hidden>
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              className="size-1.5 animate-bounce rounded-full bg-accent-primary"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </span>
        <span className="text-body-xs-regular text-tertiary">
          {label}
          {job?.progress ? ` · ${job.progress}` : ""}
        </span>
      </div>
    </div>
  );
}

function Failed({ message }: { message: string }) {
  return (
    <div className="flex gap-3">
      <AIAvatar />
      <p className="inline-flex items-center gap-2 rounded-2xl rounded-ss-sm border border-danger-subtle bg-danger-subtle/30 px-4 py-2 text-body-sm-regular text-danger-primary">
        <CircleAlert className="size-4 shrink-0" aria-hidden />
        {message}
      </p>
    </div>
  );
}

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
    <div className="flex gap-3">
      <AIAvatar />
      <article className="flex min-w-0 flex-1 flex-col gap-3 rounded-2xl rounded-ss-sm border border-subtle bg-surface-1 px-4 py-3 shadow-raised-100">
        <AIMarkdown source={result.answer} />
        <footer className="flex flex-wrap items-center gap-1.5 border-t border-subtle pt-2 text-caption-sm-regular text-tertiary">
          {result.verified ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-success-subtle/40 px-2 py-0.5 text-success-primary">
              <CircleCheck className="size-3" aria-hidden />
              Numbers checked against Plane
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-warning-subtle/40 px-2 py-0.5 text-warning-primary">
              <CircleHelp className="size-3" aria-hidden />
              Check: {result.unverified_numbers.join(", ")}
            </span>
          )}
          <span
            className="rounded-full bg-layer-1 px-2 py-0.5"
            title={`Read: ${result.sections.map((name) => SECTION_LABEL[name] ?? name).join(", ")}`}
          >
            {result.sections.length} data sections
          </span>
          <span className="rounded-full bg-layer-1 px-2 py-0.5">{result.effort} effort</span>
          {job.finished_at ? <span>{calculateTimeAgo(job.finished_at)}</span> : null}
          <span className="ms-auto flex items-center gap-0.5">
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
        </footer>
      </article>
    </div>
  );
}

/** The "History" button: earlier questions in a panel, searchable; picking one opens it in the conversation. */
function HistoryMenu({ jobs, onPick }: { jobs: TAIJob<TAskResult>[]; onPick: (job: TAIJob<TAskResult>) => void }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !ref.current?.contains(event.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const answered = jobs.filter((job) => job.status === "done" && job.result);
  const needle = filter.trim().toLowerCase();
  const shown = needle ? answered.filter((job) => job.result?.question.toLowerCase().includes(needle)) : answered;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-subtle px-2.5 text-body-xs-medium text-secondary hover:bg-layer-1"
      >
        <History className="size-3.5" aria-hidden />
        History
        {answered.length ? (
          <span className="rounded-full bg-layer-1 px-1.5 text-caption-sm-medium text-tertiary">{answered.length}</span>
        ) : null}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Earlier questions"
          className="absolute end-0 top-full z-20 mt-1 flex w-96 max-w-[90vw] flex-col overflow-hidden rounded-lg border border-subtle bg-surface-1 shadow-raised-200"
        >
          <label className="flex items-center gap-2 border-b border-subtle px-3 py-2">
            <Search className="size-3.5 text-tertiary" aria-hidden />
            <input
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the panel exists to search the list
              autoFocus
              dir="auto"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Search earlier questions"
              className="flex-1 bg-transparent text-body-xs-regular text-primary outline-none"
            />
          </label>
          <ul className="max-h-96 overflow-y-auto py-1">
            {shown.length === 0 ? (
              <li className="px-3 py-4 text-center text-body-xs-regular text-tertiary">
                {answered.length ? "Nothing matches." : "No questions yet."}
              </li>
            ) : null}
            {shown.map((job) => (
              <li key={job.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(job);
                    setOpen(false);
                  }}
                  className="flex w-full flex-col gap-0.5 px-3 py-2 text-start hover:bg-layer-1"
                >
                  <span dir="auto" className="line-clamp-2 text-body-xs-medium text-primary">
                    {job.result?.question}
                  </span>
                  <span className="text-caption-sm-regular text-tertiary">
                    {job.created_at ? calculateTimeAgo(job.created_at) : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

type Props = { workspaceSlug: string };

/** Dashboard › AI › Ask: a conversation about the team, answered only from Plane's data for the chosen period. */
export const AIAsk = observer(function AIAsk({ workspaceSlug }: Props) {
  const periodState = usePeriod("week");
  const { period } = periodState;
  const [team, setTeam] = useState("");
  const [searchParams] = useSearchParams();
  // A question sent from another tab (e.g. "Ask the AI about <person>" in Quality) is ready to send.
  const [question, setQuestion] = useState(() => searchParams.get("q") ?? "");
  const [turns, setTurns] = useState<TTurn[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const { usable } = useAIStatus(workspaceSlug);
  const { data: history, mutate } = useSWR(usable ? `TEAM_OPS_AI_ASK_${workspaceSlug}` : null, () =>
    teamAIService.listQuestions(workspaceSlug)
  );
  const busy = turns.some((turn) => !turn.error && turn.job?.status !== "done");

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  const update = (key: string, change: Partial<TTurn>) =>
    setTurns((current) => current.map((turn) => (turn.key === key ? { ...turn, ...change } : turn)));

  const ask = async (text = question.trim()) => {
    if (!text || busy) return;
    const key = `${Date.now()}`;
    setTurns((current) => [...current, { key, question: text, job: null }]);
    setQuestion("");
    let last: TAIJob<TAskResult> | null = null;
    try {
      const job = await teamAIService.ask(workspaceSlug, {
        question: text,
        from: period.from,
        to: period.to,
        team: team || undefined,
      });
      const result = await teamAIService.waitForJob(workspaceSlug, job, (current) => {
        last = current;
        update(key, { job: current });
      });
      update(key, { job: { ...(last ?? job), status: "done", result } });
      void mutate();
    } catch (error) {
      update(key, { error: getErrorMessage(error) });
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
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <ReportFilters workspaceSlug={workspaceSlug} periodState={periodState} team={team} setTeam={setTeam} />
        <div className="flex items-center gap-2">
          {turns.length ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => setTurns([])}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-subtle px-2.5 text-body-xs-medium text-secondary hover:bg-layer-1 disabled:opacity-50"
            >
              <MessageSquarePlus className="size-3.5" aria-hidden />
              New question
            </button>
          ) : null}
          <HistoryMenu
            jobs={history ?? []}
            onPick={(job) => setTurns([{ key: job.id, question: job.result?.question ?? "", job }])}
          />
        </div>
      </div>

      <section
        aria-label="Conversation"
        className="flex min-h-[28rem] flex-col overflow-hidden rounded-xl border border-subtle bg-surface-1"
      >
        <div className="flex max-h-[65vh] min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {turns.length === 0 ? (
            <div className="flex flex-col items-center gap-5 py-6">
              <div className="flex flex-col items-center gap-2 text-center">
                <span className="flex size-10 items-center justify-center rounded-full bg-accent-primary/10 text-accent-primary">
                  <Sparkles className="size-5" aria-hidden />
                </span>
                <h3 className="text-body-md-semibold text-primary">Ask about your team</h3>
                <p className="max-w-md text-body-xs-regular text-tertiary">
                  Answers come only from Plane&apos;s data for {period.label}: hours, quality, notes, evidence,
                  projects, risks and workload. Name someone to get their whole record.
                </p>
              </div>
              <div className="grid w-full max-w-4xl grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {EXAMPLES.map((section) => (
                  <div key={section.group} className="flex flex-col gap-1.5 rounded-lg border border-subtle p-3">
                    <span className="text-caption-sm-medium text-tertiary">{section.group}</span>
                    {section.questions.map((example) => (
                      <button
                        key={example}
                        type="button"
                        dir="auto"
                        onClick={() => void ask(example)}
                        className="rounded-md px-2 py-1.5 text-start text-body-xs-regular text-secondary hover:bg-layer-1 hover:text-primary"
                      >
                        {example}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {turns.map((turn) => (
            <div key={turn.key} className="flex flex-col gap-3">
              <Question text={turn.question} />
              {turn.error ? (
                <Failed message={turn.error} />
              ) : turn.job?.status === "done" ? (
                <Answer workspaceSlug={workspaceSlug} job={turn.job} />
              ) : (
                <Thinking job={turn.job} />
              )}
            </div>
          ))}
          <div ref={endRef} />
        </div>

        <form
          className="border-t border-subtle p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void ask();
          }}
        >
          <div className="flex items-end gap-2 rounded-xl border border-subtle bg-layer-1 p-1.5 focus-within:border-accent-strong">
            <textarea
              dir="auto"
              value={question}
              rows={2}
              aria-label="Question"
              placeholder={`Ask about the team in ${period.label}… (Enter sends, Shift+Enter for a new line)`}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void ask();
                }
              }}
              className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-2 py-1.5 text-body-sm-regular text-primary outline-none"
            />
            <button
              type="submit"
              aria-label="Ask"
              disabled={!question.trim() || busy}
              className="inline-flex size-9 items-center justify-center rounded-lg bg-accent-primary text-on-color disabled:opacity-40"
            >
              <Send className="size-4" aria-hidden />
            </button>
          </div>
        </form>
      </section>
    </div>
  );
});
