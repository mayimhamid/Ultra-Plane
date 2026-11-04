/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "react-router";
// components
import { useTranslation } from "@plane/i18n";
import { AppHeader } from "@/components/core/app-header";
import { ContentWrapper } from "@/components/core/content-wrapper";
import { PageHead } from "@/components/core/page-title";
import { PersonalHome } from "@/components/team-ops/home";
// hooks
import { useWorkspace } from "@/hooks/store/use-workspace";
// local components
import { WorkspaceDashboardHeader } from "./header";

// Team Ops: the app opens on Home, which starts with where the person was tagged.
function WorkspaceDashboardPage() {
  const { workspaceSlug } = useParams();
  const { currentWorkspace } = useWorkspace();
  const { t } = useTranslation();
  // derived values
  const pageTitle = currentWorkspace?.name ? `${currentWorkspace?.name} - ${t("home.title")}` : undefined;

  return (
    <>
      <AppHeader header={<WorkspaceDashboardHeader />} />
      <ContentWrapper>
        <PageHead title={pageTitle} />
        <PersonalHome workspaceSlug={workspaceSlug ?? ""} />
      </ContentWrapper>
    </>
  );
}

export default observer(WorkspaceDashboardPage);
