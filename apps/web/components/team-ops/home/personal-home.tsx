/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useState } from "react";
import { orderBy } from "lodash-es";
import { observer } from "mobx-react";
import Link from "next/link";
import { addDays, formatHm, toDateKey } from "@plane/services";
import type { TWorkSession } from "@plane/types";
// hooks
import { useUser } from "@/hooks/store/user";
import { useWorkday } from "@/hooks/team-ops/use-workday";
// components
import { ContributionGraph } from "../workday/contribution-graph";
import { HomeMentions } from "./home-mentions";

type Props = { workspaceSlug: string };

const monthFormat = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const dayFormat = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" });

type Month = { key: string; label: string; sessions: TWorkSession[] };

const groupByMonth = (sessions: TWorkSession[]): Month[] => {
  const months = new Map<string, Month>();
  for (const session of sessions) {
    const date = new Date(session.finished_at);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    if (!months.has(key)) months.set(key, { key, label: monthFormat.format(date), sessions: [] });
    months.get(key)!.sessions.push(session);
  }
  return orderBy([...months.values()], (month) => month.key, "desc");
};

function MonthBlock({ month }: { month: Month }) {
  const [open, setOpen] = useState(false);
  const tasks = new Set(month.sessions.map((session) => session.issue)).size;
  const projects = new Set(month.sessions.map((session) => (session.work_item ?? "").split("-")[0])).size;
  const seconds = month.sessions.filter((s) => !s.is_parallel).reduce((sum, s) => sum + s.duration_seconds, 0);
  return (
    <li className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <h3 className="text-body-sm-medium text-primary">{month.label}</h3>
        <div className="h-px flex-1 bg-layer-1" />
      </div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-1 py-1 text-left hover:bg-layer-1"
      >
        <span className="text-body-md-medium text-primary">
          Finished {month.sessions.length} piece{month.sessions.length === 1 ? "" : "s"} of work on {tasks} task
          {tasks === 1 ? "" : "s"} in {projects} project{projects === 1 ? "" : "s"}
        </span>
        <span className="text-body-xs-regular text-tertiary">
          {formatHm(seconds)} {open ? "▲" : "▼"}
        </span>
      </button>
      {open ? (
        <ul className="flex flex-col gap-2 border-l border-subtle pl-4">
          {month.sessions.map((session) => (
            <li
              key={session.id}
              className="flex flex-col gap-0.5 rounded-lg border border-subtle bg-surface-1 px-4 py-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-body-sm-medium text-primary">
                  <span className="text-tertiary">{session.work_item}</span> {session.work_item_name}
                </p>
                <span className="text-caption-sm-regular text-tertiary">
                  {dayFormat.format(new Date(session.finished_at))} · {formatHm(session.duration_seconds)}
                  {session.is_parallel ? " · parallel" : ""}
                </span>
              </div>
              <p className="line-clamp-2 text-body-xs-regular text-secondary">{session.summary}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** Home: one person's whole picture, in the shape of a contribution page. */
export const PersonalHome = observer(function PersonalHome({ workspaceSlug }: Props) {
  const { data: currentUser } = useUser();
  const today = toDateKey(new Date());
  const range = useMemo(() => ({ from: addDays(today, -90), to: today }), [today]);
  const { sessions, tasks } = useWorkday(workspaceSlug, currentUser?.id, range.from, range.to);
  const months = useMemo(() => groupByMonth(sessions ?? []), [sessions]);
  const attention = (sessions ?? []).filter((session) => session.needs_attention).length;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-h4-medium text-primary">{currentUser?.display_name ?? "Home"}</h1>
          <p className="text-body-sm-regular text-secondary">Your work over the last 90 days.</p>
        </div>
        <Link
          href={`/${workspaceSlug}/team-ops/workday/`}
          className="rounded-md bg-accent-primary px-4 py-2 text-body-sm-medium text-on-color"
        >
          Open Day Report
        </Link>
      </header>

      <HomeMentions workspaceSlug={workspaceSlug} />

      <dl className="flex flex-wrap gap-3">
        {[
          ["Pieces of work", String((sessions ?? []).length)],
          ["Tasks worked on", String((tasks?.results ?? []).length)],
          ["Hours", formatHm(tasks?.total_seconds ?? 0)],
          ["Needed attention", String(attention)],
        ].map(([label, value]) => (
          <div
            key={label}
            className="flex min-w-32 flex-1 flex-col rounded-lg border border-subtle bg-surface-1 px-4 py-3"
          >
            <dt className="text-caption-sm-regular text-tertiary">{label}</dt>
            <dd className="text-h4-medium text-primary tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <ContributionGraph workspaceSlug={workspaceSlug} />

      <section aria-label="Contribution activity" className="flex flex-col gap-4">
        <h2 className="text-body-md-medium text-primary">Contribution activity</h2>
        {months.length === 0 ? (
          <p className="text-body-sm-regular text-tertiary">Nothing finished yet. Start a task in Workday.</p>
        ) : (
          <ol className="flex flex-col gap-5">
            {months.map((month) => (
              <MonthBlock key={month.key} month={month} />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
});
