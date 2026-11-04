/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@makeplane/propel/components/button";

const WORKER = "/team-ops-sw.js";
const CHECK_EVERY_MS = 5 * 60 * 1000;
// Every build gets a new React Router manifest file; its name is the release.
const RELEASE = /\/assets\/manifest-[A-Za-z0-9_-]+\.js/;

/** The release this tab runs: React Router's manifest file, renamed by every build. `null` in development. */
export const currentRelease = (): string | null => {
  const manifest = (window as unknown as { __reactRouterManifest?: { url?: string } }).__reactRouterManifest;
  return manifest?.url && RELEASE.test(manifest.url) ? manifest.url : null;
};

/** The release the server has now, from a fresh copy of the page. */
export const latestRelease = async (): Promise<string | null> => {
  const response = await fetch(`/?release-check=${Date.now()}`, { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) return null;
  return (await response.text()).match(RELEASE)?.[0] ?? null;
};

type TManifestRoute = { id: string; parentId?: string; module?: string; imports?: string[]; css?: string[] };

/**
 * The code of the screens people use every day (Team Ops, the workspace home, projects and work items) and of
 * every layout above them. Fetched once per release in the background, so these screens open like an app.
 */
export const everydayFiles = (): string[] => {
  const manifest = (window as unknown as { __reactRouterManifest?: { routes?: Record<string, TManifestRoute> } })
    .__reactRouterManifest;
  const routes = manifest?.routes ?? {};
  const wanted = Object.values(routes).filter((route) =>
    /team-ops|\(home\)\/page|\(projects\)\/page|\/issues|browse/i.test(route.id)
  );
  const files = new Set<string>();
  const add = (route: TManifestRoute | undefined) => {
    for (let current = route; current; current = current.parentId ? routes[current.parentId] : undefined) {
      [current.module, ...(current.imports ?? []), ...(current.css ?? [])].forEach((file) => file && files.add(file));
    }
  };
  wanted.forEach(add);
  return [...files];
};

const WARMED_KEY = "ultra-plane-warmed-release";

/** Empties the app's caches (in the worker and here), so the reload gets every file of the new release. */
const clearCaches = async () => {
  const controller = navigator.serviceWorker?.controller;
  if (controller) {
    await new Promise<void>((resolve) => {
      const channel = new MessageChannel();
      const timeout = window.setTimeout(resolve, 2000);
      channel.port1.addEventListener("message", () => {
        window.clearTimeout(timeout);
        resolve();
      });
      channel.port1.start();
      controller.postMessage({ type: "CLEAR_CACHE" }, [channel.port2]);
    });
  }
  if ("caches" in window) {
    const names = await caches.keys();
    await Promise.all(names.map((name) => caches.delete(name)));
  }
};

/**
 * Installs the app's service worker (caching, offline start, push) and watches for a new release.
 * When the server has a newer one than this tab runs, a message offers to apply it.
 */
export function AppUpdater() {
  const [newRelease, setNewRelease] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const running = useRef<string | null>(null);

  // The worker: caching and push. Only on a secure origin, and not in development (Vite serves live files).
  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator) || !window.isSecureContext) return;
    navigator.serviceWorker.register(WORKER).catch(() => undefined);
    // Once the page has settled, fetch the everyday screens ahead of time (once per release).
    const release = currentRelease();
    const warm = async () => {
      const registration = await navigator.serviceWorker.ready;
      let warmed: string | null = null;
      try {
        warmed = window.localStorage.getItem(WARMED_KEY);
      } catch {
        // storage blocked: warm every time, the worker skips files it already has
      }
      if (!release || warmed === release) return;
      registration.active?.postMessage({ type: "WARM", urls: everydayFiles() });
      try {
        window.localStorage.setItem(WARMED_KEY, release);
      } catch {
        // ignore
      }
    };
    const timeout = window.setTimeout(() => void warm(), 4000);
    return () => window.clearTimeout(timeout);
  }, []);

  const check = useCallback(async () => {
    if (!running.current) return;
    try {
      const latest = await latestRelease();
      if (latest && latest !== running.current) setNewRelease(latest);
    } catch {
      // offline or the server is restarting: try again later
    }
  }, []);

  useEffect(() => {
    running.current = currentRelease();
    if (!running.current) return;
    const interval = window.setInterval(check, CHECK_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", check);
    void check();
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", check);
    };
  }, [check]);

  const update = async () => {
    setIsUpdating(true);
    try {
      await clearCaches();
    } finally {
      window.location.reload();
    }
  };

  if (!newRelease || newRelease === dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 z-[100] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 flex-wrap items-center justify-between gap-3 rounded-lg border border-accent-strong bg-surface-1 px-4 py-3 shadow-raised-200"
    >
      <div className="min-w-0">
        <p className="text-body-sm-medium text-primary">A new version is ready</p>
        <p className="text-body-xs-regular text-secondary">Update to get the latest changes. It takes a second.</p>
      </div>
      <div className="flex gap-2">
        <Button
          variant="ghost"
          size="md"
          stretch="auto"
          label="Later"
          disabled={isUpdating}
          onClick={() => setDismissed(newRelease)}
        />
        <Button variant="primary" size="md" stretch="auto" label="Update now" loading={isUpdating} onClick={update} />
      </div>
    </div>
  );
}
