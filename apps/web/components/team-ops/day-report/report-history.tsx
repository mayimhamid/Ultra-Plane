/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { formatMinutes } from "@plane/services";
import type { TDayReportRevision, TDayReportRevisionRow } from "@plane/types";

const at = (stamp: string) =>
  new Date(stamp).toLocaleString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const line = (row: TDayReportRevisionRow) =>
  `${row.task} · ${formatMinutes(row.minutes)}${row.finished ? " · done" : ""}${row.note ? ` · ${row.note}` : ""}`;

/** What changed in each recorded edit: rows removed in red, rows added in green. */
export function ReportHistory({ revisions }: { revisions: TDayReportRevision[] }) {
  if (revisions.length === 0) return <p className="text-body-xs-regular text-tertiary">Loading the changes...</p>;
  return (
    <ol className="flex flex-col gap-2">
      {revisions.map((revision, index) => {
        const before = revision.before.map(line);
        const after = revision.after.map(line);
        const removed = before.filter((item) => !after.includes(item));
        const added = after.filter((item) => !before.includes(item));
        return (
          <li key={revision.id} className="rounded-md border border-subtle bg-layer-1 p-3">
            <p className="text-body-xs-medium text-primary">
              Edit {revisions.length - index} · {revision.kind === "LATE" ? "sent late" : "changed"} ·{" "}
              {at(revision.changed_at)}
              {revision.changed_by ? ` · ${revision.changed_by.display_name}` : ""}
            </p>
            {revision.reason ? <p className="text-body-xs-regular text-secondary">Reason: {revision.reason}</p> : null}
            <ul className="mt-1 flex flex-col gap-0.5 text-body-xs-regular">
              {removed.map((item) => (
                <li key={`-${item}`} className="text-danger-primary">
                  − {item}
                </li>
              ))}
              {added.map((item) => (
                <li key={`+${item}`} className="text-success-primary">
                  + {item}
                </li>
              ))}
              {removed.length === 0 && added.length === 0 ? (
                <li className="text-tertiary">Sent with: {after.join("; ") || "no rows"}</li>
              ) : null}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}
