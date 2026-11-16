import type { TRow } from "./report-rows";

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

type StoredDraft = {
  version?: number;
  day?: string;
  rows: TRow[];
  at?: number;
};

const comparable = (row: TRow) => ({
  task: row.task ? `${row.task.kind}:${row.task.id}` : null,
  start: row.start,
  end: row.end,
  spread: row.spread,
  duration: row.duration,
  place: row.place,
  finished: row.finished,
  note: row.note,
});

const parseDraft = (raw: string | null): StoredDraft | null => {
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw) as StoredDraft;
    return Array.isArray(draft.rows) && draft.rows.every((row) => typeof row?.key === "string") ? draft : null;
  } catch {
    return null;
  }
};

/** A draft belongs to exactly one day. Legacy drafts are checked for rows copied into other days. */
export const readDraft = (storage: DraftStorage, key: string, day: string, serverRows: TRow[]): TRow[] | null => {
  const draft = parseDraft(storage.getItem(key));
  if (!draft) return null;

  const serverIds = new Set(serverRows.map((row) => row.key));
  const belongsToAnotherReport = draft.rows.some((row) => !row.key.startsWith("row-") && !serverIds.has(row.key));
  if ((draft.version === 2 && draft.day !== day) || belongsToAnotherReport) {
    storage.removeItem(key);
    return null;
  }

  if (
    draft.rows.length === serverRows.length &&
    draft.rows.every((row, index) => JSON.stringify(comparable(row)) === JSON.stringify(comparable(serverRows[index])))
  ) {
    storage.removeItem(key);
    return null;
  }

  if (draft.version !== 2) {
    const prefix = key.slice(0, key.lastIndexOf(":") + 1);
    const currentTime = draft.at ?? 0;
    const unsavedKeys = new Set(draft.rows.filter((row) => !serverIds.has(row.key)).map((row) => row.key));
    for (let index = 0; index < storage.length; index += 1) {
      const otherKey = storage.key(index);
      if (!otherKey?.startsWith(prefix) || otherKey === key) continue;
      const other = parseDraft(storage.getItem(otherKey));
      if (!other || !other.rows.some((row) => unsavedKeys.has(row.key))) continue;
      if ((other.at ?? 0) < currentTime || ((other.at ?? 0) === currentTime && otherKey < key)) {
        storage.removeItem(key);
        return null;
      }
    }
  }

  return draft.rows;
};

export const writeDraft = (storage: DraftStorage, key: string, day: string, rows: TRow[] | null) => {
  if (rows) storage.setItem(key, JSON.stringify({ version: 2, day, rows, at: Date.now() }));
  else storage.removeItem(key);
};
