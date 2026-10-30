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
       depenses, arrivages, photos       propriétaire uniquement
   Les règles de sécurité (firestore.rules) font respecter ces accès côté serveur.
   ===================================================================== */
import * as fb from "./firebase-sdk.js";

const CFG_KEY = "cahier-de-caisse:cloud";
const DOMAINE_VENDEUR = "vendeur.example.com"; /* adresse technique : les vendeurs se connectent avec un simple identifiant */
const COLS = ["produits", "vendeurs", "ventes", "depenses", "versements", "arrivages"];
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
  if (compte && compte.role === "vendeur") {
    C.role = "vendeur"; C.boutique = compte.boutique; C.vendeurId = compte.vendeurId;
  } else {
    C.role = "proprio"; C.boutique = u.uid; C.vendeurId = null;
    if (!compte && !horsLigne) await fb.setDoc(fb.doc(fs, "comptes", u.uid), { role: "proprio", boutique: u.uid });
  }
  cfg.session = { uid: u.uid, role: C.role, boutique: C.boutique, vendeurId: C.vendeurId, email: u.email };
  ecrireCfg(cfg);
  if (C.role === "proprio") { if (!horsLigne) await preparerBoutique(cfg); abonnerProprio(); }
  else abonnerVendeur();
  C.etat = "actif"; prevenir();
  if (typeof window.surSession === "function") window.surSession(C.role);
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
  if (col === "vendeurs") { o.boutique = { nom: S.data.reglages.boutique || "", numero: S.data.reglages.numero || "" }; return [o, null]; }
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
    const ph = Object.entries(PHOTOS).map(([id, url]) => ({ chemin: chemin("photos") + "/" + id, data: { data: url } }));
    for (let i = 0; i < ph.length; i += 40) await envoyer(ph.slice(i, i + 40));
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
      for (const col of ["vendeurs", "depenses", "versements", "arrivages"]) S.data[col] = [...maps[col].values()];
      normaliser(S.data);
      enregistrer();
      render();
      figerCoutsVentesVendeur(maps);
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
      const url = ch.type === "removed" ? null : ch.doc.data().data;
      if (PHOTOS[ch.doc.id] !== (url || undefined)) { definirPhoto(ch.doc.id, url, true); change = true; }
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
    photo(id, url) { envoyer([url ? { chemin: chemin("photos") + "/" + id, data: { data: url } } : { chemin: chemin("photos") + "/" + id, suppr: true }]); },
    reglages(r) {
      envoyer([{ chemin: "boutiques/" + C.boutique, data: { reglages: propre(r), cree: Date.now() } }]);
      /* le nom et le numéro de la boutique apparaissent chez les vendeurs */
      envoyer(S.data.vendeurs.flatMap(vd => actionsPour("vendeurs", vd)));
    },
    async remplacerTout(data) { await viderEnLigne(); await televerserTout(data, true); }
  };
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
  const maj = () => { clearTimeout(maj.t); maj.t = setTimeout(render, 60); };
  desabos.push(fb.onSnapshot(fb.doc(fs, chemin("vendeurs") + "/" + C.vendeurId), s => {
    if (s.exists()) {
      const vd = { ...s.data(), id: s.id };
      S.data.vendeurs = [vd];
      if (vd.boutique) S.data.reglages = Object.assign({}, S.data.reglages, { boutique: vd.boutique.nom || "", numero: vd.boutique.numero || "" });
    } else S.data.vendeurs = [];
    maj();
  }, e => { C.erreur = messageErreur(e); prevenir(); }));
  const ecouter = (col, transformer) => desabos.push(fb.onSnapshot(fb.query(fb.collection(fs, chemin(col)), fb.where("vendeurUid", "==", u)), snap => {
    S.data[col] = snap.docs.map(d => transformer({ ...d.data(), id: d.id }));
    if (col === "produits") chargerPhotosVendeur();
    maj();
  }, e => { C.erreur = messageErreur(e); prevenir(); }));
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
}
const _photosDemandees = new Set();
async function chargerPhotosVendeur() {
  for (const p of S.data.produits) {
    if (_photosDemandees.has(p.id)) continue;
    _photosDemandees.add(p.id);
    try { const s = await fb.getDoc(fb.doc(fs, chemin("photos") + "/" + p.id)); if (s.exists()) { PHOTOS[p.id] = s.data().data; render(); } } catch {}
  }
}

/* ================= Comptes ================= */
C.connecter = (identifiant, mdp) => fb.signInWithEmailAndPassword(auth, C.emailDe(identifiant), mdp);
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
C.creerAccesVendeur = async (vd, identifiant, mdp) => {
  const cfg = lireCfg();
  const app2 = fb.initializeApp(cfg.firebase, "creation-" + Date.now());
  let vuid;
  try {
    const auth2 = fb.initializeAuth(app2, { persistence: fb.inMemoryPersistence });
    const cred = await fb.createUserWithEmailAndPassword(auth2, C.emailDe(identifiant), mdp);
    vuid = cred.user.uid;
    await fb.signOut(auth2);
  } finally { try { await fb.deleteApp(app2); } catch {} }
  const id = slug(identifiant);
  await envoyer([
    { chemin: "comptes/" + vuid, data: { role: "vendeur", boutique: C.boutique, vendeurId: vd.id } },
    { chemin: `boutiques/${C.boutique}/membres/${vuid}`, data: { vendeurId: vd.id, identifiant: id } }
  ]);
  /* Le vendeur reçoit son identifiant, puis on marque toute sa partie à son nom */
  const ops = [{ type: "modif", col: "vendeurs", id: vd.id, data: { uid: vuid, identifiant: id } }];
  for (const col of ["produits", "ventes", "versements"]) for (const o of S.data[col]) if (o.vendeurId === vd.id) ops.push({ type: "modif", col, id: o.id, data: {} });
  db.appliquer(ops);
  return id;
};
C.retirerAccesVendeur = async (vd) => {
  if (!vd.uid) return;
  await envoyer([{ chemin: "comptes/" + vd.uid, suppr: true }, { chemin: `boutiques/${C.boutique}/membres/${vd.uid}`, suppr: true }]);
  const ops = [{ type: "modif", col: "vendeurs", id: vd.id, data: { uid: undefined } }];
  for (const col of ["produits", "ventes", "versements"]) for (const o of S.data[col]) if (o.vendeurId === vd.id) ops.push({ type: "modif", col, id: o.id, data: {} });
  db.appliquer(ops);
};
/* Lien à envoyer au vendeur : il contient la configuration (non secrète) et son identifiant */
C.lienAcces = identifiant => {
  const cfg = lireCfg();
  const charge = btoa(unescape(encodeURIComponent(JSON.stringify({ f: cfg.firebase, i: identifiant })))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return location.origin + location.pathname + "#acces=" + charge;
};
