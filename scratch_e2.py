import os

root = r"E:\Code archives\palne\plane\apps\web"


def edit(p, pairs):
    p = os.path.join(root, p)
    s = open(p, newline="").read()
    nl = "\r\n" if "\r\n" in s else "\n"
    for a, b in pairs:
        a = a.replace("\n", nl)
        b = b.replace("\n", nl)
        assert a in s, (p, a[:80])
        s = s.replace(a, b, 1)
    open(p, "w", newline="").write(s)


def append(p, text):
    p = os.path.join(root, p)
    s = open(p, newline="").read()
    nl = "\r\n" if "\r\n" in s else "\n"
    open(p, "w", newline="").write(s.rstrip() + nl + text.replace("\n", nl))


edit(
    "hooks/team-ops/use-workday.ts",
    [
        (
            "    setBreak: (action",
            "    startParallel: (issue: string, location?: TWorkPlace) =>\n      apply(workdayService.startParallel(workspaceSlug, issue, location)),\n    overrideDay: (mode: TDayMode, sessions: Record<string, TWorkPlace>) =>\n      apply(workdayService.overrideDay(workspaceSlug, mode, sessions)),\n    setBreak: (action",
        ),
        ("import type { TFinishWorkPayload,", "import type { TDayMode, TFinishWorkPayload,"),
    ],
)
edit(
    "components/team-ops/workday/now-card.tsx",
    [("const useSecondsSince =", "export const useSecondsSince =")],
)

# --- day-start: chip becomes read-only; gate and override added ---
s = open(os.path.join(root, "components/team-ops/workday/day-start.tsx"), newline="").read()
i = s.index("/** Today's answer")
nl = "\r\n" if "\r\n" in s else "\n"
s = s[:i].rstrip() + nl
s += '''
const LABEL: Record<TDayMode, string> = { ONSITE: "Onsite", REMOTE: "Remote", HYBRID: "Hybrid (both)" };

/** Today's answer. It is not a control: changing it is a deliberate step at the bottom of the page. */
export function DayModeChip({ mode }: { mode: TDayMode }) {
  return (
    <span
      title="Your answer for today. To change it, use the confirmation at the bottom of the page."
      className="rounded-lg bg-accent-subtle px-3 py-1.5 text-body-xs-medium text-accent-primary"
    >
      Today: {LABEL[mode]}
    </span>
  );
}

/** Covers the page with a blur until the question inside is answered. */
export function Gate({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-canvas/70 p-6 backdrop-blur-md"
    >
      <div className="w-full max-w-3xl">{children}</div>
    </div>
  );
}

type OverrideProps = {
  mode: TDayMode;
  sessions: TWorkSession[];
  onSubmit: (mode: TDayMode, places: Record<string, TWorkPlace>) => Promise<unknown>;
};

/** At the very end of the page, in red: change today's answer, and say again where every finished task was done. */
export function DayOverride({ mode, sessions, onSubmit }: OverrideProps) {
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState<TWorkPlace>(mode === "ONSITE" ? "ONSITE" : "REMOTE");
  const [places, setPlaces] = useState<Record<string, TWorkPlace>>({});
  const [isSaving, setIsSaving] = useState(false);
  const placeOf = (session: TWorkSession): TWorkPlace =>
    places[session.id] ?? (session.location === "ONSITE" || session.location === "REMOTE" ? session.location : next);
  const options: TWorkPlace[] = ["ONSITE", "REMOTE"];

  if (!open) {
    return (
      <div className="flex justify-end">
        <button
          type="button"
          className="text-body-xs-medium text-danger-primary hover:underline"
          onClick={() => setOpen(true)}
        >
          Change today&apos;s answer
        </button>
      </div>
    );
  }

  const submit = async () => {
    setIsSaving(true);
    try {
      await onSubmit(next, Object.fromEntries(sessions.map((session) => [session.id, placeOf(session)])));
      setOpen(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section aria-label="Change today's answer" className="flex flex-col gap-3 rounded-lg border border-danger-strong bg-danger-subtle p-4">
      <div>
        <h3 className="text-body-md-medium text-danger-primary">Change today&apos;s answer</h3>
        <p className="text-body-xs-regular text-secondary">
          Your manager sees the original answer changed. Say again where you did each task today; if they differ, the
          day becomes hybrid.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-body-sm-medium text-primary">Today I worked mainly</span>
        {options.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={next === item}
            onClick={() => setNext(item)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-body-xs-medium",
              next === item ? "border-danger-strong bg-surface-1 text-danger-primary" : "border-subtle text-secondary"
            )}
          >
            {item === "ONSITE" ? "Onsite" : "Remote"}
          </button>
        ))}
      </div>
      {sessions.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {sessions.map((session) => (
            <li key={session.id} className="flex flex-wrap items-center justify-between gap-2 text-body-xs-regular">
              <span className="min-w-0 truncate text-primary">
                {session.work_item} {session.work_item_name}
              </span>
              <span className="flex gap-1">
                {options.map((item) => (
                  <button
                    key={item}
                    type="button"
                    aria-pressed={placeOf(session) === item}
                    onClick={() => setPlaces({ ...places, [session.id]: item })}
                    className={cn(
                      "rounded px-2 py-0.5 text-caption-sm-medium",
                      placeOf(session) === item ? "bg-danger-strong text-on-color" : "bg-surface-1 text-secondary"
                    )}
                  >
                    {item === "ONSITE" ? "Onsite" : "Remote"}
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex gap-2">
        <Button variant="danger" size="md" stretch="auto" label="Confirm the change" loading={isSaving} onClick={submit} />
        <Button variant="secondary" size="md" stretch="auto" label="Keep my answer" onClick={() => setOpen(false)} />
      </div>
    </section>
  );
}
'''.replace("\n", nl)
s = s.replace('import type { TDayMode } from "@plane/types";', 'import { useState } from "react";\nimport { Button } from "@makeplane/propel/components/button";\nimport type { TDayMode, TWorkPlace, TWorkSession } from "@plane/types";'.replace("\n", nl), 1)
open(os.path.join(root, "components/team-ops/workday/day-start.tsx"), "w", newline="").write(s)

# --- workday-root ---
edit(
    "components/team-ops/workday/workday-root.tsx",
    [
        ('import { DayModeChip, DayStart } from "./day-start";', 'import { DayModeChip, DayOverride, DayStart, Gate } from "./day-start";'),
        ('import { NowCard } from "./now-card";', 'import { NowCard } from "./now-card";\nimport { ParallelTasks } from "./parallel-tasks";'),
        ("  const [isFinishing, setIsFinishing] = useState(false);\n", "  const [isFinishing, setIsFinishing] = useState(false);\n  const [parallelFinishing, setParallelFinishing] = useState<TWorkdayTimer | null>(null);\n"),
        ("        {mode ? <DayModeChip mode={mode} onChange={choose} /> : null}", "        {mode ? <DayModeChip mode={mode} /> : null}"),
        ("      {state && !mode ? <DayStart onChoose={choose} /> : null}\n", "      {state?.week?.complete && !mode ? (\n        <Gate label=\"Start your day\">\n          <DayStart onChoose={choose} />\n        </Gate>\n      ) : null}\n"),
        (
            "      {state?.week && currentUser ? (\n        <WeekPlan",
            "      {state?.week && currentUser && !state.week.complete ? (\n        <Gate label=\"Plan your week\">\n          <WeekPlan\n            workspaceSlug={workspaceSlug}\n            userId={currentUser.id}\n            week={state.week}\n            onChanged={async () => {\n              await day.refresh();\n              await everything();\n            }}\n          />\n        </Gate>\n      ) : null}\n\n      {state?.week && currentUser && state.week.complete ? (\n        <WeekPlan",
        ),
        (
            "      {mode && !(timer && isFinishing) ? (",
            """      {mode && parallelFinishing ? (
        <FinishWorkPanel
          title={`Parallel: ${parallelFinishing.work_item ?? ""} ${parallelFinishing.work_item_name ?? ""}`}
          elapsedLabel={formatDuration(parallelFinishing.worked_seconds, "en-US")}
          teams={teams ?? []}
          people={(people ?? []).filter((person) => person.id !== currentUser?.id)}
          onFinish={async (payload) => {
            await finish({ ...payload, timer: parallelFinishing.id });
            setParallelFinishing(null);
          }}
          onCancel={() => setParallelFinishing(null)}
        />
      ) : null}

      {mode && timer && !isFinishing && !parallelFinishing ? (
        <ParallelTasks
          workspaceSlug={workspaceSlug}
          defaultPlace={timer.location}
          parallel={state?.parallel ?? []}
          onStart={async (task, place) => {
            await day.startParallel(task.id, place).catch(fail("Could not start"));
          }}
          onFinish={setParallelFinishing}
        />
      ) : null}

      {mode && !(timer && isFinishing) ? (""",
        ),
        (
            '            <Stat label="Rest pauses"',
            '            {(totals?.parallel_seconds ?? 0) > 0 ? (\n              <div className="flex min-w-32 flex-1 flex-col rounded-lg border bg-surface-1 px-4 py-3" style={{ borderColor: "#8b5cf6" }}>\n                <span className="text-caption-sm-regular text-tertiary">Parallel</span>\n                <span className="text-h4-medium tabular-nums" style={{ color: "#8b5cf6" }}>\n                  {formatHm(totals?.parallel_seconds ?? 0)}\n                </span>\n              </div>\n            ) : null}\n            <Stat label="Rest pauses"',
        ),
        (
            "      {teamRows && teamRows.length > 0 ? <TeamNow rows={teamRows} /> : null}",
            "      {teamRows && teamRows.length > 0 ? <TeamNow rows={teamRows} /> : null}",
        ),
        (
            '        <Section title="My reports" hint="Daily and weekly">\n          <MyReportsRoot workspaceSlug={workspaceSlug} />\n        </Section>\n      </div>',
            '        <Section title="My reports" hint="Daily and weekly">\n          <MyReportsRoot workspaceSlug={workspaceSlug} />\n        </Section>\n      </div>\n\n      {mode ? (\n        <DayOverride\n          mode={mode}\n          sessions={todaySessions}\n          onSubmit={async (next, places) => {\n            try {\n              await day.overrideDay(next, places);\n              await everything();\n            } catch (error) {\n              fail("Could not change")(error);\n              throw error;\n            }\n          }}\n        />\n      ) : null}',
        ),
        ("import type { TFinishWorkPayload, TOpsNotification, TDayMode, TWorkPlace }", "import type { TFinishWorkPayload, TOpsNotification, TDayMode, TWorkdayTimer, TWorkPlace }"),
    ],
)
print("ok")
