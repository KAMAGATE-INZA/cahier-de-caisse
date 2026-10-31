"use strict";
/* ================= Événements ================= */
document.querySelector("nav.tabs").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; S.tab = b.dataset.tab; S.ouvert = null; garderPrefs(); render(); window.scrollTo(0, 0); });
$("#fab").addEventListener("click", () => {
  if (S.apercu) return;
  if (S.role === "vendeur") return S.tab === "vendeurs" ? versementVendeurForm() : venteVendeurForm();
  ({ depenses: depenseForm, stock: () => produitForm(), vendeurs: () => versementForm() }[S.tab] || (() => venteForm()))();
});
$("#btn-reglages").addEventListener("click", reglagesSheet);
document.addEventListener("input", e => {
  if (e.target.id === "q-ventes" || e.target.id === "q-clients") {
    const id = e.target.id, pos = e.target.selectionStart;
    if (id === "q-ventes") { S.q = e.target.value; S.limV = PAGE; } else { S.qc = e.target.value; S.limC = PAGE; }
    renderVentes();
    const el = document.getElementById(id); el.focus(); try { el.setSelectionRange(pos, pos); } catch {}
  }
});
function basculerLigne(row) { S.ouvert = S.ouvert === row.dataset.row ? null : row.dataset.row; render(); }
document.addEventListener("keydown", e => {
  const row = e.target.closest && e.target.closest(".row.compact");
  if (row && e.target === row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); basculerLigne(row); }
});
function supprimerProduit(id) {
  const n = S.data.ventes.filter(v => v.produitId === id).length;
  if (n) { toast(`Impossible : ce produit a ${plur(n, "vente")}. Mets sa quantité à 0 pour le garder dans l'historique.`); return false; }
  db.supprimer("produits", id); return true;
}
document.addEventListener("click", e => {
  const row = e.target.closest(".row.compact");
  if (row && !e.target.closest("a,button")) { basculerLigne(row); return; }
  const go = e.target.closest("[data-goto]");
  if (go) { S.tab = go.dataset.goto; if (go.dataset.vue2) S.vue = go.dataset.vue2; garderPrefs(); render(); window.scrollTo(0, 0); return; }
  const vue = e.target.closest("[data-vue]");
  if (vue) { S.vue = vue.dataset.vue; render(); return; }
  const per = e.target.closest("[data-periode]");
  if (per) { S.periode = per.dataset.periode; S.limV = S.limD = PAGE; garderPrefs(); render(); return; }
  const b = e.target.closest("[data-act]"); if (!b) return;
  const id = b.dataset.id, act = b.dataset.act;
  if (S.apercu && act !== "quitter-apercu") { toast("Aperçu : lecture seule. Quitte l'aperçu pour modifier."); return; }
  if (act === "exporter") return exporter();
  if (act === "csv") return exporterCSV();
  if (act === "importer") return $("#import-file").click();
  if (act === "reglages") return reglagesSheet();
  if (act === "plus") { S[b.dataset.quoi] += PAGE; render(); return; }
  if (act === "tous-produits") { S.tousProduits = !S.tousProduits; render(); return; }
  if (act === "copier") {
    const p = produitDe(id); if (!p) return;
    navigator.clipboard.writeText(p.lien).then(() => toast("Lien copié"), () => toast("Copie impossible : " + p.lien));
    return;
  }
  if (act === "toggle") { const v = S.data.ventes.find(x => x.id === id); if (v) db.modifier("ventes", id, { encaisse: !v.encaisse }); return; }
  if (act === "edit") return produitForm(produitDe(id));
  if (act === "variante") { const p = produitDe(id); return produitForm(null, { categorie: p.categorie, nom: p.nom, mode: p.mode, vendeurId: p.vendeurId, cout: p.cout, prixVente: p.prixVente, seuil: p.seuil, reverse: p.reverse, vendeurVoitCout: p.vendeurVoitCout, baseVendeur: p.baseVendeur }); }
  if (act === "restock") return restockForm(produitDe(id));
  if (act === "edit-vente") return venteForm(S.data.ventes.find(x => x.id === id));
  if (act === "edit-dep") return depenseForm(S.data.depenses.find(x => x.id === id));
  if (act === "nouveau-vendeur") return vendeurForm();
  if (act === "edit-vendeur") return vendeurForm(vendeurDe(id));
  if (act === "versement") return versementForm(id);
  if (act === "releve") return releveSheet(vendeurDe(id));
  if (act === "del-versement") {
    if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "Confirmer"; return; }
    const x = S.data.versements.find(y => y.id === id);
    db.supprimer("versements", id); toast("Versement supprimé"); if (x) releveSheet(vendeurDe(x.vendeurId));
    return;
  }
  if (ACTIONS[act]) return ACTIONS[act](id, b);
  if (act === "del") {
    if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "Confirmer"; setTimeout(() => { if (b.isConnected) { b.classList.remove("armed"); b.textContent = "Supprimer"; } }, 3500); return; }
    if (b.dataset.col === "produits") { if (supprimerProduit(id)) toast("Supprimé"); return; }
    db.supprimer(b.dataset.col, id); toast("Supprimé");
  }
});

ACTIONS["vers-confirmer"] = id => { db.modifier("versements", id, { confirme: true }); toast("Versement confirmé"); };
ACTIONS["vers-refuser"] = (id, b) => {
  if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "Confirmer : pas reçu"; return; }
  db.supprimer("versements", id); toast("Versement retiré");
};

/* Démarrage : verrou PIN, photos, puis affichage */
afficherVerrou();
render();
chargerPhotos().then(() => { if (Object.keys(PHOTOS).length) render(); });

/* Hors connexion : le service worker garde l'appli en mémoire après la première ouverture */
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
