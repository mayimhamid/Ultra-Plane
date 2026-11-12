/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@plane/utils";

// Every block picks its own direction from its first strong letter (dir="auto"), so a Persian paragraph reads
// right to left and an English one left to right in the same answer, and "**bold:**" stays where it belongs.
// Lists and quotes use logical sides (ps/border-s) so their bullets follow that direction.
const components: Components = {
  h1: ({ children }) => (
    <h3 dir="auto" className="mt-4 mb-1.5 text-body-md-semibold text-primary first:mt-0">
      {children}
    </h3>
  ),
  h2: ({ children }) => (
    <h3 dir="auto" className="mt-4 mb-1.5 text-body-md-semibold text-primary first:mt-0">
      {children}
    </h3>
  ),
  h3: ({ children }) => (
    <h4 dir="auto" className="mt-3 mb-1 text-body-sm-semibold text-primary first:mt-0">
      {children}
    </h4>
  ),
  h4: ({ children }) => (
    <h5 dir="auto" className="mt-3 mb-1 text-body-sm-semibold text-secondary first:mt-0">
      {children}
    </h5>
  ),
  p: ({ children }) => (
    <p dir="auto" className="my-2 leading-relaxed first:mt-0 last:mb-0">
      {children}
    </p>
  ),
  strong: ({ children }) => <strong className="font-semibold text-primary">{children}</strong>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent-primary hover:underline">
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <ul dir="auto" className="my-2 list-disc space-y-1 ps-5 marker:text-tertiary">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol dir="auto" className="my-2 list-decimal space-y-1 ps-5 marker:text-tertiary">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li dir="auto" className="leading-relaxed [&>p]:my-0">
      {children}
    </li>
  ),
  blockquote: ({ children }) => (
    <blockquote dir="auto" className="my-2 border-s-2 border-accent-strong ps-3 text-secondary [&>p]:my-1">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-subtle" />,
  pre: ({ children }) => (
    <pre
      dir="ltr"
      className="my-2 overflow-x-auto rounded-md border border-subtle bg-layer-1 p-2.5 text-body-xs-regular leading-relaxed"
    >
      {children}
    </pre>
  ),
  code: ({ className, children }) =>
    /language-/.test(className ?? "") || String(children).includes("\n") ? (
      <code className={cn("font-mono", className)}>{children}</code>
    ) : (
      <code className="font-mono rounded bg-layer-1 px-1 py-0.5 text-[0.9em]">{children}</code>
    ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto rounded-md border border-subtle">
      <table dir="auto" className="w-full border-collapse text-body-xs-regular">
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-subtle bg-layer-1 px-2.5 py-1.5 text-start font-semibold text-primary">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="border-t border-subtle px-2.5 py-1.5">{children}</td>,
  // A model never needs to show pictures; an image link stays a link.
  img: ({ src, alt }) => (
    <a href={typeof src === "string" ? src : undefined} target="_blank" rel="noopener noreferrer">
      {alt || "image"}
    </a>
  ),
};

/** Text written by Plane AI (Markdown, Persian or English), at the size of a chat message. Raw HTML is never rendered. */
export function AIMarkdown({ source, className }: { source: string; className?: string }) {
  return (
    <div className={cn("min-w-0 text-body-sm-regular break-words text-primary", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
