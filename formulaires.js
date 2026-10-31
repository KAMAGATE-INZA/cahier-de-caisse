"use strict";
/* ================= Feuilles & formulaires ================= */
function openSheet(html, onSubmit) {
  const sh = $("#sheet");
  sh.innerHTML = html; sh.hidden = false; $("#scrim").hidden = false; sh.scrollTop = 0;
  const form = sh.querySelector("form");
  if (form && onSubmit) form.addEventListener("submit", e => {
    e.preventDefault();
    try { const avant = S.ouvert; S.ouvert = null; try { onSubmit(new FormData(form)); } catch (e2) { S.ouvert = avant; throw e2; } closeSheet(); }
    catch (err) { form.querySelector(".err").textContent = err.message || "Vérifie les champs."; }
  });
  sh.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", closeSheet));
  return form || sh;
}
function closeSheet() { $("#sheet").hidden = true; $("#scrim").hidden = true; $("#sheet").innerHTML = ""; }
$("#scrim").addEventListener("click", () => { if (!S.feuilleBloquante) closeSheet(); });
function toast(t) { const el = $("#toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 2400); }
const buttons = `<div class="err"></div><div class="btns"><button type="button" class="btn sec" data-close>Annuler</button><button type="submit" class="btn pri">Enregistrer</button></div>`;
const opt = (val, lab, sel) => `<option value="${esc(val)}"${sel ? " selected" : ""}>${esc(lab)}</option>`;
function optionsProduits(sel) {
  const parCat = {};
  for (const p of S.data.produits) (parCat[p.categorie || "Divers"] ||= []).push(p);
  return Object.keys(parCat).sort().map(c => `<optgroup label="${esc(c)}">${parCat[c].sort((a, b) => nomComplet(a).localeCompare(nomComplet(b))).map(p => opt(p.id, nomComplet(p), p.id === sel)).join("")}</optgroup>`).join("");
}

function venteForm(v, modele) {
  if (!S.data.produits.length) { S.tab = "stock"; render(); produitForm(); toast("Ajoute d'abord un produit"); return; }
  const edit = !!v; v = v || Object.assign({}, modele || {});
  const pays = ["Wave","Orange Money","MTN MoMo","Moov Money","Espèces","Chariow"];
  const connus = clients();
  const form = openSheet(`<form><h2>${edit ? "Modifier la vente" : "Nouvelle vente"}</h2>
    <div class="field"><label for="v-prod">Produit</label><select id="v-prod" name="produitId">${optionsProduits(v.produitId)}</select></div>
    <div class="two">
      <div class="field"><label for="v-qte">Quantité</label><input id="v-qte" name="qte" type="number" inputmode="numeric" min="1" step="1" value="${+v.qte || 1}" required></div>
      <div class="field" data-pour="depot"><label for="v-pc">Prix payé par le client (F/pièce)</label><input id="v-pc" name="prixClient" type="number" inputmode="numeric" min="0" step="1" value="${edit && v.prixClient ? +v.prixClient : ""}"></div>
      <div class="field" data-pour="direct"><label for="v-prix" id="v-prix-lab">Prix / pièce (F)</label><input id="v-prix" name="prix" type="number" inputmode="numeric" min="0" step="any" value="${edit ? +v.prix : ""}" required></div>
    </div>
    <div class="box" data-pour="depot" id="v-partage">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><b>Partage du bénéfice</b><span class="num" id="v-benef"></span></div>
      <div class="two">
        <div class="field"><label for="v-ma">Ta part (F)</label><input id="v-ma" name="maPart" type="number" inputmode="numeric" step="1"></div>
        <div class="field"><label for="v-sa" id="v-sa-lab">Sa part (F)</label><input id="v-sa" name="saPart" type="number" inputmode="numeric" step="1"></div>
      </div>
      <div class="note num" id="v-calc"></div>
      <div><button type="button" class="mini" id="v-regle" hidden>Revenir à la règle</button></div>
    </div>
    <div class="hint" id="v-hint"></div>
    <div class="two">
      <div class="field"><label for="v-date">Date</label><input id="v-date" name="date" type="date" value="${v.date || todayISO()}" required></div>
      <div class="field" data-pour="direct"><label for="v-pay">Paiement</label><select id="v-pay" name="paiement">${pays.map(x => opt(x, x, x === v.paiement)).join("")}</select></div>
    </div>
    <div class="two" data-pour="direct">
      <div class="field"><label for="v-client">Client (facultatif)</label><input id="v-client" name="client" type="text" list="liste-clients" autocomplete="off" placeholder="Nom" value="${esc(v.client || "")}"></div>
      <div class="field"><label for="v-tel">Téléphone (facultatif)</label><input id="v-tel" name="tel" type="tel" inputmode="tel" placeholder="07 00 00 00 00" value="${esc(v.tel || "")}"></div>
    </div>
    <datalist id="liste-clients">${connus.filter(c => c.nom).map(c => `<option value="${esc(c.nom)}">`).join("")}</datalist>
    <label class="check" data-pour="direct"><input id="v-enc" name="encaisse" type="checkbox" ${edit ? (v.encaisse ? "checked" : "") : "checked"}><span id="v-enc-lab"> L'argent est déjà sur mon compte</span></label>
    <label class="check" data-pour="livrable"><input id="v-liv" name="livrer" type="checkbox" ${v.livraison ? "checked" : ""}> À livrer</label>
    <div class="box" id="v-liv-f" hidden>
      <div class="two">
        <div class="field"><label for="v-com">Commune</label><input id="v-com" name="commune" type="text" list="liste-communes" value="${esc(v.livraison ? v.livraison.commune : "")}" placeholder="Ex. Cocody"></div>
        <div class="field"><label for="v-adr">Quartier, repère</label><input id="v-adr" name="adresse" type="text" value="${esc(v.livraison ? v.livraison.adresse : "")}" placeholder="Ex. Angré 8e tranche, près de la pharmacie"></div>
        <div class="field"><label for="v-livr">Livreur</label><input id="v-livr" name="livreur" type="text" list="liste-livreurs" autocomplete="off" value="${esc(v.livraison ? v.livraison.livreur : "")}" placeholder="Nom"></div>
        <div class="field"><label for="v-tlivr">Téléphone du livreur</label><input id="v-tlivr" name="telLivreur" type="tel" inputmode="tel" value="${esc(v.livraison ? v.livraison.telLivreur : "")}"></div>
      </div>
      <div class="field"><label for="v-fliv">Frais de livraison à ta charge (F)</label><input id="v-fliv" name="fraisLiv" type="number" inputmode="numeric" min="0" step="1" value="${v.livraison && +v.livraison.frais ? +v.livraison.frais : ""}" placeholder="0 si c'est le client qui paie le livreur"></div>
      <div class="hint">Si l'argent n'est pas encore sur ton compte, le livreur l'encaissera : décoche « L'argent est déjà sur mon compte ».</div>
    </div>
    <datalist id="liste-communes">${COMMUNES.map(c => `<option value="${esc(c)}">`).join("")}</datalist>
    <datalist id="liste-livreurs">${livreursConnus().map(l => `<option value="${esc(l.nom)}">`).join("")}</datalist>
    ${buttons}</form>`, fd => {
      const qte = +fd.get("qte"), prix = +fd.get("prix");
      if (!(qte > 0) || !(prix >= 0)) throw new Error("Quantité et prix doivent être des nombres positifs.");
      const p = produitDe(fd.get("produitId"));
      const depot = p.mode === "depot";
      const data = { produitId: p.id, qte, prix, date: fd.get("date") };
      if (depot) Object.assign(data, { vendeurId: p.vendeurId, prixClient: +fd.get("prixClient") || 0, paiement: "Via le vendeur", client: "", tel: "", encaisse: false, ajuste: etatPartage.ajuste || undefined });
      else Object.assign(data, { vendeurId: undefined, prixClient: undefined, paiement: fd.get("paiement"), client: (fd.get("client")||"").trim(), tel: (fd.get("tel")||"").trim(), encaisse: fd.get("encaisse") === "on" });
      data.coutU = edit && v.produitId === data.produitId && p.mode !== "numerique" ? +v.coutU || 0 : coutVente(p, prix);
      if (!depot && p.mode !== "numerique" && fd.get("livrer") === "on") {
        data.livraison = { statut: v.livraison ? v.livraison.statut : "a-livrer", livreeLe: v.livraison ? v.livraison.livreeLe : undefined,
          commune: (fd.get("commune") || "").trim(), adresse: (fd.get("adresse") || "").trim(), livreur: (fd.get("livreur") || "").trim(),
          telLivreur: (fd.get("telLivreur") || "").trim(), frais: +fd.get("fraisLiv") || 0 };
        if (data.livraison.livreeLe === undefined) delete data.livraison.livreeLe;
      } else data.livraison = undefined;
      if (edit) { db.modifier("ventes", v.id, data); toast("Vente modifiée"); }
      else { db.ajouter("ventes", { ...data, cree: Date.now() }); toast(depot ? "Vente du vendeur enregistrée" : "Vente enregistrée"); }
    });
  /* Partage d'une vente du vendeur : la règle propose, tu peux ajuster ta part OU la sienne, l'autre se calcule */
  const etatPartage = { cote: null, modifie: false, ajuste: !!v.ajuste };
  const calc = () => {
    const p = produitDe(form.produitId.value) || {};
    if (p.mode !== "depot") return;
    const vd = vendeurDe(p.vendeurId), pc = +form.prixClient.value || 0, q = +form.qte.value || 1;
    if (!vd) { $("#v-calc").textContent = "Ce produit n'a plus de vendeur : modifie-le dans l'onglet Stock."; return; }
    const def = partageCalc(vd, p, pc, q);
    let ma, sa;
    if (etatPartage.cote === "moi") { ma = +form.maPart.value || 0; sa = def.benefice - ma; form.saPart.value = Math.round(sa); }
    else if (etatPartage.cote === "lui") { sa = +form.saPart.value || 0; ma = def.benefice - sa; form.maPart.value = Math.round(ma); }
    else { ma = def.maPart; sa = def.saPart; form.maPart.value = Math.round(ma); form.saPart.value = Math.round(sa); }
    const du = def.rembourse + ma;
    form.prix.value = q ? du / q : 0;
    if (etatPartage.modifie) etatPartage.ajuste = etatPartage.cote !== null && Math.abs(ma - def.maPart) >= 1;
    $("#v-benef").textContent = "Bénéfice " + F(def.benefice);
    $("#v-sa-lab").textContent = "Part de " + vd.nom + " (F)";
    $("#v-regle").hidden = !etatPartage.ajuste;
    $("#v-calc").innerHTML = `${esc(vd.nom)} te doit <b>${F(du)}</b>${def.rembourse ? " (ton coût " + F(def.rembourse) + " + ta part)" : ""} et garde ${F(pc * q - du)}.`
      + (etatPartage.ajuste ? `<br><span class="tag gold">Ajusté</span> La règle donnait ${F(def.maPart)} pour toi et ${F(def.saPart)} pour lui.` : `<br>Règle : ${esc(resumeRegle(vd))}.`)
      + `<br>Ton bénéfice réel : <b>${F(du - (+p.cout || 0) * q)}</b>.`
      + (ma < 0 || sa < 0 ? `<br><span style="color:var(--red)">Attention : une des deux parts est négative.</span>` : "");
  };
  const sync = (init) => {
    const p = produitDe(form.produitId.value) || {};
    const depot = p.mode === "depot", num = p.mode === "numerique", chariow = num && p.plateforme === "chariow";
    form.querySelectorAll("[data-pour]").forEach(x => x.hidden = x.dataset.pour === "depot" ? !depot : x.dataset.pour === "livrable" ? (depot || num) : depot);
    $("#v-liv-f").hidden = depot || num || !form.livrer.checked;
    form.prix.required = !depot;
    if (init && edit && depot) {
      /* reprend le partage enregistré */
      const p0 = produitDe(v.produitId), vd0 = vendeurDe(v.vendeurId);
      if (p0 && vd0) { const r0 = partageCalc(vd0, p0, v.prixClient, v.qte, totalVente(v)); form.maPart.value = Math.round(r0.maPart); etatPartage.cote = "moi"; }
    }
    if (!(init && edit)) {
      etatPartage.cote = null; etatPartage.modifie = false; etatPartage.ajuste = false;
      if (depot) { form.prixClient.value = +p.prixVente || ""; }
      else form.prix.value = +p.prixVente || "";
      form.paiement.value = chariow ? "Chariow" : "Wave";
      form.encaisse.checked = !chariow;
    }
    $("#v-hint").textContent = depot ? "Vente faite par ton vendeur : mets le prix réel payé par le client. L'appli partage le bénéfice selon votre règle. Pour un autre accord, change ta part ou la sienne : l'autre se calcule toute seule."
      : chariow ? "Vente Chariow : mets le prix payé par le client, l'appli retire la commission. Chariow te verse l'argent environ 72 h après : coche « Encaissé » quand tu l'as reçu. Plusieurs ventes le même jour ? Une seule ligne avec la quantité suffit."
      : num ? "Produit numérique : après l'enregistrement, envoie le reçu avec le lien depuis l'onglet Ventes." : "";
    majEnc(); calc();
  };
  const majEnc = () => { $("#v-enc-lab").textContent = form.paiement.value === "Chariow" ? " Chariow m'a déjà versé l'argent" : " L'argent est déjà sur mon compte"; };
  form.produitId.addEventListener("change", () => sync(false));
  form.livrer.addEventListener("change", () => { $("#v-liv-f").hidden = !form.livrer.checked; if (form.livrer.checked && !edit) form.encaisse.checked = false; majEnc(); });
  form.livreur.addEventListener("change", () => { const l = livreursConnus().find(x => x.nom.toLowerCase() === form.livreur.value.trim().toLowerCase()); if (l && l.tel && !form.telLivreur.value) form.telLivreur.value = l.tel; });
  form.paiement.addEventListener("change", majEnc);
  form.prixClient.addEventListener("input", () => { etatPartage.modifie = true; calc(); });
  form.qte.addEventListener("input", () => { etatPartage.modifie = true; calc(); });
  form.maPart.addEventListener("input", () => { etatPartage.cote = "moi"; etatPartage.modifie = true; calc(); });
  form.saPart.addEventListener("input", () => { etatPartage.cote = "lui"; etatPartage.modifie = true; calc(); });
  $("#v-regle").addEventListener("click", () => { etatPartage.cote = null; etatPartage.modifie = true; etatPartage.ajuste = false; calc(); });
  sync(true);
  form.client.addEventListener("change", () => {
    const c = connus.find(x => x.nom.toLowerCase() === form.client.value.trim().toLowerCase());
    if (c && c.tel && !form.tel.value) form.tel.value = c.tel;
  });
}

function produitForm(p, modele) {
  const edit = !!(p && p.id);
  const galerie = edit ? photosDe(p.id) : [];
  p = p || Object.assign({ mode: "stock", seuil: 2 }, modele || {});
  const cats = [...new Set(S.data.produits.map(x => x.categorie).filter(Boolean))].sort();
  const noms = [...new Set(S.data.produits.map(x => x.nom))].sort();
  const vOpts = vendeursActifs().map(vd => opt(vd.id, vd.nom + " · " + resumeRegle(vd), vd.id === p.vendeurId)).join("") + opt("__nouveau", "+ Nouveau vendeur…", false);
  const form = openSheet(`<form><h2>${edit ? "Modifier le produit" : modele ? "Nouvelle variante" : "Nouveau produit"}</h2>
    ${modele ? `<p class="note">Une variante, c'est le même produit dans un autre modèle, une autre couleur, une autre taille ou à un autre prix. Elle a son propre stock.</p>` : ""}
    <div class="two">
      <div class="field"><label for="p-cat">Catégorie</label><input id="p-cat" name="categorie" type="text" list="liste-cats" placeholder="Ex. Chaussures" value="${esc(p.categorie || "")}" required></div>
      <div class="field"><label for="p-nom">Nom du produit</label><input id="p-nom" name="nom" type="text" list="liste-noms" placeholder="Ex. Basket Nike" value="${esc(p.nom||"")}" required></div>
    </div>
    <datalist id="liste-cats">${cats.map(c => `<option value="${esc(c)}">`).join("")}</datalist>
    <datalist id="liste-noms">${noms.map(c => `<option value="${esc(c)}">`).join("")}</datalist>
    <div class="field"><label for="p-var">Variante (facultatif)</label><input id="p-var" name="variante" type="text" placeholder="Ex. Blanche pointure 42, modèle cuir…" value="${esc(modele ? "" : p.variante || "")}"></div>
    <div class="field"><label for="p-mode">Où est le produit ?</label><select id="p-mode" name="mode">
      ${opt("stock", "Physique, chez moi, je le vends moi-même", p.mode === "stock")}
      ${opt("depot", "Physique, confié à un vendeur", p.mode === "depot")}
      ${opt("numerique", "Numérique (e-book, formation, fichier)", p.mode === "numerique")}</select></div>
    <div class="field" data-pour="depot"><label for="p-vd">Vendeur</label><select id="p-vd" name="vendeurId">${vOpts}</select></div>
    <div class="field" data-pour="depot" id="p-vd-new-f"><label for="p-vd-new">Nom du nouveau vendeur</label><input id="p-vd-new" name="vendeurNom" type="text" placeholder="Tu régleras sa part dans l'onglet Vendeurs"></div>
    <div class="two" data-pour="phys">
      <div class="field"><label for="p-qte">${p.mode === "depot" ? "Pièces confiées" : "Nombre de pièces"}</label><input id="p-qte" name="quantite" type="number" inputmode="numeric" min="0" step="1" value="${+p.quantite||""}"></div>
      <div class="field"><label for="p-cout">Coût de revient / pièce (F)</label><input id="p-cout" name="cout" type="number" inputmode="numeric" min="0" step="1" value="${+p.cout||""}"></div>
    </div>
    <div class="hint" data-pour="phys">Coût de revient = (prix d'achat + transport + douane) ÷ nombre de pièces.${edit ? " Pour un nouvel achat à un autre prix, utilise plutôt « Réapprovisionner »." : ""}</div>
    <div class="two">
      <div class="field"><label for="p-pv" id="p-pv-lab">Prix de vente (F)</label><input id="p-pv" name="prixVente" type="number" inputmode="numeric" min="0" step="1" value="${+p.prixVente||""}"></div>
      <div class="field" data-pour="fixe"><label for="p-rev">Il me reverse (F/pièce)</label><input id="p-rev" name="reverse" type="number" inputmode="numeric" min="0" step="1" value="${+p.reverse||""}"></div>
      <div class="field" data-pour="stock"><label for="p-seuil">Alerte stock bas à</label><input id="p-seuil" name="seuil" type="number" inputmode="numeric" min="0" step="1" value="${p.seuil ?? 2}"></div>
      <div class="field" data-pour="num"><label for="p-plat">Vendu via</label><select id="p-plat" name="plateforme">
        ${opt("chariow", "Chariow", p.plateforme === "chariow")}${opt("moi", "Moi-même (Mobile Money)", p.plateforme !== "chariow" && p.plateforme !== "autre")}${opt("autre", "Autre plateforme", p.plateforme === "autre")}</select></div>
    </div>
    <label class="check" data-pour="depot"><input id="p-voit" name="vendeurVoitCout" type="checkbox" ${p.vendeurVoitCout ? "checked" : ""}> Le vendeur peut voir mon prix d'achat</label>
    <div class="field" data-pour="depot" id="p-base-f"><label for="p-base">Prix de base pour le partage (F/pièce)</label><input id="p-base" name="baseVendeur" type="number" inputmode="numeric" min="0" step="1" value="${+p.baseVendeur || ""}" placeholder="Ex. ton coût + une marge"></div>
    <div class="hint" data-pour="depot" id="p-base-hint">Ton vrai coût reste secret : le vendeur ne voit que ce prix de base, et le partage du bénéfice se calcule à partir de lui. Si tu mets ton coût réel, le partage est exact mais le vendeur peut le deviner à partir de ce qu'il te doit.</div>
    <div class="calc num" data-pour="depot" id="p-calc"></div>
    <div class="two" data-pour="num">
      <div class="field"><label for="p-com">Commission (%)</label><input id="p-com" name="commission" type="number" inputmode="decimal" min="0" max="100" step="0.5" value="${+p.commission || ""}" placeholder="0"></div>
      <div class="field"><label for="p-frais">Frais fixes par vente (F)</label><input id="p-frais" name="frais" type="number" inputmode="numeric" min="0" step="1" value="${+p.frais||""}" placeholder="0"></div>
    </div>
    <div class="hint" data-pour="num" id="p-num-hint"></div>
    <div class="field" data-pour="num"><label for="p-lien">Lien de ta page de vente</label><input id="p-lien" name="lien" type="url" inputmode="url" placeholder="https://ta-boutique.mychariow.shop/…" value="${esc(p.lien||"")}"></div>
    <div class="field" data-pour="num"><label for="p-acc">Phrase d'accroche (facultatif)</label><input id="p-acc" name="accroche" type="text" placeholder="Ex. Protège ton Mobile Money contre les arnaques" value="${esc(p.accroche||"")}"></div>
    <div class="field"><label for="p-desc">Description pour tes clients (facultatif)</label>
      <textarea id="p-desc" name="description" rows="3" maxlength="400" placeholder="Ex. Cuir véritable, semelle confortable, idéale pour le bureau. Tailles du 39 au 44.">${esc(p.description || "")}</textarea>
      <div class="hint">Elle apparaît sur tes fiches catalogue et dans tes messages de vente.</div></div>
    <div class="field"><label for="p-avant">Ancien prix, pour une promo (facultatif)</label><input id="p-avant" name="prixAvant" type="number" inputmode="numeric" min="0" step="1" value="${+p.prixAvant || ""}" placeholder="Ex. 15000"></div>
    <div class="field"><label>Photos (jusqu'à ${MAX_PHOTOS})</label>
      <div class="galerie-edit" id="p-galerie"></div>
      <input id="p-photos" type="file" accept="image/*" multiple hidden>
      <div class="hint">La première est la photo principale. Touche une autre photo pour la mettre en premier.</div></div>
    <label class="check"><input id="p-enligne" name="enLigne" type="checkbox" ${p.horsBoutique ? "" : "checked"}> Montrer dans ma boutique en ligne</label>
    <div class="field"><label for="p-note">Note pour toi (facultatif, jamais montrée)</label><input id="p-note" name="note" type="text" value="${esc(p.note||"")}"></div>
    ${edit ? `<label class="check"><input id="p-retro" name="retro" type="checkbox" checked> Appliquer les nouveaux coûts aux ventes déjà notées</label>
    <div class="hint">Laisse coché pour corriger une erreur. Décoche si le changement ne vaut que pour les prochaines ventes, par exemple quand Chariow baisse ta commission à 10 %.</div>` : ""}
    ${buttons}</form>`, fd => {
      const data = { categorie: fd.get("categorie").trim() || "Divers", nom: fd.get("nom").trim(), variante: (fd.get("variante")||"").trim(), mode: fd.get("mode"),
        quantite: +fd.get("quantite") || 0, cout: +fd.get("cout") || 0, prixVente: +fd.get("prixVente") || 0, reverse: +fd.get("reverse") || 0,
        note: (fd.get("note")||"").trim(), seuil: +fd.get("seuil") || 0, frais: +fd.get("frais") || 0, lien: (fd.get("lien")||"").trim(),
        plateforme: fd.get("plateforme") || "moi", commission: Math.min(100, Math.max(0, +fd.get("commission") || 0)), accroche: (fd.get("accroche")||"").trim(),
        vendeurVoitCout: fd.get("vendeurVoitCout") === "on", baseVendeur: +fd.get("baseVendeur") || 0,
        description: (fd.get("description") || "").trim(), prixAvant: +fd.get("prixAvant") || 0, horsBoutique: fd.get("enLigne") === "on" ? undefined : true };
      if (data.prixAvant && data.prixAvant <= data.prixVente) throw new Error("L'ancien prix doit être plus élevé que le prix de vente, sinon laisse-le vide.");
      if (!data.nom) throw new Error("Donne un nom au produit.");
      const doublon = S.data.produits.find(x => x.id !== p.id && norm(x.nom) === norm(data.nom) && norm(x.variante) === norm(data.variante));
      if (doublon) throw new Error("Ce produit existe déjà. Donne un nom de variante différent (modèle, couleur, taille…).");
      if (data.mode === "numerique") { data.quantite = 0; data.cout = 0; data.vendeurId = undefined; }
      else { data.commission = 0; data.frais = 0; data.plateforme = "moi"; }
      const ops = [];
      let message = edit ? "Produit mis à jour" : modele ? "Variante ajoutée" : "Produit ajouté";
      if (data.mode === "depot") {
        let vid = fd.get("vendeurId");
        if (vid === "__nouveau" || !vid) {
          const nom = (fd.get("vendeurNom") || "").trim();
          if (!nom) throw new Error("Donne le nom du vendeur.");
          const vd = { id: nouvelId(), nom, tel: "", mode: "cout+part", pct: 50 };
          ops.push({ type: "ajout", col: "vendeurs", id: vd.id, data: vd }); vid = vd.id;
          message = "Vendeur ajouté : règle sa part dans l'onglet Vendeurs";
        }
        data.vendeurId = vid;
        if (!data.vendeurVoitCout && !data.baseVendeur) data.baseVendeur = data.cout;
      } else { data.vendeurId = undefined; data.vendeurVoitCout = false; }
      const id = edit ? p.id : nouvelId();
      if (edit) {
        const change = p.mode !== data.mode || +p.cout !== data.cout || +p.frais !== data.frais || +p.commission !== data.commission;
        for (const v of S.data.ventes) {
          if (v.produitId !== p.id) continue;
          const patch = {};
          if (change && fd.get("retro") === "on") patch.coutU = coutVente(data, v.prix);
          if (p.vendeurId !== data.vendeurId && v.vendeurId) patch.vendeurId = data.vendeurId;
          if (Object.keys(patch).length) ops.push({ type: "modif", col: "ventes", id: v.id, data: patch });
        }
        ops.push({ type: "modif", col: "produits", id, data });
      } else ops.push({ type: "ajout", col: "produits", id, data: { id, ...data, cree: Date.now() } });
      db.appliquer(ops);
      if (galerie.join("|") !== photosDe(id).join("|")) definirPhotos(id, galerie).then(() => render());
      toast(message);
    });
  const vdChoisi = () => form.vendeurId.value === "__nouveau" ? null : vendeurDe(form.vendeurId.value);
  const sync = () => {
    const m = form.mode.value, vd = vdChoisi();
    const nouveau = form.vendeurId.value === "__nouveau";
    form.querySelectorAll("[data-pour]").forEach(x => {
      const pour = x.dataset.pour;
      x.hidden = !(pour === "phys" ? m !== "numerique" : pour === "num" ? m === "numerique" : pour === "fixe" ? (m === "depot" && vd && vd.mode === "fixe") : pour === m);
    });
    $("#p-vd-new-f").hidden = !(m === "depot" && nouveau);
    const voit = form.vendeurVoitCout.checked;
    $("#p-base-f").hidden = $("#p-base-hint").hidden = !(m === "depot") || voit;
    $("#p-pv-lab").textContent = m === "depot" ? "Prix public conseillé (F)" : "Prix de vente (F)";
    $("#p-qte").previousElementSibling.textContent = m === "depot" ? "Pièces confiées" : "Nombre de pièces";
    majNum(); majCalc();
  };
  const majCalc = () => {
    const vd = vdChoisi(), el = $("#p-calc");
    if (form.mode.value !== "depot" || !vd) { el.innerHTML = form.vendeurId.value === "__nouveau" ? "Par défaut, le nouveau vendeur te rend ton coût + 50 % du bénéfice. Tu pourras changer ça dans l'onglet Vendeurs." : ""; return; }
    const pv = +form.prixVente.value || 0, cout = +form.cout.value || 0;
    if (!pv) { el.innerHTML = `Règle de ${esc(vd.nom)} : ${esc(resumeRegle(vd))}.`; return; }
    const r = reverse(vd, { cout, reverse: +form.reverse.value || 0, vendeurVoitCout: form.vendeurVoitCout.checked, baseVendeur: +form.baseVendeur.value || 0 }, pv);
    el.innerHTML = `Vendue ${F(pv)} : ${esc(vd.nom)} te doit <b>${F(r)}</b> et garde ${F(pv - r)}. Ton bénéfice réel : ${F(r - cout)}.`;
  };
  const majNum = () => {
    const prix = +form.prixVente.value || 0, com = +form.commission.value || 0, frais = +form.frais.value || 0;
    const touche = prix - frais - Math.round(prix * com / 100);
    $("#p-num-hint").textContent = (prix ? `Sur une vente à ${F(prix)}, tu touches ${F(touche)}. ` : "") +
      "Ce que tu as dépensé pour créer l'e-book (Canva, couverture, pub) va dans Dépenses, catégorie « Création e-book ».";
  };
  form.plateforme.addEventListener("change", () => {
    if (form.plateforme.value === "chariow") form.commission.value = 15;
    else if (form.plateforme.value === "moi") form.commission.value = "";
    majNum();
  });
  [form.prixVente, form.commission, form.frais].forEach(i => i.addEventListener("input", majNum));
  [form.prixVente, form.cout, form.reverse, form.baseVendeur].forEach(i => i.addEventListener("input", majCalc));
  form.vendeurVoitCout.addEventListener("change", sync);
  /* Galerie : ajouter, retirer, choisir la photo principale */
  const dessinerGalerie = () => {
    $("#p-galerie").innerHTML = galerie.map((ph, i) => `<div class="g-photo${i === 0 ? " principale" : ""}"><img src="${urlPhoto(ph)}" alt="Photo ${i + 1}" data-premiere="${i}">${i === 0 ? `<span class="g-tag">Principale</span>` : ""}<button type="button" class="g-x" data-retirer-photo="${i}" aria-label="Retirer la photo">✕</button></div>`).join("")
      + (galerie.length < MAX_PHOTOS ? `<button type="button" class="g-plus" id="p-ajout-photo">+ Photo</button>` : "");
  };
  $("#p-galerie").addEventListener("click", e => {
    const r = e.target.closest("[data-retirer-photo]"); if (r) { galerie.splice(+r.dataset.retirerPhoto, 1); dessinerGalerie(); return; }
    const pr = e.target.closest("[data-premiere]"); if (pr && +pr.dataset.premiere > 0) { const [x] = galerie.splice(+pr.dataset.premiere, 1); galerie.unshift(x); dessinerGalerie(); return; }
    if (e.target.closest("#p-ajout-photo")) $("#p-photos").click();
  });
  $("#p-photos").addEventListener("change", async () => {
    const fichiers = [...$("#p-photos").files].slice(0, MAX_PHOTOS - galerie.length); $("#p-photos").value = "";
    for (const f of fichiers) { try { galerie.push(await compresserImage(f)); } catch { toast("Une photo n'a pas pu être lue."); } dessinerGalerie(); }
  });
  dessinerGalerie();
  form.vendeurId.addEventListener("change", sync);
  if (!edit && !modele) { form.plateforme.value = "chariow"; form.commission.value = 15; }
  if (!vendeursActifs().length) form.vendeurId.value = "__nouveau";
  /* Auto-complète la catégorie quand on choisit un nom de produit existant */
  form.nom.addEventListener("change", () => {
    const x = S.data.produits.find(y => norm(y.nom) === norm(form.nom.value));
    if (x && !form.categorie.value) form.categorie.value = x.categorie;
  });
  form.mode.addEventListener("change", sync); sync();
}

function restockForm(p) {
  const st = stats("tout").byProd[p.id], restant = st.restant;
  const depot = p.mode === "depot";
  const form = openSheet(`<form><h2>${depot ? "Confier plus de pièces" : "Réapprovisionner"}</h2>
    <p class="note">${esc(nomComplet(p))} : ${plur(restant, "pièce")} ${depot ? "chez le vendeur" : "en stock"}, coût actuel ${F(p.cout)} par pièce.</p>
    <div class="two">
      <div class="field"><label for="r-qte">Pièces ajoutées</label><input id="r-qte" name="qte" type="number" inputmode="numeric" min="1" step="1" required></div>
      <div class="field"><label for="r-cout">Coût de revient / pièce (F)</label><input id="r-cout" name="cout" type="number" inputmode="numeric" min="0" step="1" value="${+p.cout || ""}" required></div>
    </div>
    <div class="hint" id="r-hint">Mets le coût de ce nouvel achat, transport compris. L'appli calcule le coût moyen. Les ventes passées gardent leur ancien coût. Si le prix de vente est différent, crée plutôt une variante.</div>
    <div class="hint">L'achat de stock n'est pas une dépense : son coût est compté au moment où tu vends chaque pièce.</div>
    ${buttons}</form>`, fd => {
      const n = +fd.get("qte"), c = +fd.get("cout");
      if (!(n > 0) || !(c >= 0)) throw new Error("Indique un nombre de pièces et un coût.");
      const moyen = Math.round(restant + n > 0 ? (restant * (+p.cout || 0) + n * c) / (restant + n) : c);
      db.modifier("produits", p.id, { quantite: (+p.quantite || 0) + n, cout: moyen, reappro: Date.now() });
      toast(plur(n, "pièce ajoutée", "pièces ajoutées") + " · coût moyen " + F(moyen));
    });
  const maj = () => {
    const n = +form.qte.value || 0, c = +form.cout.value || 0;
    if (n > 0) $("#r-hint").textContent = `Nouveau stock : ${plur(restant + n, "pièce")}, coût moyen ${F((restant * (+p.cout || 0) + n * c) / (restant + n))} par pièce. Les ventes passées gardent leur ancien coût.`;
  };
  form.qte.addEventListener("input", maj); form.cout.addEventListener("input", maj);
}

function vendeurForm(vd) {
  const edit = !!vd; vd = vd || { mode: "cout+part", pct: 50 };
  const form = openSheet(`<form><h2>${edit ? "Modifier le vendeur" : "Nouveau vendeur"}</h2>
    <div class="two">
      <div class="field"><label for="w-nom">Nom</label><input id="w-nom" name="nom" type="text" value="${esc(vd.nom || "")}" required></div>
      <div class="field"><label for="w-tel">Téléphone</label><input id="w-tel" name="tel" type="tel" inputmode="tel" placeholder="07 00 00 00 00" value="${esc(vd.tel || "")}"></div>
    </div>
    <div class="field"><label for="w-mode">Votre accord</label><select id="w-mode" name="mode">${Object.entries(REGLES).map(([k, l]) => opt(k, l, k === vd.mode)).join("")}</select></div>
    <div class="two" id="w-pct-f">
      <div class="field"><label for="w-pct">Ta part du bénéfice (%)</label><input id="w-pct" name="pct" type="number" inputmode="decimal" min="0" max="100" step="1" value="${vd.pct ?? 50}"></div>
      <div class="field"><label for="w-pct2">Sa part du bénéfice (%)</label><input id="w-pct2" type="number" inputmode="decimal" min="0" max="100" step="1" value="${100 - (vd.pct ?? 50)}"></div>
    </div>
    <div class="field" id="w-mt-f"><label for="w-mt">Il garde par pièce vendue (F)</label><input id="w-mt" name="montant" type="number" inputmode="numeric" min="0" step="1" value="${+vd.montant || ""}" placeholder="Ex. 1000"></div>
    <div class="box" id="w-ex-f">
      <div class="note">Exemple pour vérifier :</div>
      <div class="two">
        <div class="field"><label for="w-ex-c">Une pièce qui te coûte (F)</label><input id="w-ex-c" type="number" inputmode="numeric" value="2000"></div>
        <div class="field"><label for="w-ex-p">vendue au client (F)</label><input id="w-ex-p" type="number" inputmode="numeric" value="10000"></div>
      </div>
      <div class="calc num" id="w-ex"></div>
    </div>
    <div class="hint" id="w-hint"></div>
    <p class="hint">C'est la règle par défaut. Pour un accord différent sur une vente, tu ajustes directement ta part ou la sienne au moment de la vente.</p>
    ${edit ? `<label class="check"><input name="retro" type="checkbox"> Recalculer ses ventes déjà notées avec cette règle</label>
      <div class="hint">Laisse décoché si la nouvelle règle ne vaut que pour les prochaines ventes. Les ventes que tu as ajustées à la main ne changent pas.</div>` : ""}
    ${buttons}
    ${edit ? `<button type="button" class="btn sec" style="color:var(--red)" data-act="suppr-vendeur" data-id="${vd.id}">Supprimer ce vendeur</button>` : ""}
  </form>`, fd => {
      const data = { nom: fd.get("nom").trim(), tel: (fd.get("tel") || "").trim(), mode: fd.get("mode"),
        pct: Math.min(100, Math.max(0, +fd.get("pct") || 0)), montant: Math.max(0, +fd.get("montant") || 0) };
      if (!data.nom) throw new Error("Donne un nom au vendeur.");
      if (data.mode === "commission" && !data.montant) throw new Error("Indique combien il garde par pièce.");
      if (edit) {
        const ops = [];
        if (fd.get("retro") === "on") for (const v of S.data.ventes) if (v.vendeurId === vd.id && v.prixClient && !v.ajuste) { const p = produitDe(v.produitId); if (p) ops.push({ type: "modif", col: "ventes", id: v.id, data: { prix: reverse(data, p, v.prixClient) } }); }
        ops.push({ type: "modif", col: "vendeurs", id: vd.id, data });
        db.appliquer(ops); toast("Vendeur mis à jour");
      } else { db.ajouter("vendeurs", data); toast("Vendeur ajouté"); }
    });
  const maj = () => {
    const m = form.mode.value, pct = +form.pct.value || 0, c = +$("#w-ex-c").value || 0, p = +$("#w-ex-p").value || 0;
    $("#w-pct-f").hidden = !(m === "cout+part" || m === "part");
    $("#w-mt-f").hidden = m !== "commission";
    $("#w-ex-f").hidden = m === "fixe";
    $("#w-hint").textContent = m === "fixe" ? "Le montant fixe se règle sur chaque produit confié (champ « Il me reverse »)." :
      m === "cout+part" ? "Il te rend d'abord ce que la pièce t'a coûté, puis vous partagez le bénéfice." :
      m === "commission" ? "Quel que soit le prix de vente, il garde ce montant par pièce et te donne tout le reste." :
      "Il te donne seulement un pourcentage du bénéfice. Attention : ton coût d'achat n'est pas remboursé à part.";
    const r = partageCalc({ mode: m, pct, montant: +form.montant.value || 0 }, { cout: c, vendeurVoitCout: true }, p, 1);
    $("#w-ex").innerHTML = `Bénéfice ${F(r.benefice)} : <b>${F(r.maPart)} pour toi</b> · <b>${F(r.saPart)} pour lui</b>.<br>Il te doit ${F(r.du)}${r.rembourse ? " (ton coût " + F(r.rembourse) + " + ta part)" : ""} et garde ${F(r.garde)}.`;
  };
  /* Les deux pourcentages restent liés : 40 % pour toi = 60 % pour lui */
  form.pct.addEventListener("input", () => { form.querySelector("#w-pct2").value = Math.max(0, 100 - (+form.pct.value || 0)); maj(); });
  $("#w-pct2").addEventListener("input", () => { form.pct.value = Math.max(0, 100 - (+$("#w-pct2").value || 0)); maj(); });
  ["#w-mode", "#w-mt", "#w-ex-c", "#w-ex-p"].forEach(x => $(x).addEventListener("input", maj));
  maj();
}

/* Supprimer un vendeur : ses produits reviennent chez toi ou passent à un autre vendeur ; son historique reste dans ton bilan */
function supprimerVendeurSheet(vd) {
  const c = compteVendeur(vd, "tout");
  const confies = S.data.produits.filter(p => p.mode === "depot" && p.vendeurId === vd.id);
  const autres = vendeursActifs().filter(x => x.id !== vd.id);
  const aHistorique = S.data.ventes.some(v => v.vendeurId === vd.id) || S.data.versements.some(x => x.vendeurId === vd.id);
  openSheet(`<div class="inner"><h2>Supprimer ${esc(vd.nom)} ?</h2>
    ${c.solde > 0 ? `<div class="banner red"><span>Il te doit encore <b>${F(c.solde)}</b>. Après la suppression, ce montant ne sera plus suivi. Si tu as reçu de l'argent, enregistre d'abord le versement.</span></div>` : ""}
    ${confies.length ? `<div class="field"><label for="sv-dest">Que faire de ses ${plur(c.piecesChezLui, "pièce")} (${plur(confies.length, "produit")}) ?</label>
      <select id="sv-dest">${opt("__moi", "Les reprendre chez moi", true)}${autres.map(x => opt(x.id, "Les confier à " + x.nom, false)).join("")}</select></div>` : ""}
    <p class="note">${aHistorique ? "Ses ventes passées restent dans ton bilan et ton historique : c'est de l'argent réellement gagné." : "Il n'a encore aucune vente ni aucun versement."}${vd.uid ? " Son accès à l'appli sera retiré." : ""}</p>
    <div class="err"></div>
    <div class="btns"><button class="btn sec" data-close>Annuler</button><button class="btn warn" id="sv-ok">Supprimer</button></div></div>`);
  $("#sv-ok").addEventListener("click", async () => {
    const bt = $("#sv-ok"); bt.disabled = true;
    try {
      if (vd.uid && typeof Cloud !== "undefined" && Cloud.retirerAccesVendeur) await Cloud.retirerAccesVendeur(vd);
      const dest = $("#sv-dest") ? $("#sv-dest").value : "__moi";
      const ops = confies.map(p => ({ type: "modif", col: "produits", id: p.id, data: dest === "__moi" ? { mode: "stock", vendeurId: undefined, vendeurVoitCout: false } : { vendeurId: dest } }));
      ops.push(aHistorique ? { type: "modif", col: "vendeurs", id: vd.id, data: { supprime: true, uid: undefined } } : { type: "suppr", col: "vendeurs", id: vd.id });
      db.appliquer(ops); closeSheet(); toast(vd.nom + " supprimé");
    } catch (x) { $(".sheet .err").textContent = typeof Cloud !== "undefined" ? Cloud.messageErreur(x) : "Suppression impossible."; bt.disabled = false; }
  });
}
ACTIONS["suppr-vendeur"] = id => supprimerVendeurSheet(vendeurDe(id));

function versementForm(vdId) {
  if (!vendeursActifs().length) { vendeurForm(); return; }
  const vd0 = vendeurDe(vdId) || vendeursActifs().map(vd => ({ vd, s: compteVendeur(vd, "tout").solde })).sort((a, b) => b.s - a.s)[0].vd;
  const form = openSheet(`<form><h2>Versement reçu</h2>
    <div class="field"><label for="x-vd">De qui ?</label><select id="x-vd" name="vendeurId">${vendeursActifs().map(vd => opt(vd.id, vd.nom, vd.id === vd0.id)).join("")}</select></div>
    <div class="two">
      <div class="field"><label for="x-mt">Montant reçu (F)</label><input id="x-mt" name="montant" type="number" inputmode="numeric" min="1" step="1" required></div>
      <div class="field"><label for="x-date">Date</label><input id="x-date" name="date" type="date" value="${todayISO()}" required></div>
    </div>
    <div class="hint" id="x-hint"></div>
    <div class="field"><label for="x-note">Note (facultatif)</label><input id="x-note" name="note" type="text" placeholder="Ex. Wave, en espèces…"></div>
    ${buttons}</form>`, fd => {
      const montant = +fd.get("montant");
      if (!(montant > 0)) throw new Error("Indique le montant reçu.");
      db.ajouter("versements", { vendeurId: fd.get("vendeurId"), montant, date: fd.get("date"), note: (fd.get("note") || "").trim(), cree: Date.now() });
      toast("Versement de " + F(montant) + " enregistré");
    });
  const maj = () => {
    const c = compteVendeur(vendeurDe(form.vendeurId.value), "tout");
    $("#x-hint").textContent = c.solde > 0 ? `Il te doit actuellement ${F(c.solde)}.` : "Il ne te doit rien pour l'instant : ce versement sera compté comme une avance.";
    if (!form.montant.value && c.solde > 0) form.montant.placeholder = String(c.solde);
  };
  form.vendeurId.addEventListener("change", maj); maj();
}

function depenseForm(d) {
  const edit = !!d; d = d || {};
  const cats = ["Publicité","Transport","Livraison","Emballage","Création e-book","Crédit / Internet","Autre"];
  openSheet(`<form><h2>${edit ? "Modifier la dépense" : "Nouvelle dépense"}</h2>
    <div class="field"><label for="d-lib">Pour quoi ?</label><input id="d-lib" name="libelle" type="text" placeholder="Ex. Pub Facebook, taxi Adjamé" value="${esc(d.libelle || "")}" required></div>
    <div class="two">
      <div class="field"><label for="d-mt">Montant (F)</label><input id="d-mt" name="montant" type="number" inputmode="numeric" min="0" step="1" value="${edit ? +d.montant : ""}" required></div>
      <div class="field"><label for="d-date">Date</label><input id="d-date" name="date" type="date" value="${d.date || todayISO()}" required></div>
    </div>
    <div class="field"><label for="d-cat">Catégorie</label><select id="d-cat" name="categorie">${cats.map(c => opt(c, c, c === d.categorie)).join("")}</select></div>
    ${buttons}</form>`, fd => {
      const data = { libelle: fd.get("libelle").trim(), montant: +fd.get("montant") || 0, date: fd.get("date"), categorie: fd.get("categorie") };
      if (edit) { db.modifier("depenses", d.id, data); toast("Dépense modifiée"); }
      else { db.ajouter("depenses", { ...data, cree: Date.now() }); toast("Dépense enregistrée"); }
    });
}

/* ================= Réglages & sauvegarde ================= */
function reglagesSheet() {
  const r = S.data.reglages, j = joursDepuis(S.data.derniereSauvegarde);
  openSheet(`<div class="inner"><h2>Réglages</h2>
    <form id="f-reglages" class="inner" style="gap:12px">
      <div class="field"><label for="g-boutique">Nom de ta boutique</label><input id="g-boutique" name="boutique" type="text" placeholder="Apparaît sur les reçus" value="${esc(r.boutique)}"></div>
      <div class="field"><label>Logo de ta boutique</label>
        <div class="logo-pick"><span class="avatar" id="g-logo-ap"></span><div class="btns" style="flex-wrap:wrap"><button type="button" class="mini" id="g-logo-btn">${r.logo ? "Changer le logo" : "Choisir une image"}</button>${r.logo ? `<button type="button" class="mini danger" id="g-logo-x">Retirer</button>` : ""}</div></div>
        <input type="file" id="g-logo" accept="image/*" hidden>
        <div class="hint">Il apparaît en haut de l'appli, dans ta boutique en ligne et chez tes vendeurs. Une image carrée marche le mieux.</div></div>
      <div class="field"><label for="g-numero">Ton numéro Mobile Money</label><input id="g-numero" name="numero" type="tel" inputmode="tel" placeholder="Pour que les clients te paient" value="${esc(r.numero)}"></div>
      <div class="field"><label for="g-obj">Objectif de bénéfice par mois (F)</label><input id="g-obj" name="objectifMois" type="number" inputmode="numeric" min="0" step="1000" value="${+r.objectifMois || ""}" placeholder="Ex. 50000"></div>
      <button type="submit" class="btn pri">Enregistrer les réglages</button>
    </form>
    <hr class="sep">
    <h3>Sécurité</h3>
    <div class="box"><div>Code PIN : <b>${pinConfig() ? "activé" : "désactivé"}</b></div><button class="btn sec" data-act="pin">${pinConfig() ? "Changer ou retirer le code" : "Activer un code PIN"}</button></div>
    <hr class="sep">
    <h3>Synchronisation en ligne</h3>
    <div id="reglages-synchro">${typeof htmlSynchro === "function" ? htmlSynchro() : ""}</div>
    <hr class="sep">
    <h3>Sauvegarde</h3>
    <div class="box num">
      <div><b>${S.data.produits.length}</b> produits · <b>${S.data.ventes.length}</b> ventes · <b>${S.data.depenses.length}</b> dépenses · <b>${S.data.versements.length}</b> versements</div>
      <div class="note">Mémoire utilisée : ${memoire()}</div>
      <div class="note">Dernière sauvegarde : ${j === null ? "jamais" : j === 0 ? "aujourd'hui" : "il y a " + plur(j, "jour")}</div>
    </div>
    <p class="note">Tes données sont sur cet appareil. Sauvegarde au moins une fois par semaine et envoie le fichier sur ton Google Drive ou à toi-même sur WhatsApp. Si tu perds ton téléphone, ce fichier te permet de tout récupérer.</p>
    <button class="btn pri" data-act="exporter">Sauvegarder dans un fichier</button>
    <button class="btn sec" data-act="importer">Restaurer depuis un fichier</button>
    <button class="btn sec" data-act="csv">Exporter pour Excel / Google Sheets</button>
    <p class="hint">Restaurer sert aussi à copier tes données sur un autre appareil. L'export Excel ne sert qu'à analyser tes chiffres : il ne peut pas être restauré.</p>
    <button class="btn sec" data-close>Fermer</button>
    <p class="hint" style="text-align:center">Cahier de Caisse · version ${VERSION_APPLI}</p>
  </div>`);
  let logo = r.logo || "";
  const apercuLogo = () => { const n = ($("#g-boutique").value || "Cahier de Caisse").trim(); $("#g-logo-ap").innerHTML = logo ? `<img src="${logo}" alt="Logo">` : esc(n.split(/\s+/).map(m => m[0] || "").join("").slice(0, 2).toUpperCase()); };
  apercuLogo(); $("#g-boutique").addEventListener("input", apercuLogo);
  $("#g-logo-btn").addEventListener("click", () => $("#g-logo").click());
  $("#g-logo").addEventListener("change", async () => {
    const f = $("#g-logo").files[0]; if (!f) return;
    try { logo = await compresserLogo(f); apercuLogo(); toast("Logo prêt : touche « Enregistrer les réglages »"); } catch { toast("Cette image n'a pas pu être lue."); }
  });
  const x = document.getElementById("g-logo-x"); if (x) x.addEventListener("click", () => { logo = ""; apercuLogo(); x.remove(); });
  $("#f-reglages").addEventListener("submit", e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    S.data.reglages = Object.assign({}, S.data.reglages, { boutique: fd.get("boutique").trim(), numero: fd.get("numero").trim(), objectifMois: +fd.get("objectifMois") || 0, logo: logo || undefined });
    if (!logo) delete S.data.reglages.logo;
    if (typeof planifierVitrine === "function") planifierVitrine(1000);
    if (db.cloud && db.cloud.reglages) db.cloud.reglages(S.data.reglages);
    enregistrer(); render(); closeSheet(); toast("Réglages enregistrés");
  });
}

/* Logo : carré de 256 px, recadré au centre, léger (environ 15 Ko) */
async function compresserLogo(fichier) {
  const url = URL.createObjectURL(fichier);
  try {
    const img = await chargerImage(url); if (!img) throw new Error("image");
    const cote = Math.min(img.width, img.height), c = document.createElement("canvas"); c.width = c.height = 256;
    const x = c.getContext("2d"); x.fillStyle = "#ffffff"; x.fillRect(0, 0, 256, 256);
    x.drawImage(img, (img.width - cote) / 2, (img.height - cote) / 2, cote, cote, 0, 0, 256, 256);
    return c.toDataURL("image/jpeg", 0.86);
  } finally { URL.revokeObjectURL(url); }
}
/* Le navigateur réserve environ 5 millions de caractères à l'appli */
function memoire() {
  let n = 0; try { n = (localStorage.getItem(KEY) || "").length; } catch {}
  const pct = n / 5e6 * 100;
  return (n < 1e6 ? Math.max(1, Math.round(n / 1000)) + " Ko" : (n / 1e6).toFixed(1).replace(".", ",") + " Mo") + " · " + (pct < 1 ? "moins de 1" : Math.round(pct)) + " % de l'espace";
}
async function partagerFichier(nom, contenu, type, titre) {
  const fichier = new File([contenu], nom, { type });
  const mobile = matchMedia("(pointer: coarse)").matches;
  if (mobile && navigator.canShare && navigator.canShare({ files: [fichier] })) {
    try { await navigator.share({ files: [fichier], title: titre }); return true; }
    catch (e) { if (e && e.name === "AbortError") return false; }
  }
  const url = URL.createObjectURL(fichier);
  const a = document.createElement("a"); a.href = url; a.download = nom;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}
async function exporter() {
  const contenu = JSON.stringify({ app: "cahier-de-caisse", exporte: new Date().toISOString(), ...S.data, derniereSauvegarde: Date.now(), photos: PHOTOS, galeries: AUTRES }, null, 2);
  if (await partagerFichier("cahier-de-caisse-" + todayISO() + ".json", contenu, "application/json", "Sauvegarde Cahier de Caisse")) {
    S.data.derniereSauvegarde = Date.now(); enregistrer(); render(); closeSheet(); toast("Sauvegarde créée");
  }
}
async function exporterCSV() {
  const c = v => { const s = String(v ?? ""); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lignes = [["Type","Date","Catégorie / Vendeur","Produit / Libellé","Quantité","Prix unitaire","Prix client","Total","Coût","Bénéfice","Paiement","Client","Téléphone","Encaissé","Catégorie dépense"]];
  for (const v of [...S.data.ventes].sort((a, b) => a.date.localeCompare(b.date))) {
    const p = produitDe(v.produitId), vd = vendeurDe(v.vendeurId);
    lignes.push([vd ? "Vente vendeur" : "Vente", v.date, vd ? vd.nom : (p ? p.categorie : ""), nomProduit(v.produitId), v.qte, v.prix, v.prixClient || "", totalVente(v), (+v.qte||0) * (+v.coutU||0), beneficeVente(v), v.paiement, v.client, v.tel, vd ? "" : (v.encaisse ? "oui" : "non"), ""]);
  }
  for (const d of [...S.data.depenses].sort((a, b) => a.date.localeCompare(b.date)))
    lignes.push(["Dépense", d.date, "", d.libelle, "", "", "", -(+d.montant||0), "", -(+d.montant||0), "", "", "", "", d.categorie]);
  for (const x of [...S.data.versements].sort((a, b) => a.date.localeCompare(b.date)))
    lignes.push(["Versement reçu", x.date, (vendeurDe(x.vendeurId) || {}).nom || "", x.note || "", "", "", "", x.montant, "", "", "", "", "", "", ""]);
  const csv = "﻿" + lignes.map(l => l.map(c).join(";")).join("\r\n");
  if (await partagerFichier("cahier-de-caisse-" + todayISO() + ".csv", csv, "text/csv", "Export Cahier de Caisse")) { closeSheet(); toast("Export créé"); }
}

$("#import-file").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  let d;
  try { d = JSON.parse(await f.text()); } catch { toast("Ce fichier n'est pas une sauvegarde valide."); return; }
  if (!valide(d)) { toast("Ce fichier n'est pas une sauvegarde du Cahier de Caisse."); return; }
  const quand = d.exporte ? new Date(d.exporte).toLocaleDateString("fr-FR", {day:"numeric", month:"long", year:"numeric"}) : "date inconnue";
  openSheet(`<div class="inner"><h2>Restaurer cette sauvegarde ?</h2>
    <div class="box num"><div>Sauvegarde du <b>${esc(quand)}</b></div>
      <div><b>${d.produits.length}</b> produits · <b>${d.ventes.length}</b> ventes · <b>${d.depenses.length}</b> dépenses</div></div>
    <p class="note">Les données actuelles de cet appareil (${plur(S.data.ventes.length, "vente")}, ${plur(S.data.depenses.length, "dépense")}) seront remplacées.</p>
    <div class="btns"><button class="btn sec" data-close>Annuler</button><button class="btn warn" id="confirm-import">Remplacer</button></div>
  </div>`);
  $("#confirm-import").addEventListener("click", () => {
    const nouv = normaliser({ format: d.format || 1, cree: d.cree || Date.now(), modifie: Date.now(), derniereSauvegarde: d.derniereSauvegarde || Date.now(),
      reglages: d.reglages, produits: d.produits, vendeurs: d.vendeurs, ventes: d.ventes, depenses: d.depenses, versements: d.versements, arrivages: d.arrivages });
    if (db.cloud && db.cloud.remplacerTout) db.cloud.remplacerTout(nouv);
    S.data = nouv;
    if (d.photos && typeof d.photos === "object") {
      const gal = d.galeries && typeof d.galeries === "object" ? d.galeries : {};
      for (const [id, url] of Object.entries(d.photos)) definirPhotos(id, [url, ...(Array.isArray(gal[id]) ? gal[id] : [])]);
    }
    enregistrer(); closeSheet(); render(); toast("Données restaurées");
  });
});

