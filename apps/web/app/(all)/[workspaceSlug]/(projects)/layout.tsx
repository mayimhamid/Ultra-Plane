/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { Outlet, useParams } from "react-router";
import { DonePrompt } from "@/components/team-ops/day-report/done-prompt";
import { PushPrompt } from "@/components/team-ops/notifications/push-prompt";
import { PageTransition } from "@/components/team-ops/pwa/page-transition";
import { ProjectsAppPowerKProvider } from "@/components/power-k/projects-app-provider";
// plane web components
import { ProjectAppSidebar } from "./_sidebar";
import { ExtendedProjectSidebar } from "./extended-project-sidebar";

function WorkspaceLayout() {
  const { workspaceSlug } = useParams();
  return (
    <>
      <ProjectsAppPowerKProvider />
      <div className="relative flex h-full w-full flex-col overflow-hidden rounded-lg border border-subtle">
        <div id="full-screen-portal" className="absolute inset-0 w-full" />
        <div className="relative flex size-full overflow-hidden">
          <ProjectAppSidebar />
          <ExtendedProjectSidebar />
          <main className="relative flex h-full w-full flex-col overflow-hidden bg-surface-1">
            {workspaceSlug ? <PushPrompt workspaceSlug={workspaceSlug} mode="alert" /> : null}
            {/* A task moved to Done in a project can go straight into the Day Report. */}
            <DonePrompt />
            <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
              <PageTransition>
                <Outlet />
              </PageTransition>
            </div>
          </main>
        </div>
      </div>
    </>
  );
}

export default observer(WorkspaceLayout);
