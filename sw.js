// Garde l'appli disponible hors connexion.
// Change ce numéro à chaque mise à jour de l'appli pour forcer le rafraîchissement.
const CACHE = "cahier-de-caisse-v4";
const FICHIERS = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png", "./apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FICHIERS)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(cles => Promise.all(cles.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Répond d'abord avec la copie en mémoire (rapide, marche sans réseau),
// puis met la copie à jour en arrière-plan quand internet est disponible.
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(enCache => {
      const reseau = fetch(e.request).then(rep => {
        if (rep.ok) { const copie = rep.clone(); caches.open(CACHE).then(c => c.put(e.request, copie)); }
        return rep;
      }).catch(() => enCache);
      return enCache || reseau;
    })
  );
});
