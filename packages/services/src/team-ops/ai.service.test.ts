/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { TAIChatEvent } from "@plane/types";
import { TeamAIService, parseSSE } from "./ai.service";

describe("parseSSE", () => {
  it("reads whole events and keeps the unfinished rest", () => {
    const text =
      'event: meta\ndata: {"conversation_id":"c1","sources":[],"effort":"low"}\n\n' +
      'event: token\ndata: {"text":"Hel"}\n\n' +
      "event: token\ndata: {";
    const { events, rest } = parseSSE(text);
    expect(events.map((e) => e.event)).toEqual(["meta", "token"]);
    expect(rest).toBe("event: token\ndata: {");
  });

  it("skips broken events", () => {
    expect(parseSSE("event: token\ndata: {nope\n\n").events).toEqual([]);
  });
});

describe("TeamAIService", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("calls the team-ops AI endpoints and rethrows the error body", async () => {
    const service = new TeamAIService("http://api.test");
    const get = vi.spyOn(service, "get").mockResolvedValue({ data: { configured: true } } as never);
    const patch = vi.spyOn(service, "patch").mockResolvedValue({ data: { effort: "low" } } as never);
    const post = vi
      .spyOn(service, "post")
      .mockResolvedValue({ data: { id: "j1", status: "done", result: { tasks: [] } } } as never);

    await expect(service.getStatus("acme")).resolves.toEqual({ configured: true });
    expect(get).toHaveBeenCalledWith("/api/workspaces/acme/team-ops/ai/");
    await service.saveSettings("acme", { enabled: true, effort: "low" });
    expect(patch).toHaveBeenCalledWith("/api/workspaces/acme/team-ops/ai/settings/", { enabled: true, effort: "low" });
    await expect(service.proposeTasks("acme", "build a fence")).resolves.toEqual({ tasks: [] });
    expect(post).toHaveBeenCalledWith("/api/workspaces/acme/team-ops/ai/tasks/", { prompt: "build a fence" });
    const params = { from: "2027-01-04", to: "2027-01-10" };
    await service.getEvidence("acme", params);
    expect(get).toHaveBeenLastCalledWith("/api/workspaces/acme/team-ops/ai/team/", { params });

    post.mockRejectedValueOnce({ response: { data: { error: "off", code: "disabled" } } });
    await expect(service.summarize("acme", { kind: "text", text: "x" })).rejects.toEqual({
      error: "off",
      code: "disabled",
    });
  });

  it("polls a job until it is done, and turns a failure into a message", async () => {
    const service = new TeamAIService("http://api.test");
    const get = vi
      .spyOn(service, "get")
      .mockResolvedValueOnce({ data: { id: "j1", status: "running", progress: "1 / 2 people", result: null } } as never)
      .mockResolvedValueOnce({ data: { id: "j1", status: "done", progress: "", result: { day: "d" } } } as never);
    const seen: string[] = [];
    const start = { id: "j1", status: "queued", result: null } as never;

    await expect(service.waitForJob("acme", start, (job) => seen.push(job.status), { intervalMs: 1 })).resolves.toEqual(
      { day: "d" }
    );
    expect(seen).toEqual(["queued", "running", "done"]);
    expect(get).toHaveBeenCalledWith("/api/workspaces/acme/team-ops/ai/jobs/j1/");

    const failed = { id: "j2", status: "failed", error: "llm_unavailable", result: null } as never;
    await expect(service.waitForJob("acme", failed)).rejects.toEqual({
      error: "The AI model is not answering right now. Try again in a few minutes.",
    });
  });

  it("streams a chat answer event by event", async () => {
    const encoder = new TextEncoder();
    const parts = [
      'event: meta\ndata: {"conversation_id":"c1","sources":[],"effort":"low"}\n\nevent: tok',
      'en\ndata: {"text":"Hi"}\n\n',
      'event: done\ndata: {"conversation_id":"c1"}',
    ];
    const body = new ReadableStream({
      start(controller) {
        parts.forEach((part) => controller.enqueue(encoder.encode(part)));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, body });
    vi.stubGlobal("fetch", fetchMock);
    const seen: TAIChatEvent[] = [];

    await new TeamAIService("http://api.test").chat("acme", { message: "hello" }, (e) => seen.push(e));

    expect(seen.map((e) => e.event)).toEqual(["meta", "token", "done"]);
    expect(fetchMock.mock.calls[0][0]).toBe("http://api.test/api/workspaces/acme/team-ops/ai/chat/");
    expect(fetchMock.mock.calls[0][1].credentials).toBe("include");
  });

  it("rejects when the chat cannot start", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, body: null, json: () => Promise.resolve({ error: "AI is off" }) })
    );
    await expect(new TeamAIService("http://api.test").chat("acme", { message: "x" }, () => {})).rejects.toEqual({
      error: "AI is off",
    });
  });
});
