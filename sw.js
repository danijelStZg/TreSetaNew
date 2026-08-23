// ===================== TREŠETA SERVICE WORKER =====================
// Strategija: NETWORK-FIRST
//  - Ako ima interneta -> povuci svježu verziju s mreže, spremi u cache
//  - Ako nema interneta -> posluži iz cachea (offline rad)
//
// Kad objaviš novu verziju aplikacije, povisi broj u CACHE_VERSION
// (npr. v2 -> v3). To prisili brisanje starog cachea.

const CACHE_VERSION = 'treseta-v36';

// Datoteke koje se predmemoriraju pri instalaciji (za offline rad)
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './cards.png',
  './icon-120.png',
  './icon-152.png',
  './icon-167.png',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './favicon-64.png'
];

// ---------- INSTALL ----------
self.addEventListener('install', event => {
  // Aktiviraj novi SW odmah, ne čekaj zatvaranje svih tabova
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache =>
      // addAll pada ako bilo koja datoteka fali; zato dodajemo pojedinačno
      Promise.allSettled(PRECACHE_URLS.map(url => cache.add(url)))
    )
  );
});

// ---------- ACTIVATE ----------
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        // Obriši sve stare cacheve osim trenutne verzije
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ---------- FETCH (network-first) ----------
self.addEventListener('fetch', event => {
  const req = event.request;

  // Obrađuj samo GET zahtjeve (POST i sl. preskoči)
  if (req.method !== 'GET') return;

  // Samo isti origin (GitHub Pages); vanjske resurse (Google Fonts) pusti mreži
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req, { cache: 'no-store' })
      .then(networkResp => {
        // Uspjeh na mreži -> osvježi cache i vrati svježu verziju
        if (networkResp && networkResp.status === 200) {
          const copy = networkResp.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(req, copy));
        }
        return networkResp;
      })
      .catch(() => {
        // Nema mreže -> posluži iz cachea
        return caches.match(req).then(cached => {
          if (cached) return cached;
          // Ako traženo nije u cacheu, za navigaciju vrati index.html
          if (req.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return Response.error();
        });
      })
  );
});

// ---------- PORUKA ZA TRENUTNO AŽURIRANJE ----------
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
