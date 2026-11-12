/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronRight, MessageCircleQuestion } from "lucide-react";
import { observer } from "mobx-react";
import { useSearchParams } from "react-router";
import useSWR from "swr";
import type { TQualityPerson } from "@plane/types";
import { cn } from "@plane/utils";
// components
import { ReportFilters, StatCard, usePeriod } from "@/components/team-ops/control/report-shared";
import { PersonAvatar } from "@/components/team-ops/hub/person-avatar";
// hooks
import { teamAIService } from "@/hooks/team-ops/use-ai";
// local imports
import { getErrorMessage } from "../calendar/error-message";

/** Up/down against the period before; `good` says which direction is the good one. */
function Trend({ now, before, good }: { now: number | null; before: number | null; good: "up" | "down" }) {
  if (now === null || before === null || now === before) return null;
  const up = now > before;
  const fine = (up && good === "up") || (!up && good === "down");
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <Icon
      aria-label={`${up ? "up" : "down"} from ${before}`}
      className={cn("inline size-3", fine ? "text-success-primary" : "text-danger-primary")}
    />
  );
}

function Cell({ children, tone }: { children: React.ReactNode; tone?: "good" | "warn" | "bad" }) {
  return (
    <td
      className={cn(
        "px-3 py-2 whitespace-nowrap tabular-nums",
        tone === "good" && "text-success-primary",
        tone === "warn" && "text-warning-primary",
        tone === "bad" && "text-danger-primary"
      )}
    >
      {children}
    </td>
  );
}

function PersonRow({ person, onAsk }: { person: TQualityPerson; onAsk: (question: string) => void }) {
  const [open, setOpen] = useState(false);
  const p = person;
  const onTimeTone =
    p.on_time_rate === null ? undefined : p.on_time_rate >= 80 ? "good" : p.on_time_rate >= 50 ? "warn" : "bad";
  const ratioTone =
    p.estimate_ratio === null
      ? undefined
      : p.estimate_ratio <= 1.25
        ? "good"
        : p.estimate_ratio <= 1.5
          ? "warn"
          : "bad";
  return (
    <>
      <tr className="cursor-pointer hover:bg-layer-1" onClick={() => setOpen(!open)}>
        <td className="px-3 py-2">
          <span className="flex items-center gap-2">
            <ChevronRight
              className={cn("size-4 text-tertiary transition-transform", open && "rotate-90")}
              aria-hidden
            />
            <PersonAvatar person={p.user} size="sm" />
            <span className="text-body-sm-medium text-primary">{p.user.display_name}</span>
          </span>
        </td>
        <Cell>
          {p.reported_hours} h <Trend now={p.reported_hours} before={p.previous.reported_hours} good="up" />
        </Cell>
        <Cell>
          {p.finished} <Trend now={p.finished} before={p.previous.finished} good="up" />
        </Cell>
        <Cell tone={onTimeTone}>
          {p.on_time_rate === null ? "–" : `${p.on_time_rate}%`}{" "}
          <Trend now={p.on_time_rate} before={p.previous.on_time_rate} good="up" />
        </Cell>
        <Cell tone={p.reopened ? "warn" : undefined}>{p.reopened || "–"}</Cell>
        <Cell tone={ratioTone}>{p.estimate_ratio === null ? "–" : `×${p.estimate_ratio}`}</Cell>
        <Cell tone={p.tasks_a_day >= 5 ? "warn" : undefined}>{p.tasks_a_day || "–"}</Cell>
        <Cell tone={(p.meeting_share ?? 0) >= 40 ? "warn" : undefined}>
          {p.meeting_share === null ? "–" : `${p.meeting_share}%`}
        </Cell>
        <Cell tone={p.work_sessions && !p.documents ? "warn" : undefined}>
          {p.documents} / {p.comments}
        </Cell>
        <Cell tone={p.reports_late ? "warn" : undefined}>
          {p.reports_sent}
          {p.reports_late ? ` (${p.reports_late} late)` : ""}
        </Cell>
      </tr>
      {open ? (
        <tr className="bg-layer-1/40">
          <td colSpan={10} className="px-4 py-3">
            <div className="flex flex-col gap-2 sm:pl-8">
              <ul className="flex flex-col gap-0.5">
                {p.notes.map((note) => (
                  <li
                    key={note}
                    className={cn(
                      "text-body-xs-regular",
                      note === "nothing stands out" ? "text-success-primary" : "text-warning-primary"
                    )}
                  >
                    • {note}
                  </li>
                ))}
              </ul>
              {p.projects.length ? (
                <p className="text-caption-sm-regular text-secondary">
                  Time: {p.projects.map((project) => `${project.name} ${project.hours} h`).join(" · ")}
                </p>
              ) : null}
              <p className="text-caption-sm-regular text-tertiary">
                {p.finished_without_due_date ? `${p.finished_without_due_date} finished tasks had no due date. ` : ""}
                {p.estimated_finished
                  ? `${p.estimated_finished} finished tasks had a plan; ${p.over_estimate} took over 1.5× of it. `
                  : "No finished task had a planned time. "}
                {p.reports_changed ? `${p.reports_changed} reports were changed after sending.` : ""}
              </p>
              <button
                type="button"
                onClick={() => onAsk(`How did ${p.user.display_name} work in this period, and what should I ask them?`)}
                className="inline-flex min-h-8 items-center gap-2 self-start rounded-md border border-subtle px-3 text-body-xs-medium text-secondary hover:bg-layer-1"
              >
                <MessageCircleQuestion className="size-4" aria-hidden />
                Ask the AI about {p.user.display_name}
              </button>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

type Props = { workspaceSlug: string };

/**
 * Dashboard › AI › Quality: after "how many hours", what a manager asks. Delivery on time, work that came back,
 * estimates, focus, documents and reports per person, each with the change since the period before. No AI needed.
 */
export const AIQuality = observer(function AIQuality({ workspaceSlug }: Props) {
  const periodState = usePeriod("week");
  const { period } = periodState;
  const [team, setTeam] = useState("");
  const [, setSearchParams] = useSearchParams();
  const params = { from: period.from, to: period.to, team: team || undefined };
  const { data, error } = useSWR(`TEAM_OPS_AI_QUALITY_${workspaceSlug}_${JSON.stringify(params)}`, () =>
    teamAIService.getQuality(workspaceSlug, params)
  );

  const ask = (question: string) => setSearchParams({ view: "ai", ai: "ask", q: question });
  const people = data?.people ?? [];
  const reporting = people.filter((p) => p.reported_hours > 0);
  const finished = people.reduce((sum, p) => sum + p.finished, 0);
  const late = people.reduce((sum, p) => sum + p.finished_late, 0);
  const onTime = people.reduce((sum, p) => sum + p.finished_on_time, 0);
  const reopened = people.reduce((sum, p) => sum + p.reopened, 0);
  const prevFinished = people.reduce((sum, p) => sum + p.previous.finished, 0);
  const rate = onTime + late ? Math.round((100 * onTime) / (onTime + late)) : null;

  return (
    <div className="flex flex-col gap-4">
      <ReportFilters workspaceSlug={workspaceSlug} periodState={periodState} team={team} setTeam={setTeam} />
      {error ? (
        <p role="alert" className="text-body-sm-medium text-danger-primary">
          {getErrorMessage(error)}
        </p>
      ) : null}
      {data ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard
              label="Tasks finished"
              value={finished}
              hint={`${prevFinished} in the period before`}
              tone={finished >= prevFinished ? "good" : "warn"}
            />
            <StatCard
              label="On time"
              value={rate === null ? "–" : `${rate}%`}
              hint={`${late} late`}
              tone={rate === null ? undefined : rate >= 80 ? "good" : rate >= 50 ? "warn" : "bad"}
            />
            <StatCard
              label="Work that came back"
              value={reopened}
              hint="finished, then reopened"
              tone={reopened ? "warn" : "good"}
            />
            <StatCard label="People reporting" value={`${reporting.length} / ${people.length}`} />
          </div>
          <div className="overflow-x-auto rounded-lg border border-subtle bg-surface-1">
            <table className="w-full min-w-[56rem] text-left text-body-sm-regular text-primary">
              <thead className="border-b border-subtle bg-layer-1 text-caption-sm-medium text-tertiary">
                <tr>
                  {[
                    "Person",
                    "Hours",
                    "Finished",
                    "On time",
                    "Reopened",
                    "Estimates",
                    "Tasks a day",
                    "Meetings",
                    "Docs / comments",
                    "Reports",
                  ].map((column) => (
                    <th key={column} scope="col" className="px-3 py-2 whitespace-nowrap">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle">
                {people.map((person) => (
                  <PersonRow key={person.user.id} person={person} onAsk={ask} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-caption-sm-regular text-tertiary">
            Arrows compare with {data.previous_from} to {data.previous_to}. Estimates: reported time ÷ planned time on
            finished tasks (×1 = as planned). {data.notice}
          </p>
        </>
      ) : null}
    </div>
  );
});
