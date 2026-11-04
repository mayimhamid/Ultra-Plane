/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { buildImportPrompt, parseImportText } from "./task-import";

describe("parseImportText", () => {
  it("reads a JSON array, a tasks object and a fenced answer", () => {
    expect(parseImportText('[{"title":"A"}]')).toEqual([{ title: "A" }]);
    expect(parseImportText('{"tasks":[{"title":"B","planned_hours":2}]}')).toEqual([{ title: "B", planned_hours: 2 }]);
    expect(parseImportText('Here you go:\n```json\n[{"title":"C"}]\n```')).toEqual([{ title: "C" }]);
  });

  it("reads CSV with quotes, numbers, lists and flags", () => {
    const csv = 'Title,Planned Hours,Assignees,Is Meeting\n"Fix, then test",1.5,a@x.test|b@x.test,yes\nPlain,,,\n';
    expect(parseImportText(csv)).toEqual([
      { title: "Fix, then test", planned_hours: 1.5, assignees: ["a@x.test", "b@x.test"], is_meeting: true },
      { title: "Plain" },
    ]);
  });

  it("explains what is wrong", () => {
    expect(() => parseImportText("")).toThrow("empty");
    expect(() => parseImportText("[{")).toThrow("could not be read");
    expect(() => parseImportText('{"x":1}')).toThrow("list of tasks");
    expect(() => parseImportText("name\n")).toThrow("header row");
    expect(() => parseImportText("owner,hours\nme,1")).toThrow('"title" column');
  });
});

describe("buildImportPrompt", () => {
  it("lists the real names a project import may use", () => {
    const prompt = buildImportPrompt({
      target: "project",
      context: {
        project: { name: "RTLS", identifier: "RT" },
        people: [{ display_name: "Sara", email: "sara@x.test" }],
        modules: ["Sensors"],
        states: ["Todo"],
        labels: [],
      },
      description: "Build the anchors",
      today: "2026-11-04",
    });
    expect(prompt).toContain('project "RTLS"');
    expect(prompt).toContain("sara@x.test (Sara)");
    expect(prompt).toContain('"Sensors"');
    expect(prompt).toContain("ONLY a JSON array");
    expect(prompt.endsWith("Build the anchors")).toBe(true);
  });

  it("asks micro task imports for meetings", () => {
    const prompt = buildImportPrompt({
      target: "micro",
      context: { people: [], modules: [], states: [], labels: [] },
      description: "",
      today: "2026-11-04",
      personName: "Ali",
    });
    expect(prompt).toContain("for Ali");
    expect(prompt).toContain('"is_meeting"');
  });
});
