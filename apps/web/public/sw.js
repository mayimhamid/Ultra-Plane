/*
 * Kill switch for the old Workbox service worker (/sw.js) that earlier Plane builds installed. A browser
 * that still has it checks this file for updates, gets this version, and then: drops every cache the old
 * worker made, removes itself, and reloads open tabs so they run the current release. Ultra Plane's own
 * worker is /team-ops-sw.js.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== "ultra-plane-v1").map((name) => caches.delete(name)));
      await self.registration.unregister();
      const windows = await self.clients.matchAll({ type: "window" });
      windows.forEach((client) => client.navigate(client.url));
    })()
  );
});
