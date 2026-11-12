/**
 * PixelOps Agent Command Center — Progressive Web App Service Worker
 * Provides offline execution, asset caching, and background synchronization.
 */

const CACHE_NAME = 'pixelops-pwa-v3';

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './pwa-192x192.png',
  './pwa-512x512.png',
  './apple-touch-icon.png',
  'https://www.gstatic.com/antigravity/web/dev/tailwindcss.min.js',
  // Precache all agent sprites directly so new frames load instantly on first paint
  './assets/agents/archivist_crimson_stand.png',
  './assets/agents/archivist_crimson_walk_1.png',
  './assets/agents/archivist_crimson_walk_2.png',
  './assets/agents/cipher_desk.png',
  './assets/agents/cipher_stand.png',
  './assets/agents/cipher_walk_1.png',
  './assets/agents/cipher_walk_2.png',
  './assets/agents/comms_ops_stand.png',
  './assets/agents/comms_ops_walk_1.png',
  './assets/agents/comms_ops_walk_2.png',
  './assets/agents/crimson_grapple_stand.png',
  './assets/agents/crimson_grapple_walk_1.png',
  './assets/agents/crimson_grapple_walk_2.png',
  './assets/agents/cyber_security_stand.png',
  './assets/agents/cyber_security_walk_1.png',
  './assets/agents/cyber_security_walk_2.png',
  './assets/agents/exo_hacker_stand.png',
  './assets/agents/exo_hacker_walk_1.png',
  './assets/agents/exo_hacker_walk_2.png',
  './assets/agents/exo_hacker_work.png',
  './assets/agents/ghillie_sniper_stand.png',
  './assets/agents/ghillie_sniper_walk_1.png',
  './assets/agents/ghillie_sniper_walk_2.png',
  './assets/agents/hazmat_cloak_stand.png',
  './assets/agents/hazmat_cloak_walk_1.png',
  './assets/agents/hazmat_cloak_walk_2.png',
  './assets/agents/heavy_sniper_stand.png',
  './assets/agents/heavy_sniper_walk_1.png',
  './assets/agents/heavy_sniper_walk_2.png',
  './assets/agents/intel_analyst_stand.png',
  './assets/agents/intel_analyst_walk_1.png',
  './assets/agents/intel_analyst_walk_2.png',
  './assets/agents/nyx_stand.png',
  './assets/agents/nyx_walk_1.png',
  './assets/agents/nyx_walk_2.png',
  './assets/agents/nyx_work.png',
  './assets/agents/recon_blue_stand.png',
  './assets/agents/recon_blue_walk_1.png',
  './assets/agents/recon_blue_walk_2.png',
  './assets/agents/recon_brown_stand.png',
  './assets/agents/recon_brown_walk_1.png',
  './assets/agents/recon_brown_walk_2.png',
  './assets/agents/recon_grey_stand.png',
  './assets/agents/recon_grey_walk_1.png',
  './assets/agents/recon_grey_walk_2.png',
  './assets/agents/safecracker_stand.png',
  './assets/agents/safecracker_walk_1.png',
  './assets/agents/safecracker_walk_2.png',
  './assets/agents/safecracker_work.png',
  './assets/agents/sleeper_agent_stand.png',
  './assets/agents/sleeper_agent_walk_1.png',
  './assets/agents/sleeper_agent_walk_2.png',
  './assets/agents/tactical_tech_ops_stand.png',
  './assets/agents/tactical_tech_ops_walk_1.png',
  './assets/agents/tactical_tech_ops_walk_2.png',
  './assets/agents/tactical_tech_ops_work.png',
  './assets/agents/undercover_field_stand.png',
  './assets/agents/undercover_field_walk_1.png',
  './assets/agents/undercover_field_walk_2.png',
  './assets/agents/undercover_infiltration_stand.png',
  './assets/agents/undercover_infiltration_walk_1.png',
  './assets/agents/undercover_infiltration_walk_2.png',
  './assets/agents/vance_desk.png',
  './assets/agents/vance_laptop.png',
  './assets/agents/vance_stand.png',
  './assets/agents/vance_walk_1.png',
  './assets/agents/vance_walk_2.png',
];

// Install Event: Pre-cache core safehouse app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Use individual puts so a single remote failure doesn't break whole install
      for (const asset of PRECACHE_ASSETS) {
        try {
          await cache.add(asset);
        } catch (e) {
          console.warn('[PixelOps SW] Non-fatal precache skip for:', asset, e);
        }
      }
    })
  );
  self.skipWaiting();
});

// Activate Event: Flush outdated safehouse cache versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[PixelOps SW] Purging legacy cache:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch Event: Stale-While-Revalidate with offline fallback
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Bypass Chrome extensions or non-http protocols
  if (!url.protocol.startsWith('http') || url.pathname.startsWith('/api/')) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // If network fetch fails (offline) and this is an HTML navigation request, return index.html
          if (event.request.mode === 'navigate' || event.request.headers.get('accept')?.includes('text/html')) {
            return caches.match('./index.html') || caches.match('./');
          }
        });

      // Return cached version immediately if available, otherwise wait for network
      return cachedResponse || fetchPromise;
    })
  );
});

// Optional background synchronization handler for queued offline commands
self.addEventListener('sync', (event) => {
  if (event.tag === 'pixelops-telemetry-sync') {
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({
            type: 'PIXELOPS_TELEMETRY_SYNCED',
            timestamp: new Date().toISOString(),
          });
        });
      })
    );
  }
});
