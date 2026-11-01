/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import useSWR from "swr";
// plane imports
import { WorkdayService } from "@plane/services";

const workdayService = new WorkdayService();

/**
 * How many Team Ops notifications the person has not read, so Plane's own bell can count them too.
 * Anyone who has no Team Ops (a guest, the feature switched off) simply has none.
 */
export const useOpsUnread = (workspaceSlug: string | undefined) => {
  const { data } = useSWR(
    workspaceSlug ? `TEAM_OPS_NOTIFICATIONS_${workspaceSlug}` : null,
    () => workdayService.listNotifications(workspaceSlug!),
    { refreshInterval: 30_000, shouldRetryOnError: false }
  );
  return data?.unread ?? 0;
};
