/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { durationText, formatMinutes, parseDuration, planLabel } from "./day-report.service";

describe("parseDuration", () => {
  it.each([
    ["1:30", 90],
    ["0:45", 45],
    ["1.5", 90],
    ["1,5", 90],
    ["2h", 120],
    ["1.5h", 90],
    ["90m", 90],
    ["2h 15m", 135],
    ["8", 480],
    ["45", 45],
  ])("reads %s as %i minutes", (text, minutes) => {
    expect(parseDuration(text)).toBe(minutes);
  });

  it("returns null for what cannot be read", () => {
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("abc")).toBeNull();
    expect(parseDuration("-2")).toBeNull();
  });
});

describe("formatMinutes and durationText", () => {
  it("formats minutes", () => {
    expect(formatMinutes(0)).toBe("0m");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(125)).toBe("2h 05m");
    expect(durationText(125)).toBe("2:05");
    expect(durationText(0)).toBe("");
  });

  it("labels a plan", () => {
    expect(planLabel(null, "HOURS")).toBe("No plan");
    expect(planLabel(3, "HOURS")).toBe("3 h");
    expect(planLabel(1, "DAYS")).toBe("1 day");
    expect(planLabel(2, "DAYS")).toBe("2 days");
  });
});
