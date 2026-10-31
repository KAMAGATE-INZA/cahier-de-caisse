"use strict";
/* ================= Base de données locale (JSON sur l'appareil) ================= */
const KEY = "cahier-de-caisse:v1";
const PREFS = "cahier-de-caisse:prefs";
const FORMAT = 3;
const VERSION_APPLI = "12"; /* affichée dans Réglages : permet de vérifier que la mise à jour est arrivée */
const nouvelId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

function donneesInitiales() {
  return { format: FORMAT, cree: Date.now(), modifie: Date.now(), derniereSauvegarde: null,
    reglages: { boutique: "", numero: "", objectifMois: 0 },
    produits: [], vendeurs: [], ventes: [], depenses: [], versements: [], arrivages: [] };
}
function valide(d) { return d && Array.isArray(d.produits) && Array.isArray(d.ventes) && Array.isArray(d.depenses); }

/* Met à niveau les données d'une ancienne version sans rien perdre */
function normaliser(d) {
  d.reglages = Object.assign({ boutique: "", numero: "", objectifMois: 0 }, d.reglages || {});
  d.vendeurs = Array.isArray(d.vendeurs) ? d.vendeurs : [];
  d.versements = Array.isArray(d.versements) ? d.versements : [];
  d.arrivages = Array.isArray(d.arrivages) ? d.arrivages : [];
  for (const x of d.versements) if (x.confirme === undefined) x.confirme = true;
  for (const p of d.produits) {
    if (!p.mode) p.mode = "stock";
    if (p.seuil === undefined) p.seuil = 2;
    if (p.commission === undefined) p.commission = 0;
    if (!p.plateforme) p.plateforme = "moi";
    if (p.variante === undefined) p.variante = "";
    if (p.vendeurVoitCout === undefined) p.vendeurVoitCout = false;
    if (!p.categorie) p.categorie = p.mode === "numerique" ? "E-books" : (p.nom || "Divers");
    /* Avant : le vendeur était un simple nom sur le produit. Maintenant : une fiche vendeur. */
    if (p.mode === "depot" && !p.vendeurId) {
      const nom = (p.depositaire || "").trim() || "Mon vendeur";
      let vd = d.vendeurs.find(x => x.nom.toLowerCase() === nom.toLowerCase());
      if (!vd) { vd = { id: nouvelId(), nom, tel: "", mode: "fixe", pct: 50 }; d.vendeurs.push(vd); }
      p.vendeurId = vd.id;
    }
  }
  const parId = Object.fromEntries(d.produits.map(p => [p.id, p]));
  for (const v of d.ventes) {
    const p = parId[v.produitId];
    if (v.coutU === undefined) v.coutU = p ? coutVente(p, v.prix) : 0;
    if (v.tel === undefined) v.tel = "";
    /* Anciennes ventes en dépôt : ce qui était marqué « encaissé » devient un versement reçu */
    if (p && p.mode === "depot" && v.vendeurId === undefined) {
      v.vendeurId = p.vendeurId;
      if (v.encaisse) d.versements.push({ id: nouvelId(), vendeurId: p.vendeurId, montant: (+v.qte || 0) * (+v.prix || 0), date: v.date, note: "Repris de l'ancienne version", cree: Date.now() });
      v.encaisse = false;
    }
  }
  d.format = FORMAT;
  return d;
}
function charger() {
  try { const raw = localStorage.getItem(KEY); if (raw) { const d = JSON.parse(raw); if (valide(d)) return normaliser(d); } } catch {}
  return null;
}
function enregistrer() {
  if (S.role === "vendeur") return true; /* le vendeur n'a que sa partie, gardée par la synchro */
  S.data.modifie = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify(S.data)); return true; }
  catch { toast("Impossible d'enregistrer sur cet appareil. Fais une sauvegarde."); return false; }
}
/* Toutes les écritures passent par ici : l'appareil d'abord, puis le serveur si la synchro est active */
const db = {
  cloud: null,
  enAttente: [],
  appliquer(ops, sansRendu) {
    for (const o of ops) {
      const liste = S.data[o.col];
      if (o.type === "ajout") liste.push(o.data);
      else if (o.type === "modif") { const x = liste.find(y => y.id === o.id); if (x) for (const k in o.data) { if (o.data[k] === undefined) delete x[k]; else x[k] = o.data[k]; } }
      else if (o.type === "suppr") S.data[o.col] = liste.filter(y => y.id !== o.id);
    }
    enregistrer();
    if (this.cloud) this.cloud.ecrire(ops);
    else if (localStorage.getItem("cahier-de-caisse:cloud")) this.enAttente.push(...ops); /* synchro pas encore prête */
    if (!sansRendu) render();
  },
  ajouter(col, obj) { const o = { id: nouvelId(), ...obj }; this.appliquer([{ type: "ajout", col, id: o.id, data: o }]); return o; },
  modifier(col, id, patch) { this.appliquer([{ type: "modif", col, id, data: patch }]); },
  supprimer(col, id) { this.appliquer([{ type: "suppr", col, id }]); }
};
/* Actions des boutons, enrichies par les autres fichiers : ACTIONS["nom"] = (id, bouton) => … */
const ACTIONS = {};

/* Coût d'une pièce vendue : coût de revient (physique) ou commission + frais de la plateforme (numérique) */
function coutVente(p, prix) {
  if (p.mode !== "numerique") return +p.cout || 0;
  return (+p.frais || 0) + Math.round((+prix || 0) * (+p.commission || 0) / 100);
}
const estChariow = v => v.paiement === "Chariow";
const estDepot = v => !!v.vendeurId;

/* ================= Règles de reversement des vendeurs ================= */
const REGLES = {
  "cout+part": "Il te rend ton coût, puis vous partagez le bénéfice en %",
  "commission": "Il garde un montant fixe par pièce, le reste est pour toi",
  "part": "Il te donne un pourcentage du bénéfice (sans rembourser ton coût)",
  "fixe": "Il te donne un montant fixe par pièce"
};
const vendeursActifs = () => S.data.vendeurs.filter(v => !v.supprime);
/* Base du partage avec le vendeur : ton vrai coût s'il a le droit de le voir, sinon le prix de base que tu as fixé */
const basePartage = p => p.vendeurVoitCout ? (+p.cout || 0) : (+p.baseVendeur || +p.cout || 0);
/* Ce que le vendeur te doit pour UNE pièce vendue au prix prixClient */
function reverse(vd, p, prixClient) {
  if (!vd || vd.mode === "fixe") return +p.reverse || 0;
  const cout = basePartage(p), prix = +prixClient || 0, pct = (+vd.pct || 0) / 100;
  if (vd.mode === "commission") return Math.max(0, Math.round(prix - (+vd.montant || 0)));
  const benef = prix - cout;
  if (vd.mode === "part") return Math.max(0, Math.round(benef * pct));
  return Math.max(0, Math.round(cout + benef * pct));
}
function resumeRegle(vd) {
  const pct = +vd.pct || 0;
  if (vd.mode === "fixe") return "Montant fixe par pièce pour toi";
  if (vd.mode === "commission") return `Il garde ${F(vd.montant)} par pièce, le reste pour toi`;
  if (vd.mode === "part") return `Bénéfice : ${pct} % pour toi, ${100 - pct} % pour lui (ton coût n'est pas remboursé)`;
  return `Ton coût, puis bénéfice : ${pct} % pour toi, ${100 - pct} % pour lui`;
}
/* Ce que deviendrait le partage d'une vente : le bénéfice, ta part, sa part (les deux côtés) */
function partageCalc(vd, p, prixClient, qte, duTotal) {
  const q = +qte || 0, base = basePartage(p), benefice = ((+prixClient || 0) - base) * q;
  const rembourse = vd && vd.mode === "part" ? 0 : base * q;
  const du = duTotal === undefined ? reverse(vd, p, prixClient) * q : duTotal;
  return { benefice, rembourse, du, maPart: du - rembourse, saPart: benefice - (du - rembourse), garde: (+prixClient || 0) * q - du };
}
function partageVente(v) {
  const p = produitDe(v.produitId), vd = vendeurDe(v.vendeurId);
  if (!p || !v.prixClient) return null;
  return partageCalc(vd, p, v.prixClient, v.qte, totalVente(v));
}

/* ================= État & utilitaires ================= */
let prefs = { tab: "bilan", periode: "mois" };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS) || "{}")); } catch {}
if (prefs.tab === "clients") prefs.tab = "ventes";
const PAGE = 30;
const S = { data: charger() || donneesInitiales(), role: "proprio", tab: prefs.tab, periode: prefs.periode, vue: "ventes",
  q: "", qc: "", ouvert: null, limV: PAGE, limC: PAGE, limD: PAGE, tousProduits: false };
function garderPrefs() { try { localStorage.setItem(PREFS, JSON.stringify({ tab: S.tab, periode: S.periode })); } catch {} }
let stockageOK = true;
try { localStorage.setItem(KEY + ":test", "1"); localStorage.removeItem(KEY + ":test"); } catch { stockageOK = false; }
if (stockageOK) enregistrer();
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

const $ = s => document.querySelector(s);
const fmt = new Intl.NumberFormat("fr-FR");
const N = n => fmt.format(Math.round(n || 0));
const F = n => N(n) + " F";
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const isoDe = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0,10); };
const todayISO = () => isoDe(new Date());
const dateDe = iso => new Date(iso + "T12:00:00");
const dayLabel = iso => { try { return dateDe(iso).toLocaleDateString("fr-FR",{weekday:"short",day:"numeric",month:"short"}); } catch { return iso; } };
const dateCourte = iso => dateDe(iso).toLocaleDateString("fr-FR");
const joursDepuis = t => t ? Math.floor((Date.now() - t) / 86400000) : null;
const norm = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const produitDe = id => S.data.produits.find(p => p.id === id);
const vendeurDe = id => S.data.vendeurs.find(v => v.id === id);
const nomComplet = p => p ? p.nom + (p.variante ? " — " + p.variante : "") : "Produit supprimé";
const nomProduit = id => nomComplet(produitDe(id));
/* Pour une vente en dépôt, « prix » = ce que le vendeur te doit par pièce (ton revenu) */
const totalVente = v => (+v.qte || 0) * (+v.prix || 0);
const fraisLivraison = v => v.livraison ? (+v.livraison.frais || 0) : 0;
const coutTotalVente = v => (+v.qte || 0) * (+v.coutU || 0) + fraisLivraison(v);
const beneficeVente = v => totalVente(v) - coutTotalVente(v);
const plur = (n, s, p) => n + " " + (n > 1 ? (p || s + "s") : s);

/* Numéro WhatsApp : 07 07 12 34 56 → 2250707123456 (Côte d'Ivoire par défaut) */
function numeroWa(tel) {
  let d = String(tel || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10) d = "225" + d;
  return d.length >= 11 ? d : "";
}
const lienWa = (tel, texte) => "https://wa.me/" + numeroWa(tel) + "?text=" + encodeURIComponent(texte);

/* ================= Périodes ================= */
const PERIODES = { "7j": "7 jours", "mois": "Ce mois", "mois-1": "Mois dernier", "tout": "Tout" };
function bornes(periode) {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth();
  if (periode === "7j") { const d = new Date(now); d.setDate(d.getDate() - 6); return [isoDe(d), todayISO()]; }
  if (periode === "mois") return [isoDe(new Date(y, m, 1)), todayISO()];
  if (periode === "mois-1") return [isoDe(new Date(y, m - 1, 1)), isoDe(new Date(y, m, 0))];
  return ["0000-00-00", "9999-99-99"];
}
function nomPeriode(periode) {
  const now = new Date();
  if (periode === "mois") return now.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  if (periode === "mois-1") return new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  if (periode === "7j") return "7 derniers jours";
  return "depuis le début";
}
const dansPeriode = (iso, [a, b]) => iso >= a && iso <= b;
function segPeriode() {
  return `<div class="seg" role="group" aria-label="Période">${Object.entries(PERIODES).map(([k, l]) =>
    `<button data-periode="${k}" aria-pressed="${k === S.periode}">${l}</button>`).join("")}</div>`;
}
/* Affichage par paquets : on montre 30 lignes, puis « Afficher plus » */
function boutonPlus(quoi, reste, nom) {
  return reste > 0 ? `<button class="btn sec" data-act="plus" data-quoi="${quoi}">Afficher ${Math.min(PAGE, reste)} de plus <span class="note">(encore ${reste} ${nom})</span></button>` : "";
}

/* ================= Calculs ================= */
function stats(periode) {
  const bp = bornes(periode);
  const byProd = {};
  for (const p of S.data.produits) byProd[p.id] = { p, vendusTotal: 0, vendus: 0, ca: 0, benef: 0 };
  let ca = 0, cout = 0, aRecevoirClients = 0, aRecevoirChariow = 0, nbVentes = 0;
  for (const v of S.data.ventes) {
    const q = +v.qte || 0, total = totalVente(v), c = coutTotalVente(v);
    const b = byProd[v.produitId];
    if (b) b.vendusTotal += q;
    if (!v.encaisse && !estDepot(v)) { if (estChariow(v)) aRecevoirChariow += total - c; else aRecevoirClients += total; }
    if (!dansPeriode(v.date, bp)) continue;
    ca += total; cout += c; nbVentes++;
    if (b) { b.vendus += q; b.ca += total; b.benef += total - c; }
  }
  const deps = S.data.depenses.filter(d => dansPeriode(d.date, bp));
  const dep = deps.reduce((s, d) => s + (+d.montant || 0), 0);
  let valeurStock = 0, piecesStock = 0, valeurChezVendeurs = 0;
  for (const id in byProd) {
    const b = byProd[id];
    if (b.p.mode === "numerique") { b.restant = Infinity; b.valeur = 0; continue; }
    b.restant = Math.max(0, (+b.p.quantite || 0) - b.vendusTotal);
    b.valeur = b.restant * (+b.p.cout || 0);
    valeurStock += b.valeur; piecesStock += b.restant;
    if (b.p.mode === "depot") valeurChezVendeurs += b.valeur;
  }
  const aRecevoirVendeurs = vendeursActifs().reduce((s, vd) => s + Math.max(0, compteVendeur(vd, "tout").solde), 0);
  return { bp, byProd, ca, cout, dep, nbVentes, nbDep: deps.length, net: ca - cout - dep,
    aRecevoir: aRecevoirClients + aRecevoirChariow + aRecevoirVendeurs, aRecevoirChariow, aRecevoirVendeurs,
    valeurStock, piecesStock, valeurChezVendeurs };
}

/* Compte d'un vendeur : ce qu'il doit, ce qu'il a versé, sur une période et au total */
function compteVendeur(vd, periode) {
  const bp = bornes(periode);
  let du = 0, duP = 0, piecesP = 0, caClientP = 0, benefP = 0, gainP = 0, verse = 0, verseP = 0, nbVersP = 0;
  for (const v of S.data.ventes) {
    if (v.vendeurId !== vd.id) continue;
    const t = totalVente(v); du += t;
    if (dansPeriode(v.date, bp)) { duP += t; piecesP += +v.qte || 0; caClientP += (+v.qte || 0) * (+v.prixClient || 0); benefP += beneficeVente(v); if (v.prixClient) gainP += (+v.qte || 0) * (+v.prixClient) - t; }
  }
  let aConfirmer = 0;
  for (const x of S.data.versements) {
    if (x.vendeurId !== vd.id) continue;
    if (x.confirme === false) { aConfirmer += +x.montant || 0; continue; }
    verse += +x.montant || 0;
    if (dansPeriode(x.date, bp)) { verseP += +x.montant || 0; nbVersP++; }
  }
  let piecesChezLui = 0, valeurChezLui = 0;
  const vendus = {};
  for (const v of S.data.ventes) vendus[v.produitId] = (vendus[v.produitId] || 0) + (+v.qte || 0);
  for (const p of S.data.produits) if (p.mode === "depot" && p.vendeurId === vd.id) {
    const r = Math.max(0, (+p.quantite || 0) - (vendus[p.id] || 0));
    piecesChezLui += r; valeurChezLui += r * (+p.cout || 0);
  }
  return { du, duP, piecesP, caClientP, benefP, gainP, verse, verseP, nbVersP, solde: du - verse, piecesChezLui, valeurChezLui, aConfirmer };
}

