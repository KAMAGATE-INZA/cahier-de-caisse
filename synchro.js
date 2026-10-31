"use strict";
/* =====================================================================
   Synchronisation : écran de connexion, réglages, accès des vendeurs,
   et l'appli simplifiée que voit le vendeur.
   La partie technique (Firebase) est dans cloud.js, chargé à la demande.
   ===================================================================== */
const CLOUD_KEY = "cahier-de-caisse:cloud";
const cfgCloud = () => { try { return JSON.parse(localStorage.getItem(CLOUD_KEY) || "null"); } catch { return null; } };
const cloudActif = () => typeof Cloud !== "undefined" && Cloud.etat === "actif";

/* Lit le bloc firebaseConfig collé depuis la console Firebase */
function lireConfigFirebase(texte) {
  const o = {};
  for (const m of String(texte).matchAll(/["']?(\w+)["']?\s*:\s*["']([^"']+)["']/g)) o[m[1]] = m[2];
  if (!o.apiKey || !o.projectId || !o.appId) return null;
  if (!o.authDomain) o.authDomain = o.projectId + ".firebaseapp.com";
  return { apiKey: o.apiKey, authDomain: o.authDomain, projectId: o.projectId, appId: o.appId, messagingSenderId: o.messagingSenderId, storageBucket: o.storageBucket };
}
function chargerCloud() { return import("./cloud.js").then(m => m.demarrer()).catch(() => { majEtatSynchro("Synchro indisponible : vérifie ta connexion internet"); }); }

/* ================= État affiché sous le titre ================= */
function majEtatSynchro(force) {
  const el = $("#etat-synchro"); if (!el) return;
  if (force) { el.textContent = force; el.hidden = false; return; }
  if (!cfgCloud()) { el.hidden = true; return; }
  el.hidden = false;
  if (typeof Cloud === "undefined" || Cloud.etat === "demarrage" || Cloud.etat === "attente" || Cloud.etat === "chargement") el.textContent = "Synchro : connexion…";
  else if (Cloud.etat === "erreur") el.textContent = "Synchro : " + Cloud.erreur;
  else if (Cloud.etat === "deconnecte") el.textContent = "Synchro : déconnecté";
  else if (!navigator.onLine) el.textContent = "Hors ligne · tout sera envoyé au retour du réseau";
  else if (Cloud.enAttente > 0) el.textContent = "Synchro : envoi en cours…";
  else el.textContent = "Synchro : à jour" + (S.role === "vendeur" ? "" : Cloud.erreur ? " · " + Cloud.erreur : "");
}
window.surEtatCloud = () => {
  majEtatSynchro();
  if (typeof Cloud !== "undefined" && Cloud.etat === "deconnecte") afficherConnexion();
  if (typeof Cloud !== "undefined" && Cloud.etat === "erreur" && document.getElementById("connexion")) {
    const e = document.querySelector("#connexion .err"); if (e) e.textContent = Cloud.erreur;
  }
};
window.surSession = role => {
  const c = document.getElementById("connexion"); if (c) c.remove();
  S.role = role;
  if (role === "vendeur") { S.tab = ["ventes", "stock", "vendeurs"].includes(S.tab) ? S.tab : "ventes"; }
  render(); majEtatSynchro();
  const r = document.getElementById("reglages-synchro"); if (r) r.innerHTML = htmlSynchro();
};
window.surDeconnexion = () => { majEtatSynchro(); };
/* L'accès de ce vendeur a été retiré : on n'affiche plus rien */
window.surAccesRetire = () => {
  S.data = donneesInitiales(); render();
  if (document.getElementById("acces-retire")) return;
  const c = document.getElementById("connexion"); if (c) c.remove();
  const el = document.createElement("div"); el.id = "connexion"; el.setAttribute("role", "dialog");
  el.innerHTML = `<div class="v-in" style="max-width:340px;display:grid;gap:14px;text-align:center" id="acces-retire">
    <h2>Accès retiré</h2><p>Le propriétaire a retiré ton accès à cet espace. Si c'est une erreur, contacte-le.</p>
    <button class="btn pri" id="ar-ok">Fermer</button></div>`;
  document.body.appendChild(el);
  $("#ar-ok").addEventListener("click", async () => { try { await Cloud.deconnecter(); } catch {} localStorage.removeItem(CLOUD_KEY); location.reload(); });
};

/* Premier branchement sur un appareil qui a déjà des données */
window.choisirDonnees = ({ ventesLocales, ventesEnLigne }) => new Promise(res => {
  S.feuilleBloquante = true;
  openSheet(`<div class="inner"><h2>Quelles données garder ?</h2>
    <p>Ton compte en ligne contient déjà ${plur(ventesEnLigne, "vente")}. Cet appareil en contient ${plur(ventesLocales, "vente")}.</p>
    <p class="note">Une copie des données de cet appareil est gardée de côté dans tous les cas.</p>
    <button class="btn pri" id="ch-en-ligne">Garder celles en ligne</button>
    <button class="btn sec" id="ch-local">Remplacer en ligne par celles de cet appareil</button></div>`);
  $("#ch-en-ligne").addEventListener("click", () => { S.feuilleBloquante = false; closeSheet(); res("enligne"); });
  $("#ch-local").addEventListener("click", () => { S.feuilleBloquante = false; closeSheet(); res("local"); });
});

/* ================= Écran de connexion ================= */
function afficherConnexion() {
  const cfg = cfgCloud(); if (!cfg || document.getElementById("connexion")) return;
  const vendeur = !!cfg.vendeur;
  const el = document.createElement("div"); el.id = "connexion"; el.setAttribute("role", "dialog");
  el.innerHTML = `<form class="v-in" style="max-width:360px;width:100%;display:grid;gap:12px;text-align:left">
    <h2 style="text-align:center">${vendeur ? "Espace vendeur" : "Connexion"}</h2>
    <p class="note" style="text-align:center">${vendeur ? "Connecte-toi avec l'identifiant et le mot de passe que t'a donnés le propriétaire." : cfg.creation ? "Crée ton compte : il servira à retrouver tes données sur tous tes appareils." : "Connecte-toi pour synchroniser tes données."}</p>
    <div class="field"><label for="cx-id">${vendeur ? "Identifiant" : "Adresse e-mail"}</label><input id="cx-id" name="id" type="${vendeur ? "text" : "email"}" autocomplete="username" autocapitalize="none" value="${esc(cfg.identifiant || "")}" required></div>
    <div class="field"><label for="cx-mdp">Mot de passe</label><input id="cx-mdp" name="mdp" type="password" autocomplete="${cfg.creation ? "new-password" : "current-password"}" minlength="6" required></div>
    <div class="err"></div>
    ${cfg.creation && !vendeur ? `<button type="submit" class="btn pri" data-mode="creer">Créer mon compte</button><button type="submit" class="btn sec" data-mode="connecter">J'ai déjà un compte : me connecter</button>`
      : `<button type="submit" class="btn pri" data-mode="connecter">Se connecter</button>`}
    ${vendeur ? "" : `<button type="button" class="v-oubli" id="cx-oubli">Mot de passe oublié ?</button>`}
    <button type="button" class="v-oubli" id="cx-annuler">${vendeur ? "Ce n'est pas moi : annuler" : "Continuer sans synchro sur cet appareil"}</button>
  </form>`;
  document.body.appendChild(el);
  const form = el.querySelector("form");
  let mode = "connecter";
  form.addEventListener("click", e => { const b = e.target.closest("[data-mode]"); if (b) mode = b.dataset.mode; });
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const err = form.querySelector(".err"); err.textContent = "";
    if (typeof Cloud === "undefined" || !Cloud.connecter) { err.textContent = "Chargement en cours, réessaie dans un instant."; return; }
    form.querySelectorAll("button").forEach(b => b.disabled = true);
    try {
      if (mode === "creer") await Cloud.creerCompte(form.id.value, form.mdp.value);
      else await Cloud.connecter(form.id.value, form.mdp.value);
      const c = cfgCloud(); if (c) { delete c.creation; localStorage.setItem(CLOUD_KEY, JSON.stringify(c)); }
    } catch (x) { err.textContent = Cloud.messageErreur(x); }
    form.querySelectorAll("button").forEach(b => b.disabled = false);
  });
  const oubli = el.querySelector("#cx-oubli");
  if (oubli) oubli.addEventListener("click", async () => {
    const err = form.querySelector(".err");
    if (!form.id.value.includes("@")) { err.textContent = "Écris d'abord ton adresse e-mail."; return; }
    try { await Cloud.motDePasseOublie(form.id.value); err.textContent = "Un e-mail pour changer ton mot de passe vient d'être envoyé."; }
    catch (x) { err.textContent = Cloud.messageErreur(x); }
  });
  el.querySelector("#cx-annuler").addEventListener("click", () => {
    localStorage.removeItem(CLOUD_KEY); location.reload();
  });
}

/* ================= Réglages : section synchro ================= */
function htmlSynchro() {
  const cfg = cfgCloud();
  if (!cfg) return `<p class="note">Synchronise tes données en ligne : elles sont sauvegardées automatiquement, tu les retrouves sur tous tes appareils, et tes vendeurs peuvent noter leurs ventes eux-mêmes depuis leur téléphone. Il faut d'abord créer un projet Firebase gratuit.</p>
    <button class="btn sec" data-act="activer-synchro">Activer la synchronisation</button>`;
  if (S.role === "vendeur") return "";
  const actif = cloudActif();
  return `<div class="box"><div>${actif ? "Connecté avec <b>" + esc(Cloud.email()) + "</b>" : "Pas encore connecté"}</div>
      <div class="note">${esc($("#etat-synchro") ? $("#etat-synchro").textContent : "")}</div></div>
    <button class="btn sec" data-act="copier-regles">Copier les règles de sécurité</button>
    <p class="hint">À coller dans Firebase : Firestore Database → Règles → Publier. Sans elles, la synchro est refusée.</p>
    ${actif && !(window.CONFIG_FIREBASE && Cloud.configActuelle() && window.CONFIG_FIREBASE.projectId === Cloud.configActuelle().projectId) ? `<button class="btn sec" data-act="liens-courts">Liens courts pour tes vendeurs</button>
    <p class="hint">Pour que le lien de ton vendeur soit simplement « …/cahier-de-caisse/#kouame ».</p>` : ""}
    ${actif ? `<button class="btn sec" data-act="deconnecter">Se déconnecter</button>` : ""}
    <button class="btn sec" data-act="desactiver-synchro">Arrêter la synchro sur cet appareil</button>`;
}
ACTIONS["activer-synchro"] = () => {
  const form = openSheet(`<form><h2>Activer la synchronisation</h2>
    <p class="note">Colle ici le bloc <b>firebaseConfig</b> que Firebase t'a donné (Paramètres du projet → Vos applications). Il n'est pas secret : ce sont les règles de sécurité qui protègent tes données.</p>
    <div class="field"><label for="sy-cfg">Configuration Firebase</label><textarea id="sy-cfg" name="cfg" rows="8" style="width:100%;border:1px solid var(--line);background:var(--bg);border-radius:10px;padding:10px;font:13px ui-monospace,monospace" placeholder='const firebaseConfig = {&#10;  apiKey: "…",&#10;  authDomain: "…",&#10;  projectId: "…",&#10;  appId: "…"&#10;};' required>${window.CONFIG_FIREBASE ? esc(JSON.stringify(window.CONFIG_FIREBASE, null, 2)) : ""}</textarea></div>
    <p class="hint">Fais-le d'abord sur l'appareil qui contient déjà tes données : elles seront envoyées en ligne. Une copie reste sur l'appareil.</p>
    ${buttons}</form>`, fd => {
      const f = lireConfigFirebase(fd.get("cfg"));
      if (!f) throw new Error("Je ne trouve pas apiKey, projectId et appId dans ce texte. Copie tout le bloc firebaseConfig.");
      localStorage.setItem(CLOUD_KEY, JSON.stringify({ firebase: f, creation: true }));
      setTimeout(() => location.reload(), 50);
    });
};
/* Liens courts : la configuration (non secrète) est publiée avec l'appli dans config.js */
ACTIONS["liens-courts"] = async () => {
  const c = Cloud.configActuelle(); if (!c) return;
  const contenu = `/* Configuration Firebase de la boutique. Elle n'est pas secrète : les règles de sécurité protègent les données.\n   Grâce à ce fichier, le lien d'un vendeur peut être court : …/cahier-de-caisse/#identifiant */\nwindow.CONFIG_FIREBASE = ${JSON.stringify(c, null, 2)};\n`;
  openSheet(`<div class="inner"><h2>Liens courts pour tes vendeurs</h2>
    <p>Télécharge le fichier <b>config.js</b>, puis envoie-le sur GitHub avec les autres fichiers de l'appli : il remplace celui qui s'y trouve.</p>
    <p class="note">Ensuite, le lien de ton vendeur sera simplement : <b>${esc(location.origin + location.pathname)}#kouame</b>. Les anciens liens longs continuent de marcher.</p>
    <button class="btn pri" id="lc-dl">Télécharger config.js</button>
    <button class="btn sec" data-close>Fermer</button></div>`);
  $("#lc-dl").addEventListener("click", () => partagerFichier("config.js", contenu, "text/javascript", "config.js"));
};
/* Règles de sécurité : copiées depuis le code de l'appli (toujours la bonne version), avec le mode d'emploi */
ACTIONS["copier-regles"] = ACTIONS["voir-regles"] = () => {
  openSheet(`<div class="inner"><h2>Règles de sécurité · version ${VERSION_REGLES}</h2>
    <ol class="etapes">
      <li>Touche <b>Copier les règles</b>.</li>
      <li>Dans Firebase : <b>Firestore Database → Règles</b>.</li>
      <li>Efface <b>tout</b> le texte déjà présent, puis colle.</li>
      <li>Touche <b>Publier</b>. Attends une minute avant de réessayer dans l'appli.</li>
    </ol>
    <button class="btn pri" id="rg-copier">Copier les règles</button>
    <textarea id="rg-texte" readonly rows="6" class="code" aria-label="Texte des règles">${esc(REGLES_FIRESTORE)}</textarea>
    <p class="hint">En haut du texte collé dans Firebase, tu dois lire « version ${VERSION_REGLES} ». Si la copie ne marche pas, appuie longuement dans le cadre, « Tout sélectionner », puis « Copier ».</p>
    <button class="btn sec" id="rg-verifier">Vérifier les règles publiées</button>
    <div class="note" id="rg-etat"></div>
    <button class="btn sec" data-close>Fermer</button></div>`);
  $("#rg-copier").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(REGLES_FIRESTORE); toast("Règles copiées : colle-les dans Firebase"); }
    catch { const t = $("#rg-texte"); t.focus(); t.select(); try { document.execCommand("copy"); toast("Règles copiées"); } catch { toast("Sélectionne le texte et copie-le"); } }
  });
  $("#rg-verifier").addEventListener("click", async () => {
    const el = $("#rg-etat");
    if (typeof Cloud === "undefined" || Cloud.etat !== "actif" || !Cloud.diagnostiquerRegles) { el.textContent = "Connecte d'abord la synchronisation."; return; }
    el.textContent = "Vérification…";
    const d = await Cloud.diagnostiquerRegles();
    el.innerHTML = d === "anciennes" ? `<b style="color:var(--red)">Les règles dans Firebase sont une ancienne version.</b> Colle celles-ci à la place et publie.`
      : d === "reseau" ? "Pas de connexion : réessaie quand le réseau revient."
      : d === "compte-repare" ? `<b style="color:var(--accent)">Règles à jour.</b> Ta fiche de compte manquait : elle vient d'être recréée.`
      : `<b style="color:var(--accent)">Règles à jour ✓</b> Firebase utilise bien la version qui gère la boutique en ligne.`;
    if (d !== "anciennes" && typeof planifierVitrine === "function") planifierVitrine(500);
  });
};
ACTIONS["deconnecter"] = () => { closeSheet(); Cloud.deconnecter(); };
ACTIONS["desactiver-synchro"] = (id, b) => {
  if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "Confirmer : arrêter la synchro ici"; return; }
  localStorage.removeItem(CLOUD_KEY);
  if (S.role === "vendeur") try { localStorage.removeItem(KEY); } catch {}
  location.reload();
};

/* ================= Accès d'un vendeur à l'appli ================= */
function htmlAccesVendeur(vd) {
  if (!cfgCloud() || S.role === "vendeur") return "";
  if (!cloudActif()) return `<div class="note">Connecte la synchro pour donner l'accès à ${esc(vd.nom)}.</div>`;
  return vd.uid
    ? `<div class="box"><div><span class="tag">Accès actif</span> identifiant <b>${esc(vd.identifiant || "")}</b></div>
        <div class="btns" style="flex-wrap:wrap"><button class="mini" data-act="lien-vendeur" data-id="${vd.id}">Renvoyer le lien</button><button class="mini danger" data-act="retirer-acces" data-id="${vd.id}">Retirer l'accès</button></div></div>`
    : `<div class="box"><div><span class="tag gold">Pas d'accès</span> ${vd.ancienUid ? "Son accès a été retiré : il ne voit plus rien." : esc(vd.nom) + " n'a pas encore l'appli."}</div>
        <div><button class="mini wa" data-act="acces-vendeur" data-id="${vd.id}">${vd.ancienUid ? "Lui redonner l'accès" : "Donner l'accès à l'appli"}</button></div></div>`;
}
const motDePasseAuHasard = () => { const c = "abcdefghjkmnpqrstuvwxyz23456789"; return Array.from(crypto.getRandomValues(new Uint32Array(8)), n => c[n % c.length]).join(""); };
function messageAcces(vd, identifiant, mdp) {
  return `Bonjour ${vd.nom}, voici ton accès à notre Cahier de Caisse pour noter tes ventes :\n\n${Cloud.lienAcces(identifiant)}\n\nIdentifiant : ${identifiant}${mdp ? "\nMot de passe : " + mdp + "\n\nChange ton mot de passe après ta première connexion (onglet « Mon compte »)." : "\nMot de passe : celui que tu utilises déjà."}\n\nOuvre le lien, connecte-toi, puis ajoute l'appli à ton écran d'accueil.`;
}
ACTIONS["acces-vendeur"] = id => {
  const vd = vendeurDe(id); if (!vd) return;
  /* Accès retiré puis redonné : on reprend son identifiant et son mot de passe actuels, rien à saisir */
  if (vd.ancienUid && vd.identifiant) {
    openSheet(`<div class="inner"><h2>Redonner l'accès à ${esc(vd.nom)}</h2>
      <p>Il retrouvera son espace avec son identifiant <b>${esc(vd.identifiant)}</b> et le mot de passe qu'il utilisait.</p>
      <div class="err"></div>
      <div class="btns"><button class="btn sec" data-close>Annuler</button><button class="btn pri" id="ra-ok">Redonner l'accès</button></div></div>`);
    $("#ra-ok").addEventListener("click", async () => {
      $("#ra-ok").disabled = true;
      try { const ident = await Cloud.creerAccesVendeur(vd, vd.identifiant, ""); montrerLienVendeur(vendeurDe(id) || vd, ident, ""); }
      catch (x) { $(".sheet .err").textContent = Cloud.messageErreur(x); $("#ra-ok").disabled = false; }
    });
    return;
  }
  const mdp = motDePasseAuHasard();
  const form = openSheet(`<form><h2>Accès pour ${esc(vd.nom)}</h2>
    <p class="note">${esc(vd.nom)} verra seulement les produits que tu lui confies, ses ventes et ce qu'il te doit. Il ne voit ni tes autres produits, ni tes dépenses, ni ton bénéfice. Le prix d'achat n'apparaît que pour les produits où tu as coché « Le vendeur peut voir mon prix d'achat ».</p>
    <div class="two">
      <div class="field"><label for="ac-id">Identifiant</label><input id="ac-id" name="identifiant" type="text" autocapitalize="none" value="${esc(Cloud.slug(vd.nom))}" required></div>
      <div class="field"><label for="ac-mdp">Mot de passe provisoire</label><input id="ac-mdp" name="mdp" type="text" value="${mdp}" minlength="6" required></div>
    </div>
    <p class="hint">Il pourra changer son mot de passe ensuite.</p>
    <div class="box" id="ac-exist" hidden>
      <div>L'identifiant <b id="ac-exist-id"></b> existe déjà : c'est sans doute son ancien accès. Pour le reprendre, entre le mot de passe que tu lui avais envoyé (il est dans votre conversation WhatsApp). Sinon, choisis un autre identifiant.</div>
      <div class="field"><label for="ac-ancien">Mot de passe qu'il utilise</label><input id="ac-ancien" name="ancien" type="text" autocomplete="off"></div>
    </div>
    <div class="err"></div>
    <div class="btns"><button type="button" class="btn sec" data-close>Annuler</button><button type="submit" class="btn pri">Créer l'accès</button></div>
  </form>`);
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const err = form.querySelector(".err"), bt = form.querySelector(".pri");
    bt.disabled = true; bt.textContent = "Création…";
    const reprise = !$("#ac-exist").hidden && form.ancien.value.trim();
    try {
      const ident = await Cloud.creerAccesVendeur(vd, form.identifiant.value, form.mdp.value, reprise ? form.ancien.value.trim() : "");
      montrerLienVendeur(vendeurDe(id) || vd, ident, reprise ? form.ancien.value.trim() : form.mdp.value);
    } catch (x) {
      if (x.code === "identifiant-existant") {
        $("#ac-exist").hidden = false; $("#ac-exist-id").textContent = Cloud.slug(form.identifiant.value);
        err.textContent = ""; bt.textContent = "Reprendre cet identifiant";
      } else { err.textContent = Cloud.messageErreur(x); bt.textContent = $("#ac-exist").hidden ? "Créer l'accès" : "Reprendre cet identifiant"; }
      bt.disabled = false;
    }
  });
  form.identifiant.addEventListener("input", () => { $("#ac-exist").hidden = true; form.querySelector(".pri").textContent = "Créer l'accès"; });
};
function montrerLienVendeur(vd, identifiant, mdp) {
  const msg = messageAcces(vd, identifiant, mdp);
  openSheet(`<div class="inner"><h2>Accès créé</h2>
    <p>Envoie ce message à ${esc(vd.nom)} :</p>
    <div class="box" style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px">${esc(msg)}</div>
    <a class="btn pri" style="text-align:center;text-decoration:none" href="${lienWa(vd.tel, msg)}" target="_blank" rel="noopener">Envoyer sur WhatsApp</a>
    <button class="btn sec" id="cp-acces">Copier le message</button>
    <button class="btn sec" data-close>Fermer</button></div>`);
  $("#cp-acces").addEventListener("click", () => navigator.clipboard.writeText(msg).then(() => toast("Message copié"), () => toast("Copie impossible")));
}
ACTIONS["lien-vendeur"] = id => { const vd = vendeurDe(id); if (vd) montrerLienVendeur(vd, vd.identifiant || "", ""); };
ACTIONS["retirer-acces"] = async (id, b) => {
  if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "Confirmer le retrait"; return; }
  try { await Cloud.retirerAccesVendeur(vendeurDe(id)); toast("Accès retiré"); } catch (x) { toast(Cloud.messageErreur(x)); }
};

/* ================= L'appli du vendeur ================= */
function renderVendeurApp() {
  const nav = document.querySelector("nav.tabs");
  if (nav.dataset.mode !== "vendeur") {
    nav.dataset.mode = "vendeur";
    nav.innerHTML = `<button role="tab" data-tab="ventes">Mes ventes</button><button role="tab" data-tab="stock">Mon stock</button><button role="tab" data-tab="vendeurs">Mon compte</button>`;
    $("#btn-reglages").hidden = true;
  }
  if (!["ventes", "stock", "vendeurs"].includes(S.tab)) S.tab = "ventes";
  nav.querySelectorAll("button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === S.tab)));
  for (const t of ONGLETS) $("#v-" + t).hidden = t !== S.tab;
  $("#fab").textContent = S.tab === "vendeurs" ? "J'ai envoyé de l'argent" : "+ Vente";
  const vd = S.data.vendeurs[0];
  const titre = $("header h1"); titre.textContent = vd ? "Espace de " + vd.nom : "Espace vendeur";
  if (!vd) { $("#v-" + S.tab).innerHTML = `<div class="empty"><b>Chargement…</b>Si ça dure, vérifie ta connexion internet.</div>`; return; }
  if (S.tab === "ventes") renderVendeurVentes(vd);
  if (S.tab === "stock") renderVendeurStock(vd);
  if (S.tab === "vendeurs") renderVendeurCompte(vd);
}
const peutModifier = v => v.auteur === "vendeur" && !v.ajuste && Date.now() - (+v.cree || 0) < 86400000;
function renderVendeurVentes(vd) {
  const bp = bornes(S.periode);
  const list = S.data.ventes.filter(v => dansPeriode(v.date, bp)).sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.cree || 0) - (a.cree || 0));
  const pieces = list.reduce((s, v) => s + (+v.qte || 0), 0), du = list.reduce((s, v) => s + totalVente(v), 0);
  const gagne = list.reduce((s, v) => s + (+v.qte || 0) * ((+v.prixClient || 0) - (+v.prix || 0)), 0);
  let h = segPeriode() + `<div class="chips">
    <div class="chip"><div class="label">Pièces vendues</div><div class="v num">${pieces}</div><div class="note num">tu as gagné ${F(gagne)}</div></div>
    <div class="chip gold"><div class="label">À reverser</div><div class="v num">${F(du)}</div><div class="note">pour ces ventes</div></div></div>`;
  if (!list.length) h += `<div class="empty"><b>Aucune vente sur cette période</b>Touche « + Vente » à chaque vente : le propriétaire la voit tout de suite.</div>`;
  let last = "";
  for (const v of list.slice(0, S.limV)) {
    if (v.date !== last) { h += `<div class="dayhead">${esc(dayLabel(v.date))}</div>`; last = v.date; }
    h += `<div class="row${peutModifier(v) ? " compact" + (S.ouvert === v.id ? " open" : "") : ""}" data-row="${v.id}" tabindex="0">
      <div><div class="t">${esc(nomProduit(v.produitId))} × ${+v.qte}</div><div class="m num">client ${F((+v.prixClient || 0) * v.qte)} · tu gardes ${F((+v.prixClient || 0) * v.qte - totalVente(v))}${v.client ? " · " + esc(v.client) : ""}${v.auteur !== "vendeur" ? " · notée par le propriétaire" : ""}${v.ajuste ? ` <span class="tag gold">partage ajusté</span>` : ""}</div></div>
      <div class="amt num">${F(totalVente(v))}<div class="m">à reverser</div></div>
      ${peutModifier(v) ? `<div class="acts"><button class="mini" data-act="v-edit" data-id="${v.id}">Modifier</button><button class="mini danger" data-act="del" data-col="ventes" data-id="${v.id}">Supprimer</button><span class="note">Modifiable pendant 24 h</span></div>` : ""}
    </div>`;
  }
  h += boutonPlus("limV", list.length - S.limV, "ventes");
  $("#v-ventes").innerHTML = h;
}
function renderVendeurStock(vd) {
  const vendus = {};
  for (const v of S.data.ventes) vendus[v.produitId] = (vendus[v.produitId] || 0) + (+v.qte || 0);
  const prods = [...S.data.produits].sort((a, b) => nomComplet(a).localeCompare(nomComplet(b)));
  if (!prods.length) { $("#v-stock").innerHTML = `<div class="empty"><b>Aucun produit confié pour l'instant</b>Les produits que le propriétaire te confie apparaîtront ici.</div>`; return; }
  const total = prods.reduce((s, p) => s + Math.max(0, (+p.quantite || 0) - (vendus[p.id] || 0)), 0);
  let h = `<div class="chip"><div class="label">Pièces en ta possession</div><div class="v num">${total}</div><div class="note">${esc(resumeRegle(vd))}</div></div>`;
  for (const p of prods) {
    const r = Math.max(0, (+p.quantite || 0) - (vendus[p.id] || 0)), pv = +p.prixVente || 0, du = reverse(vd, p, pv);
    h += `<div class="row"><div class="avec-vignette">${PHOTOS[p.id] ? `<img class="vignette" src="${vignette(p.id)}" alt="" loading="lazy">` : ""}<div style="min-width:0">
      <div class="t">${esc(nomComplet(p))}</div>
      <div class="m num">Prix conseillé ${pv ? F(pv) : "?"}${pv ? " · tu reverses " + F(du) + ", tu gardes " + F(pv - du) : ""}${p.coutVisible ? " · prix d'achat " + F(p.cout) : ""}</div></div></div>
      <div class="amt num">${plur(r, "pièce")}</div></div>`;
  }
  $("#v-stock").innerHTML = h;
}
function renderVendeurCompte(vd) {
  const c = compteVendeur(vd, "tout");
  const attente = S.data.versements.filter(x => x.confirme === false);
  let h = `<div class="chips">
    <div class="chip gold"><div class="label">Tu dois encore</div><div class="v num">${F(Math.max(0, c.solde))}</div>${c.aConfirmer ? `<div class="note num">dont ${F(c.aConfirmer)} envoyés, en attente de confirmation</div>` : ""}</div>
    <div class="chip"><div class="label">Déjà versé</div><div class="v num">${F(c.verse)}</div><div class="note">confirmé par le propriétaire</div></div></div>`;
  const mouvements = [
    ...S.data.ventes.map(v => ({ date: v.date, cree: v.cree || 0, t: `${nomProduit(v.produitId)} × ${v.qte}`, montant: totalVente(v), type: "vente" })),
    ...S.data.versements.map(x => ({ date: x.date, cree: x.cree || 0, t: x.confirme === false ? "Envoi déclaré · en attente" : "Versement confirmé", montant: x.confirme === false ? 0 : -(+x.montant || 0), affiche: +x.montant || 0, type: "vers" }))
  ].sort((a, b) => a.date.localeCompare(b.date) || a.cree - b.cree);
  let solde = 0; for (const m of mouvements) { solde += m.montant; m.solde = solde; }
  if (mouvements.length) h += `<div class="label">Relevé</div><div class="releve num">${mouvements.slice().reverse().slice(0, 60).map(m => `<div class="l ${m.type === "vers" ? "vers" : ""}">
      <div><div>${esc(m.t)}</div><div class="d">${esc(dayLabel(m.date))}</div></div>
      <div class="${m.type === "vente" ? "plus" : "moins"}">${m.type === "vente" ? "+" : "−"}${F(m.type === "vente" ? m.montant : m.affiche)}</div>
      <div class="s">reste ${F(m.solde)}</div></div>`).join("")}</div>`;
  h += `<div class="label">Mon compte</div>
    <div class="box"><div>Identifiant : <b>${esc(vd.identifiant || "")}</b></div>${S.data.reglages.boutique ? `<div class="note">Boutique : ${esc(S.data.reglages.boutique)}${S.data.reglages.numero ? " · " + esc(S.data.reglages.numero) : ""}</div>` : ""}</div>
    <button class="btn sec" data-act="v-mdp">Changer mon mot de passe</button>
    <button class="btn sec" data-act="deconnecter">Se déconnecter</button>
    <p class="hint" style="text-align:center">Cahier de Caisse · version ${VERSION_APPLI}</p>`;
  $("#v-vendeurs").innerHTML = h;
}
function venteVendeurForm(v) {
  const vd = S.data.vendeurs[0]; if (!vd) return;
  if (!S.data.produits.length) { toast("Aucun produit ne t'est confié pour l'instant."); return; }
  const edit = !!v; v = v || {};
  const form = openSheet(`<form><h2>${edit ? "Modifier la vente" : "Nouvelle vente"}</h2>
    <div class="field"><label for="vv-p">Produit</label><select id="vv-p" name="produitId">${S.data.produits.map(p => opt(p.id, nomComplet(p), p.id === v.produitId)).join("")}</select></div>
    <div class="two">
      <div class="field"><label for="vv-q">Quantité</label><input id="vv-q" name="qte" type="number" inputmode="numeric" min="1" step="1" value="${+v.qte || 1}" required></div>
      <div class="field"><label for="vv-pc">Prix payé par le client (F/pièce)</label><input id="vv-pc" name="prixClient" type="number" inputmode="numeric" min="0" step="1" value="${edit ? +v.prixClient : ""}" required></div>
    </div>
    <div class="calc num" id="vv-calc"></div>
    <div class="two">
      <div class="field"><label for="vv-d">Date</label><input id="vv-d" name="date" type="date" value="${v.date || todayISO()}" required></div>
      <div class="field"><label for="vv-c">Client (facultatif)</label><input id="vv-c" name="client" type="text" value="${esc(v.client || "")}"></div>
    </div>
    ${buttons}</form>`, fd => {
      const p = S.data.produits.find(x => x.id === fd.get("produitId")), qte = Math.round(+fd.get("qte")), pc = Math.round(+fd.get("prixClient"));
      if (!(qte > 0) || !(pc >= 0)) throw new Error("Indique la quantité et le prix.");
      const data = { produitId: p.id, qte, prixClient: pc, prix: reverse(vd, p, pc), date: fd.get("date"), client: (fd.get("client") || "").trim(), vendeurId: vd.id, auteur: "vendeur", paiement: "Via le vendeur", encaisse: false };
      if (edit) { db.modifier("ventes", v.id, data); toast("Vente modifiée"); }
      else { db.ajouter("ventes", { ...data, cree: Date.now() }); toast("Vente envoyée au propriétaire"); }
    });
  const maj = () => {
    const p = S.data.produits.find(x => x.id === form.produitId.value) || {}, q = +form.qte.value || 1, pc = +form.prixClient.value || 0;
    const du = reverse(vd, p, pc);
    $("#vv-calc").innerHTML = pc ? `Le client paie ${F(pc * q)}. Tu reverses <b>${F(du * q)}</b> et tu gardes <b>${F((pc - du) * q)}</b>.` : `Prix conseillé : ${+p.prixVente ? F(p.prixVente) : "?"}`;
  };
  form.produitId.addEventListener("change", () => { const p = S.data.produits.find(x => x.id === form.produitId.value); if (p && +p.prixVente && !edit) form.prixClient.value = p.prixVente; maj(); });
  form.qte.addEventListener("input", maj); form.prixClient.addEventListener("input", maj);
  if (!edit) { const p = S.data.produits.find(x => x.id === form.produitId.value); if (p && +p.prixVente) form.prixClient.value = p.prixVente; }
  maj();
}
function versementVendeurForm() {
  const vd = S.data.vendeurs[0]; if (!vd) return;
  const c = compteVendeur(vd, "tout");
  openSheet(`<form><h2>J'ai envoyé de l'argent</h2>
    <p class="note">Le propriétaire confirmera quand il l'aura reçu. En attendant, l'envoi apparaît « en attente ».</p>
    <div class="two">
      <div class="field"><label for="vx-m">Montant envoyé (F)</label><input id="vx-m" name="montant" type="number" inputmode="numeric" min="1" step="1" placeholder="${Math.max(0, c.solde) || ""}" required></div>
      <div class="field"><label for="vx-d">Date</label><input id="vx-d" name="date" type="date" value="${todayISO()}" required></div>
    </div>
    <div class="field"><label for="vx-n">Comment ? (facultatif)</label><input id="vx-n" name="note" type="text" placeholder="Ex. Wave, en main propre"></div>
    ${buttons}</form>`, fd => {
      const montant = Math.round(+fd.get("montant"));
      if (!(montant > 0)) throw new Error("Indique le montant.");
      db.ajouter("versements", { vendeurId: vd.id, montant, date: fd.get("date"), note: (fd.get("note") || "").trim(), confirme: false, cree: Date.now() });
      toast("Envoi déclaré : le propriétaire va le confirmer");
    });
}
ACTIONS["v-edit"] = id => venteVendeurForm(S.data.ventes.find(x => x.id === id));
ACTIONS["v-mdp"] = () => {
  const form = openSheet(`<form><h2>Changer mon mot de passe</h2>
    <div class="field"><label for="mp-a">Mot de passe actuel</label><input id="mp-a" name="a" type="password" autocomplete="current-password" required></div>
    <div class="field"><label for="mp-n">Nouveau mot de passe</label><input id="mp-n" name="n" type="password" autocomplete="new-password" minlength="6" required></div>
    <div class="err"></div>
    <div class="btns"><button type="button" class="btn sec" data-close>Annuler</button><button type="submit" class="btn pri">Changer</button></div></form>`);
  form.addEventListener("submit", async e => {
    e.preventDefault();
    try { await Cloud.changerMdp(form.a.value, form.n.value); closeSheet(); toast("Mot de passe changé"); }
    catch (x) { form.querySelector(".err").textContent = Cloud.messageErreur(x); }
  });
};

/* ================= Aperçu de l'espace d'un vendeur (pour le propriétaire) ================= */
function ouvrirApercu(vendeurId) { S.apercu = vendeurId; S.tab = "ventes"; S.ouvert = null; render(); window.scrollTo(0, 0); }
function fermerApercu() { S.apercu = null; S.tab = "vendeurs"; render(); window.scrollTo(0, 0); }
/* Construit exactement ce que le serveur enverrait au vendeur : ses produits (sans ton coût réel), ses ventes, ses versements */
function donneesVuesParVendeur(vd) {
  return { ...donneesInitiales(),
    reglages: { ...S.data.reglages },
    vendeurs: [vd],
    produits: S.data.produits.filter(p => p.mode === "depot" && p.vendeurId === vd.id)
      .map(p => { const b = basePartage(p), c = { ...p, cout: b, baseVendeur: b, vendeurVoitCout: !!p.vendeurVoitCout, coutVisible: !!p.vendeurVoitCout }; delete c.note; return c; }),
    ventes: S.data.ventes.filter(v => v.vendeurId === vd.id).map(v => { const c = { ...v }; delete c.coutU; return c; }),
    versements: S.data.versements.filter(x => x.vendeurId === vd.id) };
}
function renderApercu() {
  const vd = vendeurDe(S.apercu);
  if (!vd) { S.apercu = null; return render(); }
  const vrai = S.data, roleAvant = S.role;
  S.data = donneesVuesParVendeur(vd); S.role = "vendeur";
  try { renderVendeurApp(); } finally { S.data = vrai; S.role = roleAvant; }
  let b = document.getElementById("bandeau-apercu");
  if (!b) { b = document.createElement("div"); b.id = "bandeau-apercu"; document.querySelector(".wrap").insertBefore(b, document.querySelector("nav.tabs")); }
  b.className = "banner"; b.style.marginBottom = "8px";
  b.innerHTML = `<span><b>Aperçu :</b> voici exactement ce que ${esc(vd.nom)} voit sur son téléphone. Rien ne peut être modifié ici.</span><button class="mini" data-act="quitter-apercu">Quitter l'aperçu</button>`;
  $("#fab").hidden = true;
}
ACTIONS["apercu"] = id => ouvrirApercu(id);
ACTIONS["quitter-apercu"] = () => fermerApercu();

/* ================= Démarrage de la synchro ================= */
/* Lien d'accès vendeur ouvert sur l'appareil du propriétaire : on ne touche à rien, on propose l'aperçu */
function lienVendeurSurAppareilProprio(o, avecSynchro) {
  openSheet(`<div class="inner"><h2>Lien d'accès vendeur</h2>
    <p>Ce lien sert à ${o.i ? "<b>" + esc(o.i) + "</b>" : "ton vendeur"} pour se connecter sur <b>son</b> téléphone.</p>
    <p class="note">${avecSynchro ? "Cet appareil est connecté à ton compte de propriétaire : je n'ai rien changé." : "Cet appareil contient tes données de propriétaire : je n'ai rien changé."} Pour voir exactement ce que voit ton vendeur, utilise l'aperçu.</p>
    ${avecSynchro ? `<button class="btn pri" id="lv-apercu">Voir son espace (aperçu)</button>` : `<button class="btn sec" id="lv-vendeur">Utiliser cet appareil comme vendeur</button>`}
    <button class="btn sec" data-close>Fermer</button></div>`);
  const ap = $("#lv-apercu");
  if (ap) ap.addEventListener("click", () => {
    const vd = vendeursActifs().find(x => x.identifiant && x.identifiant === o.i) || vendeursActifs().find(x => Cloud.slug && Cloud.slug(x.nom) === o.i);
    closeSheet();
    if (vd) ouvrirApercu(vd.id); else toast("Vendeur introuvable : ouvre l'aperçu depuis l'onglet Vendeurs.");
  });
  const lv = $("#lv-vendeur");
  if (lv) lv.addEventListener("click", () => {
    localStorage.setItem(CLOUD_KEY, JSON.stringify({ firebase: o.f, identifiant: o.i || "", vendeur: true }));
    location.reload();
  });
}

(function () {
  /* Lien d'accès envoyé à un vendeur : #acces=… */
  const m = location.hash.match(/^#acces=([\w-]+)/);
  const court = !m && window.CONFIG_FIREBASE && location.hash.match(/^#([a-z0-9][a-z0-9-]{0,40})$/);
  if (m || court) {
    let o = null;
    if (court) o = { f: window.CONFIG_FIREBASE, i: court[1] };
    else try { o = JSON.parse(decodeURIComponent(escape(atob(m[1].replace(/-/g, "+").replace(/_/g, "/"))))); } catch {}
    history.replaceState(null, "", location.pathname + location.search);
    if (o && o.f && o.f.apiKey) {
      const avant = cfgCloud();
      const proprioConnecte = avant && !(avant.session && avant.session.role === "vendeur") && !avant.vendeur;
      const donneesProprio = !avant && (S.data.produits.length + S.data.ventes.length + S.data.depenses.length) > 0;
      if (proprioConnecte || donneesProprio) setTimeout(() => lienVendeurSurAppareilProprio(o, !!proprioConnecte), 300);
      else localStorage.setItem(CLOUD_KEY, JSON.stringify({ firebase: o.f, identifiant: o.i || "", vendeur: true }));
    }
  }
  const cfg = cfgCloud();
  if (!cfg) return;
  /* On ne passe en espace vendeur que si le serveur a confirmé ce rôle */
  if (cfg.session && cfg.session.role === "vendeur") { S.role = "vendeur"; S.data = donneesInitiales(); }
  majEtatSynchro();
  /* Pas de session connue : on affiche directement l'écran de connexion */
  if (!cfg.session || cfg.creation) setTimeout(afficherConnexion, 0);
  chargerCloud();
})();
