/**
 * Sudem müzik kutusu — service worker
 * Amaç: şarkılar ikinci açılışta beklemeden çalsın.
 *  - Şarkılar ve kapaklar: "cache first" (bir kez indi → hep anında)
 *  - Sayfa/HTML: "network first" (güncellemeler hemen görünsün)
 */
const VERSION = 'sudem-v3';
const AUDIO_CACHE = `${VERSION}-audio`;
const MEDIA_CACHE = `${VERSION}-media`;

const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './og-image.png',
  './icon-256.png',
  './asset/videom-hd.mp4',
  './asset/videom-poster.webp'
];

const AUDIO_FILES = [
  './asset/audio-opt/Rafat-Hasanli-Kisa-Mesafe-94.mp3',
  './asset/audio-opt/Diyar-Pala-Anla.mp3',
  './asset/audio-opt/Mor-Ve-Otesi-Bir-Derdim-Var.mp3',
  './asset/audio-opt/dilerimki.mp3',
  './asset/audio-opt/velet-seni-bana-yazmislar-35.mp3',
  './asset/audio-opt/Eypio-Ay-Kizim.mp3',
  './asset/audio-opt/Anil-Emre-Daldal-B-68.mp3',
  './asset/audio-opt/Stap-Bitanem-27.mp3'
];

const COVERS = [
  './asset/rafet.jpg',
  './asset/diyar.jpg',
  './asset/mor.jpg',
  './asset/dkkt.jpg',
  './asset/velet.webp',
  './asset/eypio.jpg',
  './asset/b.webp',
  './asset/stap.webp'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const core = await caches.open(MEDIA_CACHE);
    await Promise.allSettled(CORE.map((url) => core.add(url)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Mobil veride tüm kütüphaneyi indirmek çalan şarkıyı boğar:
// sadece Wi-Fi'de ve sıradaki birkaç şarkıyı, sırayla (paralel değil) indir.
function isCheapNetwork() {
  const c = navigator.connection || {};
  if (c.saveData) return false;
  const t = c.type || c.effectiveType || '';
  return t === 'wifi' || t === 'ethernet' || t === '4g' || t === '';
}

async function warm(urls, cacheName, limit) {
  const cache = await caches.open(cacheName);
  for (const url of urls.slice(0, limit)) {
    try {
      if (await cache.match(new Request(url), { ignoreSearch: true })) continue;
      await cache.add(new Request(url, { cache: 'no-cache' }));
    } catch (_) { /* tek dosya inmezse devam */ }
  }
}

function warmLibrary(startIndex = 0) {
  if (!isCheapNetwork()) return Promise.resolve();
  const ordered = AUDIO_FILES.slice(startIndex).concat(AUDIO_FILES.slice(0, startIndex));
  return Promise.allSettled([
    warm(ordered, AUDIO_CACHE, 3),
    warm(COVERS, MEDIA_CACHE, COVERS.length)
  ]);
}

self.addEventListener('message', (event) => {
  const data = event.data;
  if (data === 'warm') { event.waitUntil(warmLibrary(0)); return; }
  if (data && typeof data === 'object' && data.type === 'warm' && typeof data.index === 'number') {
    event.waitUntil(warmLibrary(data.index));
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isAudio = /\.(mp3|m4a|aac|ogg)$/i.test(url.pathname);
  const isMedia = /\.(mp4|webp|jpg|jpeg|png|svg|woff2?)$/i.test(url.pathname);

  // Ses: cache first (anında çalsın), yoksa ağdan indir ve sakla
  if (isAudio) {
    event.respondWith((async () => {
      const cache = await caches.open(AUDIO_CACHE);
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.status === 200) cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  // Video / görseller: önce cache, yoksa ağ
  if (isMedia) {
    event.respondWith((async () => {
      const cache = await caches.open(MEDIA_CACHE);
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.status === 200) cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  // HTML ve diğerleri: network first, çevrimdışıysa cache
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok && (req.mode === 'navigate' || req.destination === 'document')) {
        const cache = await caches.open(MEDIA_CACHE);
        cache.put(req, res.clone());
      }
      return res;
    } catch (_) {
      const cached = await caches.match(req, { ignoreSearch: true });
      return cached || Response.error();
    }
  })());
});

// Uygulama açıldıktan sonra (Wi-Fi'deyse) sıradaki birkaç şarkıyı sessizce indir
self.addEventListener('activate', () => {
  setTimeout(() => { warmLibrary(0); }, 6000);
});
