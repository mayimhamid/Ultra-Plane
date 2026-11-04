/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
// components
import { PageHead } from "@/components/core/page-title";
import { PushPrompt } from "@/components/team-ops/notifications/push-prompt";
import { NotificationsRoot } from "@/components/workspace-notifications";
// hooks
import { useWorkspace } from "@/hooks/store/use-workspace";
import type { Route } from "./+types/page";

function WorkspaceDashboardPage({ params }: Route.ComponentProps) {
  const { workspaceSlug } = params;
  // plane hooks
  const { t } = useTranslation();
  // hooks
  const { currentWorkspace } = useWorkspace();
  // derived values
  const pageTitle = currentWorkspace?.name
    ? t("notification.page_label", { workspace: currentWorkspace?.name })
    : undefined;

  return (
    <>
      <PageHead title={pageTitle} />
      <div className="flex h-full min-h-0 flex-col">
        <PushPrompt workspaceSlug={workspaceSlug} mode="settings" />
        <div className="min-h-0 flex-1">
          <NotificationsRoot workspaceSlug={workspaceSlug} />
        </div>
      </div>
    </>
  );
}

export default observer(WorkspaceDashboardPage);
