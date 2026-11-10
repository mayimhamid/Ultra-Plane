/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// components
import { Outlet, useParams } from "react-router";
import { AppHeader } from "@/components/core/app-header";
import { ContentWrapper } from "@/components/core/content-wrapper";
import { DashboardTabs } from "@/components/team-ops/dashboard";
import { WorkspaceAnalyticsHeader } from "./header";

export default function WorkspaceAnalyticsTabLayout() {
  const { workspaceSlug } = useParams();
  return (
    <>
      <AppHeader header={<WorkspaceAnalyticsHeader />} />
      {workspaceSlug ? <DashboardTabs workspaceSlug={workspaceSlug} active="analytics" /> : null}
      <ContentWrapper>
        <Outlet />
      </ContentWrapper>
    </>
  );
}
