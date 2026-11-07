/*
 * Ultra Plane service worker: caches the app so it opens fast (and opens at all without a network), shows
 * push notifications, also when the app is closed, and opens the right page when one is tapped.
 *
 * Caching never holds a release back:
 * - /assets/* files have a content hash in their name, so a cached copy is always the right one (cache first).
 * - Pages are asked from the network first. When it does not answer within a few seconds (a slow phone link)
 *   or not at all, the cached page opens the app at once and the fresh copy is kept for next time.
 * - The page can ask the worker to fetch the app's screens ahead of time (WARM), so they open instantly.
 * - API calls, sign-in and uploads are never cached.
 * The page itself checks for a new release and, when there is one, offers to update (see app-updater.tsx);
 * it then sends CLEAR_CACHE and reloads.
 */

const CACHE = "ultra-plane-v1";
const SHELL = "/__app-shell__";
// Old hashed files of earlier releases pile up; keep the newest ones only.
const MAX_ASSETS = 1200;
// How long a page may take before the cached copy is shown instead.
const PAGE_TIMEOUT_MS = 3000;
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

// Fetches the files the page names (its screens' code) into the cache, a few at a time, skipping cached ones.
const warm = async (urls) => {
  const cache = await caches.open(CACHE);
  const queue = urls.filter((url) => typeof url === "string" && url.startsWith("/assets/"));
  const worker = async () => {
    while (queue.length) {
      const url = queue.shift();
      if (await cache.match(url)) continue;
      try {
        const response = await fetch(url, { credentials: "same-origin" });
        if (response.ok && response.type === "basic") await cache.put(url, response);
      } catch (error) {
        return; // offline: stop, the next visit tries again
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  await trim(cache);
};

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "WARM" && Array.isArray(event.data.urls)) {
    event.waitUntil(warm(event.data.urls.slice(0, 600)));
    return;
  }
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

const networkFirstPage = async (event) => {
  const cache = await caches.open(CACHE);
  const fresh = fetch(event.request).then(async (response) => {
    // The app is a single page: any page works as the shell to open offline.
    if (response.ok && response.type === "basic") await cache.put(SHELL, response.clone());
    return response;
  });
  // Keep the fresh copy coming in even when the cached one is shown.
  event.waitUntil(fresh.catch(() => undefined));
  const shell = await cache.match(SHELL);
  if (!shell) return fresh;
  const slow = new Promise((resolve) => setTimeout(() => resolve(null), PAGE_TIMEOUT_MS));
  try {
    const first = await Promise.race([fresh, slow]);
    return first || shell;
  } catch (error) {
    return shell;
  }
};

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER.some((prefix) => url.pathname.startsWith(prefix))) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(event));
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
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      const client = windows.find((item) => item.url.startsWith(self.location.origin) && "focus" in item);
      if (!client) return self.clients.openWindow(target);
      const page = (await client.focus().catch(() => null)) || client;
      // The open app goes to the page itself (no reload, no start-up screen) and answers when it has done so.
      // A tab from before this release does not answer: it is navigated, which reloads it.
      const handled = await new Promise((resolve) => {
        const channel = new MessageChannel();
        const timer = setTimeout(() => resolve(false), 1200);
        channel.port1.onmessage = () => {
          clearTimeout(timer);
          resolve(true);
        };
        try {
          page.postMessage({ type: "OPEN_URL", url: target }, [channel.port2]);
        } catch (error) {
          clearTimeout(timer);
          resolve(false);
        }
      });
      if (!handled && "navigate" in page) return page.navigate(target);
    })
  );
});
