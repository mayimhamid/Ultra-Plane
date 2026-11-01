/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
import { setToast } from "@plane/blocks/toast";
import { WorkdayService } from "@plane/services";
import type { TIssueRelationTypes, TModuleRelation, TModuleRelationItem } from "@plane/types";
import { cn } from "@plane/utils";
// services
import useLocalStorage from "@/hooks/use-local-storage";
import { IssueRelationService, IssueService } from "@/services/issue";

const workdayService = new WorkdayService();
const relationService = new IssueRelationService();
const issueService = new IssueService();

const ROW = 48;
const LANE = 26;
const PAD = 22;
const LANE_COLORS = ["#3e9bf0", "#e5484d", "#30a46c", "#f5a524", "#8e4ec6", "#12a594", "#e93d82", "#978365"];

/** A line of the graph: a relation, or `sub` for a sub work item under its parent. */
type TLink = Omit<TModuleRelation, "type"> & { type: TModuleRelation["type"] | "sub" };

const KIND_LABEL: Record<TLink["type"], string> = {
  sub: "has sub work item",
  blocking: "blocks",
  duplicate: "duplicate of",
  relates_to: "relates to",
};
const KIND_DASH: Record<TLink["type"], string | undefined> = {
  sub: undefined,
  blocking: undefined,
  duplicate: "7 4",
  relates_to: "2 4",
};

/** What the person can choose when they drop one work item on another (A is the one dragged from). */
const CHOICES: { value: TIssueRelationTypes; label: (a: string, b: string) => string }[] = [
  { value: "blocking", label: (a, b) => `${a} blocks ${b}` },
  { value: "blocked_by", label: (a, b) => `${a} is blocked by ${b}` },
  { value: "relates_to", label: (a, b) => `${a} relates to ${b}` },
  { value: "duplicate", label: (a, b) => `${a} is a duplicate of ${b}` },
];

/** `primary`: the work item this one branches off (its lane starts there); `null` for the first of a lane. */
/** `end`: the row of the last work item anywhere under this one; its line runs down to there. */
type Row = { item: TModuleRelationItem; lane: number; primary: string | null; end: number };

/**
 * Like a commit graph. A parent is followed by its branches, each branch with the things under it before the next
 * branch. The first child of a top work item carries on in its lane; every other branch leaves its parent at once into a
 * lane of its own (the first one that is free from the parent down to the branch) and runs down to its work item.
 */
const arrange = (items: TModuleRelationItem[], relations: TLink[]): Row[] => {
  const blockers: Record<string, string[]> = {};
  for (const relation of relations) {
    if (relation.type === "blocking" || relation.type === "sub") (blockers[relation.to] ??= []).push(relation.from);
  }
  const ordered: TModuleRelationItem[] = [];
  const position: Record<string, number> = {};
  const pending = [...items];
  while (pending.length > 0) {
    // among those whose blockers are all above them: the one under the most recently placed parent, else the first
    let best = -1;
    let bestScore = -2;
    pending.forEach((item, index) => {
      const above = blockers[item.id] ?? [];
      if (!above.every((id) => id in position || id === item.id)) return;
      const score = above.length === 0 ? -1 : Math.max(...above.map((id) => position[id] ?? -1));
      if (score > bestScore) {
        best = index;
        bestScore = score;
      }
    });
    // a cycle: take the first one left
    const [next] = pending.splice(Math.max(0, best), 1);
    position[next.id] = ordered.length;
    ordered.push(next);
  }
  const rowOf = position;
  const parents: Record<string, string[]> = {};
  const kids: Record<string, string[]> = {};
  for (const relation of relations) {
    const [from, to] =
      rowOf[relation.from] <= rowOf[relation.to] ? [relation.from, relation.to] : [relation.to, relation.from];
    (parents[to] ??= []).push(from);
    (kids[from] ??= []).push(to);
  }
  // how far down each work item's line runs: to the last work item anywhere under it
  const end: Record<string, number> = {};
  const reach = (id: string): number => {
    if (id in end) return end[id];
    end[id] = rowOf[id];
    end[id] = Math.max(rowOf[id], ...(kids[id] ?? []).map(reach));
    return end[id];
  };
  const laneOf: Record<string, number> = {};
  const claimed = new Set<string>();
  // the rows each lane is taken, as [from, to]
  const spans: [number, number][][] = [];
  return ordered.map((item, row) => {
    const to = reach(item.id);
    // only the first child of a top work item carries on its lane; every sub work item below that is a branch of its own
    const parent = (parents[item.id] ?? []).find((id) => !claimed.has(id) && (parents[id] ?? []).length === 0);
    let lane = -1;
    let primary: string | null = null;
    if (parent !== undefined) {
      // the first branch of a parent carries on in its lane
      lane = laneOf[parent];
      claimed.add(parent);
    } else if ((parents[item.id] ?? []).length > 0) {
      // another branch: leaves the first of its parents and needs a lane that is free from there
      primary = parents[item.id][0];
      const from = rowOf[primary];
      lane = spans.findIndex((taken) => taken.every(([a, b]) => b < from || a > to));
      if (lane < 0) lane = spans.length;
    } else {
      lane = spans.findIndex((taken) => taken.every(([a, b]) => b < row || a > to));
      if (lane < 0) lane = spans.length;
    }
    (spans[lane] ??= []).push([primary ? rowOf[primary] : row, to]);
    laneOf[item.id] = lane;
    return { item, lane, primary, end: to };
  });
};

const DONE_GROUPS = new Set(["completed", "cancelled"]);

type Props = { workspaceSlug: string; projectId: string; moduleId: string };

/**
 * The work items of a module as a graph drawn like a commit history. Drag from the dot of one work item to another
 * row, pick the kind of relation and it is created (the same relation as "Add relation" inside a work item).
 * Click a line to remove it.
 */
export const ModuleRelationGraph = observer(function ModuleRelationGraph({
  workspaceSlug,
  projectId,
  moduleId,
}: Props) {
  const key = `MODULE_RELATIONS_${workspaceSlug}_${projectId}_${moduleId}`;
  const { data, mutate } = useSWR(key, () => workdayService.getModuleRelations(workspaceSlug, projectId, moduleId), {
    revalidateOnFocus: false,
  });
  const canvas = useRef<HTMLDivElement>(null);
  // the module sidebar floats over the page when it is open; leave room so nothing hides behind it
  const { storedValue: sidebarCollapsed } = useLocalStorage("module_sidebar_collapsed", "false");
  // `sub`: the whole row is dragged, to become a sub work item of the row it is dropped on.
  // `relate`: dragged from the dot, to be related to the row it is dropped on.
  const [drag, setDrag] = useState<{ mode: "sub" | "relate"; id: string } | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [pending, setPending] = useState<{ from: string; to: string } | null>(null);

  const items = useMemo(() => data?.issues ?? [], [data]);
  const relations = useMemo<TLink[]>(() => {
    const subs: TLink[] = items
      .filter((item) => item.parent)
      .map((item) => ({ id: `sub-${item.id}`, from: item.parent as string, to: item.id, type: "sub" }));
    return [...subs, ...(data?.relations ?? [])];
  }, [data, items]);
  const rows = useMemo(() => arrange(items, relations), [items, relations]);
  const depthOf = (id: string) => {
    let depth = 0;
    for (let next = items.find((item) => item.id === id)?.parent; next && depth < 20; depth++) {
      next = items.find((item) => item.id === next)?.parent;
    }
    return depth;
  };
  const dropRow = drag && pointer ? Math.floor(pointer.y / ROW) : -1;
  const place = useMemo(
    () =>
      Object.fromEntries(
        rows.map((row, index) => [row.item.id, { lane: row.lane, row: index, primary: row.primary, end: row.end }])
      ),
    [rows]
  );
  const byId = useMemo(() => Object.fromEntries(items.map((item) => [item.id, item])), [items]);
  const lanes = Math.max(1, ...rows.map((row) => row.lane + 1));
  const gutter = PAD * 2 + (lanes - 1) * LANE;
  const colorOf = (lane: number) => LANE_COLORS[lane % LANE_COLORS.length];
  const xOf = (lane: number) => PAD + lane * LANE;
  const yOf = (row: number) => row * ROW + ROW / 2;

  const toCanvas = (event: { clientX: number; clientY: number }) => {
    const box = canvas.current?.getBoundingClientRect();
    return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) };
  };

  const makeSub = async (childId: string, parentId: string) => {
    let up: string | null | undefined = parentId;
    for (let hops = 0; up && hops < 20; hops++) {
      if (up === childId) {
        setToast({
          type: "error",
          title: "Not possible",
          message: "A work item cannot go under its own sub work item.",
        });
        return;
      }
      up = items.find((item) => item.id === up)?.parent;
    }
    try {
      await issueService.patchIssue(workspaceSlug, projectId, childId, { parent_id: parentId });
      await mutate();
    } catch (error) {
      const message = (error as { error?: string })?.error ?? "Could not make it a sub work item.";
      setToast({ type: "error", title: "Not moved", message });
    }
  };

  const startDrag = (event: React.PointerEvent, mode: "sub" | "relate", id: string) => {
    event.preventDefault();
    canvas.current?.setPointerCapture(event.pointerId);
    setDrag({ mode, id });
    setPointer(toCanvas(event));
  };

  const endDrag = () => {
    setDrag(null);
    setPointer(null);
  };

  const finishDrag = (event: React.PointerEvent) => {
    if (!drag) return;
    const target = rows[Math.floor(toCanvas(event).y / ROW)]?.item;
    if (target && target.id !== drag.id) {
      if (drag.mode === "relate") setPending({ from: drag.id, to: target.id });
      else if (byId[drag.id]?.parent !== target.id) void makeSub(drag.id, target.id);
    }
    endDrag();
  };

  /** Takes a work item out of everything it is tied to: relations, its parent and its sub work items. */
  const clearLinks = async (id: string) => {
    const links = relations.filter((relation) => relation.from === id || relation.to === id);
    try {
      await Promise.all(
        links.map((link) =>
          link.type === "sub"
            ? issueService.patchIssue(workspaceSlug, projectId, link.to, { parent_id: null })
            : relationService.deleteIssueRelation(workspaceSlug, projectId, link.from, {
                relation_type: link.type,
                related_issue: link.to,
              })
        )
      );
      setToast({ type: "success", title: "Done", message: `${byId[id]?.key} has no relations now.` });
    } catch {
      setToast({ type: "error", title: "Not all removed", message: "Some relations could not be removed." });
    }
    await mutate();
  };

  const create = async (type: TIssueRelationTypes) => {
    if (!pending) return;
    const { from, to } = pending;
    setPending(null);
    try {
      await relationService.createIssueRelations(workspaceSlug, projectId, from, { relation_type: type, issues: [to] });
      await mutate();
    } catch (error) {
      const message = (error as { error?: string })?.error ?? "Could not add the relation.";
      setToast({ type: "error", title: "Relation not added", message });
    }
  };

  const remove = async (relation: TLink) => {
    try {
      if (relation.type === "sub") {
        await issueService.patchIssue(workspaceSlug, projectId, relation.to, { parent_id: null });
        await mutate();
        return;
      }
      await relationService.deleteIssueRelation(workspaceSlug, projectId, relation.from, {
        relation_type: relation.type,
        related_issue: relation.to,
      });
      await mutate();
    } catch {
      setToast({ type: "error", title: "Could not remove", message: "The relation was not removed." });
    }
  };

  if (!data) return <p className="p-6 text-body-sm-regular text-tertiary">Loading the work items...</p>;
  if (items.length === 0)
    return <p className="p-6 text-body-sm-regular text-tertiary">Add work items to this module to relate them.</p>;

  /**
   * A branch leaves its parent at once, into its own lane, and runs down to the work item. Any other line goes down
   * the lane of the upper work item and curves into the lane of the lower one.
   */
  const path = (relation: TLink) => {
    const a = place[relation.from];
    const b = place[relation.to];
    const [topId, top, bottom] = a.row <= b.row ? [relation.from, a, b] : [relation.to, b, a];
    const x1 = xOf(top.lane);
    const y1 = yOf(top.row);
    const x2 = xOf(bottom.lane);
    const y2 = yOf(bottom.row);
    if (x1 === x2) return { d: `M${x1},${y1} L${x2},${y2}`, color: colorOf(top.lane) };
    const color = colorOf(bottom.lane);
    if (bottom.primary === topId) {
      const turn = Math.min(y1 + ROW * 0.8, y2);
      return { d: `M${x1},${y1} C${x1},${(y1 + turn) / 2} ${x2},${(y1 + turn) / 2} ${x2},${turn} L${x2},${y2}`, color };
    }
    const begin = Math.max(y1, y2 - ROW);
    const middle = (begin + y2) / 2;
    return { d: `M${x1},${y1} L${x1},${begin} C${x1},${middle} ${x2},${middle} ${x2},${y2}`, color };
  };

  const notes = (id: string) =>
    relations
      .filter((relation) => relation.from === id || relation.to === id)
      .map((relation) =>
        relation.from === id
          ? `${KIND_LABEL[relation.type]} ${byId[relation.to]?.key ?? ""}`
          : relation.type === "sub"
            ? `sub work item of ${byId[relation.from]?.key ?? ""}`
            : relation.type === "blocking"
              ? `blocked by ${byId[relation.from]?.key ?? ""}`
              : `${KIND_LABEL[relation.type]} ${byId[relation.from]?.key ?? ""}`
      );

  return (
    <div className={cn("relative h-full w-full overflow-auto p-4", sidebarCollapsed !== "true" && "pr-[26rem]")}>
      <p className="mb-3 text-body-xs-regular text-tertiary">
        Drag a work item (anywhere on its box) onto another one to make it a sub work item of that one. Drag from its
        dot to relate them instead. Click a line, or the red minus, to remove relations. Solid: blocks or sub work item
        · dashed: duplicate · dotted: relates to.
      </p>
      <div
        ref={canvas}
        className="relative w-full touch-none select-none"
        style={{ height: rows.length * ROW }}
        onPointerMove={(event) => drag && setPointer(toCanvas(event))}
        onPointerUp={finishDrag}
        onPointerCancel={endDrag}
      >
        {rows.map(({ item }, index) => (
          <div
            key={item.id}
            className={cn(
              "absolute inset-x-0 flex cursor-grab items-center gap-3 rounded-md border pr-3",
              drag?.mode === "sub" && drag.id === item.id && "opacity-50",
              dropRow === index && drag?.id !== item.id
                ? "border-accent-strong bg-accent-subtle"
                : pending && (pending.from === item.id || pending.to === item.id)
                  ? "border-subtle bg-layer-1"
                  : "border-subtle bg-surface-1 hover:bg-layer-1/60"
            )}
            style={{ top: index * ROW + 3, height: ROW - 6, paddingLeft: gutter }}
            onPointerDown={(event) => startDrag(event, "sub", item.id)}
          >
            <span className="w-20 shrink-0 text-caption-sm-regular text-tertiary">{item.key}</span>
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-left text-body-sm-medium text-primary",
                item.state_group && DONE_GROUPS.has(item.state_group) && "line-through opacity-70"
              )}
              title={item.name}
              style={{ marginLeft: depthOf(item.id) * 16 }}
            >
              {item.name}
            </span>
            <span className="hidden max-w-[40%] truncate text-caption-sm-regular text-tertiary md:block">
              {notes(item.id).join(" · ")}
            </span>
            {notes(item.id).length > 0 ? (
              <button
                type="button"
                aria-label={`Remove every relation of ${item.key}`}
                title="Remove every relation of this work item"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => void clearLinks(item.id)}
                className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#e5484d] text-[14px] leading-none font-bold text-white hover:bg-[#cd2b31]"
              >
                −
              </button>
            ) : (
              <span className="size-5 shrink-0" />
            )}
          </div>
        ))}
        <svg className="pointer-events-none absolute inset-0" width="100%" height={rows.length * ROW}>
          {/* each work item's line runs down through everything under it, so a line holds all of its branch */}
          {rows.map(({ item, lane, end }, index) =>
            end > index ? (
              <line
                key={`span-${item.id}`}
                x1={xOf(lane)}
                y1={yOf(index)}
                x2={xOf(lane)}
                y2={yOf(end)}
                stroke={colorOf(lane)}
                strokeWidth={2.5}
              />
            ) : null
          )}
          {relations.map((relation) => {
            if (!place[relation.from] || !place[relation.to]) return null;
            const { d, color } = path(relation);
            return (
              <g key={relation.id} className="pointer-events-auto cursor-pointer" onClick={() => void remove(relation)}>
                <path d={d} stroke="transparent" strokeWidth={12} fill="none" />
                <path d={d} stroke={color} strokeWidth={2.5} strokeDasharray={KIND_DASH[relation.type]} fill="none" />
              </g>
            );
          })}
          {drag?.mode === "relate" && pointer ? (
            <line
              x1={xOf(place[drag.id].lane)}
              y1={yOf(place[drag.id].row)}
              x2={pointer.x}
              y2={pointer.y}
              stroke="#999"
              strokeWidth={2}
              strokeDasharray="4 4"
            />
          ) : null}
          {rows.map(({ item, lane }, index) => (
            <circle
              key={item.id}
              className="pointer-events-auto cursor-crosshair"
              role="button"
              aria-label={`Relate ${item.key} to another work item`}
              cx={xOf(lane)}
              cy={yOf(index)}
              r={7}
              fill={colorOf(lane)}
              stroke="var(--background-color-surface-1, #111)"
              strokeWidth={3}
              onPointerDown={(event) => startDrag(event, "relate", item.id)}
            />
          ))}
        </svg>
        {pending ? (
          <div
            role="dialog"
            aria-label="Kind of relation"
            className="absolute z-10 flex w-64 flex-col gap-1 rounded-md border border-subtle bg-surface-1 p-2 shadow-raised-200"
            style={{ left: gutter, top: (place[pending.to].row + 1) * ROW }}
          >
            {CHOICES.map((choice) => (
              <button
                key={choice.value}
                type="button"
                className="rounded px-2 py-1.5 text-left text-body-xs-regular text-primary hover:bg-layer-1"
                onClick={() => void create(choice.value)}
              >
                {choice.label(byId[pending.from].key, byId[pending.to].key)}
              </button>
            ))}
            <button
              type="button"
              className="rounded px-2 py-1.5 text-left text-body-xs-regular text-tertiary hover:bg-layer-1"
              onClick={() => setPending(null)}
            >
              Cancel
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
});
