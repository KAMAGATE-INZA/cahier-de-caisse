"use strict";
/* =====================================================================
   Outils : photos, catalogue en image, bilan en image, code PIN,
   arrivages (répartition des frais) et livraisons.
   ===================================================================== */

/* ================= Photos (stockées sur l'appareil, IndexedDB) ================= */
const PHOTOS = {};   /* photo principale de chaque produit (data URL) */
const AUTRES = {};   /* photos supplémentaires du produit */
const MAX_PHOTOS = 4;
let _idb = null;
function idbPhotos() {
  if (!_idb) _idb = new Promise((res, rej) => {
    const r = indexedDB.open("cahier-de-caisse-photos", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("photos");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return _idb;
}
async function idbEcrire(id, valeur) {
  const d = await idbPhotos();
  await new Promise((res, rej) => {
    const tx = d.transaction("photos", "readwrite");
    if (valeur === null) tx.objectStore("photos").delete(id); else tx.objectStore("photos").put(valeur, id);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}
async function chargerPhotos() {
  try {
    const d = await idbPhotos();
    await new Promise(res => {
      const rq = d.transaction("photos").objectStore("photos").openCursor();
      rq.onsuccess = () => {
        const c = rq.result;
        if (!c) return res();
        if (String(c.key).startsWith("g:")) { if (Array.isArray(c.value)) AUTRES[String(c.key).slice(2)] = c.value; }
        else PHOTOS[c.key] = c.value;
        c.continue();
      };
      rq.onerror = () => res();
    });
  } catch {}
}
/* Réduit la photo (720 px, JPEG) pour qu'elle prenne peu de place */
function compresserImage(fichier, max = 720, qualite = 0.8) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(fichier), img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res(c.toDataURL("image/jpeg", qualite));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("image illisible")); };
    img.src = url;
  });
}
/* Toutes les photos d'un produit, la principale en premier */
const photosDe = id => [PHOTOS[id], ...(AUTRES[id] || [])].filter(Boolean);
async function definirPhotos(id, liste, depuisServeur) {
  liste = (liste || []).filter(x => typeof x === "string" && x.startsWith("data:image/")).slice(0, MAX_PHOTOS);
  for (const ancienne of photosDe(id)) if (!liste.includes(ancienne)) oublierUrl(ancienne);
  if (liste[0]) PHOTOS[id] = liste[0]; else delete PHOTOS[id];
  if (liste.length > 1) AUTRES[id] = liste.slice(1); else delete AUTRES[id];
  try { await idbEcrire(id, liste[0] || null); await idbEcrire("g:" + id, liste.length > 1 ? liste.slice(1) : null); } catch {}
  if (!depuisServeur && db.cloud && db.cloud.photo) db.cloud.photo(id, liste);
  if (!depuisServeur && typeof planifierVitrine === "function") planifierVitrine();
}
async function definirPhoto(id, dataUrl, depuisServeur) { return definirPhotos(id, dataUrl ? [dataUrl, ...(AUTRES[id] || [])] : [], depuisServeur); }
async function enregistrerPhoto(id, fichier) { await definirPhotos(id, [await compresserImage(fichier), ...(AUTRES[id] || [])]); }

/* Fluidité : une photo est convertie une seule fois en adresse courte (blob:) pour l'affichage */
const _urls = new Map();
function urlPhoto(dataUrl) {
  if (!dataUrl) return "";
  let u = _urls.get(dataUrl);
  if (!u) {
    try {
      const [tete, b64] = dataUrl.split(","), bin = atob(b64), octets = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) octets[i] = bin.charCodeAt(i);
      u = URL.createObjectURL(new Blob([octets], { type: (tete.match(/data:([^;]+)/) || [])[1] || "image/jpeg" }));
    } catch { u = dataUrl; }
    _urls.set(dataUrl, u);
  }
  return u;
}
function oublierUrl(dataUrl) { const u = _urls.get(dataUrl); if (u && u.startsWith("blob:")) URL.revokeObjectURL(u); _urls.delete(dataUrl); }
const vignette = id => PHOTOS[id] ? urlPhoto(PHOTOS[id]) : "";

/* ================= Dessin sur canvas (catalogue et bilan) ================= */
function chargerImage(src) { return new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; }); }
function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function texteLignes(ctx, texte, largeur, maxLignes) {
  const mots = String(texte).split(/\s+/), lignes = [];
  let l = "";
  for (const m of mots) {
    const t = l ? l + " " + m : m;
    if (ctx.measureText(t).width <= largeur || !l) l = t; else { lignes.push(l); l = m; }
  }
  if (l) lignes.push(l);
  if (lignes.length > maxLignes) { lignes.length = maxLignes; let d = lignes[maxLignes - 1]; while (d && ctx.measureText(d + "…").width > largeur) d = d.slice(0, -1); lignes[maxLignes - 1] = d + "…"; }
  return lignes;
}
const POLICE = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const canvasVersBlob = c => new Promise(res => c.toBlob(res, "image/png"));

async function partagerImages(blobs, nomBase, titre) {
  const fichiers = blobs.map((b, i) => new File([b], `${nomBase}${blobs.length > 1 ? "-" + (i + 1) : ""}.png`, { type: "image/png" }));
  if (navigator.canShare && navigator.canShare({ files: fichiers })) {
    try { await navigator.share({ files: fichiers, title: titre }); return; } catch (e) { if (e && e.name === "AbortError") return; }
  }
  for (const f of fichiers) {
    const url = URL.createObjectURL(f), a = document.createElement("a");
    a.href = url; a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
}
function apercuImages(titre, blobs, nomBase, explication) {
  const urls = blobs.map(b => URL.createObjectURL(b));
  openSheet(`<div class="inner"><h2>${esc(titre)}</h2>
    ${explication ? `<p class="note">${explication}</p>` : ""}
    <div class="apercus">${urls.map(u => `<img src="${u}" alt="Aperçu">`).join("")}</div>
    <div class="btns"><button class="btn sec" data-close>Fermer</button><button class="btn pri" id="btn-partager-img">${blobs.length > 1 ? "Partager les " + blobs.length + " images" : "Partager l'image"}</button></div>
  </div>`);
  $("#btn-partager-img").addEventListener("click", () => partagerImages(blobs, nomBase, titre));
}

/* ---------- Bilan du mois en image ---------- */
async function bilanImage() {
  const st = stats(S.periode), W = 1080, H = 1350, r = S.data.reglages;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d");
  const net = Math.round(st.net), gain = net >= 0;
  x.fillStyle = "#f3f5f1"; x.fillRect(0, 0, W, H);
  x.fillStyle = "#5d6b66"; x.font = `600 30px ${POLICE}`; x.fillText((r.boutique || "Mon business").toUpperCase(), 72, 100);
  x.fillStyle = "#15211d"; x.font = `800 64px ${POLICE}`; x.fillText("Bilan · " + nomPeriode(S.periode), 72, 178);
  rrect(x, 56, 220, W - 112, 420, 36); x.fillStyle = gain ? "#0d6b57" : "#b3392f"; x.fill();
  x.fillStyle = "#ffffff"; x.font = `600 30px ${POLICE}`; x.globalAlpha = .85; x.fillText("BÉNÉFICE NET", 104, 292); x.globalAlpha = 1;
  x.font = `800 120px ${POLICE}`; x.fillText((net > 0 ? "+" : net < 0 ? "−" : "") + F(Math.abs(net)), 104, 420);
  x.font = `700 40px ${POLICE}`; x.fillText(net > 0 ? "Tu as gagné de l'argent" : net < 0 ? "Tu as perdu de l'argent" : "Ni gain ni perte", 104, 490);
  x.font = `500 32px ${POLICE}`; x.globalAlpha = .9;
  x.fillText(net > 0 ? "Tes ventes couvrent tes coûts et tes dépenses." : net < 0 ? "Tes ventes ne couvrent pas encore tes coûts." : "Tu as récupéré ce que tu as dépensé.", 104, 560);
  x.globalAlpha = 1;
  let y = 700;
  const ligne = (a, b, gras) => { x.fillStyle = "#15211d"; x.font = `${gras ? 700 : 500} 34px ${POLICE}`; x.fillText(a, 72, y); x.textAlign = "right"; x.fillText(b, W - 72, y); x.textAlign = "left"; y += 58; };
  ligne("Ventes (" + st.nbVentes + ")", F(st.ca));
  ligne("Coût des produits vendus", "− " + F(st.cout));
  ligne("Dépenses", "− " + F(st.dep));
  x.fillStyle = "#dbe2dd"; x.fillRect(72, y - 34, W - 144, 3); y += 10;
  ligne("Bénéfice net", (net >= 0 ? "+" : "−") + F(Math.abs(net)), true);
  y += 20;
  const top = Object.values(st.byProd).filter(b => b.vendus).sort((a, b) => b.benef - a.benef).slice(0, 3);
  if (top.length) {
    x.fillStyle = "#5d6b66"; x.font = `600 28px ${POLICE}`; x.fillText("MEILLEURS PRODUITS", 72, y); y += 52;
    top.forEach((b, i) => ligne(`${i + 1}. ${texteLignes(x, nomComplet(b.p), 620, 1)[0]}`, F(b.benef)));
  }
  const versP = vendeursActifs().reduce((s, vd) => s + compteVendeur(vd, S.periode).verseP, 0);
  if (versP) { y += 10; ligne("Versé par tes vendeurs", F(versP)); }
  x.fillStyle = "#5d6b66"; x.font = `500 26px ${POLICE}`; x.fillText("Cahier de Caisse · " + new Date().toLocaleDateString("fr-FR"), 72, H - 56);
  apercuImages("Bilan en image", [await canvasVersBlob(c)], "bilan-" + todayISO(), "Garde-le comme souvenir de ton mois ou montre-le à un associé.");
}

/* ================= Code PIN ================= */
const PIN_KEY = "cahier-de-caisse:pin";
const pinConfig = () => { try { return JSON.parse(localStorage.getItem(PIN_KEY) || "null"); } catch { return null; } };
async function hacherPin(pin, sel) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sel + ":" + pin));
  return [...new Uint8Array(b)].map(v => v.toString(16).padStart(2, "0")).join("");
}
let _cache = "", _cacheVerrou = null;
function afficherVerrou() {
  if (!pinConfig() || document.getElementById("verrou")) return;
  const v = document.createElement("div"); v.id = "verrou"; v.setAttribute("role", "dialog"); v.setAttribute("aria-label", "Code PIN");
  v.innerHTML = `<div class="v-in"><h2>Cahier de Caisse</h2><p class="note" id="v-msg">Entre ton code PIN</p>
    <div class="v-points" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
    <div class="v-pave">${[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map(k => k === "" ? "<span></span>" : `<button type="button" data-k="${k}" aria-label="${k === "⌫" ? "Effacer" : k}">${k}</button>`).join("")}</div>
    <button type="button" class="v-oubli" id="v-oubli">Code oublié ?</button></div>`;
  document.body.appendChild(v);
  _cache = ""; majPoints();
  v.addEventListener("click", e => {
    const k = e.target.closest("[data-k]");
    if (k) return toucheVerrou(k.dataset.k);
    if (e.target.id === "v-oubli") $("#v-msg").textContent = "Le code ne peut pas être récupéré. Il faut effacer les données de l'appli dans le navigateur, puis restaurer ta dernière sauvegarde.";
  });
}
function majPoints() { document.querySelectorAll("#verrou .v-points i").forEach((i, n) => i.classList.toggle("on", n < _cache.length)); }
async function toucheVerrou(k) {
  const attente = +(localStorage.getItem(PIN_KEY + ":attente") || 0);
  if (Date.now() < attente) { $("#v-msg").textContent = `Trop d'essais. Réessaie dans ${Math.ceil((attente - Date.now()) / 1000)} s.`; return; }
  if (k === "⌫") { _cache = _cache.slice(0, -1); majPoints(); return; }
  if (_cache.length >= 4) return;
  _cache += k; majPoints();
  if (_cache.length < 4) return;
  const cfg = pinConfig();
  if (await hacherPin(_cache, cfg.sel) === cfg.hash) {
    localStorage.removeItem(PIN_KEY + ":essais");
    document.getElementById("verrou").remove(); _cache = "";
  } else {
    const n = +(localStorage.getItem(PIN_KEY + ":essais") || 0) + 1;
    localStorage.setItem(PIN_KEY + ":essais", n);
    if (n >= 5) { localStorage.setItem(PIN_KEY + ":attente", Date.now() + 30000); localStorage.setItem(PIN_KEY + ":essais", 0); }
    $("#v-msg").textContent = n >= 5 ? "Trop d'essais. Attends 30 secondes." : "Code incorrect.";
    document.querySelector("#verrou .v-points").classList.add("faux");
    setTimeout(() => { _cache = ""; majPoints(); const p = document.querySelector("#verrou .v-points"); if (p) p.classList.remove("faux"); }, 450);
  }
}
document.addEventListener("keydown", e => { if (document.getElementById("verrou") && (/^[0-9]$/.test(e.key) || e.key === "Backspace")) toucheVerrou(e.key === "Backspace" ? "⌫" : e.key); });
/* Reverrouille si l'appli est restée en arrière-plan plus de 2 minutes */
document.addEventListener("visibilitychange", () => {
  if (document.hidden) _cacheVerrou = Date.now();
  else if (_cacheVerrou && Date.now() - _cacheVerrou > 120000) afficherVerrou();
});
function pinSheet() {
  const actif = !!pinConfig();
  const form = openSheet(`<form><h2>${actif ? "Changer ou retirer le code" : "Activer un code PIN"}</h2>
    <p class="note">Le code bloque l'appli à l'ouverture et après 2 minutes en arrière-plan. Il protège contre quelqu'un qui prend ton téléphone pour regarder tes chiffres. Ce n'est pas un chiffrement : une personne qui a ton téléphone et des connaissances techniques pourrait lire les données. Garde aussi ton téléphone verrouillé.</p>
    ${actif ? `<div class="field"><label for="pin-a">Code actuel</label><input id="pin-a" name="actuel" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off" required></div>` : ""}
    <div class="two">
      <div class="field"><label for="pin-n">${actif ? "Nouveau code" : "Code à 4 chiffres"}</label><input id="pin-n" name="nouveau" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off" ${actif ? "" : "required"}></div>
      <div class="field"><label for="pin-c">Confirme</label><input id="pin-c" name="confirme" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off"></div>
    </div>
    <p class="hint">Si tu oublies le code, il ne peut pas être récupéré : il faudra effacer les données de l'appli et restaurer ta dernière sauvegarde.</p>
    <div class="err"></div>
    <div class="btns">${actif ? `<button type="button" class="btn warn" id="pin-off">Retirer le code</button>` : `<button type="button" class="btn sec" data-close>Annuler</button>`}<button type="submit" class="btn pri">${actif ? "Changer" : "Activer"}</button></div>
  </form>`);
  const verifierActuel = async () => { const cfg = pinConfig(); return await hacherPin(form.actuel.value, cfg.sel) === cfg.hash; };
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const err = form.querySelector(".err");
    if (actif && !(await verifierActuel())) { err.textContent = "Le code actuel est incorrect."; return; }
    if (!/^[0-9]{4}$/.test(form.nouveau.value)) { err.textContent = "Le code doit faire 4 chiffres."; return; }
    if (form.nouveau.value !== form.confirme.value) { err.textContent = "Les deux codes ne sont pas identiques."; return; }
    const sel = nouvelId();
    localStorage.setItem(PIN_KEY, JSON.stringify({ sel, hash: await hacherPin(form.nouveau.value, sel) }));
    closeSheet(); toast(actif ? "Code changé" : "Code activé");
  });
  if (actif) $("#pin-off").addEventListener("click", async () => {
    if (!(await verifierActuel())) { form.querySelector(".err").textContent = "Entre d'abord le code actuel."; return; }
    localStorage.removeItem(PIN_KEY); closeSheet(); toast("Code retiré");
  });
}

/* ================= Arrivages : répartir transport et douane sur chaque pièce ================= */
const DEVISES = { F: "FCFA", USD: "Dollar ($)", CNY: "Yuan (¥)", EUR: "Euro (€)" };
function arrivageForm() {
  const physiques = S.data.produits.filter(p => p.mode !== "numerique").sort((a, b) => nomComplet(a).localeCompare(nomComplet(b)));
  const cats = [...new Set(S.data.produits.map(x => x.categorie).filter(Boolean))].sort();
  let lignes = [{ ref: physiques.length ? physiques[0].id : "__nouveau", qte: "", prix: "", cat: "", nom: "", variante: "", pv: "" }];
  const form = openSheet(`<form><h2>Nouvel arrivage</h2>
    <p class="note">Pour une commande de Chine ou d'ailleurs : tu indiques ce que chaque article t'a coûté, puis les frais communs. L'appli répartit les frais et calcule le vrai coût de revient de chaque pièce.</p>
    <div class="two">
      <div class="field"><label for="a-date">Date d'arrivée</label><input id="a-date" name="date" type="date" value="${todayISO()}" required></div>
      <div class="field"><label for="a-four">Fournisseur (facultatif)</label><input id="a-four" name="fournisseur" type="text" placeholder="Ex. Alibaba, Adjamé"></div>
    </div>
    <div class="two">
      <div class="field"><label for="a-dev">Prix d'achat en</label><select id="a-dev" name="devise">${Object.entries(DEVISES).map(([k, l]) => opt(k, l, k === "F")).join("")}</select></div>
      <div class="field" id="a-taux-f"><label for="a-taux">1 unité = combien de F ?</label><input id="a-taux" name="taux" type="number" inputmode="decimal" min="0" step="0.01" placeholder="Ex. 600"></div>
    </div>
    <h3>Articles</h3>
    <div id="a-lignes" style="display:grid;gap:10px"></div>
    <button type="button" class="btn sec" id="a-plus">+ Ajouter un article</button>
    <h3>Frais communs (en F)</h3>
    <div class="two">
      <div class="field"><label for="a-tr">Transport / fret</label><input id="a-tr" name="transport" type="number" inputmode="numeric" min="0" step="1" placeholder="0"></div>
      <div class="field"><label for="a-dou">Douane</label><input id="a-dou" name="douane" type="number" inputmode="numeric" min="0" step="1" placeholder="0"></div>
      <div class="field"><label for="a-aut">Autres (transitaire, taxi…)</label><input id="a-aut" name="autres" type="number" inputmode="numeric" min="0" step="1" placeholder="0"></div>
      <div class="field"><label for="a-rep">Répartir les frais</label><select id="a-rep" name="repartition">${opt("valeur", "Selon la valeur des articles", true)}${opt("piece", "Pareil sur chaque pièce", false)}</select></div>
    </div>
    <div class="calc num" id="a-resume"></div>
    <div class="hint">L'achat de stock n'est pas une dépense : son coût est compté au moment où tu vends chaque pièce. Pour un produit que tu as déjà, l'appli calcule le coût moyen avec ce qu'il te reste.</div>
    ${buttons}</form>`, fd => {
      const calc = calculArrivage();
      if (!calc.ok) throw new Error(calc.erreur);
      const ops = [], st = stats("tout"), lignesSauvees = [];
      for (const l of calc.lignes) {
        if (l.ref === "__nouveau") {
          const id = nouvelId();
          ops.push({ type: "ajout", col: "produits", id, data: { id, categorie: l.cat || "Divers", nom: l.nom, variante: l.variante, mode: "stock", quantite: l.qte, cout: l.cr, prixVente: +l.pv || 0, seuil: 2, vendeurVoitCout: false, commission: 0, plateforme: "moi", cree: Date.now() } });
          lignesSauvees.push({ produitId: id, nom: l.nom + (l.variante ? " — " + l.variante : ""), qte: l.qte, prixAchat: l.prixF, coutRevient: l.cr });
        } else {
          const p = produitDe(l.ref), restant = st.byProd[p.id].restant;
          const moyen = Math.round((restant * (+p.cout || 0) + l.qte * l.cr) / (restant + l.qte));
          ops.push({ type: "modif", col: "produits", id: p.id, data: { quantite: (+p.quantite || 0) + l.qte, cout: moyen, reappro: Date.now() } });
          lignesSauvees.push({ produitId: p.id, nom: nomComplet(p), qte: l.qte, prixAchat: l.prixF, coutRevient: l.cr });
        }
      }
      const id = nouvelId();
      ops.push({ type: "ajout", col: "arrivages", id, data: { id, date: fd.get("date"), fournisseur: (fd.get("fournisseur") || "").trim(),
        devise: fd.get("devise"), taux: +fd.get("taux") || 1, transport: +fd.get("transport") || 0, douane: +fd.get("douane") || 0, autres: +fd.get("autres") || 0,
        repartition: fd.get("repartition"), lignes: lignesSauvees, totalAchat: calc.totalAchat, totalFrais: calc.frais, cree: Date.now() } });
      db.appliquer(ops);
      toast(`Arrivage enregistré : ${plur(calc.pieces, "pièce")} ajoutée${calc.pieces > 1 ? "s" : ""} au stock`);
    });

  const dessinerLignes = () => {
    $("#a-lignes").innerHTML = lignes.map((l, i) => `<div class="box" data-l="${i}">
      <div class="head" style="display:flex;justify-content:space-between;gap:8px"><b>Article ${i + 1}</b>${lignes.length > 1 ? `<button type="button" class="mini danger" data-retirer="${i}">Retirer</button>` : ""}</div>
      <div class="field"><label>Produit</label><select data-k="ref">${physiques.map(p => opt(p.id, nomComplet(p), p.id === l.ref)).join("")}${opt("__nouveau", "+ Nouveau produit", l.ref === "__nouveau")}</select></div>
      ${l.ref === "__nouveau" ? `<div class="two">
        <div class="field"><label>Catégorie</label><input data-k="cat" type="text" list="a-cats" value="${esc(l.cat)}" placeholder="Ex. Chaussures"></div>
        <div class="field"><label>Nom</label><input data-k="nom" type="text" value="${esc(l.nom)}" placeholder="Ex. Basket Nike"></div>
        <div class="field"><label>Variante</label><input data-k="variante" type="text" value="${esc(l.variante)}" placeholder="Ex. Noire 42"></div>
        <div class="field"><label>Prix de vente (F)</label><input data-k="pv" type="number" inputmode="numeric" min="0" value="${esc(l.pv)}"></div></div>` : ""}
      <div class="two">
        <div class="field"><label>Quantité</label><input data-k="qte" type="number" inputmode="numeric" min="1" step="1" value="${esc(l.qte)}"></div>
        <div class="field"><label>Prix d'achat / pièce</label><input data-k="prix" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(l.prix)}"></div>
      </div>
      <div class="note num" data-cr></div>
    </div>`).join("") + `<datalist id="a-cats">${cats.map(c => `<option value="${esc(c)}">`).join("")}</datalist>`;
    majResume();
  };
  const calculArrivage = () => {
    const devise = form.devise.value, taux = devise === "F" ? 1 : (+form.taux.value || 0);
    const frais = (+form.transport.value || 0) + (+form.douane.value || 0) + (+form.autres.value || 0);
    const ls = lignes.map(l => ({ ...l, qte: Math.round(+l.qte || 0), prixF: (+l.prix || 0) * taux }));
    if (devise !== "F" && !taux) return { ok: false, erreur: "Indique le taux de change : combien de F vaut 1 " + DEVISES[devise] + "." };
    if (ls.some(l => !(l.qte > 0))) return { ok: false, erreur: "Indique la quantité de chaque article." };
    if (ls.some(l => l.ref === "__nouveau" && !l.nom.trim())) return { ok: false, erreur: "Donne un nom à chaque nouveau produit." };
    const totalAchat = ls.reduce((s, l) => s + l.qte * l.prixF, 0), pieces = ls.reduce((s, l) => s + l.qte, 0);
    for (const l of ls) {
      const part = form.repartition.value === "piece" || !totalAchat ? frais / pieces : frais * (l.prixF / totalAchat);
      l.cr = Math.round(l.prixF + part);
    }
    return { ok: true, lignes: ls, totalAchat: Math.round(totalAchat), frais, pieces, taux };
  };
  const majResume = () => {
    $("#a-taux-f").hidden = form.devise.value === "F";
    const c = calculArrivage();
    document.querySelectorAll("#a-lignes [data-cr]").forEach((el, i) => {
      const l = c.lignes ? c.lignes[i] : null;
      el.innerHTML = l && l.qte && c.ok ? `Coût de revient : <b>${F(l.cr)}</b> par pièce${form.devise.value !== "F" ? " (achat " + F(l.prixF) + ")" : ""}` : "";
    });
    $("#a-resume").innerHTML = c.ok
      ? `${plur(c.pieces, "pièce")} · achat ${F(c.totalAchat)} + frais ${F(c.frais)} = <b>${F(c.totalAchat + c.frais)}</b>`
      : esc(c.erreur);
  };
  $("#a-lignes").addEventListener("input", e => {
    const box = e.target.closest("[data-l]"), k = e.target.dataset.k; if (!box || !k) return;
    lignes[+box.dataset.l][k] = e.target.value;
    if (k === "ref") dessinerLignes(); else majResume();
  });
  $("#a-lignes").addEventListener("change", e => { if (e.target.dataset.k === "ref") { lignes[+e.target.closest("[data-l]").dataset.l].ref = e.target.value; dessinerLignes(); } });
  $("#a-lignes").addEventListener("click", e => { const r = e.target.closest("[data-retirer]"); if (r) { lignes.splice(+r.dataset.retirer, 1); dessinerLignes(); } });
  $("#a-plus").addEventListener("click", () => { lignes.push({ ref: "__nouveau", qte: "", prix: "", cat: "", nom: "", variante: "", pv: "" }); dessinerLignes(); });
  ["devise", "taux", "transport", "douane", "autres", "repartition"].forEach(n => form[n].addEventListener("input", majResume));
  dessinerLignes();
}
function arrivageDetail(id) {
  const a = S.data.arrivages.find(x => x.id === id); if (!a) return;
  openSheet(`<div class="inner"><h2>Arrivage du ${esc(dateCourte(a.date))}</h2>
    <div class="box num"><div>${a.fournisseur ? esc(a.fournisseur) + " · " : ""}${plur(a.lignes.reduce((s, l) => s + l.qte, 0), "pièce")}</div>
      <div>Achat ${F(a.totalAchat)} + transport ${F(a.transport)} + douane ${F(a.douane)}${a.autres ? " + autres " + F(a.autres) : ""} = <b>${F(a.totalAchat + a.totalFrais)}</b></div>
      ${a.devise !== "F" ? `<div class="note">Taux utilisé : 1 ${esc(DEVISES[a.devise])} = ${N(a.taux)} F</div>` : ""}
      <div class="note">Frais répartis ${a.repartition === "piece" ? "pareil sur chaque pièce" : "selon la valeur des articles"}.</div></div>
    <div class="releve num">${a.lignes.map(l => `<div class="l"><div><div>${esc(l.nom)} × ${l.qte}</div><div class="d">achat ${F(l.prixAchat)} / pièce</div></div><div></div><div><b>${F(l.coutRevient)}</b><div class="d">coût de revient</div></div></div>`).join("")}</div>
    <button class="btn sec" data-close>Fermer</button></div>`);
}

/* ================= Livraisons ================= */
const COMMUNES = ["Abobo","Adjamé","Anyama","Attécoubé","Bingerville","Cocody","Grand-Bassam","Koumassi","Marcory","Plateau","Port-Bouët","Songon","Treichville","Yopougon"];
const STATUTS_LIV = { "a-livrer": "À livrer", "en-route": "En route", "livree": "Livrée" };
const livraisonsEnCours = () => S.data.ventes.filter(v => v.livraison && (v.livraison.statut === "a-livrer" || v.livraison.statut === "en-route"));
function livreursConnus() {
  const m = new Map();
  for (const v of S.data.ventes) if (v.livraison && v.livraison.livreur) m.set(v.livraison.livreur.toLowerCase(), { nom: v.livraison.livreur, tel: v.livraison.telLivreur || "" });
  return [...m.values()];
}
function texteLivreur(v) {
  const l = v.livraison, r = S.data.reglages;
  return `Bonjour${l.livreur ? " " + l.livreur : ""}, une livraison${r.boutique ? " pour " + r.boutique : ""} :\n\n` +
    `Article : ${nomProduit(v.produitId)} × ${v.qte}\n` +
    `Client : ${v.client || "—"}${v.tel ? " · " + v.tel : ""}\n` +
    `Lieu : ${[l.commune, l.adresse].filter(Boolean).join(", ") || "—"}\n` +
    (v.encaisse ? "Déjà payé, rien à encaisser.\n" : `À encaisser : ${F(totalVente(v))}\n`) + `\nMerci de me confirmer la livraison.`;
}
function texteClientEnRoute(v) {
  const l = v.livraison, r = S.data.reglages;
  return `Bonjour${v.client ? " " + v.client : ""}, ta commande (${nomProduit(v.produitId)}) est en route${l.livreur ? " avec " + l.livreur : ""}${l.telLivreur ? " (" + l.telLivreur + ")" : ""}.` +
    (v.encaisse ? "" : ` Prévois ${F(totalVente(v))} à la livraison.`) + `${r.boutique ? "\n— " + r.boutique : ""}`;
}
function htmlLivraisons() {
  const toutes = S.data.ventes.filter(v => v.livraison);
  if (!toutes.length) return `<div class="empty"><b>Aucune livraison</b>Quand tu enregistres une vente, coche « À livrer » : tu suivras ici chaque commande jusqu'à ce que le client l'ait reçue et payée.</div>`;
  const il14 = isoDe(new Date(Date.now() - 14 * 86400000));
  const groupes = [
    ["a-livrer", "À livrer", toutes.filter(v => v.livraison.statut === "a-livrer")],
    ["en-route", "En route", toutes.filter(v => v.livraison.statut === "en-route")],
    ["livree", "Livrées ces 14 derniers jours", toutes.filter(v => v.livraison.statut === "livree" && (v.livraison.livreeLe || v.date) >= il14)]
  ];
  const aEncaisser = toutes.filter(v => v.livraison.statut !== "livree" || !v.encaisse).filter(v => !v.encaisse).reduce((s, v) => s + totalVente(v), 0);
  let h = `<div class="chips"><div class="chip"><div class="label">En cours</div><div class="v num">${livraisonsEnCours().length}</div></div>
    <div class="chip gold"><div class="label">Argent à récupérer</div><div class="v num">${F(aEncaisser)}</div></div></div>`;
  for (const [cle, titre, liste] of groupes) {
    if (!liste.length) continue;
    h += `<div class="dayhead">${titre} · ${liste.length}</div>`;
    for (const v of liste.sort((a, b) => (a.date || "").localeCompare(b.date || ""))) {
      const l = v.livraison;
      let act = "";
      if (cle === "a-livrer") act = `<a class="mini wa" href="${lienWa(l.telLivreur, texteLivreur(v))}" target="_blank" rel="noopener">Envoyer au livreur</a>
        <button class="mini" data-act="liv-statut" data-id="${v.id}" data-statut="en-route">Partie en livraison</button>`;
      if (cle === "en-route") act = `${numeroWa(v.tel) ? `<a class="mini wa" href="${lienWa(v.tel, texteClientEnRoute(v))}" target="_blank" rel="noopener">Prévenir le client</a>` : ""}
        <button class="mini" data-act="liv-livree" data-id="${v.id}">Livrée</button>`;
      if (cle === "livree" && !v.encaisse) act = `<button class="paid no" data-act="toggle" data-id="${v.id}">Argent pas encore reçu — marquer encaissé</button>`;
      if (cle !== "livree") act += `<button class="mini danger" data-act="liv-echec" data-id="${v.id}">Le client n'a pas pris</button>`;
      h += `<div class="row compact${S.ouvert === v.id ? " open" : ""}" data-row="${v.id}" tabindex="0" aria-expanded="${S.ouvert === v.id}">
        <div><div class="t">${esc(v.client || "Client")} · ${esc(l.commune || "lieu ?")}</div>
        <div class="m">${esc(nomProduit(v.produitId))} × ${+v.qte}${l.livreur ? " · " + esc(l.livreur) : ""}${l.adresse ? " · " + esc(l.adresse) : ""}</div></div>
        <div class="amt num">${F(totalVente(v))}<div class="m">${v.encaisse ? "payé" : "à encaisser"}</div></div>
        <div class="acts">${act}<button class="mini" data-act="edit-vente" data-id="${v.id}">Modifier</button></div></div>`;
    }
  }
  return h;
}
ACTIONS["liv-statut"] = (id, b) => { const v = S.data.ventes.find(x => x.id === id); if (v) { db.modifier("ventes", id, { livraison: { ...v.livraison, statut: b.dataset.statut } }); toast("Commande partie en livraison"); } };
ACTIONS["liv-livree"] = id => {
  const v = S.data.ventes.find(x => x.id === id); if (!v) return;
  const marquer = encaisse => { db.modifier("ventes", id, { livraison: { ...v.livraison, statut: "livree", livreeLe: todayISO() }, ...(encaisse ? { encaisse: true } : {}) }); closeSheet(); toast("Livraison terminée"); };
  if (v.encaisse) return marquer(false);
  openSheet(`<div class="inner"><h2>Commande livrée</h2>
    <p>As-tu reçu les ${F(totalVente(v))} ? Si le livreur les garde encore, la vente reste « à encaisser » et apparaît dans l'argent à récupérer.</p>
    <div class="btns"><button class="btn sec" id="l-pas">Pas encore</button><button class="btn pri" id="l-oui">Oui, argent reçu</button></div></div>`);
  $("#l-pas").addEventListener("click", () => marquer(false));
  $("#l-oui").addEventListener("click", () => marquer(true));
};
ACTIONS["liv-echec"] = id => {
  const v = S.data.ventes.find(x => x.id === id); if (!v) return;
  const frais = fraisLivraison(v);
  openSheet(`<div class="inner"><h2>Commande non prise</h2>
    <p>La vente sera supprimée et ${plur(+v.qte, "pièce revient", "pièces reviennent")} dans ton stock.${frais ? ` Les ${F(frais)} de livraison que tu as payés seront notés en dépense.` : ""}</p>
    <div class="btns"><button class="btn sec" data-close>Annuler</button><button class="btn warn" id="l-ok">Confirmer</button></div></div>`);
  $("#l-ok").addEventListener("click", () => {
    const ops = [{ type: "suppr", col: "ventes", id }];
    if (frais) { const did = nouvelId(); ops.push({ type: "ajout", col: "depenses", id: did, data: { id: did, libelle: "Livraison non prise · " + (v.client || nomProduit(v.produitId)), montant: frais, date: todayISO(), categorie: "Livraison", cree: Date.now() } }); }
    db.appliquer(ops); closeSheet(); toast("Vente annulée, stock remis à jour");
  });
};

/* ================= Actions des nouveaux boutons ================= */
ACTIONS["arrivage"] = () => arrivageForm();
ACTIONS["arrivage-detail"] = id => arrivageDetail(id);
ACTIONS["bilan-image"] = () => bilanImage();
ACTIONS["pin"] = () => pinSheet();
