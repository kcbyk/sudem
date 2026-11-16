/**
 * Sudem müzik kutusu — service worker
 * Amaç: uygulama internetsiz de çalışsın (sayfa + tüm şarkılar + kapaklar).
 *
 * Not: önbellek adları SABİT tutulur; uygulama güncellenince indirilen
 * şarkılar silinmez, yeniden indirmek gerekmez.
 */
const APP_VERSION = 'v5';
const AUDIO_CACHE = 'sudem-audio-v1';
const MEDIA_CACHE = 'sudem-media-v1';
const META_CACHE = 'sudem-meta-' + APP_VERSION;

const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './og-image.png',
  './icon-256.png',
  './asset/videom-poster.webp'
];

// Sıra, index.html'deki PLAYLIST sırasıyla aynı olmalı (kapak eşleşmesi için)
const TRACKS = [
  { audio: './asset/audio-opt/Rafat-Hasanli-Kisa-Mesafe-94.mp3', cover: './asset/rafet.jpg' },
  { audio: './asset/audio-opt/Diyar-Pala-Anla.mp3',              cover: './asset/diyar.jpg' },
  { audio: './asset/audio-opt/Mor-Ve-Otesi-Bir-Derdim-Var.mp3',  cover: './asset/mor.jpg' },
  { audio: './asset/audio-opt/dilerimki.mp3',                    cover: './asset/dkkt.jpg' },
  { audio: './asset/audio-opt/velet-seni-bana-yazmislar-35.mp3', cover: './asset/velet.webp' },
  { audio: './asset/audio-opt/Eypio-Ay-Kizim.mp3',               cover: './asset/eypio.jpg' },
  { audio: './asset/audio-opt/Anil-Emre-Daldal-B-68.mp3',        cover: './asset/b.webp' },
  { audio: './asset/audio-opt/Stap-Bitanem-27.mp3',              cover: './asset/stap.webp' }
];

// ---------------------------------------------------------------- install
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const meta = await caches.open(META_CACHE);
    await Promise.allSettled(CORE.map((url) => meta.add(new Request(url, { cache: 'reload' }))));
    // Arka plan videosu da önbelleğe girsin (offline'da oynasın)
    const media = await caches.open(MEDIA_CACHE);
    await Promise.allSettled([
      media.add(new Request('./asset/videom-sd.mp4', { cache: 'reload' })),
      media.add(new Request('./asset/videom-poster.webp', { cache: 'reload' }))
    ]);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = [AUDIO_CACHE, MEDIA_CACHE, META_CACHE];
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !keep.includes(k)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// ---------------------------------------------------------------- yardımcılar
async function has(cacheName, url) {
  const cache = await caches.open(cacheName);
  return !!(await cache.match(new Request(url), { ignoreSearch: true }));
}

async function grab(cacheName, url) {
  const cache = await caches.open(cacheName);
  if (await has(cacheName, url)) return true;
  try {
    const res = await fetch(new Request(url, { cache: 'no-cache' }));
    if (res && res.ok) {
      await cache.put(new Request(url), res.clone());
      return true;
    }
  } catch (_) { /* çevrimdışı ya da hata: sonra tekrar denenir */ }
  return false;
}

async function cacheStatus() {
  let done = 0;
  for (const t of TRACKS) if (await has(AUDIO_CACHE, t.audio)) done++;
  return { type: 'cache-status', done, total: TRACKS.length };
}

// Hepsini sırayla indir (paralel indirme bağlantıyı boğmasın)
async function downloadAll(reply) {
  // 1) Arka plan videosu (yavaş bağlantıda hafif sürüm) — internet gitse de oynasın
  const c = navigator.connection || {};
  const slow = c.saveData === true || /(^|-)2g$|(^|-)3g$/.test(c.effectiveType || '') ||
               (typeof c.downlink === 'number' && c.downlink > 0 && c.downlink < 2);
  const video = slow ? './asset/videom-sd.mp4' : './asset/videom-hd.mp4';
  await grab(MEDIA_CACHE, video);
  await grab(MEDIA_CACHE, './asset/videom-poster.webp');

  let done = 0;
  for (const t of TRACKS) {
    const okAudio = await grab(AUDIO_CACHE, t.audio);
    await grab(MEDIA_CACHE, t.cover);
    if (okAudio) done++;
    reply({ type: 'download-progress', done, total: TRACKS.length });
  }
  reply({ type: 'download-done', done, total: TRACKS.length });
}

// Sıradaki birkaç şarkıyı sessizce indir (sadece hızlı bağlantıda)
function isCheapNetwork() {
  const c = navigator.connection || {};
  if (c.saveData) return false;
  const t = c.type || c.effectiveType || '';
  return t === 'wifi' || t === 'ethernet' || t === '4g' || t === '';
}

async function warmSome(startIndex, limit) {
  const ordered = TRACKS.slice(startIndex).concat(TRACKS.slice(0, startIndex)).slice(0, limit);
  for (const t of ordered) {
    if (await has(AUDIO_CACHE, t.audio)) continue;
    await grab(AUDIO_CACHE, t.audio);
  }
  for (const t of TRACKS) await grab(MEDIA_CACHE, t.cover);
}

// ---------------------------------------------------------------- mesajlar
self.addEventListener('message', (event) => {
  const data = event.data;
  const reply = (msg) => {
    if (event.source && event.source.postMessage) event.source.postMessage(msg);
  };

  if (data === 'warm') { event.waitUntil(warmSome(0, 3)); return; }
  if (data && data.type === 'warm') { event.waitUntil(warmSome(data.index || 0, 3)); return; }
  if (data && data.type === 'cache-status') { event.waitUntil(cacheStatus().then(reply)); return; }
  if (data && data.type === 'download-all') { event.waitUntil(downloadAll(reply)); return; }
});

// Uygulama açıldıktan sonra, hızlı bağlantıda sıradaki şarkıları sessizce hazırla
self.addEventListener('activate', () => {
  setTimeout(() => { if (isCheapNetwork()) warmSome(0, 3); }, 6000);
});

// ---------------------------------------------------------------- fetch
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isAudio = /\.(mp3|m4a|aac|ogg)$/i.test(url.pathname);
  const isMedia = /\.(mp4|webp|jpg|jpeg|png|svg|woff2?)$/i.test(url.pathname);

  // Ses: cache first — internetsizken de anında çalar
  if (isAudio) {
    event.respondWith((async () => {
      const cache = await caches.open(AUDIO_CACHE);
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok && res.status === 200) cache.put(req, res.clone());
        return res;
      } catch (_) {
        return new Response('', { status: 504, statusText: 'offline' });
      }
    })());
    return;
  }

  // Video / görseller: cache first, yoksa ağ
  if (isMedia) {
    event.respondWith((async () => {
      const cache = await caches.open(MEDIA_CACHE);
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok && res.status === 200) cache.put(req, res.clone());
        return res;
      } catch (_) {
        return new Response('', { status: 504, statusText: 'offline' });
      }
    })());
    return;
  }

  // Sayfa: cache first (uygulama anında açılsın), arka planda güncelle
  event.respondWith((async () => {
    const meta = await caches.open(META_CACHE);
    const cached = await meta.match(req, { ignoreSearch: true });

    const network = fetch(req).then((res) => {
      if (res.ok && (req.mode === 'navigate' || req.destination === 'document')) {
        meta.put(req, res.clone());
      }
      return res;
    }).catch(() => null);

    if (cached) return cached;
    const res = await network;
    if (res) return res;
    const fallback = await caches.match('./index.html', { ignoreSearch: true });
    return fallback || new Response('Çevrimdışı', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  })());
});
