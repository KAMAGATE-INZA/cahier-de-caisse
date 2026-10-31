// Garde l'appli disponible hors connexion.
// Change ce numéro à chaque mise à jour de l'appli.
const CACHE = "cahier-de-caisse-v15-1";
const FICHIERS = ["./", "./index.html", "./regles.js", "./core.js", "./vues.js", "./formulaires.js", "./outils.js", "./catalogue.js", "./suivi.js", "./vitrine.js", "./boutique.html", "./config.js", "./synchro.js", "./main.js", "./cloud.js", "./firebase-sdk.js", "./firestore.rules", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png", "./apple-touch-icon.png"];

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

// Avec internet : toujours la dernière version publiée (et on en garde une copie).
// Sans internet, ou si le réseau met plus de 4 secondes : la copie gardée.
// Le gros fichier Firebase change rarement : la copie gardée d'abord.
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  const garder = rep => { if (rep && rep.ok) { const copie = rep.clone(); caches.open(CACHE).then(c => c.put(e.request, copie)); } return rep; };
  if (url.pathname.endsWith("/firebase-sdk.js")) {
    e.respondWith(caches.match(e.request).then(c => c || fetch(e.request).then(garder)));
    return;
  }
  e.respondWith(new Promise(resolve => {
    let fini = false;
    const deCache = () => caches.match(e.request, { ignoreSearch: true });
    const minuteur = setTimeout(() => deCache().then(c => { if (c && !fini) { fini = true; resolve(c); } }), 4000);
    fetch(e.request, { cache: "no-cache" })
      .then(rep => { clearTimeout(minuteur); if (!fini) { fini = true; resolve(garder(rep)); } else garder(rep); })
      .catch(() => { clearTimeout(minuteur); deCache().then(c => { if (!fini) { fini = true; resolve(c || Response.error()); } }); });
  }));
});
