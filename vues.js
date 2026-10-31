"use strict";
/* ================= Affichage ================= */
const ONGLETS = ["bilan","ventes","stock","vendeurs","depenses"];
const NAV_PROPRIO = document.querySelector("nav.tabs").innerHTML;
/* Remet le menu, le titre et les boutons du propriétaire (après un aperçu ou un passage en espace vendeur) */
/* Logo de la boutique (ou ses initiales) en haut de l'écran */
function majAvatar() {
  const el = document.getElementById("avatar"); if (!el) return;
  const r = S.data.reglages || {}, logo = r.logo;
  const nom = r.boutique || "Cahier de Caisse";
  const ini = nom.split(/\s+/).map(m => m[0] || "").join("").slice(0, 2).toUpperCase();
  const html = logo ? `<img src="${logo}" alt="">` : esc(ini);
  if (el.dataset.k !== (logo || ini)) { el.innerHTML = html; el.dataset.k = logo || ini; }
}
function interfaceProprio() {
  const nav = document.querySelector("nav.tabs");
  if (nav.dataset.mode === "vendeur") { nav.dataset.mode = ""; nav.innerHTML = NAV_PROPRIO; }
  $("#btn-reglages").hidden = false;
  $("header h1").textContent = S.data.reglages.boutique || "Cahier de Caisse";
  $("#fab").hidden = false;
  const b = document.getElementById("bandeau-apercu"); if (b) b.remove();
}
function render() {
  majAvatar();
  if (S.role === "vendeur") return renderVendeurApp();
  if (S.apercu) return renderApercu();
  interfaceProprio();
  if (!ONGLETS.includes(S.tab)) S.tab = "bilan";
  document.querySelectorAll("nav.tabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === S.tab)));
  for (const t of ONGLETS) $("#v-" + t).hidden = t !== S.tab;
  $("#fab").textContent = { depenses: "+ Dépense", stock: "+ Produit", vendeurs: "+ Versement" }[S.tab] || "+ Vente";
  /* Fluidité : on ne dessine que l'onglet affiché ; les autres le seront quand on les ouvre */
  if (S.tab === "bilan") renderBilan(stats(S.periode));
  else if (S.tab === "ventes") renderVentes();
  else if (S.tab === "stock") renderStock(stats("tout"));
  else if (S.tab === "vendeurs") renderVendeurs();
  else if (S.tab === "depenses") renderDepenses();
}

function bannerSauvegarde() {
  if (!stockageOK) return `<div class="banner red"><span>Ce navigateur bloque l'enregistrement. Ouvre l'appli en navigation normale (pas privée).</span></div>`;
  const n = S.data.ventes.length + S.data.depenses.length;
  const j = joursDepuis(S.data.derniereSauvegarde);
  if (n === 0) return "";
  if (j === null || j >= 7) return `<div class="banner"><span>${j === null ? "Tu n'as encore jamais sauvegardé tes données." : "Dernière sauvegarde il y a " + j + " jours."}</span><button class="mini" data-act="exporter">Sauvegarder</button></div>`;
  return "";
}

function renderBilan(st) {
  const el = $("#v-bilan");
  let h = segPeriode() + bannerSauvegarde();
  const tout = stats("tout");
  const bas = Object.values(tout.byProd).filter(b => b.p.mode === "stock" && (+b.p.quantite > 0) && b.restant <= (+b.p.seuil || 0));
  if (bas.length) h += `<div class="banner red"><span><b>Stock bas :</b> ${bas.map(b => esc(nomComplet(b.p)) + " (" + b.restant + ")").join(", ")}. Pense à racheter avant d'être en rupture.</span></div>`;
  const missing = S.data.produits.filter(p => p.mode === "numerique" ? !(+p.prixVente) : (!(+p.cout) || !(+p.quantite)));
  const enCours = livraisonsEnCours();
  if (enCours.length) {
    const al = enCours.filter(v => v.livraison.statut === "a-livrer").length, er = enCours.length - al;
    h += `<button class="banner" data-goto="ventes" data-vue2="livraisons" style="border:0;text-align:left;width:100%"><span><b>Livraisons :</b> ${[al ? al + " à livrer" : "", er ? er + " en route" : ""].filter(Boolean).join(", ")}.</span><span class="mini">Voir</span></button>`;
  }
  const aConfirmer = S.data.versements.filter(x => x.confirme === false);
  if (aConfirmer.length) h += `<button class="banner" data-goto="vendeurs" style="border:0;text-align:left;width:100%"><span><b>${plur(aConfirmer.length, "versement")} à confirmer</b> : ton vendeur dit t'avoir envoyé ${F(aConfirmer.reduce((s, x) => s + (+x.montant || 0), 0))}.</span><span class="mini">Voir</span></button>`;
  if (missing.length) h += `<div class="banner"><span>Complète ${missing.slice(0, 4).map(p => "<b>" + esc(nomComplet(p)) + "</b>").join(", ")}${missing.length > 4 ? " et " + (missing.length - 4) + " autres" : ""} dans l'onglet Stock (coût, quantité ou prix manquant). Sans ça, le bénéfice affiché est faux.</span></div>`;

  const net = Math.round(st.net), abs = F(Math.abs(net));
  const activite = st.nbVentes + st.nbDep > 0;
  let etat, signe, verdict, explique, ligne;
  if (!activite) {
    etat = "zero"; signe = ""; verdict = S.data.ventes.length ? "Aucune activité sur cette période" : "Pas encore de vente";
    explique = S.data.ventes.length ? "Choisis une autre période ou enregistre une vente." : "Enregistre ta première vente pour voir si tu gagnes ou perds de l'argent."; ligne = "= Résultat";
  } else if (net > 0) {
    etat = "gain"; signe = "+"; verdict = "Tu as gagné " + abs;
    explique = "Tes ventes couvrent le coût des produits vendus et tes dépenses, et il te reste ce bénéfice."; ligne = "= Ce que tu as gagné";
  } else if (net < 0) {
    etat = "perte"; signe = "−"; verdict = "Tu as perdu " + abs;
    explique = "Tes ventes ne couvrent pas encore le coût des produits vendus et tes dépenses. Il te manque " + abs + " pour rentrer dans tes frais."; ligne = "= Ce que tu as perdu";
  } else {
    etat = "zero"; signe = ""; verdict = "Ni gain ni perte";
    explique = "Tu as juste récupéré ce que tu as dépensé."; ligne = "= Résultat";
  }
  /* Le bilan se lit comme un ticket de caisse : le verdict en couleur, puis le détail du calcul */
  h += `<div class="hero ${etat === "gain" ? "" : etat}">
    <div class="bandeau">
      <div class="label">Bénéfice net, ${esc(nomPeriode(S.periode))}</div>
      <div class="big num">${signe}${abs}</div>
      <div class="verdict">${verdict}</div>
      <div class="explique">${explique}</div>
    </div>
    <div class="ledger num">
      <div class="arrete">${esc(S.data.reglages.boutique || "Cahier de Caisse")}, arrêté le ${new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}</div>
      <div><span>Ventes (${st.nbVentes})</span><i></i><span>${F(st.ca)}</span></div>
      <div><span>${S.data.ventes.some(v => fraisLivraison(v)) ? "− Coût des produits et livraisons" : "− Coût des produits vendus"}</span><i></i><span>${F(st.cout)}</span></div>
      <div><span>− Dépenses</span><i></i><span>${F(st.dep)}</span></div>
      <div class="tot"><span>${ligne}</span><i></i><span>${signe}${abs}</span></div>
    </div></div>`;

  const obj = +S.data.reglages.objectifMois || 0;
  if (S.periode === "mois") {
    if (obj > 0) {
      const pct = Math.max(0, Math.min(100, net / obj * 100));
      const reste = Math.max(0, obj - net);
      const now = new Date(), fin = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(), joursRestants = fin - now.getDate();
      h += `<div class="card"><div class="head"><span class="label">Objectif du mois</span><span class="num"><b>${F(obj)}</b></span></div>
        <div class="bar" role="img" aria-label="${Math.round(pct)} % de l'objectif"><i style="width:${pct}%"></i></div>
        <div class="note num">${reste === 0 ? "Objectif atteint, bravo. Tu peux viser plus haut dans les Réglages." :
          Math.round(pct) + " % atteint. Il te reste " + F(reste) + " de bénéfice à faire" + (joursRestants > 0 ? " en " + plur(joursRestants, "jour") : " aujourd'hui") + "."}</div></div>`;
    } else {
      h += `<button class="banner" data-act="reglages" style="border:0;text-align:left;width:100%"><span>Fixe-toi un <b>objectif de bénéfice pour le mois</b> : l'appli te montrera ta progression.</span><span class="mini">Fixer</span></button>`;
    }
  }

  const detailRecevoir = [st.aRecevoirVendeurs ? F(st.aRecevoirVendeurs) + " des vendeurs" : "", st.aRecevoirChariow ? F(st.aRecevoirChariow) + " de Chariow" : ""].filter(Boolean).join(", ");
  h += `<div class="chips">
      <div class="chip gold"><div class="label">À recevoir</div><div class="v num">${F(st.aRecevoir)}</div>${detailRecevoir ? `<div class="note num">dont ${detailRecevoir}</div>` : ""}</div>
      <button class="chip" data-goto="stock"><div class="label">Valeur du stock</div><div class="v num">${F(tout.valeurStock)}</div><div class="note num">${plur(tout.piecesStock, "pièce")} · voir le détail</div></button>
    </div>`;

  if (vendeursActifs().length) {
    const lignes = vendeursActifs().map(vd => ({ vd, c: compteVendeur(vd, S.periode) }));
    const verseP = lignes.reduce((s, x) => s + x.c.verseP, 0);
    h += `<button class="card link" data-goto="vendeurs" style="text-align:left;width:100%">
      <div class="head"><span class="label">Tes vendeurs · ${esc(nomPeriode(S.periode))}</span><span class="note">voir le détail</span></div>
      <div class="head"><span>Ils t'ont versé</span><b class="num">${F(verseP)}</b></div>
      ${lignes.map(({ vd, c }) => `<div class="head note num"><span>${esc(vd.nom)} : ${plur(c.piecesP, "pièce vendue", "pièces vendues")}, versé ${F(c.verseP)}</span><span>${c.solde > 0 ? "doit " + F(c.solde) : "à jour"}</span></div>`).join("")}
    </button>`;
  }

  if (activite) h += `<div class="outils"><button class="mini" data-act="bilan-image">Partager ce bilan en image</button></div>`;
  if (st.nbVentes) h += graphique(st.bp);

  h += htmlCarteDodo();
  h += `<div class="label">Par produit, du plus rentable au moins rentable</div>`;
  if (!S.data.produits.length) h += `<div class="empty"><b>Aucun produit</b>Ajoute ton premier produit dans l'onglet Stock.</div>`;
  const liste = Object.values(st.byProd).sort((a, b) => b.benef - a.benef || b.vendus - a.vendus);
  const MAXP = 5;
  liste.slice(0, S.tousProduits ? liste.length : MAXP).forEach((b, i) => {
    const p = b.p, num = p.mode === "numerique", depot = p.mode === "depot";
    const tb = tout.byProd[p.id];
    const q = +p.quantite || 0, pct = !num && q ? Math.min(100, tb.vendusTotal / q * 100) : 0;
    const margeU = b.vendus ? b.benef / b.vendus : (+p.prixVente || 0) - coutVente(p, p.prixVente);
    const tag = num ? `<span class="tag violet">Numérique</span>` : depot ? `<span class="tag gold">Chez ${esc((vendeurDe(p.vendeurId) || {}).nom || "le vendeur")}</span>` : `<span class="tag">En stock</span>`;
    h += `<div class="card prod">
      <div class="top"><div><div class="rank">#${i + 1} · ${esc(p.categorie)}</div><h3>${esc(nomComplet(p))}</h3></div>${tag}</div>
      ${num ? "" : `<div class="bar" role="img" aria-label="${tb.vendusTotal} vendus sur ${q} au total"><i style="width:${pct}%"></i></div>`}
      <div class="kv num">
        <div><span class="note">Vendus</span><b>${b.vendus}</b></div>
        <div><span class="note">${num ? "Stock" : depot ? "Chez le vendeur" : "Restants"}</span><b>${num ? "Illimité" : q ? tb.restant : "?"}</b></div>
        <div><span class="note">Bénéfice</span><b>${F(b.benef)}</b></div>
      </div>
      <div class="note num">Marge par pièce : ${(num || +p.cout || b.vendus) ? F(margeU) : "?"}${p.note ? " · " + esc(p.note) : ""}</div>
    </div>`;
  });
  if (liste.length > MAXP) h += `<button class="btn sec" data-act="tous-produits">${S.tousProduits ? "Voir seulement les 5 premiers" : "Voir les " + liste.length + " produits"}</button>`;
  el.innerHTML = h;
}

/* Graphique des ventes : une barre par jour (ou par mois sur « Tout ») */
function graphique([a, b]) {
  let buckets = [];
  const ventes = S.data.ventes.filter(v => dansPeriode(v.date, [a, b]));
  if (S.periode === "tout") {
    const premier = ventes.reduce((m, v) => v.date < m ? v.date : m, todayISO()).slice(0, 7);
    const now = new Date(); let d = new Date(now.getFullYear(), now.getMonth(), 1);
    while (isoDe(d).slice(0, 7) >= premier && buckets.length < 12) {
      const k = isoDe(d).slice(0, 7);
      buckets.unshift({ k, court: d.toLocaleDateString("fr-FR", { month: "short" }), long: d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }) });
      d = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    }
  } else {
    const d = dateDe(a), fin = dateDe(b);
    while (d <= fin) { const k = isoDe(d); buckets.push({ k, court: String(d.getDate()), long: dayLabel(k) }); d.setDate(d.getDate() + 1); }
  }
  const mois = S.periode === "tout";
  for (const bk of buckets) { bk.ca = 0; bk.n = 0; }
  const idx = Object.fromEntries(buckets.map((bk, i) => [bk.k, i]));
  for (const v of ventes) { const i = idx[mois ? v.date.slice(0, 7) : v.date]; if (i !== undefined) { buckets[i].ca += totalVente(v); buckets[i].n++; } }
  const max = Math.max(...buckets.map(x => x.ca), 1);
  const pas = Math.pow(10, Math.floor(Math.log10(max))), haut = Math.ceil(max / pas) * pas;
  const W = 360, H = 150, pt = 16, pb = 22, ph = H - pt - pb, n = buckets.length;
  const slot = W / n, bw = Math.max(1, Math.min(28, slot - 2));
  let bars = "", hits = "", labels = "";
  const etiq = new Set([0, n - 1, Math.floor((n - 1) / 2)]);
  buckets.forEach((bk, i) => {
    const x = i * slot + (slot - bw) / 2, hgt = bk.ca ? Math.max(3, bk.ca / haut * ph) : 0, y = pt + ph - hgt, r = Math.min(4, bw / 2, hgt);
    if (hgt) bars += `<path d="M${x},${pt + ph} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${pt + ph} Z" fill="var(--bar)" data-i="${i}"/>`;
    hits += `<rect x="${i * slot}" y="0" width="${slot}" height="${H}" fill="transparent" data-i="${i}"/>`;
    if (etiq.has(i) || n <= 12) labels += `<text x="${i === 0 ? i * slot + (slot - bw) / 2 : i === n - 1 ? i * slot + (slot + bw) / 2 : i * slot + slot / 2}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === n - 1 ? "end" : "middle"}" font-size="11" fill="var(--muted)">${esc(bk.court)}</text>`;
  });
  window._buckets = buckets;
  const total = buckets.reduce((s, x) => s + x.ca, 0);
  return `<div class="card chart">
    <div class="head"><span class="label">Ventes ${mois ? "par mois" : "par jour"}</span><span class="note num">Total ${F(total)}</span></div>
    <div class="tip num" id="chart-tip">Touche une barre pour voir le détail.</div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Ventes ${mois ? "par mois" : "par jour"}, total ${F(total)}">
      <line x1="0" x2="${W}" y1="${pt}" y2="${pt}" stroke="var(--grid)" stroke-width="1"/>
      <text x="0" y="${pt - 3}" font-size="11" fill="var(--muted)">${N(haut)} F</text>
      <line x1="0" x2="${W}" y1="${pt + ph}" y2="${pt + ph}" stroke="var(--line)" stroke-width="1"/>
      ${bars}${labels}<g id="chart-hits">${hits}</g>
    </svg></div>`;
}
function montrerBarre(i) {
  const bk = (window._buckets || [])[i]; if (!bk) return;
  $("#chart-tip").innerHTML = `<b>${esc(bk.long)}</b> : ${bk.n ? F(bk.ca) + " · " + bk.n + " vente" + (bk.n > 1 ? "s" : "") : "aucune vente"}`;
  document.querySelectorAll(".chart path[data-i]").forEach(p => p.setAttribute("fill", p.dataset.i == i ? "var(--bar-hi)" : "var(--bar)"));
}
document.addEventListener("pointerover", e => { const r = e.target.closest && e.target.closest("#chart-hits rect"); if (r) montrerBarre(+r.dataset.i); });
document.addEventListener("click", e => { const r = e.target.closest && e.target.closest("#chart-hits rect"); if (r) montrerBarre(+r.dataset.i); });

/* ---------- Messages WhatsApp ---------- */
function texteRecu(v) {
  const p = produitDe(v.produitId) || {}, r = S.data.reglages;
  let t = `Bonjour${v.client ? " " + v.client : ""}, merci pour ton achat !\n\n`;
  t += `Reçu du ${dateCourte(v.date)}\n${nomProduit(v.produitId)} × ${v.qte} : ${F(totalVente(v))}\n`;
  t += `Paiement : ${v.paiement || "—"}${v.encaisse ? " (payé)" : " (à régler)"}\n`;
  if (p.mode === "numerique" && p.lien) t += `\nTon lien : ${p.lien}\n`;
  if (!v.encaisse && r.numero) t += `\nTu peux payer par Mobile Money au ${r.numero}.\n`;
  t += `\nÀ bientôt${r.boutique ? " chez " + r.boutique : ""} !`;
  return t;
}
/* Vente Chariow : Chariow a déjà livré le fichier. On remercie et on invite à partager. */
function texteMerci(v) {
  const p = produitDe(v.produitId) || {}, r = S.data.reglages;
  let t = `Bonjour${v.client ? " " + v.client : ""}, merci d'avoir acheté « ${nomProduit(v.produitId)} » !\n\n`;
  t += `Tu as bien reçu ton fichier ? Si tu as un souci de téléchargement, réponds-moi ici.\n`;
  if (p.lien) t += `\nSi le guide t'est utile, partage-le à tes proches : ${p.lien}\n`;
  t += `\nÀ bientôt${r.boutique ? " — " + r.boutique : ""} !`;
  return t;
}
function texteRelance(v) {
  const r = S.data.reglages;
  return `Bonjour${v.client ? " " + v.client : ""}, petit rappel pour le paiement de ${nomProduit(v.produitId)} (${F(totalVente(v))}) du ${dateCourte(v.date)}.` +
    (r.numero ? ` Tu peux payer par Wave ou Orange Money au ${r.numero}.` : "") + ` Merci !${r.boutique ? "\n— " + r.boutique : ""}`;
}

/* ---------- Ventes (et Clients) ---------- */
function renderVentes() {
  const el = $("#v-ventes");
  const nLiv = livraisonsEnCours().length;
  const sw = `<div class="seg" role="group" aria-label="Affichage"><button data-vue="ventes" aria-pressed="${S.vue === "ventes"}">Ventes</button><button data-vue="livraisons" aria-pressed="${S.vue === "livraisons"}">Livraisons${nLiv ? " (" + nLiv + ")" : ""}</button><button data-vue="clients" aria-pressed="${S.vue === "clients"}">Clients</button></div>`;
  if (S.vue === "clients") { el.innerHTML = sw + htmlClients(); return; }
  if (S.vue === "livraisons") { el.innerHTML = sw + htmlLivraisons(); return; }
  const outilsVentes = `<div class="outils"><button class="mini" data-act="commande">Commande reçue sur WhatsApp</button></div>`;
  if (!S.data.ventes.length) { el.innerHTML = sw + outilsVentes + `<div class="empty"><b>Aucune vente enregistrée</b>Touche « + Vente » à chaque vente, même petite. C'est ce qui rend ton bilan juste.</div>`; return; }
  const q = norm(S.q), bp = bornes(S.periode);
  const list = [...S.data.ventes]
    .filter(v => q ? norm([nomProduit(v.produitId), v.client, v.tel, v.paiement, (vendeurDe(v.vendeurId) || {}).nom].join(" ")).includes(q) : dansPeriode(v.date, bp))
    .sort((a,b) => (b.date||"").localeCompare(a.date||"") || (b.cree||0) - (a.cree||0));
  const jours = {};
  for (const v of list) { const j = jours[v.date] || (jours[v.date] = { n: 0, total: 0 }); j.n++; j.total += totalVente(v); }
  const totalListe = list.reduce((t, v) => t + totalVente(v), 0);
  let h = sw + outilsVentes + segPeriode() + `<input class="search" id="q-ventes" type="search" placeholder="Chercher un produit, un client, un vendeur…" value="${esc(S.q)}" aria-label="Chercher dans les ventes">`;
  h += `<div class="note num">${q ? "Recherche dans toutes les périodes : " : ""}${plur(list.length, "vente")} · ${F(totalListe)}${q ? "" : " · " + esc(nomPeriode(S.periode))}${list.length ? ". Touche une vente pour la modifier, l'encaisser ou écrire au client." : ""}</div>`;
  if (!list.length) h += q ? `<div class="empty">Aucune vente ne correspond à « ${esc(S.q)} ».</div>`
    : `<div class="empty"><b>Aucune vente sur cette période</b>Choisis « Tout » pour voir tout l'historique.</div>`;
  let last = "";
  for (const v of list.slice(0, S.limV)) {
    if (v.date !== last) { const j = jours[v.date]; h += `<div class="dayhead num">${esc(dayLabel(v.date))} · ${plur(j.n, "vente")} · ${F(j.total)}</div>`; last = v.date; }
    const depot = estDepot(v), vd = depot ? vendeurDe(v.vendeurId) : null;
    const meta = depot
      ? [`Vendu par ${vd ? vd.nom : "le vendeur"}`, v.prixClient ? "client a payé " + F(v.prixClient) + "/pièce" : ""].filter(Boolean).map(esc).join(" · ") + (v.auteur === "vendeur" ? ` <span class="tag">Notée par ${esc(vd ? vd.nom : "le vendeur")}</span>` : "")
      : ([v.client, v.paiement].filter(Boolean).map(esc).join(" · ") || "&nbsp;") + (v.encaisse ? "" : ` <span class="tag gold">${estChariow(v) ? "Versement attendu" : "À recevoir"}</span>`)
        + (v.livraison && v.livraison.statut !== "livree" ? ` <span class="tag violet">${STATUTS_LIV[v.livraison.statut]}</span>` : "")
        + (v.auteur === "vendeur" ? ` <span class="tag">Ajoutée par le vendeur</span>` : "")
        + (v.source === "boutique" ? ` <span class="tag">Boutique en ligne</span>` : "");
    const pAttendu = depot && v.auteur === "vendeur" && vd && produitDe(v.produitId) ? reverse(vd, produitDe(v.produitId), v.prixClient) : null;
    const aVerifier = !v.ajuste && pAttendu !== null && Math.abs(pAttendu - (+v.prix || 0)) > 1;
    const pv = depot ? partageVente(v) : null;
    const lignePartage = pv ? `<br>Bénéfice ${F(pv.benefice)} : toi ${F(pv.maPart)} · ${esc(vd ? vd.nom : "lui")} ${F(pv.saPart)}${v.ajuste ? ` <span class="tag gold">ajusté</span>` : ""}` : "";
    let actions = "";
    if (depot) actions = `<button class="mini" data-act="releve" data-id="${v.vendeurId}">Compte de ${esc(vd ? vd.nom : "vendeur")}</button>`;
    else {
      actions = `<button class="paid ${v.encaisse ? "yes" : "no"}" data-act="toggle" data-id="${v.id}">${v.encaisse ? "Encaissé ✓" : estChariow(v) ? "Versement Chariow attendu — marquer reçu" : "À recevoir — marquer encaissé"}</button>`;
      actions += estChariow(v)
        ? (numeroWa(v.tel) ? `<a class="mini wa" href="${lienWa(v.tel, texteMerci(v))}" target="_blank" rel="noopener">Remercier</a>` : "")
        : `<a class="mini wa" href="${lienWa(v.tel, v.encaisse ? texteRecu(v) : texteRelance(v))}" target="_blank" rel="noopener">${v.encaisse ? "Envoyer le reçu" : "Relancer"}</a>`;
    }
    h += `<div class="row compact${S.ouvert === v.id ? " open" : ""}" data-row="${v.id}" tabindex="0" aria-expanded="${S.ouvert === v.id}">
      <div><div class="t">${esc(nomProduit(v.produitId))} × ${+v.qte}</div><div class="m">${meta}${lignePartage}${aVerifier ? ` <span class="tag red">À vérifier : selon ta règle il te doit ${F(pAttendu)}/pièce</span>` : ""}</div></div>
      <div class="amt num">${F(totalVente(v))}<div class="m">${beneficeVente(v) >= 0 ? "+" : "−"}${F(Math.abs(beneficeVente(v)))}</div></div>
      <div class="acts">${actions}
        <button class="mini" data-act="edit-vente" data-id="${v.id}">Modifier</button>
        <button class="mini danger" data-act="del" data-col="ventes" data-id="${v.id}">Supprimer</button>
      </div></div>`;
  }
  h += boutonPlus("limV", list.length - S.limV, "ventes");
  el.innerHTML = h;
}

/* ---------- Stock : catégorie > produit > variantes ---------- */
function texteProduit(p) {
  const r = S.data.reglages;
  return `${nomComplet(p)}\n\n${p.accroche ? p.accroche + "\n\n" : ""}${+p.prixVente ? "Seulement " + F(p.prixVente) + ". " : ""}Paiement par Mobile Money, téléchargement immédiat.\n\nC'est ici : ${p.lien}${r.boutique ? "\n\n— " + r.boutique : ""}`;
}
function ligneProduit(p, b, dansGroupe) {
  const num = p.mode === "numerique", depot = p.mode === "depot";
  const bas = p.mode === "stock" && +p.quantite > 0 && b.restant <= (+p.seuil || 0);
  const titre = dansGroupe ? (p.variante || "Modèle standard") : nomComplet(p);
  let meta, droite;
  if (num) {
    meta = `${p.plateforme === "chariow" ? "Chariow · " : ""}Prix ${+p.prixVente ? F(p.prixVente) : "?"}${+p.commission ? " · commission " + p.commission + " %" : ""} · tu touches ${F((+p.prixVente || 0) - coutVente(p, p.prixVente))}`;
    droite = `<span class="tag violet">Illimité</span>`;
  } else {
    const vd = depot ? vendeurDe(p.vendeurId) : null;
    meta = `Coût ${+p.cout ? F(p.cout) : "?"} · prix ${+p.prixVente ? F(p.prixVente) : "?"}${depot ? " · chez " + esc(vd ? vd.nom : "le vendeur") : ""}`;
    droite = !(+p.quantite) ? `<span class="tag red">À compléter</span>`
      : `${plur(b.restant, "pièce")}<div class="m">${F(b.valeur)}</div>${bas ? `<span class="tag red">Stock bas</span>` : ""}`;
  }
  const actions = `<button class="mini wa" data-act="partager-produit" data-id="${p.id}">Partager</button>` + (+p.prixVente ? `<button class="mini" data-act="promo" data-id="${p.id}">${+p.prixAvant > +p.prixVente ? "Promo en cours" : "Promo"}</button>` : "") + (num
    ? (p.lien ? `<button class="mini" data-act="copier" data-id="${p.id}">Copier le lien</button>` : "")
    : `<button class="mini" data-act="restock" data-id="${p.id}">${depot ? "Confier plus" : "Réapprovisionner"}</button>`);
  if (depot && !p.vendeurVoitCout) meta += ` · <span class="tag">coût caché au vendeur</span>`;
  return `<div class="row compact${S.ouvert === p.id ? " open" : ""}" data-row="${p.id}" tabindex="0" aria-expanded="${S.ouvert === p.id}">
    <div class="avec-vignette">${PHOTOS[p.id] ? `<img class="vignette" src="${vignette(p.id)}" alt="" loading="lazy">` : ""}<div style="min-width:0"><div class="t">${esc(titre)}${photosDe(p.id).length > 1 ? ` <span class="note">· ${photosDe(p.id).length} photos</span>` : ""}${+p.prixAvant > +p.prixVente ? ` <span class="tag red">Promo</span>` : ""}${p.horsBoutique ? ` <span class="tag">Pas en ligne</span>` : ""}${tagDodo(p.id)}</div><div class="m num">${meta}</div></div></div>
    <div class="amt num">${droite}</div>
    <div class="acts">${actions}
      <button class="mini" data-act="edit" data-id="${p.id}">Modifier</button>
      ${num ? "" : `<button class="mini" data-act="variante" data-id="${p.id}">+ Variante</button>`}
      <button class="mini danger" data-act="del" data-col="produits" data-id="${p.id}">Supprimer</button>
    </div></div>`;
}
function renderStock(st) {
  const el = $("#v-stock");
  majDodo();
  const vt = reglagesVitrine();
  const outils = `<div class="outils"><button class="mini" data-act="arrivage">+ Nouvel arrivage</button>${S.data.produits.length ? `<button class="mini" data-act="catalogue">Catalogue à partager</button><button class="mini${vt.active ? " wa" : ""}" data-act="vitrine">${vt.active ? "Boutique en ligne ✓" : "Boutique en ligne"}</button>` : ""}</div>`;
  if (!S.data.produits.length) { el.innerHTML = outils + `<div class="empty"><b>Aucun produit</b>Ajoute chaque produit avec sa catégorie (Chaussures, Tech, E-books…). Si un même produit existe en plusieurs modèles ou prix, ajoute-les comme variantes. Pour une commande de Chine, utilise « Nouvel arrivage » : l'appli répartit le transport et la douane sur chaque pièce.</div>`; return; }
  /* Regroupe par catégorie, puis par nom de produit */
  const cats = new Map();
  for (const p of S.data.produits) {
    const ck = p.categorie || "Divers";
    if (!cats.has(ck)) cats.set(ck, { nom: ck, valeur: 0, pieces: 0, num: true, groupes: new Map() });
    const c = cats.get(ck), b = st.byProd[p.id];
    if (p.mode !== "numerique") { c.valeur += b.valeur; c.pieces += b.restant; c.num = false; }
    const gk = norm(p.nom);
    if (!c.groupes.has(gk)) c.groupes.set(gk, { nom: p.nom, items: [], valeur: 0, pieces: 0 });
    const g = c.groupes.get(gk);
    g.items.push(p);
    if (p.mode !== "numerique") { g.valeur += b.valeur; g.pieces += b.restant; }
  }
  const listeCats = [...cats.values()].sort((a, b) => (a.num - b.num) || b.valeur - a.valeur || a.nom.localeCompare(b.nom));
  let h = outils + `<div class="total-stock"><div class="label">Valeur totale du stock</div><div class="big num">${F(st.valeurStock)}</div>
    <div class="note num">${plur(st.piecesStock, "pièce")} au prix de revient${st.valeurChezVendeurs ? ", dont " + F(st.valeurChezVendeurs) + " chez tes vendeurs" : ""}</div></div>`;
  if (listeCats.length > 1) h += `<div class="card">${listeCats.map(c => `<div class="head num"><span>${esc(c.nom)}</span><span>${c.num ? "numérique" : F(c.valeur) + " · " + (st.valeurStock ? Math.round(c.valeur / st.valeurStock * 100) : 0) + " %"}</span></div>${c.num ? "" : `<div class="bar"><i style="width:${st.valeurStock ? c.valeur / st.valeurStock * 100 : 0}%"></i></div>`}`).join("")}</div>`;
  h += `<div class="note">Touche une ligne pour la modifier, la réapprovisionner ou ajouter une variante (autre modèle, autre prix).</div>`;
  for (const c of listeCats) {
    h += `<div class="cat"><div class="cat-head"><h2>${esc(c.nom)}</h2><span class="num">${c.num ? `<span class="tag violet">Numérique</span>` : `<span class="v">${F(c.valeur)}</span> <span class="note">· ${plur(c.pieces, "pièce")}</span>`}</span></div>`;
    for (const g of c.groupes.values()) {
      const items = g.items.sort((a, b) => (a.variante || "").localeCompare(b.variante || ""));
      if (items.length === 1 && !items[0].variante) { h += ligneProduit(items[0], st.byProd[items[0].id], false); continue; }
      const num = items.every(p => p.mode === "numerique");
      h += `<div class="groupe"><div class="gh"><span class="t">${esc(g.nom)}</span><span class="note num">${plur(items.length, "variante")}${num ? "" : " · " + plur(g.pieces, "pièce") + " · <b>" + F(g.valeur) + "</b>"}</span></div>
        ${items.map(p => ligneProduit(p, st.byProd[p.id], true)).join("")}</div>`;
    }
    h += `</div>`;
  }
  const arr = [...S.data.arrivages].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 5);
  if (arr.length) {
    h += `<div class="label">Derniers arrivages</div>`;
    for (const a of arr) h += `<button class="row" data-act="arrivage-detail" data-id="${a.id}" style="text-align:left;width:100%">
      <div><div class="t">${esc(dateCourte(a.date))}${a.fournisseur ? " · " + esc(a.fournisseur) : ""}</div><div class="m num">${plur(a.lignes.reduce((s, l) => s + l.qte, 0), "pièce")} · ${plur(a.lignes.length, "article")}</div></div>
      <div class="amt num">${F(a.totalAchat + a.totalFrais)}<div class="m">dont frais ${F(a.totalFrais)}</div></div></button>`;
  }
  el.innerHTML = h;
}

/* ---------- Vendeurs ---------- */
function renderVendeurs() {
  const el = $("#v-vendeurs");
  if (!vendeursActifs().length) {
    el.innerHTML = `<div class="empty"><b>Aucun vendeur</b>Si tu confies des produits à quelqu'un qui les vend pour toi, ajoute-le ici. Tu choisis comment il te reverse l'argent (ton coût + une part du bénéfice, un pourcentage, ou un montant fixe) et l'appli calcule ce qu'il te doit.</div>
      <button class="btn pri" data-act="nouveau-vendeur">Ajouter un vendeur</button>`;
    return;
  }
  const lignes = vendeursActifs().map(vd => ({ vd, c: compteVendeur(vd, S.periode) }));
  const verseP = lignes.reduce((s, x) => s + x.c.verseP, 0), duP = lignes.reduce((s, x) => s + x.c.duP, 0);
  const solde = lignes.reduce((s, x) => s + Math.max(0, x.c.solde), 0);
  let h = segPeriode() + `<div class="chips">
    <div class="chip"><div class="label">Versé · ${esc(PERIODES[S.periode])}</div><div class="v num">${F(verseP)}</div><div class="note num">sur ${F(duP)} dus pour la période</div></div>
    <div class="chip gold"><div class="label">Ils te doivent encore</div><div class="v num">${F(solde)}</div><div class="note">toutes périodes</div></div></div>`;
  for (const { vd, c } of lignes) {
    const r = S.data.reglages;
    const msg = `Bonjour ${vd.nom}, on fait le point ? Selon mon cahier : ${plur(c.piecesP, "pièce vendue", "pièces vendues")} (${nomPeriode(S.periode)}), tu m'as versé ${F(c.verse)} au total et il reste ${F(Math.max(0, c.solde))} à me verser. Il te reste ${plur(c.piecesChezLui, "pièce")} en stock.${r.numero ? " Tu peux m'envoyer au " + r.numero + "." : ""} Merci !`;
    h += `<div class="card">
      <div class="head"><h3 style="font-size:18px">${esc(vd.nom)}</h3><span class="tag ${c.solde > 0 ? "gold" : ""}">${c.solde > 0 ? "Doit " + F(c.solde) : "À jour"}</span></div>
      <div class="note">${esc(resumeRegle(vd))}${vd.tel ? " · " + esc(vd.tel) : ""}${vd.uid ? ` · <span class="tag">a l'appli</span>` : ""}</div>
      ${S.data.versements.filter(x => x.vendeurId === vd.id && x.confirme === false).map(x => `<div class="banner"><span>${esc(vd.nom)} dit t'avoir envoyé <b>${F(x.montant)}</b> le ${esc(dateCourte(x.date))}${x.note ? " (" + esc(x.note) + ")" : ""}.</span>
        <span class="btns"><button class="mini" data-act="vers-refuser" data-id="${x.id}">Pas reçu</button><button class="mini wa" data-act="vers-confirmer" data-id="${x.id}">Reçu</button></span></div>`).join("")}
      <div class="kv num">
        <div><span class="note">Pièces vendues</span><b>${c.piecesP}</b></div>
        <div><span class="note">Dû pour la période</span><b>${F(c.duP)}</b></div>
        <div><span class="note">Versé</span><b>${F(c.verseP)}</b></div>
      </div>
      <div class="note num">${esc(nomPeriode(S.periode))} : ${c.caClientP ? "les clients ont payé " + F(c.caClientP) + ", " : ""}ton bénéfice sur ses ventes est de ${F(c.benefP)}, lui a gagné ${F(c.gainP)}. Encore chez lui : ${plur(c.piecesChezLui, "pièce")} (${F(c.valeurChezLui)}).</div>
      <div class="btns" style="flex-wrap:wrap">
        <button class="mini wa" data-act="versement" data-id="${vd.id}">+ Versement reçu</button>
        <button class="mini" data-act="releve" data-id="${vd.id}">Relevé</button>
        ${numeroWa(vd.tel) ? `<a class="mini" href="${lienWa(vd.tel, msg)}" target="_blank" rel="noopener">Faire le point sur WhatsApp</a>` : ""}
        <button class="mini" data-act="edit-vendeur" data-id="${vd.id}">Modifier</button>
        <button class="mini" data-act="apercu" data-id="${vd.id}">Aperçu de son espace</button>
      </div>${htmlAccesVendeur(vd)}</div>`;
  }
  h += `<button class="btn sec" data-act="nouveau-vendeur">Ajouter un vendeur</button>`;
  el.innerHTML = h;
}

/* Relevé : toutes les ventes et tous les versements, avec le solde au fil du temps */
function releveSheet(vd) {
  const mouvements = [
    ...S.data.ventes.filter(v => v.vendeurId === vd.id).map(v => ({ date: v.date, cree: v.cree || 0, t: `${nomProduit(v.produitId)} × ${v.qte}`, montant: totalVente(v), type: "vente" })),
    ...S.data.versements.filter(x => x.vendeurId === vd.id).map(x => ({ date: x.date, cree: x.cree || 0, t: "Versement reçu" + (x.note ? " · " + x.note : ""), montant: -(+x.montant || 0), type: "vers", id: x.id }))
  ].sort((a, b) => a.date.localeCompare(b.date) || a.cree - b.cree);
  let solde = 0;
  for (const m of mouvements) { solde += m.montant; m.solde = solde; }
  const c = compteVendeur(vd, "tout");
  const lignes = mouvements.slice().reverse().slice(0, 100);
  openSheet(`<div class="inner"><h2>Compte de ${esc(vd.nom)}</h2>
    <div class="box num"><div>Il t'a dû <b>${F(c.du)}</b> pour ses ventes et t'a versé <b>${F(c.verse)}</b>.</div>
      <div>${c.solde > 0 ? `Il te doit encore <b>${F(c.solde)}</b>.` : c.solde < 0 ? `Il t'a versé <b>${F(-c.solde)}</b> d'avance.` : "Vous êtes à jour."}</div></div>
    ${mouvements.length ? `<div class="releve num">${lignes.map(m => `<div class="l ${m.type === "vers" ? "vers" : ""}">
        <div><div>${esc(m.t)}</div><div class="d">${esc(dayLabel(m.date))}${m.type === "vers" ? ` · <button class="mini danger" data-act="del-versement" data-id="${m.id}" style="padding:1px 8px;font-size:12px">Supprimer</button>` : ""}</div></div>
        <div class="${m.montant >= 0 ? "plus" : "moins"}">${m.montant >= 0 ? "+" : "−"}${F(Math.abs(m.montant))}</div>
        <div class="s">reste ${F(m.solde)}</div></div>`).join("")}</div>
      ${mouvements.length > 100 ? `<p class="hint">Seuls les 100 derniers mouvements sont affichés.</p>` : ""}`
      : `<div class="empty">Aucune vente ni aucun versement pour l'instant.</div>`}
    <p class="hint">« + » : ce qu'il te doit pour une vente. « − » : un versement qu'il t'a fait.</p>
    <div class="btns"><button class="btn sec" data-close>Fermer</button><button class="btn pri" data-act="versement" data-id="${vd.id}">+ Versement</button></div>
  </div>`);
}

/* ---------- Dépenses ---------- */
function renderDepenses() {
  const el = $("#v-depenses");
  if (!S.data.depenses.length) { el.innerHTML = `<div class="empty"><b>Aucune dépense</b>Note tout ce que le business te coûte en plus des produits : pub, transport, livraison, emballage, création d'un e-book, crédit téléphone.</div>`; return; }
  const bp = bornes(S.periode);
  const list = S.data.depenses.filter(d => dansPeriode(d.date, bp)).sort((a,b) => (b.date||"").localeCompare(a.date||"") || (b.cree||0) - (a.cree||0));
  if (!list.length) { el.innerHTML = segPeriode() + `<div class="empty"><b>Aucune dépense sur cette période</b>Choisis « Tout » pour voir tout l'historique.</div>`; return; }
  const tot = list.reduce((s,d) => s + (+d.montant||0), 0);
  const parCat = {};
  for (const d of list) parCat[d.categorie || "Autre"] = (parCat[d.categorie || "Autre"] || 0) + (+d.montant || 0);
  const cats = Object.entries(parCat).sort((a, b) => b[1] - a[1]);
  let h = segPeriode() + `<div class="card"><div class="head"><span class="label">Dépenses · ${esc(nomPeriode(S.periode))}</span><b class="num">${F(tot)}</b></div>
    ${cats.map(([c, m]) => `<div><div class="head note num"><span>${esc(c)}</span><span>${F(m)} · ${tot ? Math.round(m / tot * 100) : 0} %</span></div><div class="bar"><i style="width:${tot ? m / tot * 100 : 0}%"></i></div></div>`).join("")}</div>`;
  for (const d of list.slice(0, S.limD)) h += `<div class="row compact${S.ouvert === d.id ? " open" : ""}" data-row="${d.id}" tabindex="0" aria-expanded="${S.ouvert === d.id}">
    <div><div class="t">${esc(d.libelle)}</div><div class="m">${esc(dayLabel(d.date))} · ${esc(d.categorie || "Autre")}</div></div>
    <div class="amt num">${F(d.montant)}</div>
    <div class="acts"><button class="mini" data-act="edit-dep" data-id="${d.id}">Modifier</button><button class="mini danger" data-act="del" data-col="depenses" data-id="${d.id}">Supprimer</button></div>
  </div>`;
  h += boutonPlus("limD", list.length - S.limD, "dépenses");
  el.innerHTML = h;
}

