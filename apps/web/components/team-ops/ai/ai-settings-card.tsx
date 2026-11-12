/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { setToast } from "@plane/blocks/toast";
import type { TAIEffort } from "@plane/types";
import { cn } from "@plane/utils";
// hooks
import { teamAIService, useAIStatus } from "@/hooks/team-ops/use-ai";
// local imports
import { getErrorMessage } from "../calendar/error-message";

type TChoice = TAIEffort | "off";

const CHOICES: { value: TChoice; label: string; hint: string }[] = [
  { value: "high", label: "High", hint: "Fastest and best answers. Uses all the CPU threads and memory it is given." },
  { value: "medium", label: "Medium", hint: "Balanced: half the threads, a mid-size context, one pass." },
  { value: "low", label: "Low", hint: "Least CPU and memory. Short answers, and each one takes longer." },
  { value: "off", label: "Off", hint: "No AI in this workspace. Everything else works as before." },
];

type Props = { workspaceSlug: string };

/** Admins: turn AI on or off and choose how much of the server one answer may use. */
export const AISettingsCard = observer(function AISettingsCard({ workspaceSlug }: Props) {
  const { status, mutate } = useAIStatus(workspaceSlug);
  const [busy, setBusy] = useState(false);
  const [indexing, setIndexing] = useState(false);

  if (!status?.can_manage) return null;
  if (!status.configured) {
    return (
      <section className="rounded-lg border border-dashed border-subtle p-4 text-body-sm-regular text-tertiary">
        AI is not set up on this server. Install Plane AI and set PLANE_AI_URL and PLANE_AI_TOKEN in the API&apos;s
        environment to turn it on. Work evidence below works without it.
      </section>
    );
  }

  const current: TChoice = !status.enabled ? "off" : (status.effort ?? "medium");
  const profile = status.enabled && status.effort ? status.profiles?.[status.effort] : undefined;

  const choose = async (value: TChoice) => {
    if (value === current || busy) return;
    setBusy(true);
    try {
      const next = await teamAIService.saveSettings(workspaceSlug, {
        enabled: value !== "off",
        effort: value === "off" ? (status.effort ?? "medium") : value,
      });
      await mutate(next, { revalidate: false });
      setToast({ type: "success", title: "Saved", message: value === "off" ? "AI is off." : `Effort: ${value}.` });
    } catch (error) {
      setToast({ type: "error", title: "Could not save", message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const index = async () => {
    setIndexing(true);
    try {
      const result = await teamAIService.index(workspaceSlug);
      setToast({
        type: "success",
        title: "Search is up to date",
        message: `${result.documents} work items and documents were indexed.`,
      });
    } catch (error) {
      setToast({ type: "error", title: "Could not index", message: getErrorMessage(error) });
    } finally {
      setIndexing(false);
    }
  };

  return (
    <section aria-label="AI settings" className="flex flex-col gap-3 rounded-lg border border-subtle bg-surface-1 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-body-sm-medium text-primary">AI effort</h2>
        <span className="text-caption-sm-regular text-tertiary">
          {status.reachable
            ? `${status.model ?? "model"} on ${status.runtime ?? "runtime"} · ${status.llm === "ok" ? "ready" : (status.llm ?? "")}`
            : "The AI service is not answering."}
        </span>
      </div>
      <div role="radiogroup" aria-label="AI effort" className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {CHOICES.map((choice) => (
          <button
            key={choice.value}
            type="button"
            role="radio"
            aria-checked={current === choice.value}
            disabled={busy || !status.reachable}
            onClick={() => void choose(choice.value)}
            className={cn(
              "flex min-h-16 flex-col items-start gap-0.5 rounded-lg border p-3 text-left disabled:opacity-60",
              current === choice.value ? "border-accent-strong bg-accent-subtle" : "border-subtle hover:bg-layer-1"
            )}
          >
            <span className="text-body-sm-medium text-primary">{choice.label}</span>
            <span className="text-caption-sm-regular text-tertiary">{choice.hint}</span>
          </button>
        ))}
      </div>
      {profile ? (
        <p className="text-caption-sm-regular text-tertiary">
          Now: {profile.threads} CPU threads, {profile.context_tokens} tokens of context, answers up to{" "}
          {profile.max_answer_tokens} tokens
          {profile.refine_rounds ? ", a reviewer checks every summary" : ""}
          {profile.llm_only_when_unclear ? ", team analysis asks the model only about unclear cases" : ""}.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={indexing || !status.reachable}
          onClick={() => void index()}
          className="min-h-9 rounded-md border border-subtle px-3 text-body-xs-medium text-secondary hover:bg-layer-1 disabled:opacity-60"
        >
          {indexing ? "Indexing..." : "Update AI search"}
        </button>
        <span className="text-caption-sm-regular text-tertiary">
          Sends work items and Hub documents to Plane AI so the assistant can find and cite them. People only ever get
          content from projects they can open.
        </span>
      </div>
    </section>
  );
});
