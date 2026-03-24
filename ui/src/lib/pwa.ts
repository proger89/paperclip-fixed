type ServiceWorkerLike = {
  scriptURL: string;
};

type ServiceWorkerRegistrationLike = {
  scope: string;
  active?: ServiceWorkerLike | null;
  waiting?: ServiceWorkerLike | null;
  installing?: ServiceWorkerLike | null;
  unregister(): Promise<boolean>;
};

type ServiceWorkerContainerLike = {
  getRegistrations(): Promise<readonly ServiceWorkerRegistrationLike[]>;
};

type CacheStorageLike = {
  keys(): Promise<string[]>;
  delete(cacheName: string): Promise<boolean>;
};

type PwaCleanupGlobal = {
  location?: { origin?: string };
  navigator?: { serviceWorker?: ServiceWorkerContainerLike };
  caches?: CacheStorageLike;
};

const PAPERCLIP_CACHE_PREFIX = "paperclip-";
const LEGACY_SERVICE_WORKER_PATH = "/sw.js";

export function isPaperclipCacheName(cacheName: string): boolean {
  return cacheName.trim().toLowerCase().startsWith(PAPERCLIP_CACHE_PREFIX);
}

function matchesLegacyPaperclipServiceWorker(
  registration: ServiceWorkerRegistrationLike,
  origin: string,
): boolean {
  const workers = [registration.active, registration.waiting, registration.installing].filter(
    (worker): worker is ServiceWorkerLike => Boolean(worker?.scriptURL),
  );
  if (workers.length === 0) return false;

  return workers.some((worker) => {
    try {
      const parsed = new URL(worker.scriptURL);
      return parsed.origin === origin && parsed.pathname === LEGACY_SERVICE_WORKER_PATH;
    } catch {
      return false;
    }
  });
}

export async function cleanupLegacyPaperclipOfflineState(
  runtime: PwaCleanupGlobal = globalThis as unknown as PwaCleanupGlobal,
): Promise<void> {
  const origin = runtime.location?.origin?.trim();

  const serviceWorkerContainer = runtime.navigator?.serviceWorker;
  if (origin && serviceWorkerContainer?.getRegistrations) {
    try {
      const registrations = await serviceWorkerContainer.getRegistrations();
      await Promise.all(
        registrations
          .filter((registration) => matchesLegacyPaperclipServiceWorker(registration, origin))
          .map((registration) => registration.unregister().catch(() => false)),
      );
    } catch {
      // Best-effort cleanup only.
    }
  }

  const cacheStorage = runtime.caches;
  if (cacheStorage?.keys && cacheStorage.delete) {
    try {
      const cacheNames = await cacheStorage.keys();
      await Promise.all(
        cacheNames
          .filter((cacheName) => isPaperclipCacheName(cacheName))
          .map((cacheName) => cacheStorage.delete(cacheName).catch(() => false)),
      );
    } catch {
      // Best-effort cleanup only.
    }
  }
}
