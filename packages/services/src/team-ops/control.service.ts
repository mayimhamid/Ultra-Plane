/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import type {
  TControlHours,
  TControlParams,
  TControlTeam,
  TFlowOverview,
  THubMessage,
  THubOverview,
  TInterruptionRow,
  TPersonNotification,
  TRankingRow,
  TSumTime,
} from "@plane/types";
// services
import { APIService } from "../api.service";

const sumParams = (params: TControlParams & { parallel_double?: boolean }) => ({
  ...params,
  parallel_double: params.parallel_double ? "1" : undefined,
});

const fail = (error: { response?: { data?: unknown } }) => {
  throw error?.response?.data;
};

/** What managers see: people's tasks and hours, the Hub and the flows. The server checks every right. */
export class ControlService extends APIService {
  constructor(BASE_URL?: string) {
    super(BASE_URL || API_BASE_URL);
  }

  private base(workspaceSlug: string) {
    return `/api/workspaces/${workspaceSlug}/team-ops/control`;
  }

  async getTeam(workspaceSlug: string, params: TControlParams): Promise<TControlTeam> {
    return this.get(`${this.base(workspaceSlug)}/team/`, { params })
      .then((response) => response?.data)
      .catch(fail);
  }

  /** The table as a CSV file. */
  async exportTeam(workspaceSlug: string, params: TControlParams): Promise<Blob> {
    return this.get(
      `${this.base(workspaceSlug)}/team/`,
      { params: { ...params, export: "csv" } },
      { responseType: "blob" }
    )
      .then((response) => response?.data)
      .catch(fail);
  }

  async listInterruptions(
    workspaceSlug: string,
    params: TControlParams & { kind?: "BREAK" | "FREEZE" }
  ): Promise<TInterruptionRow[]> {
    return this.get(`${this.base(workspaceSlug)}/interruptions/`, { params })
      .then((response) => response?.data?.results)
      .catch(fail);
  }

  /** Hours per person and day, by place, with the approval state. */
  async getHours(workspaceSlug: string, params: TControlParams): Promise<TControlHours> {
    return this.get(`${this.base(workspaceSlug)}/hours/`, { params })
      .then((response) => response?.data)
      .catch(fail);
  }

  /** Approves (or, with `approved: false`, takes back) the days with work of a person in a range. */
  async setApproval(
    workspaceSlug: string,
    payload: { user: string; from: string; to: string; approved?: boolean }
  ): Promise<number> {
    return this.post(`${this.base(workspaceSlug)}/approvals/`, payload)
      .then((response) => response?.data?.changed)
      .catch(fail);
  }

  async getRanking(workspaceSlug: string, params: TControlParams): Promise<TRankingRow[]> {
    return this.get(`${this.base(workspaceSlug)}/ranking/`, { params })
      .then((response) => response?.data?.results)
      .catch(fail);
  }

  /** Everyone's time between two dates as one number. */
  async getSum(workspaceSlug: string, params: TControlParams & { parallel_double?: boolean }): Promise<TSumTime> {
    return this.get(`${this.base(workspaceSlug)}/sum/`, { params: sumParams(params) })
      .then((response) => response?.data)
      .catch(fail);
  }

  /** The table as an Excel (or CSV) file. */
  async exportSum(
    workspaceSlug: string,
    params: TControlParams & { parallel_double?: boolean },
    format: "xlsx" | "csv" = "xlsx"
  ): Promise<Blob> {
    return this.get(
      `${this.base(workspaceSlug)}/sum/`,
      { params: { ...sumParams(params), export: format } },
      { responseType: "blob" }
    )
      .then((response) => response?.data)
      .catch(fail);
  }

  /** Counts (or stops counting) a person's frozen time between two dates. */
  async creditFreeze(
    workspaceSlug: string,
    payload: { user: string; from: string; to: string; credited: boolean }
  ): Promise<number> {
    return this.post(`${this.base(workspaceSlug)}/sum/freeze/`, payload)
      .then((response) => response?.data?.changed)
      .catch(fail);
  }

  async getPersonNotifications(workspaceSlug: string, user: string): Promise<TPersonNotification[]> {
    return this.get(`${this.base(workspaceSlug)}/notifications/`, { params: { user } })
      .then((response) => response?.data?.results)
      .catch(fail);
  }

  async getHub(workspaceSlug: string): Promise<THubOverview> {
    return this.get(`${this.base(workspaceSlug)}/hub/`)
      .then((response) => response?.data)
      .catch(fail);
  }

  /** Locks a channel so only admins write in it, or opens it again. */
  async setChannelLocked(workspaceSlug: string, channelId: string, isLocked: boolean): Promise<void> {
    return this.patch(`${this.base(workspaceSlug)}/hub/channels/${channelId}/`, { is_locked: isLocked })
      .then(() => undefined)
      .catch(fail);
  }

  async listChannelMessages(workspaceSlug: string, channelId: string): Promise<THubMessage[]> {
    return this.get(`${this.base(workspaceSlug)}/hub/channels/${channelId}/`)
      .then((response) => response?.data?.results)
      .catch(fail);
  }

  async removeMessage(workspaceSlug: string, messageId: string): Promise<void> {
    return this.delete(`${this.base(workspaceSlug)}/hub/messages/${messageId}/`)
      .then(() => undefined)
      .catch(fail);
  }

  async getFlows(workspaceSlug: string): Promise<TFlowOverview> {
    return this.get(`${this.base(workspaceSlug)}/flows/`)
      .then((response) => response?.data)
      .catch(fail);
  }
}
