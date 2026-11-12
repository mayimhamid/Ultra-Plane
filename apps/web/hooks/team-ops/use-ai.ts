/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import useSWR from "swr";
import { TeamAIService } from "@plane/services";
import type { TWorkEvidenceParams } from "@plane/types";

export const teamAIService = new TeamAIService();

/** Whether AI can be used here. `usable` is false when the server has no AI, it is down, or an admin turned it off. */
export const useAIStatus = (workspaceSlug: string) => {
  const { data, error, isLoading, mutate } = useSWR(
    workspaceSlug ? `TEAM_OPS_AI_STATUS_${workspaceSlug}` : null,
    () => teamAIService.getStatus(workspaceSlug),
    { revalidateOnFocus: false, dedupingInterval: 30_000 }
  );
  const usable = Boolean(data?.configured && data.reachable && data.enabled);
  return { status: data, usable, error, isLoading, mutate };
};

/** Work evidence per person; only fetched for people who may see the team. */
export const useWorkEvidence = (workspaceSlug: string, enabled: boolean, params: TWorkEvidenceParams) => {
  const key = enabled ? `TEAM_OPS_AI_EVIDENCE_${workspaceSlug}_${JSON.stringify(params)}` : null;
  const { data, error, isLoading } = useSWR(key, () => teamAIService.getEvidence(workspaceSlug, params), {
    revalidateOnFocus: false,
  });
  return { evidence: data, error, isLoading };
};

/** The caller's conversations with the assistant. */
export const useAIConversations = (workspaceSlug: string, enabled: boolean) => {
  const { data, mutate } = useSWR(
    enabled ? `TEAM_OPS_AI_CONVERSATIONS_${workspaceSlug}` : null,
    () => teamAIService.listConversations(workspaceSlug),
    { revalidateOnFocus: false }
  );
  return { conversations: data ?? [], refresh: mutate };
};
