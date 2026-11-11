/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import type { TDashboard, TDashboardParams, TInsights, TInsightsParams } from "@plane/types";
// services
import { APIService } from "../api.service";

export class TeamDashboardService extends APIService {
  constructor(BASE_URL?: string) {
    super(BASE_URL || API_BASE_URL);
  }

  /** The management dashboard. Needs the right to see the team. */
  async getDashboard(workspaceSlug: string, params: TDashboardParams): Promise<TDashboard> {
    return this.get(`/api/workspaces/${workspaceSlug}/team-ops/dashboard/`, { params })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** Task risk and workload for the people and projects the caller may see. */
  async getInsights(workspaceSlug: string, params: TInsightsParams): Promise<TInsights> {
    return this.get(`/api/workspaces/${workspaceSlug}/team-ops/insights/`, { params })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
