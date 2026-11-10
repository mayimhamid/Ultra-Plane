/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Outlet, useParams } from "react-router";
import { AppHeader } from "@/components/core/app-header";
import { ContentWrapper } from "@/components/core/content-wrapper";
import { DashboardTabs } from "@/components/team-ops/dashboard";
import { GlobalIssuesHeader } from "./header";

export default function GlobalIssuesLayout() {
  const { workspaceSlug } = useParams();
  return (
    <>
      <AppHeader header={<GlobalIssuesHeader />} />
      {workspaceSlug ? <DashboardTabs workspaceSlug={workspaceSlug} active="views" /> : null}
      <ContentWrapper>
        <Outlet />
      </ContentWrapper>
    </>
  );
}
