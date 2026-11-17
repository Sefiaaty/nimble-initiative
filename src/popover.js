// Popover UI: the Nimble initiative list.
import OBR from "@owlbear-rodeo/sdk";
import { STATE_KEY, emptyState, freshPips, startingPips, updateState, migrateEntry, movesLeft, resetMovement } from "./common.js";

const app = document.getElementById("app");
let role = "PLAYER";
let state = emptyState();
let dragId = null;

const INIT = [
  { n: 1, label: "Hesitant", tip: "Initiative 1-9: starts with 1 action" },
  { n: 2, label: "Ready", tip: "Initiative 10-19: starts with 2 actions" },
  { n: 3, label: "Vigilant", tip: "Initiative 20+: starts with 3 actions" },
];
const PIP_TIP = { ready: "Ready", spent: "Spent", reaction: "Spent on a reaction", locked: "Not available this round (initiative)" };
const NEXT_PIP = { ready: "spent", spent: "reaction", reaction: "ready", locked: "ready" };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const isGM = () => role === "GM";
const canEdit = (e) => isGM() || e.kind === "hero";
const activeId = () => (state.started && state.entries[state.turn] ? state.entries[state.turn].id : null);

function render() {
  const s = state;
  const gm = isGM();
  const head = `
    <header>
      <div class="title">Nimble Initiative</div>
      <div class="round">${s.started ? `Round ${s.round}` : "Not in combat"}</div>
    </header>
    ${gm ? `<div class="controls">
      ${s.started
        ? `<button data-act="next" class="primary">End turn &amp; next</button><button data-act="stop">End combat</button>`
        : `<button data-act="start" class="primary" ${s.entries.length ? "" : "disabled"}>Start combat</button>`}
      <button data-act="clear" title="Remove everyone from the list">Clear</button>
      <label class="auto" title="Measure token moves on the map and take them off the spaces left">
        <input type="checkbox" data-act="auto" ${s.autoMove === false ? "" : "checked"}> Auto movement</label>
    </div>` : ""}`;

  if (!s.entries.length) {
    app.innerHTML = head + `<div class="empty">${gm
      ? "Select tokens on the map, right-click, and choose <b>Add to Nimble Initiative</b> or <b>Add as Minion Group</b>.<br><br>Use <b>Mark as Hero</b> once on each hero token: it is remembered for future scenes."
      : "No one is in the initiative list yet."}</div>`;
    return;
  }

  const rows = s.entries.map((e) => {
    migrateEntry(e);
    const left = movesLeft(e);
    const active = e.id === activeId();
    const edit = canEdit(e);
    const pips = e.pips.map((p, i) =>
      `<button class="pip ${p}" data-act="pip" data-id="${e.id}" data-i="${i}" title="${PIP_TIP[p]}" ${edit ? "" : "disabled"}></button>`).join("");
    const init = e.kind === "hero" ? `<div class="init">${INIT.map((o) =>
      `<button class="chip ${e.init === o.n ? "on" : ""}" data-act="init" data-id="${e.id}" data-n="${o.n}" title="${o.tip}" ${edit ? "" : "disabled"}>${o.label}</button>`).join("")}</div>` : "";
    const count = e.kind === "minion" ? `<span class="count">×${e.items.length}</span>` : "";
    const badge = e.kind === "hero" ? `<span class="badge hero">Hero</span>` : e.kind === "minion" ? `<span class="badge minion">Minions</span>` : "";
    return `
    <div class="row ${active ? "active" : ""} ${e.kind}" data-id="${e.id}" ${gm ? 'draggable="true"' : ""}>
      ${gm ? `<div class="grip" title="Drag to reorder">⋮⋮</div>` : ""}
      ${e.img ? `<img src="${esc(e.img)}" alt="" onerror="this.style.visibility='hidden'">` : `<div class="noimg"></div>`}
      <div class="body">
        <div class="top">
          <button class="name" data-act="focus" data-id="${e.id}" title="Show on map">${esc(e.name)}</button>${count}${badge}
          ${gm ? `<button class="x" data-act="remove" data-id="${e.id}" title="Remove from list">✕</button>` : ""}
        </div>
        ${init}
        <div class="line">
          <div class="pips">${pips}</div>
          <div class="move">
            <button data-act="move" data-id="${e.id}" title="Spend 1 action to Move: adds your speed to spaces left. With Auto movement on, this happens by itself when the token runs out." ${edit ? "" : "disabled"}>Move</button>
            <button data-act="mv" data-d="-1" data-id="${e.id}" ${edit ? "" : "disabled"}>−</button>
            <span class="left ${left < 0 ? "over" : ""}" title="${left < 0 ? "Moved further than its Move actions allow" : "Spaces of movement left"}">${left}</span>
            <button data-act="mv" data-d="1" data-id="${e.id}" ${edit ? "" : "disabled"}>+</button>
            <label title="Spaces per Move action">spd <input type="number" min="0" max="99" value="${e.speed}" data-act="speed" data-id="${e.id}" ${edit ? "" : "disabled"}></label>
          </div>
        </div>
        ${active ? `<button class="endturn" data-act="endturn" data-id="${e.id}" ${edit ? "" : "disabled"}>End turn</button>` : ""}
      </div>
    </div>`;
  }).join("");

  app.innerHTML = head + `<div class="list">${rows}</div>
    <div class="legend"><span class="pip ready"></span>ready <span class="pip spent"></span>spent <span class="pip reaction"></span>reaction <span class="pip locked"></span>not yet</div>`;
}

// ---- actions ----
const find = (s, id) => s.entries.find((e) => e.id === id);

function endTurnOf(e) {
  e.pips = freshPips();
  resetMovement(e);
}

async function handle(act, el) {
  const id = el.dataset.id;
  if (act === "focus") {
    const e = find(state, id);
    if (!e) return;
    await OBR.player.select(e.items, true);
    try { await OBR.viewport.animateToBounds(await OBR.scene.items.getItemBounds(e.items)); } catch (_) {}
    return;
  }
  await updateState((s) => {
    const e = id ? find(s, id) : null;
    switch (act) {
      case "start":
        s.started = true; s.round = 1; s.turn = 0;
        for (const x of s.entries) { migrateEntry(x); x.pips = startingPips(x); resetMovement(x); }
        break;
      case "stop":
        s.started = false; s.round = 0; s.turn = 0;
        for (const x of s.entries) { migrateEntry(x); x.pips = freshPips(); resetMovement(x); x.init = null; }
        break;
      case "clear":
        return Object.assign(s, emptyState());
      case "next": {
        const cur = s.entries[s.turn];
        if (cur) endTurnOf(cur);
        s.turn += 1;
        if (s.turn >= s.entries.length) { s.turn = 0; s.round += 1; }
        break;
      }
      case "endturn":
        if (!e) return false;
        endTurnOf(e);
        if (s.entries[s.turn] && s.entries[s.turn].id === e.id) {
          s.turn += 1;
          if (s.turn >= s.entries.length) { s.turn = 0; s.round += 1; }
        }
        break;
      case "remove": {
        const idx = s.entries.findIndex((x) => x.id === id);
        if (idx < 0) return false;
        s.entries.splice(idx, 1);
        if (idx < s.turn) s.turn -= 1;
        if (s.turn >= s.entries.length) s.turn = 0;
        break;
      }
      case "pip": {
        if (!e) return false;
        const i = Number(el.dataset.i);
        e.pips[i] = NEXT_PIP[e.pips[i]] || "ready";
        break;
      }
      case "init": {
        if (!e) return false;
        const n = Number(el.dataset.n);
        e.init = e.init === n ? null : n;
        // Before anyone has acted in round 1, the choice reshapes the starting pips.
        if (s.started && s.round === 1 && !e.pips.some((p) => p === "spent" || p === "reaction")) e.pips = startingPips(e);
        break;
      }
      case "move": {
        if (!e) return false;
        const i = e.pips.indexOf("ready");
        if (i < 0) return false; // no actions left
        migrateEntry(e);
        e.pips[i] = "spent";
        e.budget += Number(e.speed) || 0;
        break;
      }
      case "mv":
        if (!e) return false;
        migrateEntry(e);
        e.budget = Math.max(0, e.budget + Number(el.dataset.d));
        break;
      default:
        return false;
    }
  });
}

app.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-act]");
  if (!el || el.disabled || el.tagName === "INPUT") return;
  handle(el.dataset.act, el);
});
app.addEventListener("change", (ev) => {
  const el = ev.target;
  if (el.dataset.act === "auto") { updateState((s) => { s.autoMove = el.checked; }); return; }
  if (el.dataset.act !== "speed") return;
  const v = Math.max(0, Math.min(99, Number(el.value) || 0));
  updateState((s) => { const e = find(s, el.dataset.id); if (!e) return false; e.speed = v; });
});

// ---- drag to reorder (GM) ----
app.addEventListener("dragstart", (ev) => {
  const row = ev.target.closest(".row");
  if (!row) return;
  dragId = row.dataset.id;
  row.classList.add("dragging");
  ev.dataTransfer.effectAllowed = "move";
});
app.addEventListener("dragend", () => { dragId = null; app.querySelectorAll(".row").forEach((r) => r.classList.remove("dragging", "over")); });
app.addEventListener("dragover", (ev) => {
  const row = ev.target.closest(".row");
  if (!row || !dragId) return;
  ev.preventDefault();
  app.querySelectorAll(".row.over").forEach((r) => r.classList.remove("over"));
  if (row.dataset.id !== dragId) row.classList.add("over");
});
app.addEventListener("drop", (ev) => {
  const row = ev.target.closest(".row");
  if (!row || !dragId || row.dataset.id === dragId) return;
  ev.preventDefault();
  const from = dragId, to = row.dataset.id;
  updateState((s) => {
    const current = s.entries[s.turn] ? s.entries[s.turn].id : null;
    const fi = s.entries.findIndex((e) => e.id === from);
    const [moved] = s.entries.splice(fi, 1);
    const ti = s.entries.findIndex((e) => e.id === to);
    s.entries.splice(fi <= ti ? ti + 1 : ti, 0, moved);
    if (current) s.turn = Math.max(0, s.entries.findIndex((e) => e.id === current));
  });
});

// ---- theme ----
function applyTheme(t) {
  const r = document.documentElement.style;
  r.setProperty("--bg", t.background.paper);
  r.setProperty("--bg2", t.background.default);
  r.setProperty("--fg", t.text.primary);
  r.setProperty("--fg2", t.text.secondary);
  r.setProperty("--accent", t.primary.main);
  document.documentElement.dataset.mode = t.mode;
}

OBR.onReady(async () => {
  role = await OBR.player.getRole();
  applyTheme(await OBR.theme.getTheme());
  OBR.theme.onChange(applyTheme);
  OBR.player.onChange((p) => { if (p.role !== role) { role = p.role; render(); } });

  const load = async () => {
    if (!(await OBR.scene.isReady())) {
      app.innerHTML = `<div class="empty">Open a scene to use the tracker.</div>`;
      return;
    }
    const md = await OBR.scene.getMetadata();
    state = md[STATE_KEY] || emptyState();
    render();
  };
  OBR.scene.onReadyChange(load);
  OBR.scene.onMetadataChange((md) => { state = md[STATE_KEY] || emptyState(); render(); });
  load();
});
