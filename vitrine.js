"use strict";
/* =====================================================================
   Boutique en ligne : une page publique (boutique.html) où tes clients
   voient tes produits et commandent sur WhatsApp. Elle est alimentée par
   ton stock : prix, photos, descriptions, disponibilité, promos.
   Ce qui n'est JAMAIS publié : coûts d'achat, quantités exactes, ventes,
   vendeurs, clients, dépenses.
   ===================================================================== */

const VITRINE_DEF = { active: false, nom: "", whatsapp: "", accueil: "", theme: "emeraude", epuises: false };
const reglagesVitrine = () => Object.assign({}, VITRINE_DEF, S.data.reglages.vitrine || {});
const ETAT_VITRINE = "cahier-de-caisse:vitrine-etat";
const lireEtatVitrine = () => { try { return JSON.parse(localStorage.getItem(ETAT_VITRINE) || "{}"); } catch { return {}; } };
const ecrireEtatVitrine = e => { try { localStorage.setItem(ETAT_VITRINE, JSON.stringify(e)); } catch {} };
const slugTexte = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const cloudActifProprio = () => typeof Cloud !== "undefined" && Cloud.etat === "actif" && Cloud.role === "proprio" && !!Cloud.publierVitrine;

/* Adresse de la page publique. Si config.js n'est pas encore publié sur GitHub,
   le lien porte lui-même l'adresse du projet Firebase (non secrète). */
function lienVitrine(v) {
  v = v || reglagesVitrine();
  const base = location.origin + location.pathname.replace(/[^/]*$/, "") + "boutique.html";
  const cfg = typeof Cloud !== "undefined" && Cloud.configActuelle ? Cloud.configActuelle() : null;
  const publiee = window.CONFIG_FIREBASE && cfg && window.CONFIG_FIREBASE.projectId === cfg.projectId;
  const q = !publiee && cfg ? "?projet=" + encodeURIComponent(cfg.projectId) + "&cle=" + encodeURIComponent(cfg.apiKey) : "";
  return base + q + "#" + v.nom;
}
const configPubliee = () => { const cfg = typeof Cloud !== "undefined" && Cloud.configActuelle ? Cloud.configActuelle() : null; return !!(window.CONFIG_FIREBASE && cfg && window.CONFIG_FIREBASE.projectId === cfg.projectId); };

/* Petite photo pour la liste des produits (rapide à charger sur un téléphone) */
const _petites = new Map();
async function photoReduite(dataUrl, cote = 420, qualite = 0.72) {
  if (_petites.has(dataUrl)) return _petites.get(dataUrl);
  const img = await chargerImage(dataUrl); if (!img) return "";
  const k = Math.min(1, cote / Math.max(img.width, img.height));
  const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  const x = c.getContext("2d"); x.fillStyle = "#ffffff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
  const r = c.toDataURL("image/jpeg", qualite); _petites.set(dataUrl, r); return r;
}

/* Ce que voit le client : un article par produit (les variantes regroupées) */
async function contenuVitrine() {
  const v = reglagesVitrine(), r = S.data.reglages, st = stats("tout");
  const produits = S.data.produits.filter(p => !p.horsBoutique && +p.prixVente > 0);
  const groupes = regrouperProduits(produits, st);
  const articles = [], images = {}, pris = new Set();
  for (const g of groupes) {
    const variantes = g.items.map(p => ({
      nom: p.variante || "", prix: +p.prixVente || 0, avant: +p.prixAvant > +p.prixVente ? +p.prixAvant : 0,
      dispo: p.mode === "numerique" || !!(st.byProd[p.id] && st.byProd[p.id].restant > 0)
    }));
    const dispo = variantes.some(x => x.dispo);
    if (!dispo && !v.epuises) continue;
    let id = slugTexte(g.nom) || "article";
    if (pris.has(id)) id = slugTexte(g.categorie + " " + g.nom) || id;
    for (let i = 2; pris.has(id); i++) id = (slugTexte(g.nom) || "article") + "-" + i;
    pris.add(id);
    const photos = g.photos.slice(0, MAX_PHOTOS);
    const lien = g.numerique && /^https:\/\//i.test(g.lien) ? g.lien : "";
    const plusRecent = Math.max(0, ...g.items.map(p => +p.cree || 0));
    articles.push({
      id, nom: g.nom, categorie: g.categorie, description: (g.description || "").slice(0, 400),
      variantes, prixMin: g.prixMin, prixMax: g.prixMax, remise: g.remise >= 5 ? g.remise : 0,
      nouveau: g.nouveau, peu: !g.numerique && g.restant > 0 && g.restant <= 2, epuise: !dispo,
      numerique: g.numerique, lien, vignette: photos[0] ? await photoReduite(photos[0]) : "", nbPhotos: photos.length,
      recent: plusRecent
    });
    if (photos.length) images[id] = photos;
  }
  /* ordre : disponibles d'abord, puis les plus récents */
  articles.sort((a, b) => (a.epuise - b.epuise) || (b.recent - a.recent) || a.nom.localeCompare(b.nom));
  articles.forEach((a, i) => { a.ordre = i; delete a.recent; });
  const racine = {
    nom: r.boutique || "Ma boutique", logo: /^data:image\//.test(r.logo || "") ? r.logo : "", whatsapp: numeroWa(v.whatsapp || r.numero), accueil: (v.accueil || "").slice(0, 300),
    theme: THEMES[v.theme] ? v.theme : "emeraude", couleur: (THEMES[v.theme] || THEMES.emeraude).fonce,
    categories: [...new Set(articles.map(a => a.categorie))]
  };
  return { racine, articles, images };
}

/* Publication automatique : quelques secondes après chaque changement */
let _minuteurVitrine = null, _publication = null;
function planifierVitrine(delai) {
  const v = reglagesVitrine();
  if (!v.active || !v.nom || S.role !== "proprio" || S.apercu || !cloudActifProprio()) return;
  clearTimeout(_minuteurVitrine);
  _minuteurVitrine = setTimeout(() => publierVitrine().catch(() => {}), delai === undefined ? 4000 : delai);
}
async function publierVitrine(ancien) {
  if (_publication) { await _publication.catch(() => {}); }
  const v = reglagesVitrine();
  if (!v.active || !v.nom || !cloudActifProprio()) return null;
  _publication = (async () => {
    const etat = lireEtatVitrine();
    majFeuilleVitrine();
    const essayer = async () => { const c = await contenuVitrine(); return Cloud.publierVitrine({ nom: v.nom, ancien, ...c }); };
    try {
      let res;
      try { res = await essayer(); }
      catch (e) {
        /* Refus du serveur : on cherche la cause, et on répare ce qui peut l'être */
        if (!String((e && e.code) || "").includes("permission-denied")) throw e;
        const diag = await Cloud.diagnostiquerRegles();
        if (diag === "compte-repare") res = await essayer();
        else throw Object.assign(new Error(diag), { code: "permission-denied", diag });
      }
      ecrireEtatVitrine({ maj: Date.now(), nb: res.nb, erreur: "", nom: v.nom });
      return res;
    } catch (e) {
      const code = String((e && e.code) || "");
      const msg = e.diag === "anciennes" ? "Les règles de sécurité publiées dans Firebase sont une ancienne version, sans la boutique. Touche « Copier les règles (version " + VERSION_REGLES + ") » ci-dessous, puis colle-les dans Firebase à la place des anciennes et publie."
        : code.includes("permission-denied") ? "Le serveur refuse la publication alors que les règles semblent à jour. Recopie les règles (version " + VERSION_REGLES + ") dans Firebase, attends une minute, puis réessaie."
        : code === "vitrine-prise" ? e.message
        : code.includes("unavailable") || !navigator.onLine ? "Pas de connexion : la boutique sera mise à jour au retour du réseau."
        : (typeof Cloud !== "undefined" && Cloud.messageErreur ? Cloud.messageErreur(e) : String(e));
      ecrireEtatVitrine(Object.assign(etat, { erreur: msg, regles: e.diag === "anciennes" || code.includes("permission-denied") }));
      throw Object.assign(new Error(msg), { code });
    }
  })();
  const p = _publication;
  try { return await p; } finally { if (_publication === p) _publication = null; majFeuilleVitrine(); }
}
window.addEventListener("online", () => planifierVitrine(1500));

function sauverReglagesVitrine(v) {
  S.data.reglages = Object.assign({}, S.data.reglages, { vitrine: v });
  enregistrer();
  if (db.cloud && db.cloud.reglages) db.cloud.reglages(S.data.reglages);
}

/* ---------- Feuille « Boutique en ligne » ---------- */
function texteInvitationBoutique() {
  const r = S.data.reglages;
  return `Bonjour ! Voici ma boutique en ligne${r.boutique ? " " + r.boutique : ""} : tous mes articles avec les photos et les prix. Tu choisis, tu commandes sur WhatsApp en un clic.\n\n${lienVitrine()}`;
}
let _dessinerPartage = null;
function majFeuilleVitrine() {
  const el = document.getElementById("vt-etat"); if (!el) return;
  el.innerHTML = htmlEtatVitrine();
  if (_dessinerPartage && document.getElementById("vt-partage")) _dessinerPartage();
}
function htmlEtatVitrine() {
  const v = reglagesVitrine(), e = lireEtatVitrine();
  if (!v.active) return `<div class="note">La boutique n'est pas en ligne.</div>`;
  if (_publication) return `<div class="note">Mise à jour en cours…</div>`;
  if (e.erreur) return `<div class="banner red"><span>${esc(e.erreur)}</span>${e.regles ? `<button type="button" class="mini" data-act="voir-regles">Copier les règles (version ${VERSION_REGLES})</button>` : ""}</div>`;
  if (e.maj && e.nom === v.nom) return `<div class="note num">En ligne · ${plur(e.nb || 0, "article")} · mise à jour ${new Date(e.maj).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}. Elle suit ton stock toute seule.</div>`;
  return `<div class="note">Pas encore publiée sur cet appareil.</div>`;
}
function vitrineSheet() {
  const v = reglagesVitrine(), r = S.data.reglages;
  const enLigne = cloudActifProprio();
  if (!enLigne) {
    openSheet(`<div class="inner"><h2>Boutique en ligne</h2>
      <p>Ta boutique en ligne est une page web publique : tes clients y voient tes produits avec les photos, les prix et les descriptions, et ils commandent sur WhatsApp en un clic.</p>
      <p class="note">Elle a besoin de la <b>synchronisation en ligne</b> (c'est elle qui publie la page). ${typeof Cloud !== "undefined" && Cloud.etat && Cloud.etat !== "actif" && typeof cfgCloud === "function" && cfgCloud() ? "La synchro est en cours de connexion : réessaie dans un instant." : "Active-la dans les Réglages, puis reviens ici."}</p>
      <div class="btns"><button class="btn sec" data-close>Fermer</button><button class="btn pri" data-act="reglages">Ouvrir les Réglages</button></div></div>`);
    return;
  }
  const nomParDefaut = v.nom || slugTexte(r.boutique) || "ma-boutique";
  const st = stats("tout"), groupes = regrouperProduits(S.data.produits.filter(p => !p.horsBoutique && +p.prixVente > 0), st);
  const dispo = g => g.items.some(p => p.mode === "numerique" || (st.byProd[p.id] && st.byProd[p.id].restant > 0));
  const visibles = groupes.filter(g => v.epuises || dispo(g)).length, epuises = groupes.filter(g => !dispo(g)).length;
  const sansPrix = S.data.produits.filter(p => !p.horsBoutique && !(+p.prixVente)).length;
  const caches = S.data.produits.filter(p => p.horsBoutique).length;
  const sansPhoto = S.data.produits.filter(p => !p.horsBoutique && +p.prixVente > 0 && !PHOTOS[p.id]).length;
  const form = openSheet(`<form><h2>Boutique en ligne</h2>
    <p class="note">Une page publique où tes clients voient tes produits et commandent sur WhatsApp. Elle se met à jour toute seule quand tu modifies ton stock. Tes coûts, tes quantités exactes, tes ventes et tes vendeurs ne sont jamais montrés.</p>
    <label class="check"><input id="vt-actif" name="active" type="checkbox" ${v.active ? "checked" : ""}> <b>Ma boutique est en ligne</b></label>
    <div id="vt-etat">${htmlEtatVitrine()}</div>
    <div class="field"><label for="vt-nom">Adresse de ta boutique</label>
      <div style="display:flex;align-items:center;gap:6px"><span class="note" style="white-space:nowrap">boutique.html#</span><input id="vt-nom" name="nom" type="text" autocapitalize="none" autocomplete="off" spellcheck="false" maxlength="40" value="${esc(nomParDefaut)}" required></div>
      <div class="hint">Lettres, chiffres et tirets. Exemple : kama-shoes.</div></div>
    <div class="field"><label for="vt-wa">Numéro WhatsApp qui reçoit les commandes</label><input id="vt-wa" name="whatsapp" type="tel" inputmode="tel" placeholder="07 00 00 00 00" value="${esc(v.whatsapp || r.numero || "")}" required></div>
    <div class="field"><label for="vt-acc">Message d'accueil (facultatif)</label><textarea id="vt-acc" name="accueil" rows="2" maxlength="300" placeholder="Ex. Livraison partout à Abidjan en 24 h · Paiement Wave, Orange Money ou à la livraison">${esc(v.accueil || "")}</textarea></div>
    <div class="field"><label>Couleur</label><div class="nuancier">${Object.entries(THEMES).map(([k, t]) => `<label title="${esc(t.nom)}"><input type="radio" name="theme" value="${k}" ${k === (v.theme || "emeraude") ? "checked" : ""}><span style="background:${t.fonce}"></span></label>`).join("")}</div></div>
    <label class="check"><input name="epuises" type="checkbox" ${v.epuises ? "checked" : ""}> Montrer aussi les produits épuisés (marqués « Épuisé »)</label>
    <div class="box note num">${plur(visibles, "article")} ${visibles > 1 ? "seront montrés" : "sera montré"} (les variantes d'un produit sont regroupées)${epuises && !v.epuises ? ` · ${plur(epuises, "épuisé")} non montré${epuises > 1 ? "s" : ""}` : ""}${caches ? ` · ${plur(caches, "produit caché", "produits cachés")} (case décochée dans sa fiche)` : ""}${sansPrix ? ` · ${plur(sansPrix, "produit")} sans prix de vente, donc non montré${sansPrix > 1 ? "s" : ""}` : ""}${sansPhoto ? `<br>${plur(sansPhoto, "produit")} sans photo : ajoute-en une pour mieux vendre.` : ""}</div>
    ${configPubliee() ? "" : `<p class="hint">Pour un lien plus court, publie ton fichier config.js sur GitHub (Réglages → Synchronisation → Liens courts). Sans lui, le lien marche aussi, il est juste plus long.</p>`}
    <div class="err"></div>
    <div class="btns"><button type="button" class="btn sec" data-close>Fermer</button><button type="submit" class="btn pri">Enregistrer et publier</button></div>
    <div id="vt-partage"></div>
    </form>`, null);
  const dessinerPartage = () => {
    const w = reglagesVitrine(), el = $("#vt-partage");
    if (!w.active || !w.nom) { el.innerHTML = ""; return; }
    const lien = lienVitrine(w), e = lireEtatVitrine(), publiee = e.maj && e.nom === w.nom && !e.erreur;
    if (!publiee) { el.innerHTML = `<div class="banner red" style="margin-top:12px"><span><b>Ne partage pas encore le lien :</b> la boutique n'est pas publiée${e.erreur ? " (voir le message ci-dessus)" : ""}. Tes clients verraient une page d'erreur.</span></div>`; return; }
    el.innerHTML = `<div class="box" style="margin-top:12px"><div class="label">Ton lien</div><div style="word-break:break-all"><a href="${esc(lien)}" target="_blank" rel="noopener">${esc(lien)}</a></div>
      <div class="btns" style="flex-wrap:wrap;margin-top:8px"><button type="button" class="mini" id="vt-copier">Copier le lien</button><a class="mini wa" href="https://wa.me/?text=${encodeURIComponent(texteInvitationBoutique())}" target="_blank" rel="noopener">Partager sur WhatsApp</a><a class="mini" href="${esc(lien)}" target="_blank" rel="noopener">Voir la boutique</a></div>
      <p class="hint">Mets ce lien dans ta bio WhatsApp, ton statut, ta page Facebook ou TikTok.</p></div>`;
    $("#vt-copier").addEventListener("click", () => navigator.clipboard.writeText(lien).then(() => toast("Lien copié"), () => toast("Copie impossible")));
  };
  dessinerPartage(); _dessinerPartage = dessinerPartage;
  form.nom.addEventListener("input", () => { const p = form.nom.selectionStart, s = form.nom.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"); if (s !== form.nom.value) { form.nom.value = s; try { form.nom.setSelectionRange(p, p); } catch {} } });
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const err = form.querySelector(".err"); err.textContent = "";
    const fd = new FormData(form), avant = reglagesVitrine();
    const nom = slugTexte(fd.get("nom"));
    if (nom.length < 3) { err.textContent = "Choisis une adresse d'au moins 3 lettres."; return; }
    if (!numeroWa(fd.get("whatsapp"))) { err.textContent = "Mets un numéro WhatsApp valide (10 chiffres, ou avec l'indicatif)."; return; }
    const nv = { active: fd.get("active") === "on", nom, whatsapp: (fd.get("whatsapp") || "").trim(), accueil: (fd.get("accueil") || "").trim(), theme: fd.get("theme") || "emeraude", epuises: fd.get("epuises") === "on" };
    const bouton = form.querySelector("button[type=submit]"); bouton.disabled = true; bouton.textContent = "Publication…";
    try {
      if (nv.active && nom !== avant.nom && !(await Cloud.nomVitrineLibre(nom).catch(() => true))) throw new Error("Cette adresse est déjà prise par une autre boutique. Choisis-en une autre.");
      sauverReglagesVitrine(nv);
      if (nv.active) {
        majFeuilleVitrine();
        const res = await publierVitrine(avant.active && avant.nom !== nom ? avant.nom : undefined);
        toast(res ? `Boutique en ligne : ${plur(res.nb, "article")}` : "Boutique enregistrée");
      } else if (avant.active && avant.nom) {
        await Cloud.retirerVitrine(avant.nom); ecrireEtatVitrine({}); toast("Boutique retirée d'internet");
      } else toast("Enregistré");
      form.nom.value = nom;
    } catch (x) { if ((lireEtatVitrine().erreur || "") !== x.message) err.textContent = x.message || String(x); } /* déjà affiché dans l'état de la boutique */
    bouton.disabled = false; bouton.textContent = "Enregistrer et publier";
    majFeuilleVitrine(); dessinerPartage();
  });
}
ACTIONS["vitrine"] = () => vitrineSheet();
