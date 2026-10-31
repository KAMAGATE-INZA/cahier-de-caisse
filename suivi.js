"use strict";
/* =====================================================================
   Suivi des clients (fiches, historique, relances WhatsApp)
   et produits qui dorment (rien vendu depuis longtemps → promo, partage).
   ===================================================================== */

/* ---------- Clients ----------
   Un client = les ventes où tu as noté son nom ou son numéro, plus sa fiche
   (quartier, note) si tu en as créé une. Le numéro sert de clé ; sans numéro, le nom. */
const cleClientDe = (tel, nom) => numeroWa(tel) || (String(nom || "").trim() ? "nom:" + norm(nom) : "");
const JOURS_RELANCE = 30;
function clients() {
  const map = new Map(), alias = new Map();
  const vide = cle => ({ cle, nom: "", tel: "", quartier: "", note: "", fiche: null, achats: 0, total: 0, du: 0, dernier: "", premier: "", ventes: [], produits: {} });
  /* un nom déjà associé à un numéro (fiche ou vente) : ses ventes sans numéro vont au même client */
  for (const f of S.data.clients || []) if (numeroWa(f.tel) && f.nom) alias.set("nom:" + norm(f.nom), numeroWa(f.tel));
  for (const v of S.data.ventes) if (numeroWa(v.tel) && (v.client || "").trim() && !alias.has("nom:" + norm(v.client))) alias.set("nom:" + norm(v.client), numeroWa(v.tel));
  const cleDe = (tel, nom) => { const c = cleClientDe(tel, nom); return c.startsWith("nom:") && alias.has(c) ? alias.get(c) : c; };
  for (const f of S.data.clients || []) {
    const cle = cleDe(f.tel, f.nom); if (!cle) continue;
    const c = map.get(cle) || vide(cle);
    Object.assign(c, { nom: f.nom || c.nom, tel: f.tel || c.tel, quartier: f.quartier || "", note: f.note || "", fiche: f });
    map.set(cle, c);
  }
  for (const v of S.data.ventes) {
    const cle = cleDe(v.tel, v.client); if (!cle) continue;
    if (!map.has(cle)) map.set(cle, vide(cle));
    const c = map.get(cle);
    if (!c.nom && (v.client || "").trim()) c.nom = v.client.trim();
    if (!c.tel && v.tel) c.tel = v.tel;
    c.achats++; c.total += totalVente(v); c.ventes.push(v);
    if (!v.encaisse && !estChariow(v) && !estDepot(v)) c.du += totalVente(v);
    if (v.date > c.dernier) c.dernier = v.date;
    if (!c.premier || v.date < c.premier) c.premier = v.date;
    c.produits[v.produitId] = (c.produits[v.produitId] || 0) + (+v.qte || 0);
  }
  const auj = dateDe(todayISO()).getTime();
  for (const c of map.values()) c.jours = c.dernier ? Math.round((auj - dateDe(c.dernier).getTime()) / 86400000) : null; /* en jours de calendrier */
  return [...map.values()].sort((a, b) => b.total - a.total || (b.dernier || "").localeCompare(a.dernier || ""));
}
const aRelancer = c => c.achats > 0 && c.jours >= JOURS_RELANCE && !!numeroWa(c.tel) && c.du <= 0;
const FILTRES_CLIENTS = {
  tous: { nom: "Tous", f: () => true },
  relancer: { nom: "À relancer", f: aRelancer },
  doivent: { nom: "Doivent", f: c => c.du > 0 },
  fideles: { nom: "Fidèles", f: c => c.achats > 1 }
};
const prenomDe = c => (c.nom || "").split(/\s+/)[0];

/* Messages WhatsApp selon la situation du client */
function messagesClient(c) {
  const r = S.data.reglages, b = r.boutique ? " " + r.boutique : "", p = prenomDe(c) ? " " + prenomDe(c) : "";
  const v = typeof reglagesVitrine === "function" ? reglagesVitrine() : {};
  const lien = v.active && v.nom && typeof lienVitrine === "function" ? lienVitrine(v) : "";
  const dernierProduit = c.ventes.length ? nomProduit([...c.ventes].sort((x, y) => (y.date || "").localeCompare(x.date || ""))[0].produitId) : "";
  const m = [];
  if (c.du > 0) m.push({ t: "Relancer le paiement", texte: `Bonjour${p}, petit rappel : il reste ${F(c.du)} à régler pour tes achats.` + (r.numero ? ` Tu peux payer par Wave ou Orange Money au ${r.numero}.` : "") + ` Merci !${b ? "\n—" + b : ""}` });
  if (c.jours !== null && c.jours <= 7 && dernierProduit) m.push({ t: "Prendre des nouvelles", texte: `Bonjour${p} ! Merci encore pour ton achat (${dernierProduit}). Tout se passe bien ? Si tu es content(e), un petit avis me ferait plaisir.${b ? "\n—" + b : ""}` });
  m.push({ t: lien ? "Envoyer la boutique" : "Proposer les nouveautés", texte: lien
    ? `Bonjour${p} ! C'est${b || " moi"}. J'ai de nouveaux articles qui pourraient te plaire, regarde ici :\n${lien}\n\nDis-moi si quelque chose t'intéresse, je te le réserve.`
    : `Bonjour${p} ! C'est${b || " moi"}. J'ai des nouveautés qui pourraient te plaire. Je t'envoie les photos ?` });
  return m;
}

function htmlClients() {
  const all = clients();
  const r = S.data.reglages;
  const ajout = `<button class="btn sec" data-act="nouveau-client">+ Ajouter un client</button>`;
  if (!all.length) return `<div class="empty"><b>Aucun client pour l'instant</b>Quand tu notes le nom ou le numéro du client dans une vente, il apparaît ici avec tout son historique. Tu pourras le relancer sur WhatsApp en un geste.</div>` + ajout;
  const f = FILTRES_CLIENTS[S.filtreC] ? S.filtreC : "tous";
  const q = norm(S.qc);
  const parFiltre = all.filter(FILTRES_CLIENTS[f].f);
  const list = parFiltre.filter(c => !q || norm([c.nom, c.tel, c.quartier, c.note].join(" ")).includes(q));
  if (f === "relancer") list.sort((a, b) => b.total - a.total);
  if (f === "doivent") list.sort((a, b) => b.du - a.du);
  if (f === "fideles") list.sort((a, b) => b.achats - a.achats || b.total - a.total);
  const nb = k => all.filter(FILTRES_CLIENTS[k].f).length;
  const fideles = nb("fideles"), totalClients = all.reduce((s, c) => s + c.total, 0);
  let h = `<div class="chips"><div class="chip"><div class="label">Clients</div><div class="v num">${all.length}</div><div class="note num">${fideles ? plur(fideles, "est revenu", "sont revenus") + " plusieurs fois" : "&nbsp;"}</div></div>
    <div class="chip"><div class="label">Panier moyen</div><div class="v num">${F(totalClients / Math.max(1, all.reduce((s, c) => s + c.achats, 0)))}</div><div class="note">par achat</div></div></div>
    <div class="seg" role="group" aria-label="Filtrer les clients">${Object.entries(FILTRES_CLIENTS).map(([k, x]) => { const n = k === "tous" ? all.length : nb(k); return `<button data-act="filtre-clients" data-id="${k}" aria-pressed="${k === f}">${x.nom}${k !== "tous" && n ? " (" + n + ")" : ""}</button>`; }).join("")}</div>
    <input class="search" id="q-clients" type="search" placeholder="Chercher un nom, un numéro, un quartier…" value="${esc(S.qc)}" aria-label="Chercher un client">`;
  if (f === "relancer") h += `<div class="note">Clients qui n'ont rien acheté depuis ${JOURS_RELANCE} jours ou plus : un petit message suffit souvent à les faire revenir. Les meilleurs clients sont en haut.</div>`;
  if (f === "doivent") h += `<div class="note num">Ils te doivent ${F(parFiltre.reduce((s, c) => s + c.du, 0))} au total.</div>`;
  if (q) h += `<div class="note">${plur(list.length, "client trouvé", "clients trouvés")}</div>`;
  if (!list.length && !q) h += `<div class="empty">${f === "relancer" ? "Personne à relancer pour l'instant : tous tes clients ont acheté récemment, ou leur numéro n'est pas noté." : f === "doivent" ? "Personne ne te doit d'argent." : "Pas encore de client revenu une deuxième fois."}</div>`;
  for (const c of list.slice(0, S.limC)) {
    const msg = messagesClient(c), principal = f === "doivent" || c.du > 0 ? msg[0] : msg[msg.length - 1];
    h += `<div class="row client" data-act="client" data-id="${esc(c.cle)}" role="button" tabindex="0">
      <div><div class="t">${esc(c.nom || c.tel)}${c.achats > 1 ? ` <span class="tag">Fidèle</span>` : ""}${c.du > 0 ? ` <span class="tag gold">Doit ${F(c.du)}</span>` : ""}</div>
      <div class="m num">${c.achats ? plur(c.achats, "achat") + " · dernier " + (c.jours <= 0 ? "aujourd'hui" : "il y a " + c.jours + " j") : "Pas encore d'achat"}${c.quartier ? " · " + esc(c.quartier) : ""}</div></div>
      <div class="amt num">${F(c.total)}</div>
      ${numeroWa(c.tel) && (f !== "tous" || c.du > 0) ? `<div class="acts"><a class="mini wa" data-act="rien" href="${lienWa(c.tel, principal.texte)}" target="_blank" rel="noopener">${esc(principal.t)}</a></div>` : ""}
    </div>`;
  }
  h += boutonPlus("limC", list.length - S.limC, "clients") + ajout;
  return h;
}

function clientSheet(cle) {
  const c = clients().find(x => x.cle === cle);
  if (!c) { closeSheet(); return; }
  const ventes = [...c.ventes].sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.cree || 0) - (a.cree || 0));
  const prefs = Object.entries(c.produits).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const msgs = numeroWa(c.tel) ? messagesClient(c) : [];
  openSheet(`<div class="inner"><h2>${esc(c.nom || c.tel)}</h2>
    <div class="note">${[c.nom ? c.tel : "", c.quartier].filter(Boolean).map(esc).join(" · ") || "Pas de numéro noté"}${c.premier ? " · client depuis le " + esc(dateCourte(c.premier)) : ""}</div>
    ${c.note ? `<div class="box">${esc(c.note)}</div>` : ""}
    <div class="kv num">
      <div><span class="note">Achats</span><b>${c.achats}</b></div>
      <div><span class="note">Dépensé</span><b>${F(c.total)}</b></div>
      <div><span class="note">Panier moyen</span><b>${F(c.achats ? c.total / c.achats : 0)}</b></div>
    </div>
    ${c.du > 0 ? `<div class="banner"><span>Il reste <b>${F(c.du)}</b> à recevoir de ce client.</span></div>` : ""}
    ${msgs.length ? `<div class="btns" style="flex-wrap:wrap">${msgs.map(m => `<a class="mini wa" href="${lienWa(c.tel, m.texte)}" target="_blank" rel="noopener">${esc(m.t)}</a>`).join("")}<a class="mini" href="tel:${esc(String(c.tel).replace(/[^\d+]/g, ""))}">Appeler</a></div>` : ""}
    ${prefs.length ? `<div class="label">Ce qu'il achète</div><div class="note">${prefs.map(([id, q]) => esc(nomProduit(id)) + " (" + q + ")").join(", ")}</div>` : ""}
    ${ventes.length ? `<div class="label">Historique</div><div class="releve num">${ventes.slice(0, 40).map(v => `<div class="l"><div><div>${esc(nomProduit(v.produitId))} × ${+v.qte}</div><div class="d">${esc(dayLabel(v.date))}${v.paiement ? " · " + esc(v.paiement) : ""}${!v.encaisse && !estChariow(v) ? ` · <span class="tag gold">à recevoir</span>` : ""}</div></div><div class="plus">${F(totalVente(v))}</div><div></div></div>`).join("")}</div>
      ${ventes.length > 40 ? `<p class="hint">Les 40 derniers achats sont affichés.</p>` : ""}` : `<div class="empty">Pas encore d'achat noté.</div>`}
    <div class="btns" style="flex-wrap:wrap"><button class="btn sec" data-act="fiche-client" data-id="${esc(c.cle)}">Modifier la fiche</button><button class="btn pri" data-act="vente-client" data-id="${esc(c.cle)}">+ Vente pour ce client</button></div>
    <button class="btn sec" data-close>Fermer</button>
  </div>`);
}

function clientForm(c) {
  c = c || { nom: "", tel: "", quartier: "", note: "", ventes: [], fiche: null };
  const existe = !!(c.cle);
  openSheet(`<form><h2>${existe ? "Fiche de " + esc(c.nom || c.tel) : "Nouveau client"}</h2>
    <div class="two">
      <div class="field"><label for="k-nom">Nom</label><input id="k-nom" name="nom" type="text" autocomplete="off" value="${esc(c.nom)}"></div>
      <div class="field"><label for="k-tel">Téléphone (WhatsApp)</label><input id="k-tel" name="tel" type="tel" inputmode="tel" placeholder="07 00 00 00 00" value="${esc(c.tel)}"></div>
    </div>
    <div class="field"><label for="k-q">Quartier ou commune</label><input id="k-q" name="quartier" type="text" placeholder="Ex. Cocody Angré" value="${esc(c.quartier)}"></div>
    <div class="field"><label for="k-note">Note (pointure, goûts, préférences…)</label><textarea id="k-note" name="note" rows="2" maxlength="300" placeholder="Ex. Pointure 42, aime les couleurs sombres, paie toujours par Wave">${esc(c.note)}</textarea></div>
    ${existe && c.ventes.length ? `<p class="hint">Si tu changes le nom ou le numéro, ses ${plur(c.ventes.length, "vente")} ${c.ventes.length > 1 ? "sont mises" : "est mise"} à jour aussi.</p>` : ""}
    ${c.fiche ? `<button type="button" class="mini danger" id="k-suppr">Supprimer la fiche (les ventes restent)</button>` : ""}
    ${buttons}</form>`, fd => {
      const data = { nom: (fd.get("nom") || "").trim(), tel: (fd.get("tel") || "").trim(), quartier: (fd.get("quartier") || "").trim(), note: (fd.get("note") || "").trim() };
      if (!data.nom && !data.tel) throw new Error("Mets au moins un nom ou un numéro.");
      if (data.tel && !numeroWa(data.tel)) throw new Error("Ce numéro ne semble pas valide (10 chiffres, ou avec l'indicatif).");
      const nouvelleCle = cleClientDe(data.tel, data.nom);
      const autre = clients().find(x => x.cle === nouvelleCle && x.cle !== c.cle);
      if (autre && autre.fiche) throw new Error("Un autre client a déjà ce numéro ou ce nom.");
      const ops = [];
      if (c.fiche) ops.push({ type: "modif", col: "clients", id: c.fiche.id, data });
      else { const id = nouvelId(); ops.push({ type: "ajout", col: "clients", id, data: { id, ...data, cree: Date.now() } }); }
      for (const v of c.ventes || []) {
        const patch = {};
        if (data.nom && (v.client || "") !== data.nom) patch.client = data.nom;
        if (data.tel && (v.tel || "") !== data.tel) patch.tel = data.tel;
        if (Object.keys(patch).length) ops.push({ type: "modif", col: "ventes", id: v.id, data: patch });
      }
      db.appliquer(ops);
      toast(existe ? "Fiche mise à jour" : "Client ajouté");
    });
  const s = document.getElementById("k-suppr");
  if (s) s.addEventListener("click", () => {
    if (!s.classList.contains("armed")) { s.classList.add("armed"); s.textContent = "Confirmer la suppression de la fiche"; return; }
    db.supprimer("clients", c.fiche.id); closeSheet(); toast("Fiche supprimée");
  });
}

ACTIONS["client"] = id => clientSheet(id);
ACTIONS["rien"] = () => {};
ACTIONS["nouveau-client"] = () => clientForm();
ACTIONS["fiche-client"] = id => clientForm(clients().find(x => x.cle === id));
ACTIONS["vente-client"] = id => { const c = clients().find(x => x.cle === id); closeSheet(); venteForm(null, { client: c ? c.nom : "", tel: c ? c.tel : "" }); };
ACTIONS["filtre-clients"] = id => { S.filtreC = id; S.limC = PAGE; render(); };
document.addEventListener("keydown", e => {
  const el = e.target;
  if (el && el.matches && el.matches(".row.client[role=button]") && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); clientSheet(el.dataset.id); }
});

/* ---------- Produits qui dorment ----------
   Produit physique encore en stock, sans vente depuis X jours
   (on compte depuis la dernière vente, le dernier réapprovisionnement ou l'ajout du produit). */
const PREF_DODO = "cahier-de-caisse:dodo";
const joursDodo = () => { try { return +localStorage.getItem(PREF_DODO) || 30; } catch { return 30; } };
let _dodo = new Map();
function produitsQuiDorment(seuil) {
  seuil = seuil || joursDodo();
  const st = stats("tout"), derniere = {};
  for (const v of S.data.ventes) if (!derniere[v.produitId] || v.date > derniere[v.produitId]) derniere[v.produitId] = v.date;
  const debut = +S.data.cree || Date.now(), res = [];
  for (const p of S.data.produits) {
    if (p.mode === "numerique") continue;
    const b = st.byProd[p.id]; if (!b || b.restant <= 0) continue;
    const vente = derniere[p.id] ? dateDe(derniere[p.id]).getTime() - 12 * 3600000 : 0; /* début de la journée de vente */
    const depuis = Math.max(vente, +p.reappro || 0, +p.cree || 0) || debut;
    const jours = Math.round((Date.now() - depuis) / 86400000);
    if (jours < seuil) continue;
    res.push({ p, restant: b.restant, valeur: b.valeur, jours, jamais: !vente });
  }
  return res.sort((a, b) => b.valeur - a.valeur || b.jours - a.jours);
}
function majDodo() { _dodo = new Map(produitsQuiDorment().map(x => [x.p.id, x])); return _dodo; }
const tagDodo = id => { const d = _dodo.get(id); return d ? ` <span class="tag gold">Dort depuis ${d.jours} j</span>` : ""; };
function ligneDodo(d) {
  const p = d.p, vd = p.mode === "depot" ? vendeurDe(p.vendeurId) : null;
  return `<div class="row">
    <div class="avec-vignette">${PHOTOS[p.id] ? `<img class="vignette" src="${vignette(p.id)}" alt="" loading="lazy">` : ""}<div style="min-width:0"><div class="t">${esc(nomComplet(p))}${+p.prixAvant > +p.prixVente ? ` <span class="tag red">Promo</span>` : ""}</div>
    <div class="m num">${d.jamais ? "Jamais vendu · en stock depuis " + d.jours + " j" : "Rien vendu depuis " + d.jours + " j"} · ${plur(d.restant, "pièce")}${vd ? " chez " + esc(vd.nom) : ""}</div></div></div>
    <div class="amt num">${F(d.valeur)}<div class="m">bloqués</div></div>
    <div class="acts"><button class="mini" data-act="promo" data-id="${p.id}">${+p.prixAvant > +p.prixVente ? "Changer la promo" : "Faire une promo"}</button><button class="mini wa" data-act="partager-produit" data-id="${p.id}">Partager</button></div>
  </div>`;
}
function htmlCarteDodo() {
  const liste = [...majDodo().values()];
  if (!liste.length) return "";
  const total = liste.reduce((s, d) => s + d.valeur, 0);
  return `<div class="card dodo">
    <div class="head"><span class="label">Produits qui dorment</span><b class="num">${F(total)}</b></div>
    <div class="note">${liste.length > 1 ? plur(liste.length, "produit") + " n'ont" : "1 produit n'a"} rien vendu depuis ${joursDodo()} jours ou plus : c'est de l'argent bloqué. Une petite promo ou un partage peut les relancer.</div>
    ${liste.slice(0, 3).map(ligneDodo).join("")}
    <button class="btn sec" data-act="dodo">${liste.length > 3 ? "Voir les " + liste.length + " produits" : "Régler la durée"}</button>
  </div>`;
}
function dodoSheet() {
  const seuil = joursDodo(), liste = produitsQuiDorment(seuil);
  openSheet(`<div class="inner"><h2>Produits qui dorment</h2>
    <div class="seg" role="group" aria-label="Durée">${[15, 30, 60, 90].map(j => `<button data-act="dodo-jours" data-id="${j}" aria-pressed="${j === seuil}">${j} jours</button>`).join("")}</div>
    <div class="note num">${liste.length ? plur(liste.length, "produit") + " sans vente depuis " + seuil + " jours ou plus · " + F(liste.reduce((s, d) => s + d.valeur, 0)) + " bloqués au prix de revient." : "Aucun produit ne dort depuis " + seuil + " jours. Bravo !"}</div>
    ${liste.map(ligneDodo).join("")}
    <p class="hint">Idées pour les relancer : une promo de 10 à 20 % (le prix barré s'affiche sur tes fiches et dans ta boutique en ligne), un statut WhatsApp avec la fiche du produit, un lot « 2 achetés = livraison offerte », ou le proposer à tes clients fidèles.</p>
    <button class="btn sec" data-close>Fermer</button></div>`);
}
ACTIONS["dodo"] = () => dodoSheet();
ACTIONS["dodo-jours"] = id => { try { localStorage.setItem(PREF_DODO, String(+id)); } catch {} dodoSheet(); render(); };

/* ---------- Promo en deux gestes ---------- */
function promoSheet(p) {
  if (!p) return;
  const enPromo = +p.prixAvant > +p.prixVente;
  const base = enPromo ? +p.prixAvant : +p.prixVente;
  if (!base) { produitForm(p); toast("Mets d'abord un prix de vente"); return; }
  const vd = p.mode === "depot" ? vendeurDe(p.vendeurId) : null;
  const form = openSheet(`<form><h2>Promo : ${esc(nomComplet(p))}</h2>
    <p class="note num">Prix normal ${F(base)}${+p.cout ? " · ton coût " + F(p.cout) : ""}${enPromo ? " · en promo à " + F(p.prixVente) : ""}.</p>
    <div class="btns" style="flex-wrap:wrap">${[10, 15, 20, 30].map(x => `<button type="button" class="mini" data-remise="${x}">-${x} %</button>`).join("")}</div>
    <div class="field"><label for="pr-prix">Nouveau prix (F)</label><input id="pr-prix" name="prix" type="number" inputmode="numeric" min="1" step="1" value="${enPromo ? +p.prixVente : Math.round(base * 0.85 / 100) * 100}" required></div>
    <div class="calc num" id="pr-calc"></div>
    <label class="check"><input name="partager" type="checkbox" checked> Partager la fiche promo juste après</label>
    ${enPromo ? `<button type="button" class="mini danger" id="pr-stop">Arrêter la promo (revenir à ${F(base)})</button>` : ""}
    ${buttons}</form>`, fd => {
      const prix = Math.round(+fd.get("prix") || 0);
      if (!prix || prix >= base) throw new Error("Le prix promo doit être plus bas que " + F(base) + ".");
      db.modifier("produits", p.id, { prixVente: prix, prixAvant: base });
      toast(`Promo : ${F(prix)} au lieu de ${F(base)}`);
      if (fd.get("partager") === "on") setTimeout(() => partagerProduit(p.id), 80);
    });
  const calc = () => {
    const prix = +form.prix.value || 0, el = $("#pr-calc");
    if (!prix) { el.textContent = ""; return; }
    const remise = Math.round((1 - prix / base) * 100);
    const gain = vd ? reverse(vd, p, prix) - (+p.cout || 0) : prix - (+p.cout || 0);
    el.innerHTML = `Le client verra <s>${F(base)}</s> → <b>${F(prix)}</b> (-${remise} %).` + (+p.cout ? `<br>${vd ? "Avec la règle de " + esc(vd.nom) + ", ton" : "Ton"} bénéfice par pièce : <b style="color:var(${gain < 0 ? "--red" : "--accent"})">${gain < 0 ? "−" : ""}${F(Math.abs(gain))}</b>${gain < 0 ? " : tu vendrais à perte." : "."}` : "");
  };
  form.prix.addEventListener("input", calc); calc();
  form.querySelectorAll("[data-remise]").forEach(b => b.addEventListener("click", () => { form.prix.value = Math.max(100, Math.round(base * (1 - b.dataset.remise / 100) / 100) * 100); calc(); }));
  const stop = document.getElementById("pr-stop");
  if (stop) stop.addEventListener("click", () => { db.modifier("produits", p.id, { prixVente: base, prixAvant: 0 }); closeSheet(); toast("Promo arrêtée"); });
}
ACTIONS["promo"] = id => promoSheet(produitDe(id));

/* ---------- Commande reçue de la boutique en ligne ----------
   Le client envoie un message WhatsApp déjà écrit par la boutique :
     • 2 × Basket urbaine (Noire 41) — 20 000 F
     Nom : Awa / Livraison à : Cocody / Remarque : …
   Tu le colles ici : l'appli retrouve les produits et enregistre les ventes d'un coup. */
function analyserCommande(texte) {
  const res = { articles: [], nom: "", lieu: "", note: "" };
  for (const brut of String(texte || "").split(/\r?\n/)) {
    const l = brut.trim();
    let m = l.match(/^[•*·-]?\s*(\d+)\s*[×xX]\s*(.+?)\s*[—–-]\s*([\d\s.  ]+)\s*F\b/);
    if (m) {
      let nom = m[2].trim(), variante = "";
      const mv = nom.match(/^(.*\S)\s*\(([^()]*)\)$/); if (mv) { nom = mv[1].trim(); variante = mv[2].trim(); }
      const qte = +m[1], total = +m[3].replace(/\D/g, "");
      res.articles.push({ qte, nom, variante, total, prix: qte ? Math.round(total / qte) : 0 });
      continue;
    }
    if ((m = l.match(/^Nom\s*:\s*(.+)$/i))) res.nom = m[1].trim();
    else if ((m = l.match(/^Livraison à\s*:\s*(.+)$/i))) res.lieu = m[1].trim();
    else if ((m = l.match(/^Remarque\s*:\s*(.+)$/i))) res.note = m[1].trim();
  }
  for (const a of res.articles) {
    a.produit = S.data.produits.find(p => norm(p.nom) === norm(a.nom) && norm(p.variante || "") === norm(a.variante))
      || S.data.produits.find(p => norm(nomComplet(p)) === norm(a.nom + (a.variante ? " " + a.variante : "")))
      || (!a.variante ? S.data.produits.find(p => norm(p.nom) === norm(a.nom)) : null) || null;
  }
  return res;
}
function commandeSheet() {
  const pays = ["Wave", "Orange Money", "MTN MoMo", "Moov Money", "Espèces"];
  const form = openSheet(`<form><h2>Commande reçue sur WhatsApp</h2>
    <p class="note">Copie le message de commande que le client t'a envoyé depuis ta boutique en ligne, puis colle-le ici. L'appli retrouve les produits et prépare les ventes.</p>
    <div class="field"><label for="cm-texte">Message du client</label><textarea id="cm-texte" rows="5" placeholder="Bonjour ! Je voudrais commander :&#10;• 1 × Hub USB — 7 000 F&#10;…"></textarea></div>
    <button type="button" class="mini" id="cm-coller">Coller depuis le presse-papiers</button>
    <div id="cm-apercu"></div>
    <div class="two">
      <div class="field"><label for="cm-nom">Client</label><input id="cm-nom" name="client" type="text" list="liste-clients-cm" autocomplete="off"></div>
      <div class="field"><label for="cm-tel">Son numéro WhatsApp</label><input id="cm-tel" name="tel" type="tel" inputmode="tel" placeholder="07 00 00 00 00"></div>
    </div>
    <datalist id="liste-clients-cm">${clients().filter(c => c.nom).map(c => `<option value="${esc(c.nom)}">`).join("")}</datalist>
    <div class="two">
      <div class="field"><label for="cm-lieu">Lieu de livraison</label><input id="cm-lieu" name="lieu" type="text" placeholder="Commune, quartier"></div>
      <div class="field"><label for="cm-pay">Paiement</label><select id="cm-pay" name="paiement">${pays.map(x => opt(x, x, x === "Wave")).join("")}</select></div>
    </div>
    <label class="check"><input name="livrer" id="cm-livrer" type="checkbox" checked> À livrer</label>
    <label class="check"><input name="encaisse" type="checkbox"> L'argent est déjà sur mon compte</label>
    ${buttons}</form>`, fd => {
      const c = analyserCommande($("#cm-texte").value);
      const ok = c.articles.filter(a => a.produit);
      if (!c.articles.length) throw new Error("Je ne trouve aucun article dans ce message. Colle le message complet envoyé par la boutique.");
      if (!ok.length) throw new Error("Aucun de ces articles ne correspond à un produit de ton stock.");
      const client = (fd.get("client") || "").trim(), tel = (fd.get("tel") || "").trim(), lieu = (fd.get("lieu") || "").trim();
      const ops = [], date = todayISO();
      for (const a of ok) {
        const p = a.produit, id = nouvelId();
        const v = { id, produitId: p.id, qte: a.qte, prix: a.prix, date, paiement: fd.get("paiement"), client, tel, encaisse: fd.get("encaisse") === "on", coutU: coutVente(p, a.prix), source: "boutique", cree: Date.now() };
        if (fd.get("livrer") === "on" && p.mode !== "numerique") v.livraison = { statut: "a-livrer", commune: lieu, adresse: c.note ? "Remarque du client : " + c.note : "", livreur: "", telLivreur: "", frais: 0 };
        ops.push({ type: "ajout", col: "ventes", id, data: v });
      }
      /* fiche client : on garde son quartier pour la prochaine fois */
      const cle = cleClientDe(tel, client);
      if (cle && lieu) {
        const existant = clients().find(x => x.cle === cle);
        if (existant && existant.fiche) { if (!existant.fiche.quartier) ops.push({ type: "modif", col: "clients", id: existant.fiche.id, data: { quartier: lieu } }); }
        else { const id = nouvelId(); ops.push({ type: "ajout", col: "clients", id, data: { id, nom: client, tel, quartier: lieu, note: "", cree: Date.now() } }); }
      }
      db.appliquer(ops);
      toast(`Commande enregistrée : ${plur(ok.length, "vente")}${ok.length < c.articles.length ? " (" + (c.articles.length - ok.length) + " article non reconnu)" : ""}`);
    });
  const apercu = () => {
    const c = analyserCommande($("#cm-texte").value), el = $("#cm-apercu");
    if (!c.articles.length) { el.innerHTML = ""; return; }
    if (c.nom && !form.client.value) { form.client.value = c.nom; remplirTel(); }
    if (c.lieu && !form.lieu.value) form.lieu.value = c.lieu;
    const total = c.articles.filter(a => a.produit).reduce((s, a) => s + a.total, 0);
    el.innerHTML = `<div class="releve num">${c.articles.map(a => `<div class="l"><div><div>${a.qte} × ${esc(a.nom)}${a.variante ? " (" + esc(a.variante) + ")" : ""}</div>
      <div class="d">${a.produit ? (a.produit.mode === "depot" ? `<span class="tag gold">Pièce chez ${esc((vendeurDe(a.produit.vendeurId) || {}).nom || "ton vendeur")} : pense à la récupérer</span>` : "Trouvé dans ton stock") : `<span class="tag red">Produit introuvable : ajoute-le d'abord dans ton stock</span>`}</div></div>
      <div class="${a.produit ? "plus" : ""}">${F(a.total)}</div><div></div></div>`).join("")}</div>
      <div class="note num">Total reconnu : <b>${F(total)}</b>${c.note ? " · Remarque : " + esc(c.note) : ""}</div>`;
  };
  const remplirTel = () => { const k = clients().find(x => x.nom && norm(x.nom) === norm(form.client.value)); if (k && k.tel && !form.tel.value) form.tel.value = k.tel; };
  $("#cm-texte").addEventListener("input", apercu);
  form.client.addEventListener("change", remplirTel);
  $("#cm-coller").addEventListener("click", async () => {
    try { $("#cm-texte").value = await navigator.clipboard.readText(); apercu(); }
    catch { toast("Appuie longuement dans le cadre, puis « Coller »."); $("#cm-texte").focus(); }
  });
}
ACTIONS["commande"] = () => commandeSheet();
