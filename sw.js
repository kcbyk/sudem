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

// Kalan şarkıları tek tek, bağlantıyı boğmadan önden indir
function warmLibrary() {
  return Promise.allSettled([
    caches.open(AUDIO_CACHE).then((c) => Promise.allSettled(AUDIO_FILES.map((u) => c.add(new Request(u, { cache: 'no-cache' }))))),
    caches.open(MEDIA_CACHE).then((c) => Promise.allSettled(COVERS.map((u) => c.add(new Request(u, { cache: 'no-cache' })))))
  ]);
}

self.addEventListener('message', (event) => {
  if (event.data === 'warm') event.waitUntil(warmLibrary());
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

// Uygulama açıldıktan sonra kalan şarkıları sessizce indirmeye başla
self.addEventListener('activate', () => {
  setTimeout(() => { warmLibrary(); }, 3000);
});
