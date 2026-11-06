/* Nouveautés PhilPapers — philosophie de l'esprit
 * Données : data/index.json + data/items-AAAA-MM.json (générés chaque jour par collector/collect.py),
 *           chargés mois par mois selon la période affichée.
 * Marques lu / à lire : localStorage + synchronisation optionnelle via un dépôt GitHub privé.
 */
(() => {
  "use strict";

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } },
  };

  const PAGE = 60;
  const ui = Object.assign(
    { lang: "fr", type: "all", period: "7", status: "unread", author: "", venue: "" },
    store.get("ui", {})
  );
  if (ui.period === "0") ui.period = "365";
  let items = [];
  let months = [];          // [{month, count, file, last}] — plus récent d'abord
  const loaded = new Map(); // mois -> items
  let generated = "";
  let shown = PAGE;
  // marks[id] = { r: 0|1, l: 0|1, t: horodatage ms }
  let marks = store.get("marks", {});
  let dirty = store.get("dirty", false);

  // ---------- Données ----------
  async function getJSON(url) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(url, { cache: attempt ? "default" : "no-cache" });
        if (!r.ok) throw new Error(r.status);
        return await r.json();
      } catch { /* nouvelle tentative */ }
    }
    throw new Error("échec " + url);
  }

  async function loadIndex() {
    try {
      const j = await getJSON("data/index.json");
      const changed = j.generated !== generated;
      months = j.months || [];
      generated = j.generated || "";
      if (changed) { loaded.clear(); items = []; }
      return changed;
    } catch {
      if (!months.length) toast("Impossible de charger les nouveautés (hors ligne ?)");
      return false;
    }
  }

  /** Mois nécessaires pour l'affichage courant. */
  function neededMonths() {
    // « À lire plus tard » et « Lus » : on cherche dans tout l'historique.
    if (ui.status === "later" || ui.status === "read") return months.map((m) => m.month);
    const c = cutoff();
    return months.filter((m) => !c || m.month >= c.slice(0, 7)).map((m) => m.month);
  }

  let loadingP = null;
  async function ensureLoaded() {
    const missing = neededMonths().filter((m) => !loaded.has(m));
    if (!missing.length) return;
    if (missing.length > 1) $("#list").innerHTML = `<div class="empty"><strong>Chargement de l'historique…</strong>${missing.length} mois</div>`;
    loadingP = Promise.all(missing.map(async (m) => {
      const meta = months.find((x) => x.month === m);
      try { loaded.set(m, (await getJSON("data/" + meta.file)).items || []); }
      catch { toast("Mois " + m + " indisponible (hors ligne ?)"); }
    }));
    await loadingP;
    items = [...loaded.values()].flat().sort((a, b) => (a.added < b.added ? 1 : a.added > b.added ? -1 : 0));
    authorIndex = venueIndex = null;
  }

  async function refresh() {
    await loadIndex();
    await ensureLoaded();
    render();
  }

  const isRead = (id) => !!(marks[id] && marks[id].r);
  const isLater = (id) => !!(marks[id] && marks[id].l);
  const langGroup = (it) => (it.lang === "fr" ? "fr" : it.lang === "en" ? "en" : "other");

  function latestDate() {
    return (months[0] && months[0].last) || items.reduce((m, it) => (it.added > m ? it.added : m), "");
  }
  function cutoff() {
    const n = Number(ui.period);
    if (!n) return "";
    const last = latestDate();
    if (!last) return "";
    const d = new Date(last + "T12:00:00");
    d.setDate(d.getDate() - (n - 1));
    return d.toISOString().slice(0, 10);
  }

  // ---------- Auteurs et publications ----------
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const displayAuthor = (a) => { const [last, first] = a.split(/,\s*/); return first ? `${first} ${last}` : a; };
  let authorIndex = null, venueIndex = null;
  function buildIndexes() {
    if (authorIndex) return;
    const ac = new Map(), vc = new Map();
    for (const it of items) {
      it._a ??= (it.authors || []).map((a) => norm(displayAuthor(a)) + " | " + norm(a)).join(" || ");
      it._v ??= norm(it.venue) + " | " + norm(it.pub);
      for (const a of it.authors || []) { const d = displayAuthor(a); ac.set(d, (ac.get(d) || 0) + 1); }
      if (it.venue) vc.set(it.venue, (vc.get(it.venue) || 0) + 1);
    }
    authorIndex = [...ac].sort((a, b) => b[1] - a[1]);
    venueIndex = [...vc].sort((a, b) => b[1] - a[1]);
  }
  function suggest(listEl, kind, q) {
    buildIndexes();
    const index = kind === "author" ? authorIndex : venueIndex;
    const nq = norm(q);
    const out = [];
    for (const [name, n] of index) {
      if (!nq || norm(name).includes(nq)) out.push(`<option value="${esc(name)}">${n} titre${n > 1 ? "s" : ""}</option>`);
      if (out.length >= 40) break;
    }
    listEl.innerHTML = out.join("");
  }

  function matches(it, { lang = ui.lang, type = ui.type } = {}, c = cutoff()) {
    if (c && it.added < c && ui.status !== "later" && ui.status !== "read") return false;
    if (ui.author && !it._a.includes(norm(ui.author))) return false;
    if (ui.venue && !it._v.includes(norm(ui.venue))) return false;
    if (ui.status === "unread" && isRead(it.id)) return false;
    if (ui.status === "read" && !isRead(it.id)) return false;
    if (ui.status === "later" && !isLater(it.id)) return false;
    if (lang && langGroup(it) !== lang) return false;
    if (type !== "all" && it.type !== type) return false;
    return true;
  }

  // ---------- Rendu ----------
  const fmtDay = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  function dayLabel(iso) {
    const s = fmtDay.format(new Date(iso + "T12:00:00"));
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function cardHTML(it) {
    const read = isRead(it.id), later = isLater(it.id);
    const authors = (it.authors || []).map((a) => {
      const d = displayAuthor(a);
      return `<button type="button" class="linkish" data-author="${esc(d)}" title="Voir les titres de ${esc(d)}">${esc(d)}</button>`;
    }).join(", ");
    const year = /^\d{4}/.test(it.year || "") ? it.year : "";
    let pub = esc([it.pub, year && !String(it.pub).includes(year) ? year : ""].filter(Boolean).join(" · "));
    if (it.venue) {
      const v = esc(it.venue);
      const btn = `<button type="button" class="linkish" data-venue="${v}" title="Voir les titres de cette publication">${v}</button>`;
      pub = pub.includes(v) ? pub.replace(v, btn) : `${btn}${pub ? " · " + pub : ""}`;
    }
    return `<article class="card${read ? " is-read" : ""}" data-id="${esc(it.id)}">
      <div class="meta-top">
        <span class="badge">${esc(it.subtype)}</span>
        ${langGroup(it) === "other" ? `<span class="badge lang">${esc(it.langName)}</span>` : ""}
      </div>
      <h3 class="title"><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a></h3>
      <p class="authors">${authors}</p>
      ${pub ? `<p class="pub">${pub}</p>` : ""}
      ${it.abstract ? `<details class="abs"><summary>Résumé</summary><p>${esc(it.abstract)}</p></details>` : ""}
      <div class="actions">
        <button class="act later${later ? " on" : ""}" data-act="later" aria-pressed="${later}">${later ? "★ À lire" : "☆ Plus tard"}</button>
        <button class="act read${read ? " on" : ""}" data-act="read" aria-pressed="${read}">${read ? "✓ Lu" : "Marquer lu"}</button>
      </div>
    </article>`;
  }

  function render() {
    buildIndexes();
    const c = cutoff();
    $("#clearFilters").hidden = !(ui.author || ui.venue);
    // Compteurs d'onglets de langue (selon type, période, statut)
    $$(".lang-tabs button").forEach((b) => {
      const n = items.filter((it) => matches(it, { lang: b.dataset.lang }, c)).length;
      $(".n", b).textContent = n;
      b.setAttribute("aria-selected", String(b.dataset.lang === ui.lang));
    });
    $$("#typeChips button").forEach((b) => {
      const n = items.filter((it) => matches(it, { type: b.dataset.type }, c)).length;
      $(".n", b).textContent = n;
      b.setAttribute("aria-pressed", String(b.dataset.type === ui.type));
    });
    $("#period").value = ui.period;
    $("#status").value = ui.status;

    const upd = generated ? new Date(generated).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }) : "—";
    $("#subtitle").textContent = `Nouveautés PhilPapers · mis à jour ${upd}`;

    const list = items.filter((it) => matches(it, {}, c));
    const main = $("#list");
    if (!items.length) {
      main.innerHTML = `<div class="empty"><strong>Aucune donnée</strong>Le fichier des nouveautés n'a pas encore été généré.</div>`;
      return;
    }
    if (!list.length) {
      const any = items.some((it) => (!c || it.added >= c) && langGroup(it) === ui.lang && (ui.type === "all" || it.type === ui.type)
        && (!ui.author || it._a.includes(norm(ui.author))) && (!ui.venue || it._v.includes(norm(ui.venue))));
      const msg = ui.status === "later" ? "Rien de mis de côté ici."
        : !any ? "Aucune nouveauté pour cette sélection."
        : ui.status === "unread" ? "Tout est lu pour cette sélection." : "Rien pour cette sélection.";
      // Indiquer où se trouvent les résultats ailleurs (autre langue / période plus longue).
      const otherLangs = ["fr", "en", "other"].filter((l) => l !== ui.lang && items.some((it) => matches(it, { lang: l }, c)));
      const names = { fr: "Français", en: "Anglais", other: "Autres langues" };
      let hint = "Essayez une autre langue, un autre type ou une période plus longue.";
      if (otherLangs.length) hint = `Résultats dans : ${otherLangs.map((l) => `<button type="button" class="linkish" data-goto-lang="${l}">${names[l]}</button>`).join(", ")}.`;
      if (ui.period !== "365" && ui.status !== "later" && ui.status !== "read") hint += ` <button type="button" class="linkish" data-goto-period="365">Chercher sur 1 an</button>`;
      main.innerHTML = `<div class="empty"><strong>${msg}</strong>${hint}</div>`;
      return;
    }
    let html = "", day = "", count = {};
    list.forEach((it) => (count[it.added] = (count[it.added] || 0) + 1));
    list.slice(0, shown).forEach((it) => {
      if (it.added !== day) {
        day = it.added;
        html += `<h2 class="day"><span>${dayLabel(day)}</span><span>${count[day]}</span></h2>`;
      }
      html += cardHTML(it);
    });
    if (list.length > shown) html += `<button class="act more" id="more">Afficher plus (${list.length - shown})</button>`;
    main.innerHTML = html;
  }

  function saveUI() { store.set("ui", ui); }

  // ---------- Marques ----------
  let undoFn = null;
  function setMark(id, key, value) {
    const prev = marks[id] ? { ...marks[id] } : null;
    const m = marks[id] || { r: 0, l: 0, t: 0 };
    m[key] = value ? 1 : 0;
    m.t = Date.now();
    marks[id] = m;
    store.set("marks", marks);
    dirty = true; store.set("dirty", true);
    scheduleSync();
    return prev;
  }

  function onAction(btn) {
    const card = btn.closest(".card");
    const id = card.dataset.id;
    const key = btn.dataset.act === "read" ? "r" : "l";
    const on = key === "r" ? !isRead(id) : !isLater(id);
    const prev = setMark(id, key, on);
    // Lu => on le retire aussi de « à lire plus tard »
    if (key === "r" && on && isLater(id)) setMark(id, "l", false);
    const leaves = !items.find((it) => it.id === id && matches(it));
    const finish = () => { render(); };
    if (leaves) {
      card.classList.add("leaving");
      setTimeout(finish, 220);
      undoFn = () => {
        if (prev) marks[id] = { ...prev, t: Date.now() }; else marks[id] = { r: 0, l: 0, t: Date.now() };
        store.set("marks", marks); dirty = true; store.set("dirty", true); scheduleSync(); render();
      };
      toast(key === "r" ? (on ? "Marqué comme lu" : "Marqué non lu") : (on ? "Mis de côté" : "Retiré de « à lire »"), true);
    } else finish();
  }

  // ---------- Synchronisation GitHub ----------
  const cfg = () => store.get("sync", null);
  const enc = (s) => {
    const bytes = new TextEncoder().encode(s);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  const dec = (b) => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\n/g, "")), (c) => c.charCodeAt(0)));

  function merge(a, b) {
    const out = { ...a };
    for (const [id, m] of Object.entries(b || {})) {
      if (!out[id] || (m.t || 0) > (out[id].t || 0)) out[id] = m;
    }
    return out;
  }

  let syncTimer = null, syncing = false;
  function scheduleSync() {
    if (!cfg()) return setDot("off");
    clearTimeout(syncTimer);
    syncTimer = setTimeout(sync, 2500);
  }
  function setDot(s) { $("#syncDot").className = "dot " + s; }

  async function sync({ manual = false } = {}) {
    const c = cfg();
    if (!c) { setDot("off"); if (manual) openSettings(); return; }
    if (syncing) return;
    syncing = true;
    $("#syncBtn").classList.add("spin");
    const url = `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/state.json`;
    const headers = { Authorization: `Bearer ${c.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        let sha, remote = {};
        const g = await fetch(url, { headers, cache: "no-store" });
        if (g.status === 200) {
          const j = await g.json();
          sha = j.sha;
          remote = JSON.parse(dec(j.content)).marks || {};
        } else if (g.status !== 404) {
          throw new Error(g.status === 401 ? "jeton refusé" : g.status === 403 ? "accès refusé au dépôt" : `GitHub ${g.status}`);
        }
        const merged = merge(merge({}, remote), marks);
        marks = merge(marks, remote);
        store.set("marks", marks);
        const changedRemote = JSON.stringify(merged) !== JSON.stringify(remote);
        if (!changedRemote) { dirty = false; store.set("dirty", false); break; }
        const body = { message: "Mise à jour des lectures", content: enc(JSON.stringify({ v: 1, marks: merged })) };
        if (sha) body.sha = sha;
        const p = await fetch(url, { method: "PUT", headers, body: JSON.stringify(body) });
        if (p.ok) { dirty = false; store.set("dirty", false); break; }
        if (p.status !== 409 && p.status !== 422) throw new Error(`GitHub ${p.status}`);
        // conflit : un autre appareil vient d'écrire -> on recommence
      }
      store.set("lastSync", Date.now());
      setDot("ok");
      if (manual) toast("Synchronisé");
      render();
    } catch (e) {
      setDot("err");
      if (manual || navigator.onLine) toast("Synchronisation impossible : " + e.message);
    } finally {
      syncing = false;
      $("#syncBtn").classList.remove("spin");
    }
  }

  function openSettings() {
    const d = $("#settings"), f = $("form", d), c = cfg() || {};
    f.owner.value = c.owner || "";
    f.repo.value = c.repo || "philmind-sync";
    f.token.value = c.token || "";
    const last = store.get("lastSync", 0);
    $("#syncInfo").textContent = c.owner
      ? `Dernière synchronisation : ${last ? new Date(last).toLocaleString("fr-FR") : "jamais"} · ${Object.keys(marks).length} marques enregistrées.`
      : "Synchronisation non configurée : les marques restent sur cet appareil.";
    d.showModal();
  }

  $("#settings").addEventListener("close", () => {
    const d = $("#settings");
    if (d.returnValue !== "save") return;
    const f = $("form", d);
    const owner = f.owner.value.trim(), repo = f.repo.value.trim(), token = f.token.value.trim();
    if (owner && repo && token) { store.set("sync", { owner, repo, token }); sync({ manual: true }); }
    else { store.set("sync", null); setDot("off"); toast("Synchronisation désactivée"); }
  });

  // ---------- Toast ----------
  let toastTimer;
  function toast(msg, undo = false) {
    const t = $("#toast");
    t.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button" id="undo">Annuler</button>' : ""}`;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), undo ? 5000 : 3000);
    if (undo) $("#undo").onclick = () => { if (undoFn) undoFn(); undoFn = null; t.classList.remove("show"); };
  }

  // ---------- Événements ----------
  $(".lang-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    ui.lang = b.dataset.lang; shown = PAGE; saveUI(); render(); scrollTo({ top: 0 });
  });
  $("#typeChips").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    ui.type = b.dataset.type; shown = PAGE; saveUI(); render();
  });
  const update = async () => { shown = PAGE; saveUI(); await ensureLoaded(); render(); };
  $("#period").addEventListener("change", (e) => { ui.period = e.target.value; update(); });
  $("#status").addEventListener("change", (e) => { ui.status = e.target.value; update(); });

  // Filtres auteur / publication : suggestions pendant la saisie, filtrage après une courte pause.
  for (const [id, key, listId] of [["author", "author", "authorList"], ["venue", "venue", "venueList"]]) {
    const input = $("#" + id);
    let typingTimer;
    input.addEventListener("input", () => {
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => { ui[key] = input.value.trim(); shown = PAGE; saveUI(); render(); }, 250);
      suggest($("#" + listId), key, input.value);
    });
    input.addEventListener("focus", () => suggest($("#" + listId), key, input.value));
  }
  /** Recopie les filtres dans les champs (seulement quand l'appli les change elle-même). */
  function syncInputs() { $("#author").value = ui.author; $("#venue").value = ui.venue; }
  syncInputs();
  $("#clearFilters").addEventListener("click", () => { ui.author = ""; ui.venue = ""; syncInputs(); update(); });

  /** Clic sur un auteur ou une revue dans une fiche : on filtre, et on élargit à 1 an pour tout voir. */
  async function filterBy(key, value) {
    ui[key] = value;
    syncInputs();
    if (ui.status === "unread" || ui.status === "all") ui.period = "365";
    await update();
    scrollTo({ top: 0, behavior: "smooth" });
    toast(`Filtre : ${value} (sur 1 an)`);
  }

  $("#list").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.id === "more") { shown += PAGE; render(); return; }
    if (b.dataset.author) return filterBy("author", b.dataset.author);
    if (b.dataset.venue) return filterBy("venue", b.dataset.venue);
    if (b.dataset.gotoLang) { ui.lang = b.dataset.gotoLang; return update(); }
    if (b.dataset.gotoPeriod) { ui.period = b.dataset.gotoPeriod; return update(); }
    if (b.dataset.act) onAction(b);
  });
  $("#syncBtn").addEventListener("click", () => sync({ manual: true }));
  $("#settingsBtn").addEventListener("click", openSettings);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { refresh(); if (cfg()) sync(); }
    else if (dirty && cfg()) sync();
  });
  addEventListener("online", () => cfg() && sync());

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

  // ---------- Démarrage ----------
  refresh().then(() => { if (cfg()) sync(); else setDot("off"); });
})();
