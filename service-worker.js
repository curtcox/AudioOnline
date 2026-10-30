/* Atomic install: an incomplete cache never replaces a working offline version. */
importScripts('offline-assets.js', 'vendor/hashbin-cache-v0.4.0.js');
const CACHE = OfflineAssets.version;
const absolute = asset => new URL(asset, self.registration.scope).href;
// Cache Storage can be written by anything on this origin, so bytes are checked against pinned hashes before
// they are stored or served (HashBin SDK v0.4.0 verified cache, vendored).
const verified = HashBinCache.verify;
const assetHash = HashBinCache.lookup(OfflineAssets.hashes, self.registration.scope);
async function populate() {
  const existed = await caches.has(CACHE);
  const cache = await caches.open(CACHE);
  try {
    await Promise.all(OfflineAssets.assets.map(async asset => {
      const url = absolute(asset);
      // Pinned remote runtimes do not change between releases; reuse a verified copy from an older cache.
      const kept = url.startsWith('https://') ? await verified(await caches.match(url), assetHash(url), url) : null;
      if (kept) { await cache.put(url, kept); return; }
      let response;
      try { response = await fetch(url, { cache: 'reload' }); if (!response.ok) throw new Error('HTTP ' + response.status); }
      catch (error) {
        // The identical vendored copy keeps offline setup working when a CDN is blocked.
        if (!asset.startsWith('https://cdnjs.cloudflare.com/')) throw error;
        response = await fetch(absolute('vendor/lz-string.min.js'), { cache: 'reload' });
        if (!response.ok) throw new Error('Compression library unavailable.');
      }
      const checked = await verified(response, assetHash(url), url);
      if (!checked) throw new Error('Offline download did not match its manifest: ' + asset);
      await cache.put(url, checked);
    }));
  } catch (error) { if (!existed) await caches.delete(CACHE); throw error; }
}
self.addEventListener('install', event => event.waitUntil(populate()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  await self.clients.claim();
  // Older page clients can continue using their matching assets until they reload.
  for (const name of await caches.keys()) if (name.startsWith('audioonline-') && name !== CACHE) await caches.delete(name);
})()));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const inScope = url.origin === self.location.origin && url.pathname.startsWith(new URL(self.registration.scope).pathname);
  if (!inScope && !OfflineAssets.assets.includes(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Query strings carry documents or version tags, never change the static bytes.
    const key = url.origin === self.location.origin ? url.origin + url.pathname : url.href;
    const navigation = event.request.mode === 'navigate';
    const entry = !assetHash(key) && navigation && (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html')) ? absolute('index.html') : key;
    const cached = await verified(await cache.match(entry), assetHash(entry), entry);
    if (cached) return cached;
    // A missing or altered entry is never served; offline status reports it until repaired.
    await cache.delete(entry);
    return fetch(event.request);
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'activate-update') { self.skipWaiting(); return; }
  if (!['offline-status', 'repair-offline'].includes(event.data?.type)) return;
  event.waitUntil((async () => {
    try {
      if (event.data.type === 'repair-offline') await populate();
      const cache = await caches.open(CACHE);
      const entries = await Promise.all(OfflineAssets.assets.map(async asset => verified(await cache.match(absolute(asset)), assetHash(absolute(asset)), absolute(asset))));
      event.ports[0]?.postMessage({ ready: entries.every(Boolean), version: CACHE });
    } catch (_) { event.ports[0]?.postMessage({ ready: false }); }
  })());
});
