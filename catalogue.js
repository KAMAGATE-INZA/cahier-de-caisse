"use strict";
/* =====================================================================
   Catalogue à partager : images (grille ou fiche produit), texte WhatsApp,
   et partage d'un seul produit. Les variantes d'un même produit sont
   regroupées (« Disponible en : Blanche 42, Noire 41 »).
   ===================================================================== */

const THEMES = {
  emeraude: { nom: "Émeraude", fonce: "#0d6b57", clair: "#dcefe8", fond: "#f3f5f1" },
  nuit:     { nom: "Nuit",     fonce: "#15211d", clair: "#e4e9e5", fond: "#f2f3f1" },
  bordeaux: { nom: "Bordeaux", fonce: "#7a1f2b", clair: "#f6e3e5", fond: "#faf5f4" },
  ocean:    { nom: "Océan",    fonce: "#1d4e89", clair: "#e1ebf6", fond: "#f4f7fb" },
  or:       { nom: "Or",       fonce: "#7a5c12", clair: "#f6eedb", fond: "#fbf8f1" }
};
const FORMATS = { statut: { W: 1080, H: 1920, nom: "Statut WhatsApp (vertical)" }, carre: { W: 1080, H: 1080, nom: "Publication (carré)" } };
const PREFS_CATALOGUE = "cahier-de-caisse:catalogue";
const prefsCatalogue = () => { try { return Object.assign({ theme: "emeraude", format: "statut", presentation: "fiche" }, JSON.parse(localStorage.getItem(PREFS_CATALOGUE) || "{}")); } catch { return { theme: "emeraude", format: "statut", presentation: "fiche" }; } };

/* ---------- Regrouper les variantes d'un même produit ---------- */
function regrouperProduits(produits, st) {
  const groupes = new Map();
  for (const p of produits) {
    const cle = norm(p.categorie || "Divers") + "|" + norm(p.nom);
    if (!groupes.has(cle)) groupes.set(cle, { nom: p.nom, categorie: p.categorie || "Divers", items: [] });
    groupes.get(cle).items.push(p);
  }
  const quinze = Date.now() - 14 * 86400000;
  return [...groupes.values()].map(g => {
    const items = g.items.sort((a, b) => (a.variante || "").localeCompare(b.variante || ""));
    const prix = items.map(p => +p.prixVente || 0).filter(Boolean);
    const restant = items.reduce((s, p) => s + (p.mode === "numerique" ? Infinity : (st.byProd[p.id] ? st.byProd[p.id].restant : 0)), 0);
    const photos = [];
    for (const p of items) for (const ph of photosDe(p.id)) if (photos.length < MAX_PHOTOS && !photos.includes(ph)) photos.push(ph);
    const avant = items.map(p => ({ a: +p.prixAvant || 0, v: +p.prixVente || 0 })).filter(x => x.a > x.v && x.v);
    return {
      ...g, items, photos,
      variantes: items.map(p => p.variante).filter(Boolean),
      prixMin: prix.length ? Math.min(...prix) : 0, prixMax: prix.length ? Math.max(...prix) : 0,
      prixAvant: avant.length === 1 && items.length === 1 ? avant[0].a : 0,
      remise: avant.length ? Math.max(...avant.map(x => Math.round((1 - x.v / x.a) * 100))) : 0,
      description: (items.find(p => (p.description || "").trim()) || {}).description || "",
      restant, numerique: items.every(p => p.mode === "numerique"),
      nouveau: items.some(p => +p.cree > quinze),
      lien: (items.find(p => p.lien) || {}).lien || ""
    };
  });
}
const textePrix = g => !g.prixMin ? "" : g.prixMin === g.prixMax ? F(g.prixMin) : F(g.prixMin).replace(" F", "") + " – " + F(g.prixMax);
function badgesDe(g) {
  const b = [];
  if (g.remise >= 5) b.push({ t: "-" + g.remise + " %", rouge: true });
  if (g.nouveau) b.push({ t: "Nouveau" });
  if (!g.numerique && g.restant > 0 && g.restant <= 2) b.push({ t: g.restant === 1 ? "Dernière pièce" : "Dernières pièces" });
  return b;
}

/* ---------- Dessin ---------- */
function imageCouverture(x, img, rx, ry, rw, rh, rayon) {
  x.save(); rrect(x, rx, ry, rw, rh, rayon); x.clip();
  const k = Math.max(rw / img.width, rh / img.height), w = img.width * k, h = img.height * k;
  x.drawImage(img, rx + (rw - w) / 2, ry + (rh - h) / 2, w, h);
  x.restore();
}
function vignetteVide(x, g, rx, ry, rw, rh, rayon, th) {
  x.save(); rrect(x, rx, ry, rw, rh, rayon); x.fillStyle = th.clair; x.fill();
  x.fillStyle = th.fonce; x.textAlign = "center"; x.textBaseline = "middle";
  x.font = `800 ${Math.round(Math.min(rw, rh) * 0.32)}px ${POLICE}`;
  x.fillText(g.nom.split(/\s+/).map(m => m[0] || "").join("").slice(0, 2).toUpperCase(), rx + rw / 2, ry + rh / 2);
  x.restore();
}
function pastille(x, texte, px, py, th, rouge, taille = 30) {
  x.save(); x.font = `800 ${taille}px ${POLICE}`;
  const w = x.measureText(texte).width + taille * 1.1, h = taille * 1.6;
  rrect(x, px, py, w, h, h / 2); x.fillStyle = rouge ? "#c2352a" : th.fonce; x.fill();
  x.fillStyle = "#ffffff"; x.textBaseline = "middle"; x.fillText(texte, px + taille * 0.55, py + h / 2 + 1);
  x.restore(); return w;
}
function enTete(x, W, th, titre, sousTitre, hauteur) {
  const r = S.data.reglages;
  x.fillStyle = th.fonce; x.fillRect(0, 0, W, hauteur);
  x.fillStyle = "#ffffff"; x.globalAlpha = .8; x.font = `700 30px ${POLICE}`;
  x.fillText((r.boutique || "Ma boutique").toUpperCase(), 64, hauteur * 0.36); x.globalAlpha = 1;
  x.font = `800 ${hauteur > 200 ? 66 : 54}px ${POLICE}`;
  x.fillText(texteLignes(x, titre, W - 128, 1)[0], 64, hauteur * 0.72);
  if (sousTitre) { x.globalAlpha = .8; x.font = `500 28px ${POLICE}`; x.fillText(sousTitre, 64, hauteur * 0.9); x.globalAlpha = 1; }
}
function piedDePage(x, W, H, th, hauteur, sousTexte) {
  const r = S.data.reglages;
  x.fillStyle = "#15211d"; x.fillRect(0, H - hauteur, W, hauteur);
  x.fillStyle = "#ffffff"; x.font = `700 ${hauteur > 140 ? 40 : 34}px ${POLICE}`;
  x.fillText(r.numero ? "Commande sur WhatsApp : " + r.numero : "Commande sur WhatsApp", 64, H - hauteur * 0.52);
  x.globalAlpha = .75; x.font = `500 ${hauteur > 140 ? 28 : 24}px ${POLICE}`; x.fillText(sousTexte || "Paiement Mobile Money accepté", 64, H - hauteur * 0.2); x.globalAlpha = 1;
}
function dessinerPrix(x, g, px, py, taille, th, avecPrix) {
  if (!avecPrix || !g.prixMin) return;
  x.fillStyle = th.fonce; x.font = `800 ${taille}px ${POLICE}`;
  const t = textePrix(g); x.fillText(t, px, py);
  if (g.prixAvant) {
    const w = x.measureText(t).width + 22;
    x.font = `600 ${Math.round(taille * 0.55)}px ${POLICE}`; x.fillStyle = "#8a948f";
    const a = F(g.prixAvant); x.fillText(a, px + w, py);
    const wa = x.measureText(a).width; x.fillRect(px + w, py - taille * 0.2, wa, 3);
  }
}

/* Grille : 6 produits (statut) ou 4 produits (carré) par image */
async function dessinerGrille(groupes, o) {
  const { W, H } = FORMATS[o.format], th = THEMES[o.theme], carre = o.format === "carre";
  const parPage = carre ? 4 : 6, haut = carre ? 170 : 250, pied = carre ? 120 : 170, blobs = [];
  for (let i = 0; i < groupes.length; i += parPage) {
    const page = groupes.slice(i, i + parPage), n = Math.floor(i / parPage) + 1, total = Math.ceil(groupes.length / parPage);
    const c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d");
    x.fillStyle = th.fond; x.fillRect(0, 0, W, H);
    enTete(x, W, th, o.titre, "", haut);
    const gx = 48, gap = 28, lignes = carre ? 2 : 3, gy = haut + 36;
    const cw = (W - gx * 2 - gap) / 2, ch = (H - pied - gy - 36 - gap * (lignes - 1)) / lignes, ph = ch * 0.62;
    for (let k = 0; k < page.length; k++) {
      const g = page[k], cx = gx + (k % 2) * (cw + gap), cy = gy + Math.floor(k / 2) * (ch + gap);
      x.save(); rrect(x, cx, cy, cw, ch, 26); x.fillStyle = "#ffffff"; x.fill(); x.restore();
      const img = g.photos[0] ? await chargerImage(g.photos[0]) : null;
      if (img) imageCouverture(x, img, cx, cy, cw, ph, 26); else vignetteVide(x, g, cx, cy, cw, ph, 26, th);
      let bx = cx + 14; for (const b of badgesDe(g).slice(0, 2)) bx += pastille(x, b.t, bx, cy + 14, th, b.rouge, carre ? 22 : 24) + 8;
      x.fillStyle = "#15211d"; x.font = `700 ${carre ? 32 : 34}px ${POLICE}`;
      x.fillText(texteLignes(x, g.nom, cw - 44, 1)[0], cx + 22, cy + ph + 46);
      if (g.variantes.length) { x.fillStyle = "#5d6b66"; x.font = `500 ${carre ? 23 : 25}px ${POLICE}`; x.fillText(texteLignes(x, g.variantes.join(" · "), cw - 44, 1)[0], cx + 22, cy + ph + 82); }
      dessinerPrix(x, g, cx + 22, cy + ch - 24, carre ? 38 : 42, th, o.prix);
    }
    piedDePage(x, W, H, th, pied, total > 1 ? `Page ${n} / ${total}` : "");
    blobs.push(await canvasVersBlob(c));
  }
  return blobs;
}

/* Fiche : un produit par image, avec ses photos, ses variantes et sa description */
async function dessinerFiche(g, o) {
  const { W, H } = FORMATS[o.format], th = THEMES[o.theme], carre = o.format === "carre";
  const c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d");
  x.fillStyle = th.fond; x.fillRect(0, 0, W, H);
  const haut = carre ? 0 : 130, pied = carre ? 110 : 170;
  if (!carre) { x.fillStyle = th.fonce; x.fillRect(0, 0, W, haut); x.fillStyle = "#ffffff"; x.font = `800 40px ${POLICE}`; x.fillText(texteLignes(x, S.data.reglages.boutique || "Ma boutique", W - 128, 1)[0], 64, 82); }
  const m = carre ? 40 : 48, imgs = [];
  for (const ph of g.photos) { const i = await chargerImage(ph); if (i) imgs.push(i); }
  /* Hauteur du texte d'abord : les photos prennent toute la place qui reste */
  const T = carre ? { nom: 48, ln: 56, va: 26, lv: 34, pr: 56, de: 26, ld: 34, maxD: 3 } : { nom: 62, ln: 72, va: 32, lv: 44, pr: 76, de: 34, ld: 46, maxD: 7 };
  x.font = `800 ${T.nom}px ${POLICE}`; const lignesNom = texteLignes(x, g.nom, W - m * 2, 2);
  x.font = `600 ${T.va}px ${POLICE}`; const lignesVar = g.variantes.length ? texteLignes(x, "Disponible en : " + g.variantes.join(", "), W - m * 2, 2) : [];
  x.font = `400 ${T.de}px ${POLICE}`; let lignesDesc = g.description && o.description ? texteLignes(x, g.description.replace(/\s+/g, " "), W - m * 2, T.maxD) : [];
  const hauteurTexte = () => lignesNom.length * T.ln + lignesVar.length * T.lv + (o.prix && g.prixMin ? T.pr + 40 : 0) + (lignesDesc.length ? 30 + lignesDesc.length * T.ld : 0) + (carre ? 60 : 90);
  const dispo = H - pied - haut - m;
  const zoneMin = carre ? 420 : 760, zoneMax = carre ? 600 : 1150;
  while (dispo - hauteurTexte() < zoneMin && lignesDesc.length > 1) lignesDesc = texteLignes(x, g.description.replace(/\s+/g, " "), W - m * 2, lignesDesc.length - 1);
  /* Zone photos : la grande + jusqu'à 3 petites */
  const zoneY = haut + m, zoneH = Math.max(zoneMin, Math.min(zoneMax, dispo - hauteurTexte())), petites = imgs.slice(1, 4);
  const grandeW = petites.length && !carre ? W - m * 2 : (petites.length ? W - m * 2 - 220 - 16 : W - m * 2);
  const grandeH = petites.length && !carre ? zoneH - 230 : zoneH;
  if (imgs[0]) imageCouverture(x, imgs[0], m, zoneY, grandeW, grandeH, 30); else vignetteVide(x, g, m, zoneY, grandeW, grandeH, 30, th);
  if (petites.length) {
    if (carre) {
      const pw = 220, phh = (zoneH - 16 * (petites.length - 1)) / petites.length;
      petites.forEach((im, k) => imageCouverture(x, im, W - m - pw, zoneY + k * (phh + 16), pw, phh, 22));
    } else {
      const pw = (W - m * 2 - 16 * (petites.length - 1)) / petites.length;
      petites.forEach((im, k) => imageCouverture(x, im, m + k * (pw + 16), zoneY + grandeH + 16, pw, 214, 22));
    }
  }
  let bx = m + 18; for (const b of badgesDe(g)) bx += pastille(x, b.t, bx, zoneY + 18, th, b.rouge, carre ? 26 : 30) + 10;
  /* Texte */
  let y = zoneY + zoneH + (carre ? 62 : 86);
  x.fillStyle = "#15211d"; x.font = `800 ${T.nom}px ${POLICE}`;
  for (const l of lignesNom) { x.fillText(l, m, y); y += T.ln; }
  x.fillStyle = "#5d6b66"; x.font = `600 ${T.va}px ${POLICE}`;
  for (const l of lignesVar) { x.fillText(l, m, y); y += T.lv; }
  if (o.prix && g.prixMin) { y += carre ? 34 : 46; dessinerPrix(x, g, m, y, T.pr, th, true); y += carre ? 20 : 30; }
  if (lignesDesc.length) {
    y += carre ? 26 : 40;
    x.fillStyle = "#2c3a35"; x.font = `400 ${T.de}px ${POLICE}`;
    for (const l of lignesDesc) { x.fillText(l, m, y); y += T.ld; }
  }
  piedDePage(x, W, H, th, pied, g.numerique ? "Paiement Mobile Money · téléchargement immédiat" : "Paiement Mobile Money accepté");
  return canvasVersBlob(c);
}

/* Texte à coller dans WhatsApp (gras *…*, italique _…_, barré ~…~) */
function texteCatalogue(groupes, o) {
  const r = S.data.reglages, parCat = {};
  for (const g of groupes) (parCat[g.categorie] ||= []).push(g);
  let t = `*${r.boutique || "Ma boutique"}* · ${o.titre}\n`;
  for (const [cat, liste] of Object.entries(parCat)) {
    t += `\n_${cat}_\n`;
    for (const g of liste) {
      t += `• *${g.nom}*${g.variantes.length ? " (" + g.variantes.join(", ") + ")" : ""}`;
      if (o.prix && g.prixMin) t += ` : ${textePrix(g)}${g.prixAvant ? " ~" + F(g.prixAvant) + "~" : ""}`;
      const b = badgesDe(g).map(x => x.t); if (b.length) t += ` · ${b.join(" · ")}`;
      if (o.description && g.description) t += `\n   ${g.description.replace(/\s+/g, " ").slice(0, 140)}${g.description.length > 140 ? "…" : ""}`;
      if (g.numerique && g.lien) t += `\n   ${g.lien}`;
      t += "\n";
    }
  }
  t += `\nPaiement Mobile Money accepté.${r.numero ? "\nCommande ici : " + r.numero : ""}`;
  return t;
}
function legendeProduit(g) {
  const r = S.data.reglages;
  return `*${g.nom}*${g.variantes.length ? "\nDisponible en : " + g.variantes.join(", ") : ""}` +
    (g.prixMin ? `\nPrix : *${textePrix(g)}*${g.prixAvant ? " au lieu de ~" + F(g.prixAvant) + "~" : ""}` : "") +
    (g.description ? `\n\n${g.description}` : "") + (g.numerique && g.lien ? `\n\n${g.lien}` : "") +
    `\n\n${r.numero ? "Commande ici : " + r.numero : "Écris-moi pour commander"}${r.boutique ? "\n— " + r.boutique : ""}`;
}

/* ---------- Écran « Catalogue à partager » ---------- */
function catalogueSheet() {
  const pc = prefsCatalogue(), cats = [...new Set(S.data.produits.map(p => p.categorie || "Divers"))].sort();
  const form = openSheet(`<form><h2>Catalogue à partager</h2>
    <div class="field"><label for="k-cat">Quels produits ?</label><select id="k-cat" name="cat">${opt("__tout", "Tout le catalogue", true)}${cats.map(c => opt(c, c, false)).join("")}</select></div>
    <div class="field"><label>Présentation</label><div class="seg" role="group">
      ${[["fiche", "Une fiche par produit"], ["grille", "Grille"], ["texte", "Texte"]].map(([k, l]) => `<button type="button" data-pres="${k}" aria-pressed="${pc.presentation === k}">${l}</button>`).join("")}</div>
      <div class="hint" id="k-pres-hint"></div></div>
    <div class="field" id="k-format-f"><label for="k-format">Format</label><select id="k-format" name="format">${Object.entries(FORMATS).map(([k, f]) => opt(k, f.nom, k === pc.format)).join("")}</select></div>
    <div class="field" id="k-theme-f"><label>Couleur</label><div class="nuancier">${Object.entries(THEMES).map(([k, t]) => `<label title="${esc(t.nom)}"><input type="radio" name="theme" value="${k}" ${k === pc.theme ? "checked" : ""}><span style="background:${t.fonce}"></span>${esc(t.nom)}</label>`).join("")}</div></div>
    <label class="check"><input name="prix" type="checkbox" checked> Afficher les prix</label>
    <label class="check"><input name="description" type="checkbox" checked> Afficher les descriptions</label>
    <label class="check"><input name="dispo" type="checkbox" checked> Seulement les produits disponibles</label>
    <div class="field"><label for="k-titre">Titre (facultatif)</label><input id="k-titre" name="titre" type="text" placeholder="Ex. Nouvel arrivage, Promo du week-end"></div>
    <div class="err"></div>
    <div class="btns"><button type="button" class="btn sec" data-close>Annuler</button><button type="submit" class="btn pri">Créer</button></div>
  </form>`);
  let pres = pc.presentation;
  const maj = () => {
    form.querySelectorAll("[data-pres]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.pres === pres)));
    $("#k-format-f").hidden = $("#k-theme-f").hidden = pres === "texte";
    $("#k-pres-hint").textContent = { fiche: "Une image par produit : grande photo, autres photos, variantes, prix et description. Idéal pour les statuts.", grille: "Plusieurs produits par image, pour montrer beaucoup de choses d'un coup.", texte: "Une liste de prix à coller dans un groupe WhatsApp, sans image." }[pres];
  };
  form.addEventListener("click", e => { const b = e.target.closest("[data-pres]"); if (b) { pres = b.dataset.pres; maj(); } });
  maj();
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const fd = new FormData(form), st = stats("tout");
    const produits = S.data.produits.filter(p => (fd.get("cat") === "__tout" || (p.categorie || "Divers") === fd.get("cat")) &&
      (fd.get("dispo") !== "on" || p.mode === "numerique" || st.byProd[p.id].restant > 0));
    const groupes = regrouperProduits(produits, st).sort((a, b) => a.categorie.localeCompare(b.categorie) || a.nom.localeCompare(b.nom));
    if (!groupes.length) { form.querySelector(".err").textContent = "Aucun produit à montrer avec ces choix."; return; }
    const o = { format: fd.get("format"), theme: fd.get("theme") || "emeraude", prix: fd.get("prix") === "on", description: fd.get("description") === "on",
      titre: (fd.get("titre") || "").trim() || (fd.get("cat") === "__tout" ? "Catalogue" : fd.get("cat")) };
    try { localStorage.setItem(PREFS_CATALOGUE, JSON.stringify({ theme: o.theme, format: o.format, presentation: pres })); } catch {}
    if (pres === "texte") return apercuTexte("Liste de prix", texteCatalogue(groupes, o));
    const bt = form.querySelector(".pri"); bt.disabled = true; bt.textContent = "Création…";
    if (pres === "grille") return apercuImages("Ton catalogue", await dessinerGrille(groupes, o), "catalogue", "Partage-les en statut WhatsApp ou dans tes groupes.");
    if (groupes.length > 20) { form.querySelector(".err").textContent = `${groupes.length} produits : choisis une catégorie, ou la présentation en grille.`; bt.disabled = false; bt.textContent = "Créer"; return; }
    const blobs = [];
    for (let i = 0; i < groupes.length; i++) { bt.textContent = `Création ${i + 1} / ${groupes.length}…`; blobs.push(await dessinerFiche(groupes[i], o)); }
    apercuImages("Tes fiches produit", blobs, "produit", "Une image par produit. Partage-les en statut : chaque fiche reste 24 h.");
  });
}
function apercuTexte(titre, texte) {
  openSheet(`<div class="inner"><h2>${esc(titre)}</h2>
    <div class="box" style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;max-height:50vh;overflow:auto">${esc(texte)}</div>
    <a class="btn pri" style="text-align:center;text-decoration:none" href="${lienWa("", texte)}" target="_blank" rel="noopener">Envoyer sur WhatsApp</a>
    <button class="btn sec" id="txt-copier">Copier le texte</button>
    <button class="btn sec" data-close>Fermer</button></div>`);
  $("#txt-copier").addEventListener("click", () => navigator.clipboard.writeText(texte).then(() => toast("Texte copié"), () => toast("Copie impossible")));
}

/* ---------- Partager un seul produit (image + texte) ---------- */
async function partagerProduit(id) {
  const p = produitDe(id); if (!p) return;
  const st = stats("tout");
  const g = regrouperProduits(S.data.produits.filter(x => norm(x.nom) === norm(p.nom) && (x.categorie || "Divers") === (p.categorie || "Divers")), st)[0];
  const pc = prefsCatalogue();
  toast("Création de l'image…");
  const blob = await dessinerFiche(g, { format: pc.format, theme: pc.theme, prix: true, description: true });
  const texte = legendeProduit(g), url = URL.createObjectURL(blob);
  openSheet(`<div class="inner"><h2>Partager ${esc(g.nom)}</h2>
    <div class="apercus" style="grid-template-columns:minmax(0,220px)"><img src="${url}" alt="Aperçu"></div>
    <div class="box" style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px">${esc(texte)}</div>
    <button class="btn pri" id="pp-partager">Partager l'image et le texte</button>
    <a class="btn sec" style="text-align:center;text-decoration:none" href="${lienWa("", texte)}" target="_blank" rel="noopener">Envoyer seulement le texte</a>
    <button class="btn sec" data-close>Fermer</button></div>`);
  $("#pp-partager").addEventListener("click", async () => {
    const f = new File([blob], norm(g.nom) + ".png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [f], text: texte })) {
      try { await navigator.share({ files: [f], text: texte }); return; } catch (e) { if (e && e.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(texte); } catch {}
    partagerImages([blob], norm(g.nom), g.nom);
    toast("Image enregistrée, texte copié : colle-le sous l'image");
  });
}

ACTIONS["catalogue"] = () => catalogueSheet();
ACTIONS["partager-produit"] = id => partagerProduit(id);
