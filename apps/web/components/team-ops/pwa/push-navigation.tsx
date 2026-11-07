/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { useNavigate } from "react-router";
// hooks
import { refreshTeamOps } from "@/hooks/team-ops/use-day-report";

type TOpenUrl = { type?: string; url?: string };

/**
 * A tapped push notification asks the open app (through the service worker) to go to its page. The app does so
 * itself, as when a link is pressed: no reload and no start-up screen, and the Team Ops data is refreshed so the
 * page shows what the notification is about. It answers the worker, which otherwise reloads the tab.
 */
export function PushNavigation() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent<TOpenUrl | null>) => {
      const data = event.data;
      if (data?.type !== "OPEN_URL" || typeof data.url !== "string") return;
      let target: URL;
      try {
        target = new URL(data.url, window.location.origin);
      } catch {
        return;
      }
      // Only pages of this app: the worker is ours, but the address still comes from outside.
      if (target.origin !== window.location.origin) return;
      void navigate(`${target.pathname}${target.search}${target.hash}`);
      void refreshTeamOps();
      event.ports[0]?.postMessage("opened");
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    navigator.serviceWorker.startMessages?.();
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [navigate]);

  return null;
}
