/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// local imports
import { DocsView } from "./docs-view";

type Props = {
  workspaceSlug: string;
};

/** Doc Hub: a document is its text together with its files. Older loose files are listed under "Other files". */
export function DocHubView({ workspaceSlug }: Props) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <DocsView workspaceSlug={workspaceSlug} />
    </div>
  );
}
