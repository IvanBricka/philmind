/* Nouveautés PhilPapers — philosophie de l'esprit
 * Données : data/items.json (généré chaque jour par collector/collect.py)
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
    { lang: "fr", type: "all", period: "7", status: "unread" },
    store.get("ui", {})
  );
  let items = [];
  let generated = "";
  let shown = PAGE;
  // marks[id] = { r: 0|1, l: 0|1, t: horodatage ms }
  let marks = store.get("marks", {});
  let dirty = store.get("dirty", false);

  // ---------- Données ----------
  async function loadItems() {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch("data/items.json", { cache: attempt ? "default" : "no-cache" });
        if (!r.ok) throw new Error(r.status);
        const j = await r.json();
        items = j.items || [];
        generated = j.generated || "";
        return;
      } catch { /* nouvelle tentative */ }
    }
    // On garde les données déjà affichées le cas échéant.
    if (!items.length) toast("Impossible de charger les nouveautés (hors ligne ?)");
  }

  const isRead = (id) => !!(marks[id] && marks[id].r);
  const isLater = (id) => !!(marks[id] && marks[id].l);
  const langGroup = (it) => (it.lang === "fr" ? "fr" : it.lang === "en" ? "en" : "other");

  function latestDate() {
    return items.reduce((m, it) => (it.added > m ? it.added : m), "");
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

  function matches(it, { lang = ui.lang, type = ui.type } = {}, c = cutoff()) {
    if (c && it.added < c && ui.status !== "later") return false;
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
      const [last, first] = a.split(/,\s*/);
      return first ? `${first} ${last}` : a;
    }).join(", ");
    const year = /^\d{4}/.test(it.year || "") ? it.year : "";
    const pub = [it.pub, year && !String(it.pub).includes(year) ? year : ""].filter(Boolean).join(" · ");
    return `<article class="card${read ? " is-read" : ""}" data-id="${esc(it.id)}">
      <div class="meta-top">
        <span class="badge">${esc(it.subtype)}</span>
        ${langGroup(it) === "other" ? `<span class="badge lang">${esc(it.langName)}</span>` : ""}
      </div>
      <h3 class="title"><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a></h3>
      <p class="authors">${esc(authors)}</p>
      ${pub ? `<p class="pub">${esc(pub)}</p>` : ""}
      ${it.abstract ? `<details class="abs"><summary>Résumé</summary><p>${esc(it.abstract)}</p></details>` : ""}
      <div class="actions">
        <button class="act later${later ? " on" : ""}" data-act="later" aria-pressed="${later}">${later ? "★ À lire" : "☆ Plus tard"}</button>
        <button class="act read${read ? " on" : ""}" data-act="read" aria-pressed="${read}">${read ? "✓ Lu" : "Marquer lu"}</button>
      </div>
    </article>`;
  }

  function render() {
    const c = cutoff();
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
      const any = items.some((it) => (!c || it.added >= c) && langGroup(it) === ui.lang && (ui.type === "all" || it.type === ui.type));
      const msg = ui.status === "later" ? "Rien de mis de côté ici."
        : !any ? "Aucune nouveauté pour cette sélection."
        : ui.status === "unread" ? "Tout est lu pour cette sélection." : "Rien pour cette sélection.";
      main.innerHTML = `<div class="empty"><strong>${msg}</strong>Essayez une autre langue, un autre type ou une période plus longue.</div>`;
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
  $("#period").addEventListener("change", (e) => { ui.period = e.target.value; shown = PAGE; saveUI(); render(); });
  $("#status").addEventListener("change", (e) => { ui.status = e.target.value; shown = PAGE; saveUI(); render(); });
  $("#list").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.id === "more") { shown += PAGE; render(); return; }
    if (b.dataset.act) onAction(b);
  });
  $("#syncBtn").addEventListener("click", () => sync({ manual: true }));
  $("#settingsBtn").addEventListener("click", openSettings);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { loadItems().then(render); if (cfg()) sync(); }
    else if (dirty && cfg()) sync();
  });
  addEventListener("online", () => cfg() && sync());

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

  // ---------- Démarrage ----------
  loadItems().then(() => {
    render();
    if (cfg()) sync(); else setDot("off");
  });
})();
