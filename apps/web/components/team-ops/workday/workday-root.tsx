/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import Link from "next/link";
import { useSearchParams } from "react-router";
import { mutate } from "swr";
import { setToast } from "@plane/blocks/toast";
import { toDateKey } from "@plane/services";
import type { TDayMode, TOpsNotification } from "@plane/types";
// hooks
import { useUser } from "@/hooks/store/user";
import { useCalendarSettings } from "@/hooks/team-ops/use-work-calendar";
import { useOpsNotifications, useWorkdayState } from "@/hooks/team-ops/use-workday";
// components
import { getErrorMessage } from "../calendar/error-message";
import { DayReportCard } from "../day-report/day-report-card";
import { TeamDayReports } from "../day-report/team-day-reports";
import { NotificationItem } from "../notifications/notification-item";
import { MyReportsRoot } from "../reports/my-reports-root";
// local imports
import { DayModeChip, DayOverride, DayStart, Gate, WeekUnlock } from "./day-start";
import { WeekPlan } from "./week-plan";

type Props = { workspaceSlug: string };

const dateFormat = new Intl.DateTimeFormat("en-US", { weekday: "long", day: "numeric", month: "long" });

const shift = (key: string, days: number) => {
  const [y, m, d] = key.split("-").map(Number);
  return toDateKey(new Date(y, m - 1, d + days));
};

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-lg border border-subtle bg-surface-1">
      <summary className="flex min-h-12 cursor-pointer items-baseline justify-between gap-2 px-4 py-3">
        <span className="text-body-md-medium text-primary">{title}</span>
        <span className="text-caption-sm-regular text-tertiary">{hint}</span>
      </summary>
      <div className="border-t border-subtle">{children}</div>
    </details>
  );
}

function Alerts({
  items,
  onRead,
  workspaceSlug,
}: {
  items: TOpsNotification[];
  onRead: (id?: string) => Promise<void>;
  workspaceSlug: string;
}) {
  if (items.length === 0) return null;
  return (
    <section
      aria-label="Alerts"
      className="flex flex-col gap-1 rounded-lg border border-accent-strong bg-surface-1 p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-body-md-medium text-primary">
          New for you
          <span className="rounded-full bg-accent-primary px-2 py-0.5 text-caption-sm-medium text-on-color">
            {items.length}
          </span>
        </h3>
        <button
          type="button"
          className="text-body-xs-medium text-accent-primary hover:underline"
          onClick={() => onRead()}
        >
          Mark all read
        </button>
      </div>
      <ul className="flex flex-col divide-y divide-subtle">
        {items.slice(0, 5).map((item) => (
          <li key={item.id}>
            <NotificationItem
              workspaceSlug={workspaceSlug}
              item={item}
              onOpen={() => void onRead(item.id)}
              action={{ label: "Dismiss", onClick: () => void onRead(item.id) }}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Day Report: say how the week is worked, then at the end of each day list the tasks and the time they took.
 * `?date=` opens another day (from the calendar); `?user=` lets a manager read someone's report and its changes.
 */
export const WorkdayRoot = observer(function WorkdayRoot({ workspaceSlug }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: currentUser } = useUser();
  const { permissions } = useCalendarSettings(workspaceSlug);
  const day = useWorkdayState(workspaceSlug);
  const { notifications, markRead } = useOpsNotifications(workspaceSlug);

  const today = toDateKey(new Date());
  const requested = searchParams.get("date");
  const date = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) && requested <= today ? requested : today;
  const viewedUser = searchParams.get("user") ?? undefined;
  const othersReport = !!viewedUser && viewedUser !== currentUser?.id;

  const state = day.state;
  const mode = state?.day?.mode;
  const unread = (notifications ?? []).filter((item) => !item.read);
  const everything = () => mutate((key) => typeof key === "string" && key.startsWith("TEAM_OPS_"));
  const fail = (title: string) => (error: unknown) =>
    setToast({ type: "error", title, message: getErrorMessage(error) });
  const choose = (next: TDayMode) => day.setDayMode(next).catch(fail("Could not save"));

  const goTo = (next: string) => {
    const params = new URLSearchParams(searchParams);
    if (next === today) params.delete("date");
    else params.set("date", next);
    setSearchParams(params, { replace: true });
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-h4-medium text-primary">Day Report</h1>
          <p className="text-body-sm-regular text-secondary">{dateFormat.format(new Date())}</p>
        </div>
        {mode ? <DayModeChip mode={mode} /> : null}
      </header>

      {!othersReport ? <Alerts items={unread} onRead={markRead} workspaceSlug={workspaceSlug} /> : null}

      {day.isLoading ? <p className="text-body-sm-regular text-tertiary">Loading your day...</p> : null}

      {!othersReport && state?.week && currentUser && !state.week.complete ? (
        <Gate label="Plan your week">
          <WeekPlan
            workspaceSlug={workspaceSlug}
            userId={currentUser.id}
            week={state.week}
            onChanged={async () => {
              await day.refresh();
              await everything();
            }}
            onConfirm={async () => {
              await day.confirmWeek();
              await everything();
            }}
          />
        </Gate>
      ) : null}

      {!othersReport && state?.week?.complete && !mode && date === today ? (
        <Gate label="Start your day">
          <DayStart onChoose={choose} />
        </Gate>
      ) : null}

      {/* The day shown: today by default, any past day from here or from the calendar. */}
      <nav aria-label="Choose the day" className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => goTo(shift(date, -1))}
          className="min-h-10 rounded-md border border-subtle px-3 text-body-sm-medium text-secondary hover:bg-layer-1"
        >
          ← Previous day
        </button>
        <input
          type="date"
          value={date}
          max={today}
          aria-label="Day"
          onChange={(event) => event.target.value && goTo(event.target.value)}
          className="h-10 rounded-md border border-subtle bg-layer-1 px-3 text-body-sm-regular text-primary"
        />
        <button
          type="button"
          disabled={date >= today}
          onClick={() => goTo(shift(date, 1))}
          className="min-h-10 rounded-md border border-subtle px-3 text-body-sm-medium text-secondary hover:bg-layer-1 disabled:opacity-40"
        >
          Next day →
        </button>
        {date !== today ? (
          <button
            type="button"
            onClick={() => goTo(today)}
            className="min-h-10 rounded-md px-3 text-body-sm-medium text-accent-primary hover:underline"
          >
            Today
          </button>
        ) : null}
        {othersReport ? (
          <Link
            href={`/${workspaceSlug}/team-ops/workday/`}
            className="ml-auto min-h-10 content-center text-body-sm-medium text-accent-primary hover:underline"
          >
            Back to my report
          </Link>
        ) : null}
      </nav>

      <DayReportCard
        workspaceSlug={workspaceSlug}
        day={date}
        user={othersReport ? viewedUser : undefined}
        canSeeHistory={!othersReport || !!permissions?.can_view_team}
      />

      {permissions?.can_view_team && !othersReport ? <TeamDayReports workspaceSlug={workspaceSlug} day={date} /> : null}

      {permissions?.can_view_team ? (
        <nav aria-label="Manage the team" className="flex flex-wrap gap-x-5 gap-y-1 text-body-sm-medium">
          <Link className="text-accent-primary hover:underline" href={`/${workspaceSlug}/team-ops/calendar/team/`}>
            Team calendar
          </Link>
          <Link className="text-accent-primary hover:underline" href={`/${workspaceSlug}/team-ops/reports/board/`}>
            Report board
          </Link>
          {permissions.can_manage ? (
            <Link
              className="text-accent-primary hover:underline"
              href={`/${workspaceSlug}/team-ops/calendar/settings/`}
            >
              Calendar settings
            </Link>
          ) : null}
        </nav>
      ) : null}

      {!othersReport ? (
        <>
          <div className="flex flex-col gap-3">
            <Section title="My reports" hint="Daily and weekly">
              <MyReportsRoot workspaceSlug={workspaceSlug} />
            </Section>
          </div>

          {state?.week && currentUser && state.week.complete ? (
            <WeekPlan
              workspaceSlug={workspaceSlug}
              userId={currentUser.id}
              week={state.week}
              onChanged={async () => {
                await day.refresh();
                await everything();
              }}
              onConfirm={async () => {
                await day.confirmWeek();
              }}
            />
          ) : null}

          {state?.week?.confirmed ? (
            <WeekUnlock
              onUnlock={async () => {
                await day.unlockWeek().catch(fail("Could not reopen"));
                await everything();
              }}
            />
          ) : null}

          {mode ? (
            <DayOverride
              mode={mode}
              sessions={[]}
              onSubmit={async (next, places) => {
                try {
                  await day.overrideDay(next, places);
                  await everything();
                } catch (error) {
                  fail("Could not change")(error);
                  throw error;
                }
              }}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
});
