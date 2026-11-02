/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/** A browser or phone a person turned notifications on for. */
export type TPushDevice = {
  id: string;
  device: string;
  created_at: string;
  last_success_at: string | null;
};

/** Whether push is set up on the server, the key the browser subscribes with, and the person's devices. */
export type TPushConfig = {
  enabled: boolean;
  public_key: string;
  devices: TPushDevice[];
};

/** What the browser returns for a push subscription. */
export type TPushSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  device?: string;
};

export type TPushDevices = { devices: TPushDevice[] };
export type TPushTestResult = TPushDevices & { sent: number };
