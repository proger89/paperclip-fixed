const PAPERCLIP_CACHE_PREFIX = "paperclip-";

async function clearPaperclipCaches() {
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((key) => key.toLowerCase().startsWith(PAPERCLIP_CACHE_PREFIX))
      .map((key) => caches.delete(key)),
  );
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await clearPaperclipCaches();
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      await Promise.all(
        clients.map(async (client) => {
          if ("navigate" in client) {
            try {
              await client.navigate(client.url);
            } catch {
              // Best-effort refresh only.
            }
          }
        }),
      );
    })(),
  );
});
