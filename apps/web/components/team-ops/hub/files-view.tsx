/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { MAX_FILE_MB } from "@plane/services";
import { setToast } from "@plane/blocks/toast";
import { useUser } from "@/hooks/store/user";
import { hubService, hubExtraService, useHubFiles } from "@/hooks/team-ops/use-hub";
// local imports
import { getErrorMessage } from "../calendar/error-message";

type Props = { workspaceSlug: string };

const dateFormat = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric" });
const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * Files that do not belong to a document: files shared with the workspace before documents could hold files, and
 * the files of the channels the person is in. New files are added to a document, not here.
 */
export const FilesView = observer(function FilesView({ workspaceSlug }: Props) {
  const { data: currentUser } = useUser();
  const { files, refresh } = useHubFiles(workspaceSlug);

  const open = async (id: string) => {
    try {
      const { url } = await hubService.getFileLink(workspaceSlug, id);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setToast({ type: "error", title: "Could not open the file", message: getErrorMessage(error) });
    }
  };

  const remove = async (id: string) => {
    try {
      await hubExtraService.deleteFile(workspaceSlug, id);
      await refresh();
    } catch (error) {
      setToast({ type: "error", title: "Could not remove", message: getErrorMessage(error) });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-subtle px-4 py-3">
        <h2 className="text-body-md-medium text-primary">Other files</h2>
        <p className="text-caption-sm-regular text-tertiary">
          Files that are not part of a document: older shared files and the files of your channels. To share a new file,
          add it to a document. Up to {MAX_FILE_MB} MB each; links open for 5 minutes.
        </p>
      </header>
      <ul className="min-h-0 flex-1 divide-y divide-subtle overflow-y-auto">
        {(files ?? []).length === 0 ? (
          <li className="px-4 py-6 text-center text-body-sm-regular text-tertiary">No other files.</li>
        ) : null}
        {(files ?? []).map((file) => (
          <li key={file.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
            <div className="min-w-0">
              <button
                type="button"
                className="truncate text-body-sm-medium text-accent-primary hover:underline"
                onClick={() => void open(file.id)}
              >
                {file.name}
              </button>
              <p className="text-caption-sm-regular text-tertiary">
                {formatSize(file.size)} · {file.uploaded_by.display_name} ·{" "}
                {dateFormat.format(new Date(file.created_at))} · {file.source}
              </p>
            </div>
            {file.source === "Library" && file.uploaded_by.id === currentUser?.id ? (
              <button
                type="button"
                className="text-body-xs-regular text-tertiary hover:text-danger-primary"
                onClick={() => void remove(file.id)}
              >
                Remove
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
});
