import os

web = r"E:\Code archives\palne\plane\apps\web\components\team-ops\workday"


def edit(name, pairs):
    p = os.path.join(web, name)
    s = open(p, newline="").read()
    nl = "\r\n" if "\r\n" in s else "\n"
    for a, b in pairs:
        a = a.replace("\n", nl)
        b = b.replace("\n", nl)
        assert a in s, (name, a[:80])
        s = s.replace(a, b, 1)
    open(p, "w", newline="").write(s)


edit(
    "week-plan.tsx",
    [
        ("  onChanged: () => Promise<unknown>;\n};", "  onChanged: () => Promise<unknown>;\n  /** Confirms and locks the plan. */\n  onConfirm: () => Promise<unknown>;\n};"),
        (
            "function DayTile({\n  day,\n  isToday,\n  busy,\n  onChoose,\n}: {\n  day: TWeekDay;\n  isToday: boolean;\n  busy: boolean;\n  onChoose: (mode: \"ONSITE\" | \"REMOTE\" | \"OFF\") => void;\n}) {",
            "function DayTile({\n  day,\n  isToday,\n  busy,\n  locked,\n  onChoose,\n}: {\n  day: TWeekDay;\n  isToday: boolean;\n  busy: boolean;\n  locked: boolean;\n  onChoose: (mode: \"ONSITE\" | \"REMOTE\" | \"OFF\") => void;\n}) {",
        ),
        ("  const editable = !day.past && day.mode !== \"LEAVE\";", "  const editable = !locked && !day.past && day.mode !== \"LEAVE\";"),
        (
            "export function WeekPlan({ workspaceSlug, userId, week, onChanged }: Props) {",
            "export function WeekPlan({ workspaceSlug, userId, week, onChanged, onConfirm }: Props) {",
        ),
        (
            "  const choose = async",
            """  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } catch (error) {
      setToast({ type: "error", title: "Could not confirm", message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const choose = async""",
        ),
        (
            '''        week.complete ? "border-subtle bg-surface-1" : "border-warning-strong bg-surface-1"''',
            '''        week.confirmed ? "border-subtle bg-surface-1" : "border-warning-strong bg-surface-1"''',
        ),
        (
            '''          {week.complete ? "Your week" : "Plan your week to start working"}''',
            '''          {week.confirmed ? "Your week (confirmed)" : "Plan your week to start working"}''',
        ),
        (
            '''          {week.complete
            ? "Saturday to Friday. Change a day any time before it ends."
            : "Say which days you work, and where, for the rest of this week. It is required, and your manager sees it. You can do it on any day of the week."}''',
            '''          {week.confirmed
            ? "Saturday to Friday. It is locked and your manager can see it. To change it, use the red section at the bottom of the page."
            : "Say which days you work, and where, for the rest of this week, then confirm. It is required, your manager sees it, and after you confirm it is locked. You can do it on any day of the week."}''',
        ),
        (
            "            busy={busy}\n            onChoose",
            "            busy={busy}\n            locked={week.confirmed}\n            onChoose",
        ),
        (
            "      </ol>\n    </section>\n  );\n}",
            """      </ol>
      {!week.confirmed ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            size="md"
            stretch="auto"
            label="Confirm my week"
            loading={busy}
            disabled={week.missing.length > 0}
            onClick={confirm}
          />
          {week.missing.length > 0 ? (
            <span className="text-body-xs-regular text-warning-primary">
              {week.missing.length} working day(s) still need a plan.
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}""",
        ),
        ('import { setToast } from "@plane/blocks/toast";', 'import { Button } from "@makeplane/propel/components/button";\nimport { setToast } from "@plane/blocks/toast";'),
    ],
)

# the red "change my week" section
p = os.path.join(web, "day-start.tsx")
s = open(p, newline="").read()
nl = "\r\n" if "\r\n" in s else "\n"
s = s.rstrip() + nl + '''
/** At the bottom, in red: reopen the confirmed week plan. The page is blurred again until it is confirmed anew. */
export function WeekUnlock({ onUnlock }: { onUnlock: () => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  if (!open) {
    return (
      <div className="flex justify-end">
        <button type="button" className="text-body-xs-medium text-danger-primary hover:underline" onClick={() => setOpen(true)}>
          Change my week plan
        </button>
      </div>
    );
  }
  return (
    <section aria-label="Change the week plan" className="flex flex-col gap-3 rounded-lg border border-danger-strong bg-danger-subtle p-4">
      <div>
        <h3 className="text-body-md-medium text-danger-primary">Change my week plan</h3>
        <p className="text-body-xs-regular text-secondary">
          Your manager already sees this plan, and is told that you reopened it. You cannot start work until you
          confirm the week again.
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          variant="danger"
          size="md"
          stretch="auto"
          label="Reopen the plan"
          loading={isSaving}
          onClick={async () => {
            setIsSaving(true);
            try {
              await onUnlock();
            } finally {
              setIsSaving(false);
              setOpen(false);
            }
          }}
        />
        <Button variant="secondary" size="md" stretch="auto" label="Keep it" onClick={() => setOpen(false)} />
      </div>
    </section>
  );
}
'''.replace("\n", nl)
open(p, "w", newline="").write(s)

edit(
    "workday-root.tsx",
    [
        ('import { DayModeChip, DayOverride, DayStart, Gate } from "./day-start";', 'import { DayModeChip, DayOverride, DayStart, Gate, WeekUnlock } from "./day-start";'),
        (
            "            workspaceSlug={workspaceSlug}\n            userId={currentUser.id}\n            week={state.week}\n            onChanged={async () => {\n              await day.refresh();\n              await everything();\n            }}\n          />\n        </Gate>",
            "            workspaceSlug={workspaceSlug}\n            userId={currentUser.id}\n            week={state.week}\n            onChanged={async () => {\n              await day.refresh();\n              await everything();\n            }}\n            onConfirm={async () => {\n              await day.confirmWeek();\n              await everything();\n            }}\n          />\n        </Gate>",
        ),
        ("      {mode ? (\n        <DayOverride", "      {state?.week?.confirmed ? (\n        <WeekUnlock\n          onUnlock={async () => {\n            await day.unlockWeek().catch(fail(\"Could not reopen\"));\n            await everything();\n          }}\n        />\n      ) : null}\n\n      {mode ? (\n        <DayOverride"),
    ],
)
print("ok")
