/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@plane/utils";

const CODE_LANGUAGE = /language-/;

// Styled after a GitHub README: headings with a rule under the first two levels, boxed code, tables, quotes, tasks.
const components: Components = {
  h1: ({ children }) => (
    <h1 className="mt-6 mb-4 border-b border-subtle pb-2 text-h4-semibold text-primary first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-6 mb-3 border-b border-subtle pb-1.5 text-h5-semibold text-primary first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => <h3 className="text-body-lg-semibold mt-5 mb-2 text-primary first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-4 mb-2 text-body-md-semibold text-primary first:mt-0">{children}</h4>,
  h5: ({ children }) => <h5 className="mt-3 mb-1 text-body-sm-semibold text-primary first:mt-0">{children}</h5>,
  h6: ({ children }) => <h6 className="mt-3 mb-1 text-body-sm-semibold text-secondary first:mt-0">{children}</h6>,
  p: ({ children }) => <p className="my-3 text-body-md-regular leading-relaxed text-primary first:mt-0">{children}</p>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent-primary hover:underline">
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="my-3 list-disc pl-6 text-primary">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal pl-6 text-primary">{children}</ol>,
  li: ({ className, children }) => (
    <li className={cn("my-1 text-body-md-regular", className?.includes("task-list-item") && "-ml-5 list-none")}>
      {children}
    </li>
  ),
  input: (props) => <input {...props} disabled className="mr-2 align-middle" />,
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-4 border-strong pl-4 text-secondary [&>p]:my-1">{children}</blockquote>
  ),
  hr: () => <hr className="my-6 border-subtle" />,
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-lg border border-subtle bg-layer-1 p-3 text-body-sm-regular leading-relaxed">
      {children}
    </pre>
  ),
  code: ({ className, children }) => {
    const isBlock = CODE_LANGUAGE.test(className ?? "") || String(children).includes("\n");
    return isBlock ? (
      <code className={cn("font-mono text-primary", className)}>{children}</code>
    ) : (
      <code className="font-mono rounded bg-layer-1 px-1.5 py-0.5 text-[0.9em] text-primary">{children}</code>
    );
  },
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-body-sm-regular">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-subtle bg-layer-1 px-3 py-1.5 text-left text-body-sm-semibold text-primary">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="border border-subtle px-3 py-1.5 text-primary">{children}</td>,
  img: ({ src, alt }) => <img src={src} alt={alt ?? ""} className="my-3 max-w-full rounded-md" />,
};

/** Text written in Markdown, shown as it would be on a GitHub README page. Raw HTML is never rendered. */
export function MarkdownView({ source, className }: { source: string; className?: string }) {
  return (
    <div className={cn("min-w-0 break-words", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
