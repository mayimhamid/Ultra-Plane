/*
 * Ultra Plane service worker: caches the app so it opens fast (and opens at all without a network), shows
 * push notifications, also when the app is closed, and opens the right page when one is tapped.
 *
 * Caching never holds a release back:
 * - /assets/* files have a content hash in their name, so a cached copy is always the right one (cache first).
 * - Pages are always asked from the network first; the cached page is only used offline.
 * - API calls, sign-in and uploads are never cached.
 * The page itself checks for a new release and, when there is one, offers to update (see app-updater.tsx);
 * it then sends CLEAR_CACHE and reloads.
 */

const CACHE = "ultra-plane-v1";
const SHELL = "/__app-shell__";
// Old hashed files of earlier releases pile up; keep the newest ones only.
const MAX_ASSETS = 400;
const NEVER = ["/api/", "/auth/", "/god-mode", "/spaces", "/live", "/uploads", "/team-ops-sw.js", "/sw.js"];

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "CLEAR_CACHE") {
    event.waitUntil(
      caches
        .keys()
        .then((names) => Promise.all(names.map((name) => caches.delete(name))))
        .then(() => event.ports[0] && event.ports[0].postMessage("cleared"))
    );
  }
});

const trim = async (cache) => {
  const keys = await cache.keys();
  const assets = keys.filter((request) => new URL(request.url).pathname.startsWith("/assets/"));
  await Promise.all(assets.slice(0, Math.max(0, assets.length - MAX_ASSETS)).map((request) => cache.delete(request)));
};

const cacheFirst = async (request) => {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    await cache.put(request, response.clone());
    trim(cache);
  }
  return response;
};

const staleWhileRevalidate = async (request) => {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  const fresh = fetch(request)
    .then((response) => {
      if (response.ok && response.type === "basic") cache.put(request, response.clone());
      return response;
    })
    .catch(() => hit);
  return hit || fresh;
};

const networkFirstPage = async (request) => {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    // The app is a single page: any page works as the shell to open offline.
    if (response.ok && response.type === "basic") await cache.put(SHELL, response.clone());
    return response;
  } catch (error) {
    const shell = await cache.match(SHELL);
    if (shell) return shell;
    throw error;
  }
};

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER.some((prefix) => url.pathname.startsWith(prefix))) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request));
  } else if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request));
  } else if (/\.(png|svg|ico|webp|woff2?|json)$/.test(url.pathname) && !url.search) {
    event.respondWith(staleWhileRevalidate(request));
  }
  // Everything else (including the release check of the page) goes straight to the network.
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    data = { body: event.data ? event.data.text() : "" };
  }
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192x192.png",
    badge: "/icons/icon-192x192.png",
    data: { url: data.url || "/" },
  };
  // A newer notification of the same kind replaces the one still on screen, and buzzes again.
  if (data.tag) {
    options.tag = data.tag;
    options.renotify = true;
  }
  event.waitUntil(self.registration.showNotification(data.title || "Notification", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          return client
            .focus()
            .then((focused) => (focused && "navigate" in focused ? focused.navigate(target) : focused));
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
