/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { PushService } from "./push.service";

const BASE = "/api/workspaces/acme/team-ops/push";

describe("PushService", () => {
  let service: PushService;

  beforeEach(() => {
    service = new PushService("http://api.test");
  });

  it("reads whether push is set up and which devices the person has", async () => {
    const get = vi
      .spyOn(service, "get")
      .mockResolvedValue({ data: { enabled: true, public_key: "BKey", devices: [] } } as never);

    await expect(service.getConfig("acme")).resolves.toEqual({ enabled: true, public_key: "BKey", devices: [] });

    expect(get).toHaveBeenCalledWith(`${BASE}/`);
  });

  it("sends the subscription the browser made", async () => {
    const post = vi.spyOn(service, "post").mockResolvedValue({ data: { devices: [{ id: "d1" }] } } as never);
    const subscription = { endpoint: "https://push.example.com/x", keys: { p256dh: "p", auth: "a" }, device: "Chrome" };

    await expect(service.subscribe("acme", subscription)).resolves.toEqual({ devices: [{ id: "d1" }] });

    expect(post).toHaveBeenCalledWith(`${BASE}/subscribe/`, subscription);
  });

  it("turns a device off by its address", async () => {
    const post = vi.spyOn(service, "post").mockResolvedValue({ data: { devices: [] } } as never);

    await service.unsubscribe("acme", "https://push.example.com/x");

    expect(post).toHaveBeenCalledWith(`${BASE}/unsubscribe/`, { endpoint: "https://push.example.com/x" });
  });

  it("asks for a test message", async () => {
    const post = vi.spyOn(service, "post").mockResolvedValue({ data: { sent: 1, devices: [] } } as never);

    await expect(service.sendTest("acme")).resolves.toEqual({ sent: 1, devices: [] });

    expect(post).toHaveBeenCalledWith(`${BASE}/test/`, {});
  });

  it("throws the error body of a failed request", async () => {
    vi.spyOn(service, "post").mockRejectedValue({ response: { data: { error: "Push is not set up." } } });

    await expect(service.sendTest("acme")).rejects.toEqual({ error: "Push is not set up." });
  });
});
