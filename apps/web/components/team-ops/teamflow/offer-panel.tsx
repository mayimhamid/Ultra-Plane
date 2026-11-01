/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import useSWR from "swr";
import { Button } from "@makeplane/propel/components/button";
import { setToast } from "@plane/blocks/toast";
// hooks
import { flowService } from "@/hooks/team-ops/use-hub";
// local imports
import { getErrorMessage } from "../calendar/error-message";

type Props = { workspaceSlug: string; flowId: string; onTaken: () => Promise<unknown> };

/** Shown to a person of the flow who has nothing left to do in the project: take a free task, or join someone's. */
export function OfferPanel({ workspaceSlug, flowId, onTaken }: Props) {
  const key = `TEAM_OPS_FLOW_OFFER_${flowId}`;
  const { data, mutate } = useSWR(key, () => flowService.getOffer(workspaceSlug, flowId), {
    shouldRetryOnError: false,
  });
  const [busy, setBusy] = useState<string | null>(null);

  if (!data?.eligible || (data.pull.length === 0 && data.merge.length === 0)) return null;

  const take = async (issue: string) => {
    setBusy(issue);
    try {
      const { kind } = await flowService.pull(workspaceSlug, flowId, issue);
      setToast({ type: "success", title: kind === "merge" ? "You joined the task" : "The task is yours", message: "" });
      await mutate();
      await onTaken();
    } catch (error) {
      setToast({ type: "error", title: "Could not take it", message: getErrorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  const List = ({
    title,
    hint,
    items,
  }: {
    title: string;
    hint: string;
    items: { id: string; name: string; key: string }[];
  }) =>
    items.length === 0 ? null : (
      <div className="flex flex-col gap-1.5">
        <p className="text-body-sm-medium text-primary">
          {title} <span className="font-normal text-tertiary">{hint}</span>
        </p>
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-2 rounded-md border border-subtle bg-surface-1 px-3 py-1.5"
            >
              <span className="min-w-0 truncate text-body-xs-regular text-primary">
                <span className="text-tertiary">{item.key}</span> {item.name}
              </span>
              <Button
                variant="secondary"
                size="sm"
                stretch="auto"
                label={title.split(" ")[0]}
                loading={busy === item.id}
                onClick={() => void take(item.id)}
              />
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <section
      aria-label="Pick up work"
      className="flex flex-col gap-3 rounded-md border border-accent-strong bg-accent-subtle p-3"
    >
      <p className="text-body-sm-medium text-primary">You have nothing left in this project. Pick something up?</p>
      <List title="Pull a task" hint="nobody has it yet" items={data.pull} />
      <List title="Merge into a task" hint="others are still on it; you join them" items={data.merge} />
    </section>
  );
}
