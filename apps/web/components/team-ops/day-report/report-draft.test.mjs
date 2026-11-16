import assert from "node:assert/strict";
import test from "node:test";
import { readDraft, writeDraft } from "./report-draft.ts";

class MemoryStorage {
  values = new Map();

  get length() {
    return this.values.size;
  }

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, value);
  }

  removeItem(key) {
    this.values.delete(key);
  }

  key(index) {
    return [...this.values.keys()][index] ?? null;
  }
}

const key = (day) => `ultra-plane-day-report:workspace:${day}`;
const row = (id) => ({ key: id, task: { id: "task-1" }, start: "11:30", end: "12:30" });

test("a draft written for one day cannot appear on another", () => {
  const storage = new MemoryStorage();
  writeDraft(storage, key("2026-11-10"), "2026-11-10", [row("row-1")]);
  assert.equal(readDraft(storage, key("2026-11-10"), "2026-11-11", []), null);
  assert.equal(storage.getItem(key("2026-11-10")), null);
});

test("a legacy saved row copied into an empty day is discarded", () => {
  const storage = new MemoryStorage();
  storage.setItem(key("2026-11-11"), JSON.stringify({ rows: [row("saved-row-id")], at: 2 }));
  assert.equal(readDraft(storage, key("2026-11-11"), "2026-11-11", []), null);
});

test("a legacy unsaved row copied into later days stays only on its first day", () => {
  const storage = new MemoryStorage();
  storage.setItem(key("2026-11-10"), JSON.stringify({ rows: [row("row-1")], at: 1 }));
  storage.setItem(key("2026-11-11"), JSON.stringify({ rows: [row("row-1")], at: 2 }));
  assert.equal(readDraft(storage, key("2026-11-11"), "2026-11-11", []), null);
  assert.equal(readDraft(storage, key("2026-11-10"), "2026-11-10", []).length, 1);
});

test("an edited row belonging to the current server report is restored", () => {
  const storage = new MemoryStorage();
  storage.setItem(key("2026-11-10"), JSON.stringify({ rows: [row("saved-row-id")], at: 1 }));
  assert.equal(
    readDraft(storage, key("2026-11-10"), "2026-11-10", [{ ...row("saved-row-id"), note: "Before" }]).length,
    1
  );
});

test("a stale local copy identical to the server report is discarded", () => {
  const storage = new MemoryStorage();
  storage.setItem(key("2026-11-10"), JSON.stringify({ rows: [row("saved-row-id")], at: 1 }));
  assert.equal(readDraft(storage, key("2026-11-10"), "2026-11-10", [row("saved-row-id")]), null);
});
