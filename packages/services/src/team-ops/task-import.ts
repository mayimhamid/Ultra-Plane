/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TImportContext, TImportItem } from "@plane/types";

const LIST_FIELDS = new Set(["assignees", "labels"]);
const NUMBER_FIELDS = new Set(["planned_hours", "planned_days"]);

/** Splits one CSV line, keeping commas inside quotes. */
const csvCells = (line: string, separator: string) => {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === separator) {
      cells.push(cell.trim());
      cell = "";
    } else cell += char;
  }
  cells.push(cell.trim());
  return cells;
};

const normalise = (key: string) =>
  key
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

const fromCsv = (text: string): TImportItem[] => {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("The CSV file needs a header row and at least one task.");
  const separator = lines[0].includes(";") && !lines[0].includes(",") ? ";" : ",";
  const header = csvCells(lines[0], separator).map(normalise);
  if (!header.includes("title") && !header.includes("name")) throw new Error('The CSV header needs a "title" column.');
  return lines.slice(1).map((line) => {
    const cells = csvCells(line, separator);
    const item: Record<string, unknown> = {};
    header.forEach((key, index) => {
      const value = cells[index] ?? "";
      if (value === "") return;
      if (NUMBER_FIELDS.has(key)) item[key] = Number(value.replace(",", "."));
      else if (LIST_FIELDS.has(key)) item[key] = value.split(/[|;]/).map((part) => part.trim());
      else if (key === "is_meeting") item[key] = ["1", "true", "yes", "y"].includes(value.toLowerCase());
      else item[key] = value;
    });
    return item as TImportItem;
  });
};

/**
 * The tasks of an import file: a JSON array, `{ "tasks": [...] }`, JSON wrapped in a ```json block (as chat
 * assistants answer), or CSV with a header row.
 */
export const parseImportText = (text: string): TImportItem[] => {
  const trimmed = text.trim().replace(/^﻿/, "");
  if (!trimmed) throw new Error("The file is empty.");
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const json = fenced ? fenced[1].trim() : trimmed;
  if (json.startsWith("[") || json.startsWith("{")) {
    let data: unknown;
    try {
      data = JSON.parse(json);
    } catch {
      throw new Error("The JSON could not be read. Check that it is complete.");
    }
    const list = Array.isArray(data) ? data : (data as { tasks?: unknown }).tasks;
    if (!Array.isArray(list)) throw new Error('The JSON must be a list of tasks, or { "tasks": [...] }.');
    return list as TImportItem[];
  }
  return fromCsv(trimmed);
};

const quote = (values: string[]) => (values.length ? values.map((value) => `"${value}"`).join(", ") : "(none)");

/**
 * A prompt to paste into ChatGPT or Claude: it explains the exact JSON to return, with the real names of the
 * people, modules, states and labels, so the answer can be imported as it is.
 */
export const buildImportPrompt = (options: {
  target: "micro" | "project";
  context: TImportContext;
  description: string;
  today: string;
  personName?: string;
}) => {
  const { target, context, description, today, personName } = options;
  const fields =
    target === "micro"
      ? [
          '- "title" (text, required): a short name of the task.',
          '- "description" (text, optional).',
          '- "planned_hours" (number) OR "planned_days" (number, a day is 8 hours): how long it should take.',
          '- "due_date" (YYYY-MM-DD, optional).',
          '- "is_meeting" (true/false): true when the task is a meeting.',
        ]
      : [
          '- "title" (text, required): a short name of the task.',
          '- "description" (text, optional).',
          '- "planned_hours" (number) OR "planned_days" (number, a day is 8 hours): how long it should take.',
          '- "start_date" and "due_date" (YYYY-MM-DD, optional).',
          '- "priority": one of "urgent", "high", "medium", "low", "none".',
          `- "assignees": a list of emails, only from: ${quote(context.people.map((p) => `${p.email} (${p.display_name})`))}.`,
          `- "module" (optional): exactly one of ${quote(context.modules)}.`,
          `- "state" (optional): exactly one of ${quote(context.states)}.`,
          `- "labels" (optional list): only from ${quote(context.labels)}.`,
        ];
  const where =
    target === "micro"
      ? `small tasks with no project for ${personName ?? "one person"}`
      : `work items of the project "${context.project?.name ?? ""}"`;
  return [
    `You are helping me plan work. Turn my description below into ${where}.`,
    `Today is ${today}. Split the work into concrete tasks of a few hours to a few days, and estimate each one.`,
    "",
    "Answer with ONLY a JSON array, no text before or after it. Each item is an object with these keys:",
    ...fields,
    "Leave a key out when you do not know it. Use the names exactly as written above; do not invent people,",
    "modules, states or labels.",
    "",
    "Example:",
    target === "micro"
      ? '[{"title": "Call the supplier", "planned_hours": 0.5, "due_date": "2026-11-20"}]'
      : '[{"title": "Wire the sensor board", "planned_days": 2, "priority": "high", "assignees": ["name@company.com"]}]',
    "",
    "My description:",
    description.trim() || "(write what needs to be done here)",
  ].join("\n");
};
