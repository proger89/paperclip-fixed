import { describe, expect, it, vi } from "vitest";
import { cleanupLegacyPaperclipOfflineState, isPaperclipCacheName } from "./pwa";

describe("isPaperclipCacheName", () => {
  it("matches legacy paperclip caches", () => {
    expect(isPaperclipCacheName("paperclip-v2")).toBe(true);
    expect(isPaperclipCacheName("paperclip-offline-shell")).toBe(true);
    expect(isPaperclipCacheName("other-cache")).toBe(false);
  });
});

describe("cleanupLegacyPaperclipOfflineState", () => {
  it("unregisters legacy paperclip service workers and clears matching caches", async () => {
    const unregisterPaperclip = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const unregisterOther = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const deleteCache = vi.fn<(cacheName: string) => Promise<boolean>>().mockResolvedValue(true);

    await cleanupLegacyPaperclipOfflineState({
      location: { origin: "http://localhost:3100" },
      navigator: {
        serviceWorker: {
          getRegistrations: vi.fn().mockResolvedValue([
            {
              scope: "http://localhost:3100/",
              active: { scriptURL: "http://localhost:3100/sw.js" },
              unregister: unregisterPaperclip,
            },
            {
              scope: "http://localhost:3100/",
              active: { scriptURL: "http://localhost:3100/plugin-sw.js" },
              unregister: unregisterOther,
            },
          ]),
        },
      },
      caches: {
        keys: vi.fn().mockResolvedValue(["paperclip-v2", "paperclip-temp", "other-cache"]),
        delete: deleteCache,
      },
    });

    expect(unregisterPaperclip).toHaveBeenCalledTimes(1);
    expect(unregisterOther).not.toHaveBeenCalled();
    expect(deleteCache).toHaveBeenCalledTimes(2);
    expect(deleteCache).toHaveBeenCalledWith("paperclip-v2");
    expect(deleteCache).toHaveBeenCalledWith("paperclip-temp");
  });

  it("stays best-effort when service worker or cache APIs are unavailable", async () => {
    await expect(
      cleanupLegacyPaperclipOfflineState({
        location: { origin: "http://localhost:3100" },
      }),
    ).resolves.toBeUndefined();
  });
});
