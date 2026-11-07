/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { ChevronRight, FileText, Folder, Paperclip } from "lucide-react";
import type { THubDoc } from "@plane/types";
import { cn } from "@plane/utils";

export type TDocNode = { doc: THubDoc; children: TDocNode[] };

const byTitle = (a: TDocNode, b: TDocNode) =>
  a.doc.title.localeCompare(b.doc.title, undefined, { sensitivity: "base" });

/**
 * The documents as a tree. A document whose parent is not in the list (one the person cannot read, or one a filter
 * left out) is shown at the top, so nothing disappears.
 */
export const buildTree = (docs: THubDoc[]): TDocNode[] => {
  const nodes = new Map(docs.map((doc) => [doc.id, { doc, children: [] as TDocNode[] }]));
  const roots: TDocNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.doc.parent ? nodes.get(node.doc.parent) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  const sortAll = (list: TDocNode[]) => {
    list.sort(byTitle);
    list.forEach((node) => sortAll(node.children));
  };
  sortAll(roots);
  return roots;
};

/** The tree in reading order with its depth: for a list of choices ("Inside"). */
export const flattenTree = (nodes: TDocNode[], depth = 0): { doc: THubDoc; depth: number }[] =>
  nodes.flatMap((node) => [{ doc: node.doc, depth }, ...flattenTree(node.children, depth + 1)]);

/** The ids of a document and everything inside it. */
export const withDescendants = (nodes: TDocNode[], id: string): Set<string> => {
  const found = new Set<string>();
  const walk = (list: TDocNode[], inside: boolean) => {
    for (const node of list) {
      const here = inside || node.doc.id === id;
      if (here) found.add(node.doc.id);
      walk(node.children, here);
    }
  };
  walk(nodes, false);
  return found;
};

type Props = {
  nodes: TDocNode[];
  openId?: string;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onOpen: (doc: THubDoc) => void;
  depth?: number;
};

/** The documents as folders and pages: a document with pages inside opens and closes like a folder. */
export function DocTree({ nodes, openId, expanded, onToggle, onOpen, depth = 0 }: Props) {
  return (
    <ul className="flex flex-col gap-0.5">
      {nodes.map((node) => {
        const isFolder = node.children.length > 0;
        const isOpen = expanded.has(node.doc.id);
        return (
          <li key={node.doc.id}>
            <div
              className={cn(
                "group flex min-h-10 items-center gap-1 rounded-md pr-2 hover:bg-layer-1",
                openId === node.doc.id && "bg-accent-subtle"
              )}
              style={{ paddingLeft: `${depth * 14 + 4}px` }}
            >
              {isFolder ? (
                <button
                  type="button"
                  aria-label={isOpen ? `Close ${node.doc.title}` : `Open ${node.doc.title}`}
                  aria-expanded={isOpen}
                  onClick={() => onToggle(node.doc.id)}
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded text-tertiary hover:bg-layer-2"
                >
                  <ChevronRight className={cn("size-4 transition-transform", isOpen && "rotate-90")} aria-hidden />
                </button>
              ) : (
                <span className="size-7 shrink-0" aria-hidden />
              )}
              <button
                type="button"
                onClick={() => onOpen(node.doc)}
                className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
              >
                {isFolder ? (
                  <Folder className="size-4 shrink-0 text-accent-primary" aria-hidden />
                ) : (
                  <FileText className="size-4 shrink-0 text-tertiary" aria-hidden />
                )}
                <span
                  className={cn(
                    "truncate text-body-sm-regular",
                    openId === node.doc.id ? "font-medium text-accent-primary" : "text-primary"
                  )}
                >
                  {node.doc.title}
                </span>
                {node.doc.file_count > 0 ? (
                  <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-caption-sm-regular text-tertiary">
                    <Paperclip className="size-3" aria-hidden />
                    {node.doc.file_count}
                  </span>
                ) : null}
              </button>
            </div>
            {isFolder && isOpen ? (
              <DocTree
                nodes={node.children}
                openId={openId}
                expanded={expanded}
                onToggle={onToggle}
                onOpen={onOpen}
                depth={depth + 1}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
