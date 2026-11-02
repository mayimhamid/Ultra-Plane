/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import type { TPushConfig, TPushDevices, TPushSubscription, TPushTestResult } from "@plane/types";
// services
import { APIService } from "../api.service";

const fail = (error: { response?: { data?: unknown } }) => {
  throw error?.response?.data;
};

/** Notifications on a phone or browser (Web Push). */
export class PushService extends APIService {
  constructor(BASE_URL?: string) {
    super(BASE_URL || API_BASE_URL);
  }

  private base(workspaceSlug: string) {
    return `/api/workspaces/${workspaceSlug}/team-ops/push`;
  }

  async getConfig(workspaceSlug: string): Promise<TPushConfig> {
    return this.get(`${this.base(workspaceSlug)}/`)
      .then((response) => response?.data)
      .catch(fail);
  }

  async subscribe(workspaceSlug: string, subscription: TPushSubscription): Promise<TPushDevices> {
    return this.post(`${this.base(workspaceSlug)}/subscribe/`, subscription)
      .then((response) => response?.data)
      .catch(fail);
  }

  async unsubscribe(workspaceSlug: string, endpoint: string): Promise<TPushDevices> {
    return this.post(`${this.base(workspaceSlug)}/unsubscribe/`, { endpoint })
      .then((response) => response?.data)
      .catch(fail);
  }

  async sendTest(workspaceSlug: string): Promise<TPushTestResult> {
    return this.post(`${this.base(workspaceSlug)}/test/`, {})
      .then((response) => response?.data)
      .catch(fail);
  }
}
