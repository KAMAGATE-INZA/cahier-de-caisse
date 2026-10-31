/* =====================================================================
   Synchronisation en ligne (Firebase) : propriétaire et vendeurs.
   Chargé seulement quand la synchro est configurée sur l'appareil.

   Organisation des données en ligne :
     comptes/{uid}                       rôle du compte (proprio / vendeur)
     boutiques/{uidProprio}              réglages de la boutique
       membres/{uidVendeur}              vendeurs qui ont accès
       produits, ventes, vendeurs,       ce que le vendeur peut lire (sa partie seulement)
       versements
       produitsPrive, ventesPrive        coûts d'achat : jamais lisibles par un vendeur
       depenses, arrivages, photos,      propriétaire uniquement
       clients
     vitrines/{nom}                      boutique en ligne publique (lecture libre)
       articles, images
   Les règles de sécurité (firestore.rules) font respecter ces accès côté serveur.
   ===================================================================== */
import * as fb from "./firebase-sdk.js";

const CFG_KEY = "cahier-de-caisse:cloud";
const DOMAINE_VENDEUR = "vendeur.example.com"; /* adresse technique : les vendeurs se connectent avec un simple identifiant */
const COLS = ["produits", "vendeurs", "ventes", "depenses", "versements", "arrivages", "clients"];
const PRIVE = { produits: ["cout", "baseVendeur", "note"], ventes: ["coutU"] };

const C = window.Cloud = { etat: "demarrage", role: null, user: null, enAttente: 0, erreur: "" };
let app = null, auth = null, fs = null, desabos = [];

const lireCfg = () => { try { return JSON.parse(localStorage.getItem(CFG_KEY) || "null"); } catch { return null; } };
const ecrireCfg = c => { try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch {} };
const slug = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
C.emailDe = id => String(id).includes("@") ? String(id).trim() : slug(id) + "@" + DOMAINE_VENDEUR;
C.slug = slug;
const chemin = col => `boutiques/${C.boutique}/${col}`;
const propre = o => JSON.parse(JSON.stringify(o)); /* retire les valeurs « undefined » */
const prevenir = () => { if (typeof window.surEtatCloud === "function") window.surEtatCloud(); };

function messageErreur(e) {
  const code = (e && e.code) || "";
  if (code.includes("permission-denied")) return "Accès refusé par le serveur. As-tu bien publié les règles de sécurité dans Firebase ?";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found") || code.includes("invalid-email")) return "Identifiant ou mot de passe incorrect.";
  if (code.includes("email-already-in-use")) return "Cet identifiant est déjà pris. Choisis-en un autre.";
  if (code.includes("weak-password")) return "Mot de passe trop court : 6 caractères minimum.";
  if (code.includes("too-many-requests")) return "Trop d'essais. Attends quelques minutes.";
  if (code.includes("network") || code.includes("unavailable")) return "Pas de connexion internet. Réessaie quand le réseau revient.";
  if (code.includes("requires-recent-login")) return "Reconnecte-toi puis recommence.";
  if (code.includes("invalid-api-key") || code.includes("api-key-not-valid")) return "La configuration Firebase collée n'est pas valide.";
  return "Erreur : " + (e && e.message ? e.message : code || "inconnue");
}
C.messageErreur = messageErreur;
C.configActuelle = () => (lireCfg() || {}).firebase || null;

/* ================= Démarrage ================= */
export function demarrer() {
  const cfg = lireCfg();
  if (!cfg || !cfg.firebase) return;
  try {
    app = fb.initializeApp(cfg.firebase);
    auth = fb.getAuth(app);
    try {
      fs = fb.initializeFirestore(app, { localCache: fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() }), ignoreUndefinedProperties: true });
    } catch { fs = fb.initializeFirestore(app, { ignoreUndefinedProperties: true }); }
  } catch (e) { C.etat = "erreur"; C.erreur = messageErreur(e); prevenir(); return; }
  C.etat = "attente";
  fb.onAuthStateChanged(auth, u => u ? ouvrirSession(u).catch(e => { C.etat = "erreur"; C.erreur = messageErreur(e); prevenir(); }) : fermerSession());
  window.addEventListener("online", prevenir); window.addEventListener("offline", prevenir);
}

async function ouvrirSession(u) {
  C.user = u; C.etat = "chargement"; prevenir();
  const cfg = lireCfg() || {};
  let compte = null, horsLigne = false;
  try { const s = await fb.getDoc(fb.doc(fs, "comptes", u.uid)); if (s.exists()) compte = s.data(); }
  catch { horsLigne = true; if (cfg.session && cfg.session.uid === u.uid) compte = cfg.session; }
  const compteVendeurTechnique = String(u.email || "").endsWith("@" + DOMAINE_VENDEUR);
  if (!compte && compteVendeurTechnique) {
    /* Identifiant de vendeur dont l'accès a été retiré : il ne devient surtout pas propriétaire d'une boutique */
    C.role = "retire"; C.etat = "retire"; prevenir();
    if (typeof window.surAccesRetire === "function") window.surAccesRetire();
    return;
  }
  if (compte && compte.role === "vendeur") {
    C.role = "vendeur"; C.boutique = compte.boutique; C.vendeurId = compte.vendeurId;
  } else {
    C.role = "proprio"; C.boutique = u.uid; C.vendeurId = null;
    if (!compte && !horsLigne) await fb.setDoc(fb.doc(fs, "comptes", u.uid), { role: "proprio", boutique: u.uid });
  }
  cfg.session = { uid: u.uid, role: C.role, boutique: C.boutique, vendeurId: C.vendeurId, email: u.email };
  /* Le rôle vient du serveur, pas du lien ouvert : on nettoie toute trace d'un lien vendeur sur un compte propriétaire */
  if (C.role === "proprio") { delete cfg.vendeur; delete cfg.identifiant; } else cfg.vendeur = true;
  ecrireCfg(cfg);
  if (C.role === "proprio") { if (!horsLigne) await preparerBoutique(cfg); abonnerProprio(); }
  else abonnerVendeur();
  C.etat = "actif"; prevenir();
  if (typeof window.surSession === "function") window.surSession(C.role);
  if (C.role === "proprio" && typeof planifierVitrine === "function") planifierVitrine(3000); /* remet la boutique en ligne à jour */
}
function fermerSession() {
  desabos.forEach(f => { try { f(); } catch {} }); desabos = [];
  db.cloud = null; C.user = null; C.role = null; C.etat = "deconnecte"; prevenir();
  if (typeof window.surDeconnexion === "function") window.surDeconnexion();
}

/* Premier branchement du propriétaire : envoie les données de l'appareil, ou demande quoi garder */
async function preparerBoutique(cfg) {
  const ref = fb.doc(fs, "boutiques", C.boutique);
  const snap = await fb.getDoc(ref);
  const local = S.data.ventes.length + S.data.produits.length + S.data.depenses.length;
  if (!snap.exists()) {
    await televerserTout(S.data, true);
    await fb.setDoc(ref, { reglages: propre(S.data.reglages), cree: Date.now() });
  } else if (cfg.lie !== C.user.uid && local > 0) {
    const distantes = await fb.getDocs(fb.collection(fs, chemin("ventes")));
    const distProd = await fb.getDocs(fb.collection(fs, chemin("produits")));
    /* Si tout ce qui est sur l'appareil est déjà en ligne (même compte, simple reconnexion), rien à demander */
    const idsV = new Set(distantes.docs.map(d => d.id)), idsP = new Set(distProd.docs.map(d => d.id));
    const dejaEnLigne = S.data.ventes.every(v => idsV.has(v.id)) && S.data.produits.every(p => idsP.has(p.id));
    if (dejaEnLigne) { cfg.lie = C.user.uid; ecrireCfg(cfg); return; }
    const choix = await window.choisirDonnees({ ventesLocales: S.data.ventes.length, ventesEnLigne: distantes.size });
    if (choix === "local") {
      try { localStorage.setItem("cahier-de-caisse:avant-synchro", JSON.stringify(S.data)); } catch {}
      await viderEnLigne(); await televerserTout(S.data, true);
      await fb.setDoc(ref, { reglages: propre(S.data.reglages), cree: Date.now() });
    } else {
      try { localStorage.setItem("cahier-de-caisse:avant-synchro", JSON.stringify(S.data)); } catch {}
    }
  }
  cfg.lie = C.user.uid; ecrireCfg(cfg);
}

/* Un document par produit : photo principale + autres. Firestore limite un document à 1 Mo : on retire les dernières si besoin */
function docPhotos(liste) {
  const autres = liste.slice(1);
  while (autres.length && JSON.stringify({ data: liste[0], autres }).length > 950000) autres.pop();
  return { data: liste[0], autres };
}

/* ================= Découpage public / privé ================= */
function vendeurUidDe(vendeurId) { const vd = S.data.vendeurs.find(v => v.id === vendeurId); return (vd && vd.uid) || null; }
function decouper(col, obj) {
  const o = propre(obj);
  if (col === "produits") {
    const priv = { cout: +o.cout || 0, baseVendeur: +o.baseVendeur || 0, note: o.note || "" };
    PRIVE.produits.forEach(k => delete o[k]);
    o.base = basePartage(obj); o.vendeurUid = o.mode === "depot" ? vendeurUidDe(o.vendeurId) : null;
    return [o, priv];
  }
  if (col === "ventes") {
    const priv = { coutU: +o.coutU || 0 };
    delete o.coutU;
    o.vendeurUid = o.vendeurId ? vendeurUidDe(o.vendeurId) : null;
    if (o.vendeurId && !o.auteur) o.auteur = "proprio";
    return [o, priv];
  }
  if (col === "versements") { o.vendeurUid = vendeurUidDe(o.vendeurId); return [o, null]; }
  if (col === "vendeurs") { o.boutique = { nom: S.data.reglages.boutique || "", numero: S.data.reglages.numero || "", logo: S.data.reglages.logo || "" }; return [o, null]; }
  return [o, null];
}

/* Écritures groupées (500 au maximum par envoi) */
async function envoyer(actions) {
  for (let i = 0; i < actions.length; i += 400) {
    const batch = fb.writeBatch(fs);
    for (const a of actions.slice(i, i + 400)) a.suppr ? batch.delete(fb.doc(fs, a.chemin)) : batch.set(fb.doc(fs, a.chemin), a.data);
    C.enAttente++; prevenir();
    try { await batch.commit(); }
    catch (e) { C.erreur = messageErreur(e); if (typeof toast === "function") toast(C.erreur); }
    finally { C.enAttente--; prevenir(); }
  }
}
function actionsPour(col, obj) {
  const [pub, priv] = decouper(col, obj), r = [{ chemin: chemin(col) + "/" + obj.id, data: pub }];
  if (priv) r.push({ chemin: chemin(col + "Prive") + "/" + obj.id, data: priv });
  return r;
}
async function televerserTout(data, avecPhotos) {
  const actions = [];
  for (const col of COLS) for (const obj of data[col] || []) actions.push(...actionsPour(col, obj));
  await envoyer(actions);
  if (avecPhotos) {
    const ids = new Set([...Object.keys(PHOTOS), ...Object.keys(AUTRES)]);
    const ph = [...ids].map(id => ({ chemin: chemin("photos") + "/" + id, data: docPhotos(photosDe(id)) }));
    for (let i = 0; i < ph.length; i += 8) await envoyer(ph.slice(i, i + 8));
  }
}
async function viderEnLigne() {
  const actions = [];
  for (const col of [...COLS, "produitsPrive", "ventesPrive", "photos"]) {
    const s = await fb.getDocs(fb.collection(fs, chemin(col)));
    s.forEach(d => actions.push({ chemin: chemin(col) + "/" + d.id, suppr: true }));
  }
  await envoyer(actions);
}

/* ================= Propriétaire : écoute en direct ================= */
function abonnerProprio() {
  const maps = {}, recus = new Set(), attendus = [...COLS, "produitsPrive", "ventesPrive"];
  let minuteur = null;
  const recomposer = () => {
    if (attendus.some(c => !recus.has(c))) return;
    clearTimeout(minuteur);
    minuteur = setTimeout(() => {
      const fusion = (col) => [...maps[col].values()].map(o => ({ ...o, ...(maps[col + "Prive"] ? maps[col + "Prive"].get(o.id) || {} : {}) }));
      S.data.produits = fusion("produits");
      S.data.ventes = fusion("ventes");
      for (const col of ["vendeurs", "depenses", "versements", "arrivages", "clients"]) S.data[col] = [...maps[col].values()];
      normaliser(S.data);
      enregistrer();
      render();
      figerCoutsVentesVendeur(maps);
      if (typeof planifierVitrine === "function") planifierVitrine(); /* une vente du vendeur change le stock affiché en ligne */
    }, 60);
  };
  for (const col of attendus) {
    maps[col] = new Map();
    desabos.push(fb.onSnapshot(fb.collection(fs, chemin(col)), snap => {
      snap.docChanges().forEach(ch => ch.type === "removed" ? maps[col].delete(ch.doc.id) : maps[col].set(ch.doc.id, { ...ch.doc.data(), id: ch.doc.id }));
      recus.add(col); recomposer();
    }, e => { C.erreur = messageErreur(e); prevenir(); }));
  }
  desabos.push(fb.onSnapshot(fb.doc(fs, "boutiques", C.boutique), s => {
    if (s.exists() && s.data().reglages) { S.data.reglages = Object.assign({}, S.data.reglages, s.data().reglages); enregistrer(); render(); }
  }, () => {}));
  desabos.push(fb.onSnapshot(fb.collection(fs, chemin("photos")), snap => {
    let change = false;
    snap.docChanges().forEach(ch => {
      if (ch.doc.metadata.hasPendingWrites) return;
      const d = ch.type === "removed" ? null : ch.doc.data();
      const liste = d ? [d.data, ...(Array.isArray(d.autres) ? d.autres : [])].filter(Boolean) : [];
      if (liste.join("|") !== photosDe(ch.doc.id).join("|")) { definirPhotos(ch.doc.id, liste, true); change = true; }
    });
    if (change) render();
  }, () => {}));

  db.cloud = {
    ecrire(ops) {
      const actions = [];
      for (const o of ops) {
        if (o.type === "suppr") {
          actions.push({ chemin: chemin(o.col) + "/" + o.id, suppr: true });
          if (PRIVE[o.col]) actions.push({ chemin: chemin(o.col + "Prive") + "/" + o.id, suppr: true });
          continue;
        }
        const obj = S.data[o.col].find(x => x.id === o.id);
        if (obj) actions.push(...actionsPour(o.col, obj));
      }
      envoyer(actions);
    },
    photo(id, liste) { envoyer([liste && liste.length ? { chemin: chemin("photos") + "/" + id, data: docPhotos(liste) } : { chemin: chemin("photos") + "/" + id, suppr: true }]); },
    reglages(r) {
      envoyer([{ chemin: "boutiques/" + C.boutique, data: { reglages: propre(r), cree: Date.now() } }]);
      /* le nom et le numéro de la boutique apparaissent chez les vendeurs */
      envoyer(S.data.vendeurs.flatMap(vd => actionsPour("vendeurs", vd)));
    },
    async remplacerTout(data) { await viderEnLigne(); await televerserTout(data, true); }
  };
  viderFileAttente();
}
/* Écritures faites pendant les premières secondes, avant la fin de la connexion : on les envoie maintenant */
function viderFileAttente() {
  if (!db.enAttente || !db.enAttente.length) return;
  const ops = db.enAttente; db.enAttente = [];
  db.cloud.ecrire(ops);
}
/* Une vente ajoutée par le vendeur n'a pas de coût d'achat : on le fige avec le coût actuel du produit */
function figerCoutsVentesVendeur(maps) {
  const actions = [];
  for (const v of S.data.ventes) {
    if (!v.vendeurId || maps.ventesPrive.has(v.id)) continue;
    const p = S.data.produits.find(x => x.id === v.produitId);
    if (!p) continue;
    v.coutU = +p.cout || 0;
    actions.push({ chemin: chemin("ventesPrive") + "/" + v.id, data: { coutU: v.coutU } });
  }
  if (actions.length) envoyer(actions);
}

/* ================= Vendeur : écoute de sa partie seulement ================= */
function abonnerVendeur() {
  const u = C.user.uid;
  S.role = "vendeur";
  S.data = donneesInitiales();
  const refus = e => {
    if (String((e && e.code) || "").includes("permission-denied")) {
      desabos.forEach(f => { try { f(); } catch {} }); desabos = [];
      S.data = donneesInitiales(); db.cloud = null; C.etat = "retire"; prevenir();
      if (typeof window.surAccesRetire === "function") window.surAccesRetire();
    } else { C.erreur = messageErreur(e); prevenir(); }
  };
  const maj = () => { clearTimeout(maj.t); maj.t = setTimeout(render, 60); };
  desabos.push(fb.onSnapshot(fb.doc(fs, chemin("vendeurs") + "/" + C.vendeurId), s => {
    if (s.exists()) {
      const vd = { ...s.data(), id: s.id };
      S.data.vendeurs = [vd];
      if (vd.boutique) S.data.reglages = Object.assign({}, S.data.reglages, { boutique: vd.boutique.nom || "", numero: vd.boutique.numero || "", logo: vd.boutique.logo || "" });
    } else S.data.vendeurs = [];
    maj();
  }, refus));
  const ecouter = (col, transformer) => desabos.push(fb.onSnapshot(fb.query(fb.collection(fs, chemin(col)), fb.where("vendeurUid", "==", u)), snap => {
    S.data[col] = snap.docs.map(d => transformer({ ...d.data(), id: d.id }));
    if (col === "produits") chargerPhotosVendeur();
    maj();
  }, refus));
  /* le vendeur ne reçoit jamais le vrai coût : seulement la base du partage */
  ecouter("produits", p => ({ ...p, cout: +p.base || 0, baseVendeur: +p.base || 0, coutVisible: !!p.vendeurVoitCout }));
  ecouter("ventes", v => v);
  ecouter("versements", x => x);

  db.cloud = {
    ecrire(ops) {
      const actions = [];
      for (const o of ops) {
        if (o.col !== "ventes" && o.col !== "versements") continue;
        if (o.type === "suppr") { actions.push({ chemin: chemin(o.col) + "/" + o.id, suppr: true }); continue; }
        const obj = propre(S.data[o.col].find(x => x.id === o.id) || {});
        if (!obj.id) continue;
        obj.vendeurUid = u; obj.vendeurId = C.vendeurId;
        if (o.col === "ventes") { obj.auteur = "vendeur"; delete obj.coutU; delete obj.ajuste; obj.encaisse = false; obj.paiement = "Via le vendeur"; }
        if (o.col === "versements") obj.confirme = false;
        actions.push({ chemin: chemin(o.col) + "/" + o.id, data: obj });
      }
      envoyer(actions);
    }
  };
  viderFileAttente();
}
/* Photos du vendeur : une écoute par produit confié (il ne peut pas lister toute la collection).
   Gardées en mémoire seulement : rien ne reste sur son téléphone si l'accès est retiré. */
const _ecoutesPhotos = new Map();
function chargerPhotosVendeur() {
  const ids = new Set(S.data.produits.map(p => p.id));
  for (const [id, stop] of _ecoutesPhotos) if (!ids.has(id)) {
    try { stop(); } catch {}
    _ecoutesPhotos.delete(id);
    for (const ph of photosDe(id)) oublierUrl(ph);
    delete PHOTOS[id]; delete AUTRES[id];
  }
  for (const id of ids) {
    if (_ecoutesPhotos.has(id)) continue;
    const stop = fb.onSnapshot(fb.doc(fs, chemin("photos") + "/" + id), s => {
      const d = s.exists() ? s.data() : {};
      const liste = [d.data, ...(Array.isArray(d.autres) ? d.autres : [])].filter(x => typeof x === "string" && x.startsWith("data:image/"));
      if (liste.join("|") === photosDe(id).join("|")) return;
      for (const ph of photosDe(id)) if (!liste.includes(ph)) oublierUrl(ph);
      if (liste[0]) PHOTOS[id] = liste[0]; else delete PHOTOS[id];
      if (liste.length > 1) AUTRES[id] = liste.slice(1); else delete AUTRES[id];
      clearTimeout(chargerPhotosVendeur.t); chargerPhotosVendeur.t = setTimeout(render, 80);
    }, () => {});
    _ecoutesPhotos.set(id, stop);
    desabos.push(() => { try { stop(); } catch {} _ecoutesPhotos.delete(id); });
  }
}

/* ================= Boutique en ligne (vitrine publique) =================
   vitrines/{nom}            nom, numéro WhatsApp, message, index des articles publiés (empreintes)
     articles/{id}           fiche d'un produit (avec une petite photo) : lu par la page boutique.html
     images/{id}             grandes photos, chargées seulement quand un client ouvre le produit
   Lecture libre pour tout le monde ; écriture réservée au propriétaire de la vitrine.
   Seul ce qui a changé est renvoyé : l'index garde l'empreinte de chaque article. */
const empreinte = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36) + s.length.toString(36); };
async function envoyerOuEchouer(actions, parLot) {
  for (let i = 0; i < actions.length; i += parLot) {
    const batch = fb.writeBatch(fs);
    for (const a of actions.slice(i, i + parLot)) a.suppr ? batch.delete(fb.doc(fs, a.chemin)) : batch.set(fb.doc(fs, a.chemin), a.data);
    C.enAttente++; prevenir();
    try { await batch.commit(); } finally { C.enAttente--; prevenir(); }
  }
}
function photosTenant(liste) {
  const l = liste.slice(0, 4);
  while (l.length > 1 && JSON.stringify(l).length > 950000) l.pop();
  return l;
}
C.publierVitrine = async ({ nom, ancien, racine, articles, images }) => {
  if (C.role !== "proprio" || !C.user) { const e = new Error("Connecte-toi d'abord (Réglages → Synchronisation)."); e.code = "hors-ligne"; throw e; }
  const ref = fb.doc(fs, "vitrines", nom), base = "vitrines/" + nom + "/";
  const snap = await fb.getDoc(ref);
  if (snap.exists() && snap.data().proprio !== C.user.uid) { const e = new Error("Ce nom de boutique est déjà pris. Choisis-en un autre."); e.code = "vitrine-prise"; throw e; }
  const avant = snap.exists() ? (snap.data().index || {}) : {};
  const index = {}, legers = [], lourds = [], retraits = [];
  for (const a of articles) {
    const ha = empreinte(JSON.stringify(a)), hi = images[a.id] && images[a.id].length ? empreinte(images[a.id].join("|")) : "";
    index[a.id] = ha + "." + hi;
    const [pa, pi] = String(avant[a.id] || ".").split(".");
    if (pa !== ha) legers.push({ chemin: base + "articles/" + a.id, data: a });
    if (pi !== hi) lourds.push(hi ? { chemin: base + "images/" + a.id, data: { photos: photosTenant(images[a.id]) } } : { chemin: base + "images/" + a.id, suppr: true });
  }
  for (const id in avant) if (!index[id]) retraits.push({ chemin: base + "articles/" + id, suppr: true }, { chemin: base + "images/" + id, suppr: true });
  const signature = empreinte(JSON.stringify([racine, index]));
  const changements = legers.length + lourds.length + retraits.length;
  if (snap.exists() && snap.data().signature === signature && !changements) return { nb: articles.length, envoyes: 0, retires: 0 };
  const doc = { ...racine, proprio: C.user.uid, index, signature, nb: articles.length, maj: Date.now() };
  /* la fiche de la vitrine d'abord : les règles vérifient le propriétaire avant d'accepter les articles */
  if (!snap.exists()) await fb.setDoc(ref, { ...doc, index: {}, signature: "" });
  /* lots de 8 : chaque écriture fait vérifier le propriétaire par les règles, et Firebase limite ces vérifications par envoi */
  await envoyerOuEchouer(legers, 8);
  await envoyerOuEchouer(lourds, 5);     /* une requête Firestore ne dépasse pas 10 Mo */
  await envoyerOuEchouer(retraits, 8);
  await fb.setDoc(ref, doc);             /* l'index en dernier : si l'envoi est coupé, la prochaine fois reprend */
  if (ancien && ancien !== nom) await C.retirerVitrine(ancien).catch(() => {});
  return { nb: articles.length, envoyes: legers.length + lourds.length, retires: retraits.length / 2 };
};
C.retirerVitrine = async nom => {
  if (!nom || !C.user) return;
  const ref = fb.doc(fs, "vitrines", nom), snap = await fb.getDoc(ref);
  if (!snap.exists() || snap.data().proprio !== C.user.uid) return;
  const actions = [];
  for (const id in (snap.data().index || {})) actions.push({ chemin: "vitrines/" + nom + "/articles/" + id, suppr: true }, { chemin: "vitrines/" + nom + "/images/" + id, suppr: true });
  await envoyerOuEchouer(actions, 8);
  await fb.deleteDoc(ref); /* en dernier : les règles lisent cette fiche pour autoriser les suppressions ci-dessus */
};
/* Pourquoi le serveur refuse ? « anciennes » : les règles publiées dans Firebase datent d'avant la boutique.
   « compte-repare » : la fiche de compte manquait, elle vient d'être recréée (on peut réessayer). */
C.diagnostiquerRegles = async () => {
  try { await fb.getDoc(fb.doc(fs, "vitrines", "verification-des-regles")); await fb.getDoc(fb.doc(fs, "identifiants", "verification-des-regles")); }
  catch (e) { return String((e && e.code) || "").includes("permission") ? "anciennes" : "reseau"; }
  if (C.role === "proprio" && C.user) {
    try {
      const s = await fb.getDoc(fb.doc(fs, "comptes", C.user.uid));
      if (!s.exists() || s.data().role !== "proprio") { await fb.setDoc(fb.doc(fs, "comptes", C.user.uid), { role: "proprio", boutique: C.user.uid }); return "compte-repare"; }
    } catch {}
  }
  return "ok";
};
C.nomVitrineLibre = async nom => {
  const s = await fb.getDoc(fb.doc(fs, "vitrines", nom));
  return !s.exists() || s.data().proprio === (C.user && C.user.uid);
};

/* ================= Comptes ================= */
/* identifiants/{identifiant} : compte de connexion actuel d'un vendeur (il change quand tu lui donnes un nouveau mot de passe).
   Lisible par tous : il ne contient qu'une adresse technique, jamais de mot de passe. */
C.emailPour = async identifiant => {
  if (String(identifiant).includes("@")) return String(identifiant).trim();
  try { const s = await fb.getDoc(fb.doc(fs, "identifiants", slug(identifiant))); if (s.exists() && s.data().email) return s.data().email; } catch {}
  return C.emailDe(identifiant);
};
C.connecter = async (identifiant, mdp) => fb.signInWithEmailAndPassword(auth, await C.emailPour(identifiant), mdp);
C.creerCompte = (email, mdp) => fb.createUserWithEmailAndPassword(auth, email.trim(), mdp);
C.motDePasseOublie = email => fb.sendPasswordResetEmail(auth, email.trim());
C.deconnecter = () => fb.signOut(auth);
C.changerMdp = async (ancien, nouveau) => {
  const cred = fb.EmailAuthProvider.credential(auth.currentUser.email, ancien);
  await fb.reauthenticateWithCredential(auth.currentUser, cred);
  await fb.updatePassword(auth.currentUser, nouveau);
};
C.email = () => auth && auth.currentUser ? auth.currentUser.email : "";

/* Crée le compte du vendeur sans déconnecter le propriétaire (seconde instance temporaire) */
/* Crée l'identifiant du vendeur. Si l'identifiant existe déjà (accès retiré puis redonné), on le reprend :
   soit on connaît déjà son compte, soit on vérifie avec le mot de passe qu'il utilise. */
C.creerAccesVendeur = async (vd, identifiant, mdp, mdpExistant) => {
  const cfg = lireCfg(), id = slug(identifiant);
  let vuid = null;
  if (vd.ancienUid && vd.identifiant === id) vuid = vd.ancienUid;
  if (!vuid) {
    const app2 = fb.initializeApp(cfg.firebase, "creation-" + Date.now());
    try {
      const auth2 = fb.initializeAuth(app2, { persistence: fb.inMemoryPersistence });
      try {
        const cred = mdpExistant ? await fb.signInWithEmailAndPassword(auth2, await C.emailPour(id), mdpExistant)
                                 : await fb.createUserWithEmailAndPassword(auth2, C.emailDe(id), mdp);
        vuid = cred.user.uid;
      } catch (e) {
        if (!mdpExistant && String(e.code || "").includes("email-already-in-use")) { const x = new Error("identifiant existant"); x.code = "identifiant-existant"; throw x; }
        throw e;
      }
      await fb.signOut(auth2);
    } finally { try { await fb.deleteApp(app2); } catch {} }
  }
  await envoyer([
    { chemin: "comptes/" + vuid, data: { role: "vendeur", boutique: C.boutique, vendeurId: vd.id } },
    { chemin: `boutiques/${C.boutique}/membres/${vuid}`, data: { vendeurId: vd.id, identifiant: id } }
  ]);
  /* l'identifiant est réservé à ta boutique (sans effet si les règles n'ont pas encore la version 15) */
  if (!(vd.ancienUid && vd.identifiant === id && vd.versionAcces)) fb.getDoc(fb.doc(fs, "identifiants", id)).then(s => { if (!s.exists()) return fb.setDoc(fb.doc(fs, "identifiants", id), { email: C.emailDe(id), boutique: C.boutique, vendeurId: vd.id }); }).catch(() => {});
  /* Le vendeur reçoit son identifiant, puis on marque toute sa partie à son nom */
  const ops = [{ type: "modif", col: "vendeurs", id: vd.id, data: { uid: vuid, identifiant: id, ancienUid: undefined } }];
  for (const col of ["produits", "ventes", "versements"]) for (const o of S.data[col]) if (o.vendeurId === vd.id) ops.push({ type: "modif", col, id: o.id, data: {} });
  db.appliquer(ops);
  return id;
};
/* Nouveau mot de passe pour un vendeur qui l'a perdu : un nouveau compte de connexion sous le même identifiant.
   Son lien, son identifiant, ses ventes et son stock ne changent pas ; l'ancien mot de passe ne marche plus. */
C.nouveauMotDePasse = async (vd, mdp, identifiant) => {
  const cfg = lireCfg(), id = slug(identifiant || vd.identifiant || vd.nom);
  const ref = fb.doc(fs, "identifiants", id);
  let fiche;
  try { fiche = await fb.getDoc(ref); }
  catch (e) { if (String((e && e.code) || "").includes("permission")) { const x = new Error("Les règles de sécurité dans Firebase doivent être mises à jour (version " + (typeof VERSION_REGLES !== "undefined" ? VERSION_REGLES : 15) + ") : Réglages → Synchronisation → Copier les règles."); x.code = "regles"; throw x; } throw e; }
  if (fiche.exists() && fiche.data().boutique !== C.boutique) { const x = new Error("Cet identifiant appartient à une autre boutique. Choisis-en un autre."); x.code = "pris"; throw x; }
  let n = Math.max(2, (+vd.versionAcces || 1) + 1), vuid = null, email = "";
  const app2 = fb.initializeApp(cfg.firebase, "mdp-" + Date.now());
  try {
    const auth2 = fb.initializeAuth(app2, { persistence: fb.inMemoryPersistence });
    for (let essai = 0; essai < 10 && !vuid; essai++, n++) {
      email = id + "." + n + "@" + DOMAINE_VENDEUR;
      try { vuid = (await fb.createUserWithEmailAndPassword(auth2, email, mdp)).user.uid; }
      catch (e) { if (!String(e.code || "").includes("email-already-in-use")) throw e; }
    }
    if (!vuid) throw new Error("Impossible de créer le nouvel accès. Réessaie.");
    n--;
    await fb.signOut(auth2);
  } finally { try { await fb.deleteApp(app2); } catch {} }
  await fb.setDoc(ref, { email, boutique: C.boutique, vendeurId: vd.id });
  const actions = [
    { chemin: "comptes/" + vuid, data: { role: "vendeur", boutique: C.boutique, vendeurId: vd.id } },
    { chemin: `boutiques/${C.boutique}/membres/${vuid}`, data: { vendeurId: vd.id, identifiant: id } }
  ];
  /* l'ancien compte n'est retiré que s'il était encore actif (après un retrait d'accès, ses fiches n'existent plus) */
  if (vd.uid && vd.uid !== vuid) actions.push({ chemin: "comptes/" + vd.uid, suppr: true }, { chemin: `boutiques/${C.boutique}/membres/${vd.uid}`, suppr: true });
  await envoyerOuEchouer(actions, 8);
  const ops = [{ type: "modif", col: "vendeurs", id: vd.id, data: { uid: vuid, identifiant: id, versionAcces: n, ancienUid: undefined } }];
  for (const col of ["produits", "ventes", "versements"]) for (const o of S.data[col]) if (o.vendeurId === vd.id) ops.push({ type: "modif", col, id: o.id, data: {} });
  db.appliquer(ops);
  return id;
};
C.retirerAccesVendeur = async (vd) => {
  if (!vd.uid) return;
  await envoyer([{ chemin: "comptes/" + vd.uid, suppr: true }, { chemin: `boutiques/${C.boutique}/membres/${vd.uid}`, suppr: true }]);
  /* On garde la trace de son compte : redonner l'accès plus tard ne demandera rien de plus */
  const ops = [{ type: "modif", col: "vendeurs", id: vd.id, data: { uid: undefined, ancienUid: vd.uid } }];
  for (const col of ["produits", "ventes", "versements"]) for (const o of S.data[col]) if (o.vendeurId === vd.id) ops.push({ type: "modif", col, id: o.id, data: {} });
  db.appliquer(ops);
};
/* Lien à envoyer au vendeur : il contient la configuration (non secrète) et son identifiant */
C.lienAcces = identifiant => {
  const cfg = lireCfg();
  if (window.CONFIG_FIREBASE && cfg && window.CONFIG_FIREBASE.projectId === cfg.firebase.projectId) return location.origin + location.pathname + "#" + slug(identifiant);
  const charge = btoa(unescape(encodeURIComponent(JSON.stringify({ f: cfg.firebase, i: identifiant })))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return location.origin + location.pathname + "#acces=" + charge;
};
