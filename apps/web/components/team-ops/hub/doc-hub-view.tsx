/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { cn } from "@plane/utils";
// local imports
import { DocsView } from "./docs-view";
import { FilesView } from "./files-view";

type TTab = "docs" | "files";

const TABS: { value: TTab; label: string }[] = [
  { value: "docs", label: "Documents" },
  { value: "files", label: "Files" },
];

type Props = {
  workspaceSlug: string;
  initialTab?: TTab;
};

/** Doc Hub: the workspace's documents and its shared files in one place. */
export function DocHubView({ workspaceSlug, initialTab = "docs" }: Props) {
  const [tab, setTab] = useState<TTab>(initialTab);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-4 border-b border-subtle px-4 pt-3">
        <h2 className="pb-2 text-body-md-medium text-primary">Doc Hub</h2>
        <div role="tablist" aria-label="Doc Hub" className="flex gap-1">
          {TABS.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={tab === item.value}
              onClick={() => setTab(item.value)}
              className={cn(
                "-mb-px border-b-2 px-3 pb-2 text-body-sm-medium",
                tab === item.value
                  ? "border-accent-strong text-primary"
                  : "border-transparent text-tertiary hover:text-secondary"
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div role="tabpanel" className="min-h-0 flex-1">
        {tab === "docs" ? <DocsView workspaceSlug={workspaceSlug} /> : <FilesView workspaceSlug={workspaceSlug} />}
      </div>
    </div>
  );
}
