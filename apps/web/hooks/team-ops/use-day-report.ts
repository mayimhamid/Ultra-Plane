/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import useSWR, { mutate as globalMutate } from "swr";
import { DayReportService } from "@plane/services";
import type { TDayReportRowInput, TMicroTaskInput } from "@plane/types";

export const dayReportService = new DayReportService();

/** Every Team Ops screen that shows time or tasks reads fresh data after a change. */
export const refreshTeamOps = () => globalMutate((key) => typeof key === "string" && key.startsWith("TEAM_OPS_"));

/** One day's report: the caller's, or `user`'s for managers. */
export const useDayReport = (workspaceSlug: string, day: string, user?: string) => {
  const key = `TEAM_OPS_DAY_REPORT_${workspaceSlug}_${day}_${user ?? "me"}`;
  const { data, error, isLoading, mutate } = useSWR(key, () => dayReportService.getReport(workspaceSlug, day, user), {
    revalidateOnFocus: false,
  });
  return {
    report: data,
    error,
    isLoading,
    save: async (body: { entries: TDayReportRowInput[]; submit?: boolean; reason?: string }) => {
      const next = await dayReportService.saveReport(workspaceSlug, day, body);
      await mutate(next, { revalidate: false });
      await refreshTeamOps();
      return next;
    },
  };
};

export const useDayReportHistory = (workspaceSlug: string, day: string, user: string | undefined, enabled: boolean) =>
  useSWR(enabled ? `TEAM_OPS_DAY_REPORT_HISTORY_${workspaceSlug}_${day}_${user ?? "me"}` : null, () =>
    dayReportService.getHistory(workspaceSlug, day, user)
  );

export const useTeamDayReports = (workspaceSlug: string, day: string, enabled: boolean) =>
  useSWR(enabled ? `TEAM_OPS_DAY_REPORT_TEAM_${workspaceSlug}_${day}` : null, () =>
    dayReportService.getTeam(workspaceSlug, day)
  );

/** Micro tasks of the caller, or of `user` for managers. */
export const useMicroTasks = (workspaceSlug: string, user?: string) => {
  const key = `TEAM_OPS_MICRO_TASKS_${workspaceSlug}_${user ?? "me"}`;
  const { data, error, isLoading, mutate } = useSWR(key, () => dayReportService.listMicroTasks(workspaceSlug, user));
  const after = async () => {
    await mutate();
    await refreshTeamOps();
  };
  return {
    tasks: data,
    error,
    isLoading,
    create: async (body: TMicroTaskInput) => {
      const task = await dayReportService.createMicroTask(workspaceSlug, { ...body, user });
      await after();
      return task;
    },
    update: async (id: string, body: Partial<TMicroTaskInput> & { done?: boolean }) => {
      await dayReportService.updateMicroTask(workspaceSlug, id, body);
      await after();
    },
    remove: async (id: string) => {
      await dayReportService.deleteMicroTask(workspaceSlug, id);
      await after();
    },
  };
};
