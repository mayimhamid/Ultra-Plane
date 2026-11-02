/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useState } from "react";
import useSWR from "swr";
import { PushService } from "@plane/services";

const pushService = new PushService();
const WORKER = "/team-ops-sw.js";
// subscriptions already told to the server in this page load, so opening several pages does not repeat it
const told = new Set<string>();

/** The server key is base64url; the browser wants raw bytes. */
export const keyToBytes = (key: string): Uint8Array => {
  const padded = key + "=".repeat((4 - (key.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
};

/** A short name for this device, for the person's own list of devices. */
export const deviceLabel = (agent: string): string => {
  const browser = /edg\//i.test(agent)
    ? "Edge"
    : /firefox/i.test(agent)
      ? "Firefox"
      : /chrome|crios/i.test(agent)
        ? "Chrome"
        : /safari/i.test(agent)
          ? "Safari"
          : "Browser";
  const system = /android/i.test(agent)
    ? "Android"
    : /iphone|ipad|ipod/i.test(agent)
      ? "iOS"
      : /windows/i.test(agent)
        ? "Windows"
        : /mac os/i.test(agent)
          ? "macOS"
          : /linux/i.test(agent)
            ? "Linux"
            : "";
  return system ? `${browser} on ${system}` : browser;
};

const isSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

const messageOf = (error: unknown, fallback: string) =>
  (error as { error?: string; detail?: string })?.error ??
  (error as { detail?: string })?.detail ??
  (error instanceof Error ? error.message : fallback);

/**
 * Notifications on this browser or phone. `enable` asks the person's permission, subscribes the browser and tells
 * the server; `disable` undoes it. On an iPhone this only works once the app is added to the Home Screen.
 */
export const usePushNotifications = (workspaceSlug: string) => {
  const { data: config, mutate } = useSWR(
    `TEAM_OPS_PUSH_${workspaceSlug}`,
    () => pushService.getConfig(workspaceSlug),
    {
      shouldRetryOnError: false,
    }
  );
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [needsInstall, setNeedsInstall] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // What this browser can do and whether it already has a subscription
  useEffect(() => {
    const canPush = isSupported();
    setSupported(canPush);
    setNeedsInstall(!canPush && isIos() && !isStandalone());
    if (!canPush) return;
    setPermission(Notification.permission);
    void navigator.serviceWorker
      .getRegistration(WORKER)
      .then((registration) => registration?.pushManager.getSubscription())
      .then((subscription) => setEndpoint(subscription?.endpoint ?? null))
      .catch(() => setEndpoint(null));
  }, []);

  // The person may have signed in as someone else on this browser: tell the server who it belongs to now
  useEffect(() => {
    if (!config?.enabled || !endpoint || told.has(`${workspaceSlug}:${endpoint}`)) return;
    told.add(`${workspaceSlug}:${endpoint}`);
    void navigator.serviceWorker
      .getRegistration(WORKER)
      .then((registration) => registration?.pushManager.getSubscription())
      .then((subscription) => {
        const json = subscription?.toJSON();
        if (!json?.endpoint || !json.keys?.p256dh || !json.keys.auth) return;
        return pushService
          .subscribe(workspaceSlug, {
            endpoint: json.endpoint,
            keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
            device: deviceLabel(navigator.userAgent),
          })
          .then(() => mutate());
      })
      .catch(() => undefined);
  }, [config?.enabled, endpoint, workspaceSlug, mutate]);

  const enable = useCallback(async () => {
    if (!config?.enabled || !isSupported()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") return;
      const registration = await navigator.serviceWorker.register(WORKER);
      await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyToBytes(config.public_key) as BufferSource,
        }));
      const json = subscription.toJSON();
      await pushService.subscribe(workspaceSlug, {
        endpoint: subscription.endpoint,
        keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
        device: deviceLabel(navigator.userAgent),
      });
      setEndpoint(subscription.endpoint);
      await mutate();
    } catch (failure) {
      setError(messageOf(failure, "Could not turn notifications on."));
    } finally {
      setBusy(false);
    }
  }, [config, workspaceSlug, mutate]);

  const disable = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration(WORKER);
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await pushService.unsubscribe(workspaceSlug, subscription.endpoint);
        await subscription.unsubscribe();
      }
      setEndpoint(null);
      await mutate();
    } catch (failure) {
      setError(messageOf(failure, "Could not turn notifications off."));
    } finally {
      setBusy(false);
    }
  }, [workspaceSlug, mutate]);

  const test = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await pushService.sendTest(workspaceSlug);
    } catch (failure) {
      setError(messageOf(failure, "Could not send the test."));
    } finally {
      setBusy(false);
    }
  }, [workspaceSlug]);

  return {
    config,
    supported,
    needsInstall,
    permission,
    isOn: endpoint !== null && permission === "granted",
    busy,
    error,
    enable,
    disable,
    test,
  };
};
