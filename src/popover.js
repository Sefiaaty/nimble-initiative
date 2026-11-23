// Popover UI: Nimble initiative tracker (v2) and the monster library.
import OBR from "@owlbear-rodeo/sdk";
import {
  STATE_KEY, MON_KEY, OPEN_KEY, REACTIONS, SKILLS, GROUP_COLORS, GMG_NAMES,
  emptyState, migrateState, updateState, startingPips, freshPips, movesLeft, resetMovement,
  startTurn, finishTurn, nextUp, newRound, actors, toggleReaction, hpOf, isMonsterKind,
  parseNexusId, fetchMonster, findOfficial, loadLibrary, saveLibrary, addTokens, applyMonster, entryKindFor, rescaleLegendary,
  clean, tempOf, damage, giveTemp, jumpTo,
  PARTY_KEY, HEROES_KEY, HERO_FLAG, CLASSES, partyOf, partyList, isHero, itemName,
  SCENE_KEY, PEEK_KEY, SCENE_CH, sceneOf, isVideo, BAR_HIDDEN_KEY, directLink,
  CONDITIONS, condDef, DURATIONS, addCond, removeCond, condsOnCombatEnd, condTimer, setUses, resetUses, COND_ORDER,
} from "./common.js";

const app = document.getElementById("app");
let role = "PLAYER";
let state = emptyState();
let tab = "init";
let dragId = null;
let pendingRender = false;
const openStat = new Set();       // entry ids with the stat block expanded
const statCache = new Map();      // token id -> stat block
let lib = loadLibrary();
let libQuery = "", libType = "all", libOpen = null, libMsg = "", libBusy = false;
let linkTargets = null;           // token ids chosen from the map's right-click menu
let selection = [];

// ---- rolling monster dice through Dice+ (falls back to a local roll if Dice+ isn't there)
const ROLL_SRC = "com.shade.nimble-initiative";
const ROLL_PREF = `${ROLL_SRC}/rollTarget`;
let rollTarget = "everyone";
try { if (localStorage.getItem(ROLL_PREF) === "self") rollTarget = "self"; } catch (_) {}
let diceReady = null; // null unknown, true/false after a check
function checkDicePlus() {
  return new Promise((resolve) => {
    const requestId = Math.random().toString(36).slice(2);
    let done = false;
    const off = OBR.broadcast.onMessage("dice-plus/isReady", (ev) => {
      const d = ev.data || {};
      if (d.requestId === requestId && d.ready) { done = true; off(); resolve(true); }
    });
    OBR.broadcast.sendMessage("dice-plus/isReady", { requestId, timestamp: Date.now() }, { destination: "ALL" }).catch(() => {});
    setTimeout(() => { if (!done) { off(); resolve(false); } }, 1000);
  });
}
function localRoll(n) {
  const m = n.replace(/\s+/g, "").match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  if (!m) return null;
  const cnt = Number(m[1] || 1), sides = Number(m[2]), mod = Number(m[3] || 0);
  const dice = Array.from({ length: cnt }, () => 1 + Math.floor(Math.random() * sides));
  return { dice, total: dice.reduce((a, b) => a + b, 0) + mod };
}
async function rollDice(notation, label) {
  if (diceReady !== true) diceReady = await checkDicePlus();
  if (diceReady) {
    await OBR.broadcast.sendMessage("dice-plus/roll-request", {
      rollId: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      playerId: await OBR.player.getId(),
      playerName: label ? `${await OBR.player.getName()} (${label})` : await OBR.player.getName(),
      rollTarget, diceNotation: notation.replace(/\s+/g, ""), showResults: true, timestamp: Date.now(), source: ROLL_SRC,
    }, { destination: "ALL" });
    return;
  }
  const r = localRoll(notation);
  if (r) OBR.notification.show(`${label ? label + ": " : ""}${notation} = ${r.total} (${r.dice.join(", ")})`);
}
// dice in a stat block line become buttons
const diceify = (html, label) => html.replace(/\b(\d*d\d+(?:\s*[+\u2013-]\s*\d+)?)\b/g,
  (m) => `<button class="roll" data-act="roll" data-n="${m.replace(/\u2013/g, "-")}" data-what="${label}" title="Roll ${m} in Dice+">🎲 ${m}</button>`);

const INIT = [
  { n: 1, label: "Hesitant", tip: "Initiative 1-9: starts with 1 action" },
  { n: 2, label: "Ready", tip: "Initiative 10-19: starts with 2 actions" },
  { n: 3, label: "Vigilant", tip: "Initiative 20+ or a natural 20: starts with 3 actions" },
];
const PIP_TIP = { ready: "Ready", spent: "Spent", reaction: "Used on a reaction", locked: "Not available this round (initiative)" };

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const isGM = () => role === "GM";
const canEdit = () => isGM(); // the GM runs the whole tracker
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");
const find = (s, id) => s.entries.find((e) => e.id === id);

// Don't redraw while someone is typing in a field; redraw when they leave it.
function render() {
  const a = document.activeElement;
  if (a && app.contains(a) && (a.tagName === "INPUT" || a.tagName === "TEXTAREA") && a.type !== "checkbox") { pendingRender = true; return; }
  pendingRender = false;
  if (!isGM()) { app.innerHTML = renderPlayer(); return; }
  app.innerHTML = (isGM() ? `<nav class="tabs"><button class="${tab === "init" ? "on" : ""}" data-act="tab" data-t="init">Initiative</button><button class="${tab === "lib" ? "on" : ""}" data-act="tab" data-t="lib">Monster Library</button><button class="${tab === "party" ? "on" : ""}" data-act="tab" data-t="party">Party</button><button class="${tab === "scene" ? "on" : ""}" data-act="tab" data-t="scene">Scene</button></nav>` : "")
    + (tab === "lib" && isGM() ? renderLibrary() : tab === "party" && isGM() ? renderParty() : tab === "scene" && isGM() ? renderScene() : renderInit());
}
app.addEventListener("focusout", () => setTimeout(() => { if (pendingRender) render(); }, 0));

// ================================================================ scene
const PRESETS_KEY = `${SCENE_KEY}/presets`;
const sceneBc = new BroadcastChannel(SCENE_CH);
let sceneDraft = null;   // { url, kind, title, sub } being edited
let scenePeek = false;
try { scenePeek = localStorage.getItem(PEEK_KEY) === "1"; } catch (_) {}
sceneBc.onmessage = (e) => { if (e.data && "peek" in e.data) { scenePeek = !!e.data.peek; if (tab === "scene") render(); } };
const loadPresets = () => { try { return JSON.parse(localStorage.getItem(PRESETS_KEY) || "[]"); } catch (_) { return []; } };
const savePresets = (l) => { try { localStorage.setItem(PRESETS_KEY, JSON.stringify(l)); } catch (_) {} };
function setScenePeek(v) {
  scenePeek = v;
  try { localStorage.setItem(PEEK_KEY, v ? "1" : "0"); } catch (_) {}
  sceneBc.postMessage({ peek: v });
}
const mediaTag = (u0, kind, cls, url = directLink(u0)) => !url ? "" : isVideo(url, kind)
  ? `<video class="${cls}" src="${esc(url)}" autoplay loop muted playsinline></video>`
  : `<img class="${cls}" src="${esc(url)}" alt="">`;

function renderScene() {
  const live = sceneOf(roomMd);
  if (!sceneDraft) sceneDraft = live.url ? { url: live.url, kind: live.kind, title: live.title, sub: live.sub } : { url: "", kind: "", title: "", sub: "" };
  const d = sceneDraft;
  const same = live.on && live.url === d.url && live.title === d.title && live.sub === d.sub;
  const presets = loadPresets();
  return `<div class="scene">
    ${live.on ? `<div class="slive"><b>Live:</b> ${esc(live.title || "untitled scene")}
      <button data-act="scpeek" title="Hide the scene for you only, so you can work on the map">${scenePeek ? "Back to scene" : "Peek"}</button>
      <button class="send" data-act="scend" title="Fade the scene out for everyone">End scene</button></div>` : ""}
    <div class="sprev">${d.url ? mediaTag(d.url, d.kind, "sp") : `<div class="sp empty">Pick a picture or paste a link</div>`}
      <div class="scap"><div class="t">${esc(d.title)}</div><div class="s">${esc(d.sub)}</div></div></div>
    <div class="srow"><input type="text" data-act="scurl" placeholder="Image, GIF or video link" value="${esc(d.url)}"><button data-act="scpick" title="Choose from your Owlbear uploads">My uploads</button></div>
    <input type="text" data-act="sctitle" placeholder="Caption (e.g. The Rusty Tankard)" value="${esc(d.title)}">
    <input type="text" data-act="scsub" placeholder="Small line under it (optional)" value="${esc(d.sub)}">
    <div class="srow"><button class="sgo" data-act="scshow" ${d.url ? "" : "disabled"}>${live.on ? (same ? "Showing" : "Update scene") : "Show scene"}</button>
      <button data-act="scsave" ${d.url ? "" : "disabled"} title="Keep this backdrop and caption for later">Save preset</button></div>
    ${presets.length ? `<div class="spresets"><div class="muted small">Presets</div>${presets.map((x, i) => `<div class="spre">
      ${mediaTag(x.url, x.kind, "spt")}<span>${esc(x.title || "Untitled")}</span>
      <button data-act="scload" data-i="${i}" title="Load into the editor">Edit</button><button class="sgo" data-act="scquick" data-i="${i}" title="Show it now">Show</button><button class="pdel" data-act="scdel" data-i="${i}" title="Delete preset">✕</button></div>`).join("")}</div>` : ""}
    <div class="muted small">Everyone sees the scene over the map until you end it. The party bar stays on top. Peek hides it for you only, so you can set up the battle map behind it.</div>
  </div>`;
}

async function showScene(x) {
  await OBR.room.setMetadata({ [SCENE_KEY]: { on: true, url: directLink(x.url), kind: x.kind || "", title: x.title || "", sub: x.sub || "", at: Date.now() } });
}
async function handleScene(act, el) {
  const d = sceneDraft || (sceneDraft = { url: "", kind: "", title: "", sub: "" });
  const presets = loadPresets();
  if (act === "scpick") {
    try {
      const picked = await OBR.assets.downloadImages(false);
      if (picked && picked[0]) {
        const im = picked[0].image || {};
        d.url = im.url || ""; d.kind = String(im.mime || "").startsWith("video") ? "video" : "";
        if (!d.title && picked[0].name) d.title = picked[0].name;
      }
    } catch (err) { OBR.notification.show("Couldn't open your uploads", "WARNING"); }
    render(); return;
  }
  if (act === "scshow") { if (d.url) { await showScene(d); setScenePeek(false); } return; }
  if (act === "scend") { setScenePeek(false); const live = roomMd[SCENE_KEY] || {}; await OBR.room.setMetadata({ [SCENE_KEY]: { ...live, on: false, at: Date.now() } }); return; }
  if (act === "scpeek") { setScenePeek(!scenePeek); render(); return; }
  if (act === "scsave") { if (!d.url) return; presets.unshift({ url: d.url, kind: d.kind, title: d.title, sub: d.sub }); savePresets(presets.slice(0, 40)); render(); return; }
  const x = presets[Number(el.dataset.i)];
  if (!x) return;
  if (act === "scload") { sceneDraft = { ...x }; render(); return; }
  if (act === "scquick") { sceneDraft = { ...x }; await showScene(x); setScenePeek(false); render(); return; }
  if (act === "scdel") { presets.splice(Number(el.dataset.i), 1); savePresets(presets); render(); return; }
}

// ================================================================ initiative
function phaseText(s) {
  if (!s.started) return "Not in combat";
  const act = find(s, s.active);
  if (s.phase === "legendary" && act) return `Round ${s.round} · ${esc(act.name)} acts`;
  if (s.phase === "turn" && act) return `Round ${s.round} · ${esc(act.name)}'s turn`;
  return nextUp(s) ? `Round ${s.round} · who's next?` : `Round ${s.round} · everyone has acted`;
}

function renderInit() {
  const s = state;
  const gm = isGM();
  const next = nextUp(s);
  const nextLabel = !s.started ? "" : s.phase === "legendary" ? "Legendary done"
    : s.phase === "turn" ? "End turn & next" : next ? `Start: ${esc(next.name)}` : `Start round ${s.round + 1}`;
  const head = `
    <header><div class="title">Nimble Initiative</div><div class="round">${phaseText(s)}</div></header>
    ${gm ? `<div class="controls">
      ${s.started
        ? `<button data-act="next" class="primary">${nextLabel}</button><button data-act="stop">End combat</button>`
        : `<button data-act="start" class="primary" ${s.entries.length ? "" : "disabled"}>Start combat</button>`}
      <button data-act="clear" title="Remove everyone from the list">Clear</button>
      <label class="auto" title="Measure token moves on the map for whoever is acting"><input type="checkbox" data-act="auto" ${s.autoMove === false ? "" : "checked"}> Auto movement</label>
    </div>` : ""}`;

  if (!s.entries.length) {
    return head + `<div class="empty">${gm
      ? "Select tokens on the map, right-click, and choose <b>Add to Nimble Initiative</b>.<br><br>Right-click a monster and choose <b>Link Nimble Monster</b> to give it its nimble.nexus stat block: HP, armor, Speed and actions fill in by themselves.<br><br>Use <b>Mark as Hero</b> once on each hero token: it is remembered for future scenes."
      : "No one is in the initiative list yet."}</div>`;
  }
  const legBanner = s.started && s.phase === "legendary" && find(s, s.active)
    ? `<div class="banner leg">After each hero's turn: <b>${esc(find(s, s.active).name)}</b> acts. Press <b>Done</b> when finished.</div>` : "";
  return head + legBanner + `<div class="list">${s.entries.map(row).join("")}</div>
    <div class="legend"><span class="pip ready"></span>ready <span class="pip spent"></span>spent <span class="pip reaction"></span>reaction <span class="pip locked"></span>not yet</div>`;
}

function hpBlock(e) {
  if (!e.maxHp || e.kind === "minion") return "";
  const id = e.items[0];
  const hp = hpOf(e, id);
  const pct = Math.max(0, Math.min(100, (hp / e.maxHp) * 100));
  const tmp = tempOf(e, id);
  if (!isGM()) return "";
  return `<div class="hp">
    <div class="bar"><div class="fill ${hp <= e.maxHp / 2 ? "low" : ""}" style="width:${pct}%"></div>${tmp ? `<div class="tmpfill" style="width:${Math.min(100, (tmp / e.maxHp) * 100)}%"></div>` : ""}<span>${hp} / ${e.maxHp} HP${tmp ? ` <em>+${tmp} temp</em>` : ""}</span></div>
    <input type="number" min="0" placeholder="0" data-act="hpamt" data-id="${e.id}" title="Amount (Enter = damage, Shift+Enter = heal)">
    <button data-act="dmg" data-id="${e.id}" title="Take damage (temp HP goes first)">−</button><button data-act="heal" data-id="${e.id}" title="Heal">+</button><button class="tmpb" data-act="temp" data-id="${e.id}" title="Give temp HP (doesn't stack: keeps the higher)">T</button>
  </div>`;
}

function statusBadges(e) {
  const out = [];
  if (e.kind === "hero") out.push(`<span class="badge hero">Hero</span>`);
  if (e.kind === "minion") out.push(`<span class="badge minion">Minions</span>`);
  if (e.kind === "legendary") out.push(`<span class="badge legendary">Legendary</span>`);
  if (e.armor) out.push(`<span class="badge armor ${e.armor}" title="${cap(e.armor)} armor">${cap(e.armor)} armor</span>`);
  if (e.maxHp && e.kind !== "minion") {
    const hp = hpOf(e, e.items[0]);
    if (hp <= 0) out.push(e.kind === "legendary" ? `<span class="badge dying">Last Stand</span>` : `<span class="badge dying">Down</span>`);
    else if (hp <= e.maxHp / 2) out.push(`<span class="badge bloodied">Bloodied</span>`);
  }
  return out.join("");
}

function row(e) {
  const s = state;
  const gm = isGM();
  const edit = canEdit(e);
  const active = e.id === s.active;
  const done = s.done.includes(e.id);
  const mon = isMonsterKind(e.kind);
  const left = movesLeft(e);
  const pips = e.pips.map((p, i) => `<button class="pip ${p}" data-act="pip" data-id="${e.id}" data-i="${i}" title="${mon ? (p === "ready" ? "Action ready" : "Action used") : PIP_TIP[p]}" ${edit ? "" : "disabled"}></button>`).join("");
  const init = e.kind === "hero" ? `<div class="init">${INIT.map((o) =>
    `<button class="chip ${e.init === o.n ? "on" : ""}" data-act="init" data-id="${e.id}" data-n="${o.n}" title="${o.tip}" ${edit ? "" : "disabled"}>${o.label}</button>`).join("")}</div>` : "";
  const used = e.assessed || [];
  const assess = e.kind === "hero" ? `<div class="assess">
      <select data-act="assess" data-id="${e.id}" title="Assess (1 action): each skill only once per encounter" ${e.pips.includes("ready") && used.length < SKILLS.length ? "" : "disabled"}>
        <option value="">Assess…</option>
        ${SKILLS.map((k) => `<option value="${k}" ${used.includes(k) ? "disabled" : ""}>${k}${used.includes(k) ? " (used)" : ""}</option>`).join("")}
      </select>
      ${used.map((k) => `<button class="used" data-act="unassess" data-id="${e.id}" data-k="${k}" title="Used this encounter (click to undo)">${k} ✕</button>`).join("")}
    </div>` : "";
  const reacts = e.kind === "hero" ? `<div class="reacts" title="Reactions: each costs 1 action from your next turn, once per round">${REACTIONS.map((r) =>
    `<button class="rx ${e.react[r.k] ? "on" : ""}" data-act="react" data-id="${e.id}" data-k="${r.k}" title="${r.name}" ${edit && (e.react[r.k] || e.pips.includes("ready")) ? "" : "disabled"}>${r.label}</button>`).join("")}</div>` : "";
  const count = e.kind === "minion" ? `<span class="count">×${e.items.length}</span>` : "";
  const dot = e.kind === "minion" && gm ? `<span class="dot" style="background:${GROUP_COLORS[e.color % GROUP_COLORS.length]}" title="Group colour on the map (only you see it)"></span>` : "";
  const move = mon
    ? `<div class="move"><span class="lbl">Move</span>
        <button data-act="mv" data-d="-1" data-id="${e.id}" ${edit ? "" : "disabled"}>−</button>
        <span class="left ${left < 0 ? "over" : ""}" title="Spaces left this turn">${active ? left : e.speed}</span>
        <button data-act="mv" data-d="1" data-id="${e.id}" ${edit ? "" : "disabled"}>+</button>
        <label title="Speed">spd <input type="number" min="0" max="99" value="${e.speed}" data-act="speed" data-id="${e.id}" ${edit ? "" : "disabled"}></label></div>`
    : `<div class="move">
        <button data-act="move" data-id="${e.id}" title="Spend 1 action to Move: adds your Speed to spaces left. With Auto movement on, this happens by itself." ${edit ? "" : "disabled"}>Move</button>
        <button data-act="mv" data-d="-1" data-id="${e.id}" ${edit ? "" : "disabled"}>−</button>
        <span class="left ${left < 0 ? "over" : ""}" title="${left < 0 ? "Moved further than its Move actions allow" : "Spaces of movement left"}">${left}</span>
        <button data-act="mv" data-d="1" data-id="${e.id}" ${edit ? "" : "disabled"}>+</button>
        <label title="Spaces per Move action">spd <input type="number" min="0" max="99" value="${e.speed}" data-act="speed" data-id="${e.id}" ${edit ? "" : "disabled"}></label></div>`;
  const canStart = s.started && e.kind !== "legendary";
  const queued = s.pendingNext === e.id;
  const turnBtn = active
    ? `<button class="endturn" data-act="endturn" data-id="${e.id}">${s.phase === "legendary" ? "Done" : "End turn"}</button>`
    : canStart ? `<button class="taketurn ${done ? "mon" : ""}" data-act="take" data-id="${e.id}" title="${s.active ? "Ends the current turn, then this one goes" : "Start this turn now"}">${queued ? "⏳ Up next" : `▶ ${done ? "Go again" : e.kind === "hero" ? "Take turn" : "Act now"}`}</button>` : "";
  const nactCtl = mon && gm && e.kind !== "legendary" ? `<span class="nact"><button data-act="nact" data-d="-1" data-id="${e.id}" title="Fewer actions">−</button><button data-act="nact" data-d="1" data-id="${e.id}" title="More actions">+</button></span>` : "";
  return `
  <div class="row ${active ? "active" : ""} ${done ? "done" : ""} ${e.items.some((i) => selection.includes(i)) ? "sel" : ""} ${e.kind}" data-id="${e.id}" ${gm ? 'draggable="true"' : ""}>
    ${gm ? `<div class="grip" title="Drag to reorder">⋮⋮</div>` : ""}
    ${e.img ? `<img src="${esc(e.img)}" alt="" onerror="this.style.visibility='hidden'">` : `<div class="noimg"></div>`}
    <div class="body">
      <div class="top">
        ${dot}<button class="name" data-act="focus" data-id="${e.id}" title="Show on map">${esc(e.name)}</button>${count}
        ${s.started && e.kind !== "legendary" && !active ? `<button class="acted ${done ? "on" : ""}" data-act="toggledone" data-id="${e.id}" title="${done ? "Has acted this round (click: hasn't acted)" : "Hasn't acted yet (click: mark as acted)"}">${done ? "✓" : "○"}</button>` : ""}
        <span class="badges">${statusBadges(e)}</span>
        ${gm && e.linked ? `<button class="sb ${openStat.has(e.id) ? "on" : ""}" data-act="stat" data-id="${e.id}" title="Stat block">≡</button>` : ""}
        ${gm ? `<button class="x" data-act="remove" data-id="${e.id}" title="Remove from list">✕</button>` : ""}
      </div>
      ${init}
      ${hpBlock(e)}
      ${woundsBlock(e)}
      ${condBlock(e)}
      ${usesBlock(e)}
      <div class="line"><div class="pips">${pips}${nactCtl}</div>${move}</div>
      ${assess}
      ${reacts}
      ${openStat.has(e.id) ? `<div class="stat">${statHtml(statCache.get(e.items[0]))}</div>` : ""}
      ${turnBtn}
    </div>
  </div>`;
}

// ---- conditions ----
let cp = null; // the open condition picker: { id, k, name, x, dur, n }
function condChips(e, removable) {
  return (e.conds || []).map((c) => {
    const d = condDef(c.k);
    const nm = (c.k === "custom" ? c.name : d ? d.name : c.k) + (c.x !== undefined ? ` ${c.x}` : "");
    const t = condTimer(state, c);
    const tip = `${nm}: ${d ? d.tip : "Custom condition."}${t ? ` (${t})` : ""}${removable ? "\nClick to remove." : ""}`;
    const inner = `<img class="ci" src="conds/${d ? c.k : "custom"}.png" alt=""><span>${esc(nm)}${t ? `<i>${esc(t)}</i>` : ""}</span>`;
    return removable
      ? `<button class="cond k-${c.k}" data-act="condrm" data-id="${e.id}" data-cid="${c.cid}" title="${esc(tip)}">${inner}</button>`
      : `<span class="cond k-${c.k}" title="${esc(tip)}">${inner}</span>`;
  }).join("");
}
function condBlock(e) {
  const gm = isGM();
  const chips = condChips(e, gm);
  const add = gm ? `<button class="addcond" data-act="condopen" data-id="${e.id}" title="Add a condition">+ Condition</button>` : "";
  if (!chips && !add) return "";
  return `<div class="conds">${chips}${add}</div>${gm && cp && cp.id === e.id ? condPicker(e) : ""}`;
}
function condPicker(e) {
  const s = state;
  const d = condDef(cp.k);
  const act = s.active ? find(s, s.active) : null;
  const durs = DURATIONS.filter((x) => (x.k !== "endThis" && x.k !== "endSrc") || act);
  const label = (x) => x.k === "endSrc" ? `Until the end of ${esc(act.name)}'s next turn` : x.k === "endThis" ? `Until the end of this turn (${esc(act.name)})` : x.label;
  return `<div class="condpick">
    <div class="cprow"><select data-cp="k">${CONDITIONS.map((c) => `<option value="${c.k}" ${cp.k === c.k ? "selected" : ""}>${c.name}</option>`).join("")}<option value="custom" ${cp.k === "custom" ? "selected" : ""}>Custom…</option></select>
    ${cp.k === "custom" ? `<input type="text" data-cp="name" maxlength="40" placeholder="Condition name" value="${esc(cp.name || "")}">` : ""}
    ${d && d.x ? `<input type="number" class="cpx" data-cp="x" placeholder="X" value="${esc(cp.x ?? "")}" title="X">` : ""}</div>
    <div class="cprow"><select data-cp="dur">${durs.map((x) => `<option value="${x.k}" ${cp.dur === x.k ? "selected" : ""}>${label(x)}</option>`).join("")}</select>
    ${cp.dur === "rounds" ? `<input type="number" class="cpx" min="1" max="99" data-cp="n" value="${cp.n || 1}" title="Rounds">` : ""}</div>
    ${d ? `<div class="muted small">${esc(d.tip)}</div>` : ""}
    <div class="cprow"><button class="primary" data-act="condadd" data-id="${e.id}">Add</button><button data-act="condclose">Cancel</button></div>
  </div>`;
}

// ---- hero Wounds (GM only): dies at the last one ----
function woundsBlock(e) {
  if (!isGM() || e.kind !== "hero") return "";
  const max = e.maxWounds || 6, w = Math.min(e.wounds || 0, max);
  const pips = Array.from({ length: max }, (_, j) => {
    const last = j === max - 1;
    return `<button class="wpip ${j < w ? "on" : ""} ${last ? "skull" : ""}" data-act="wound" data-id="${e.id}" data-j="${j}" title="${last ? `Wound ${max}: the hero dies` : `Wound ${j + 1}`}">${last ? "💀" : ""}</button>`;
  }).join("");
  const warn = w >= max ? `<span class="wwarn dead">Dead</span>` : w === max - 1 ? `<span class="wwarn">1 Wound from death</span>` : "";
  return `<div class="wounds" title="Wounds: ${w} of ${max}. Click a dot to set them; they stay until healed.">
    <span class="lbl">Wounds</span>${pips}
    <span class="wmax" title="Most heroes die at 6 Wounds; change it if a class or feature allows more"><button data-act="wmax" data-d="-1" data-id="${e.id}">−</button><button data-act="wmax" data-d="1" data-id="${e.id}">+</button></span>${warn}
  </div>`;
}

// ---- limited-use monster abilities (1/turn, 1/round, 1/encounter, 1/day...) ----
const PER_LABEL = { turn: "turn", round: "round", encounter: "encounter", day: "day", "safe rest": "Safe Rest", "field rest": "Field Rest", rest: "rest" };
function usesBlock(e) {
  if (!isGM() || !(e.uses || []).length) return "";
  return `<div class="uses">${e.uses.map((u, i) => `<span class="use ${u.used >= u.max ? "gone" : ""}" title="${esc(u.name)}: ${u.max}/${PER_LABEL[u.per] || u.per}. Click a dot to mark a use${u.per === "day" || u.per.includes("rest") ? ". Resets by hand" : ", resets by itself"}.">
    ${esc(u.name)} <em>${u.max}/${PER_LABEL[u.per] || u.per}</em>
    ${Array.from({ length: u.max }, (_, j) => `<button class="upip ${j < u.used ? "spent" : ""}" data-act="use" data-id="${e.id}" data-u="${i}" data-j="${j}"></button>`).join("")}</span>`).join("")}</div>`;
}
const usesFilled = new Set();
async function fillMissingUses() {
  if (!isGM()) return;
  const todo = state.entries.filter((e) => e.linked && !Array.isArray(e.uses) && !usesFilled.has(e.id));
  if (!todo.length) return;
  todo.forEach((e) => usesFilled.add(e.id));
  const items = await OBR.scene.items.getItems(todo.map((e) => e.items[0]));
  const mons = new Map(items.map((it) => [it.id, it.metadata[MON_KEY]]));
  await updateState((s) => {
    let touched = false;
    for (const e of s.entries) {
      if (!todo.some((x) => x.id === e.id) || Array.isArray(e.uses)) continue;
      setUses(e, mons.get(e.items[0])); touched = true;
    }
    return touched ? s : false;
  });
}

// ---- players: a view-only list of the heroes ----
let visibleTokens = new Set(); // tokens players can see (hidden monsters stay out of the legend)
async function refreshVisible(items) {
  if (isGM()) return;
  const list = items || await OBR.scene.items.getItems((i) => i.layer === "CHARACTER" || i.layer === "MOUNT" || i.layer === "PROP");
  const next = new Set(list.filter((i) => i.visible !== false).map((i) => i.id));
  const changed = next.size !== visibleTokens.size || [...next].some((id) => !visibleTokens.has(id));
  visibleTokens = next;
  if (changed) render();
}
function renderPlayer() {
  const s = state;
  const heroes = s.entries.filter((e) => e.kind === "hero");
  const act = s.active ? find(s, s.active) : null;
  const phase = !s.started ? "Not in combat" : act ? (act.kind === "hero" ? `Round ${s.round} · ${esc(act.name)}'s turn` : `Round ${s.round} · the enemies are acting`) : `Round ${s.round}`;
  const head = `<header><div class="title">Nimble Initiative</div><div class="round">${phase}</div></header>`;
  if (!heroes.length) return head + `<div class="empty">No heroes in the initiative yet.</div>`;
  const rows = heroes.map((e) => {
    const active = e.id === s.active, done = s.done.includes(e.id);
    const pips = e.pips.map((p) => `<span class="pip ${p}" title="${PIP_TIP[p]}"></span>`).join("");
    const rx = REACTIONS.filter((r) => e.react[r.k]).map((r) => `<span class="rx on" title="${r.name} used this round">${r.label}</span>`).join("");
    const conds = condChips(e, false);
    return `<div class="row ro hero ${active ? "active" : ""} ${done ? "done" : ""}">
      ${e.img ? `<img src="${esc(e.img)}" alt="" onerror="this.style.visibility='hidden'">` : `<div class="noimg"></div>`}
      <div class="body">
        <div class="top"><span class="name">${esc(e.name)}</span>${s.started ? `<span class="acted ${done ? "on" : ""}" title="${done ? "Has acted this round" : "Hasn't acted yet"}">${done ? "✓" : "○"}</span>` : ""}${active ? `<span class="badge hero">Acting</span>` : ""}</div>
        <div class="line"><div class="pips">${pips}</div>${active ? `<span class="muted small">${movesLeft(e)} spaces left</span>` : ""}</div>
        ${rx ? `<div class="reacts">${rx}</div>` : ""}
        ${conds ? `<div class="conds">${conds}</div>` : ""}
      </div></div>`;
  }).join("");
  const seen = (e) => e.items.some((id) => visibleTokens.has(id));
  const inPlay = [...new Set(s.entries.filter(seen).flatMap((e) => (e.conds || []).map((c) => (condDef(c.k) ? c.k : "custom:" + c.name))))]
    .sort((a, b) => COND_ORDER.indexOf(a.split(":")[0]) - COND_ORDER.indexOf(b.split(":")[0]));
  const legend = inPlay.length ? `<div class="clegend"><div class="muted small">Conditions on the map</div>${inPlay.map((k) => {
    const d = condDef(k), nm = d ? d.name : k.slice(7);
    return `<div class="cl"><img src="conds/${d ? k : "custom"}.png" alt=""><span><b>${esc(nm)}</b> ${esc(d ? d.tip : "Custom condition.")}</span></div>`;
  }).join("")}</div>` : "";
  return head + `<div class="list">${rows}</div>
    <div class="legend"><span class="pip ready"></span>ready <span class="pip spent"></span>spent <span class="pip reaction"></span>reaction <span class="pip locked"></span>not yet</div>${legend}`;
}

function statHtml(m) {
  if (!m) return `<div class="muted">Loading…</div>`;
  const moves = (m.moves || []).map((x) => `${x.mode ? cap(x.mode) + " " : ""}${x.speed}`).join(", ") || m.speed;
  const saves = m.saves ? Object.entries(m.saves).map(([k, v]) => `${k.toUpperCase()}${v > 0 ? "+".repeat(v) : "–".repeat(-v)}`).join(" ") : "";
  const list = (arr) => arr.map((x) => `<p><b>${esc(clean(x.name))}${x.count > 1 ? ` (${x.count}×)` : ""}.</b> ${diceify(esc(clean(x.desc)), esc(`${m.name || "Monster"}: ${clean(x.name)}`))}</p>`).join("");
  const members = (m.members || []).map((mm) => `<div class="member"><div class="mh">${esc(mm.name)}${mm.hpPerHero ? ` · ${mm.hpPerHero}/hero HP` : mm.hp ? ` · ${mm.hp} HP` : ""}${mm.armor && mm.armor !== "none" ? ` · ${cap(mm.armor)} armor` : ""}</div>${list(mm.abilities)}${list(mm.actions)}</div>`).join("");
  return `
    <div class="sh">Lvl ${esc(m.level || "–")} ${esc(cap(m.size))} ${esc(m.kind)} · ${m.hpPerHero ? `${m.hpPerHero}/hero` : m.hp} HP · ${cap(m.armor === "none" ? "no" : m.armor)} armor · Speed ${esc(moves)}${saves ? ` · Saves ${esc(saves)}` : ""}</div>
    ${m.resist ? `<p><b>Resists:</b> ${esc(m.resist)}</p>` : ""}${m.vuln ? `<p><b>Vulnerable:</b> ${esc(m.vuln)}</p>` : ""}
    ${list(m.abilities)}
    ${m.instructions ? `<p class="ins">${esc(clean(m.instructions))}</p>` : ""}
    ${list(m.actions)}${members}
    ${m.bloodied ? `<p class="bl"><b>Bloodied:</b> ${esc(clean(m.bloodied))}</p>` : ""}
    ${m.lastStand ? `<p class="ls"><b>Last Stand:</b> ${esc(clean(m.lastStand))}</p>` : ""}
    ${m.type === "minion" ? `<p class="rules"><b>Minion rules:</b> any damage kills one. Attacks use a single die, can't crit, miss on a 1 and ignore advantage and disadvantage. Minions attacking the same hero add their damage into one attack (Defend or Interpose once against all of it).</p>` : ""}
    <div class="src"><button class="rollto" data-act="rollto" title="Who sees the rolls you make from this stat block">🎲 Rolls: ${rollTarget === "self" ? "only me" : "everyone"}</button> · <a href="https://nimble.nexus/monsters/${esc(m.nid)}" target="_blank" rel="noopener">nimble.nexus</a></div>`;
}

async function loadStat(e) {
  const id = e.items[0];
  if (statCache.has(id)) return;
  const [it] = await OBR.scene.items.getItems([id]);
  if (it && it.metadata[MON_KEY]) statCache.set(id, it.metadata[MON_KEY]);
  render();
}

// ---- actions ----
async function handle(act, el) {
  const id = el.dataset.id;
  if (act === "condopen") { cp = cp && cp.id === id ? null : { id, k: "dazed", dur: "endNext", n: 1 }; render(); return; }
  if (act === "condclose") { cp = null; render(); return; }
  if (act === "condadd") {
    if (!cp) return;
    const d = condDef(cp.k);
    const name = cp.k === "custom" ? String(cp.name || "").trim() : d.name;
    if (!name) return;
    const pick = cp; cp = null;
    await updateState((s) => { const e = find(s, id); if (!e) return false; addCond(s, e, { k: pick.k, name, x: d && d.x ? pick.x : undefined, dur: pick.dur, n: pick.n }); });
    return;
  }
  if (act === "wound") {
    const j = Number(el.dataset.j);
    await updateState((s) => { const e = find(s, id); if (!e) return false; e.wounds = j < (e.wounds || 0) ? j : j + 1; });
    return;
  }
  if (act === "wmax") {
    await updateState((s) => { const e = find(s, id); if (!e) return false; e.maxWounds = Math.max(1, Math.min(12, (e.maxWounds || 6) + Number(el.dataset.d))); e.wounds = Math.min(e.wounds || 0, e.maxWounds); });
    return;
  }
  if (act === "use") {
    const ui = Number(el.dataset.u), j = Number(el.dataset.j);
    await updateState((s) => { const e = find(s, id); const u = e && e.uses && e.uses[ui]; if (!u) return false; u.used = j < u.used ? j : j + 1; });
    return;
  }
  if (act === "condrm") { await updateState((s) => { const e = find(s, id); if (!e) return false; removeCond(e, el.dataset.cid); }); return; }
  if (act.startsWith("sc")) return handleScene(act, el);
  if (act === "roll") { await rollDice(el.dataset.n, el.dataset.what); return; }
  if (act === "rollto") { rollTarget = rollTarget === "self" ? "everyone" : "self"; try { localStorage.setItem(ROLL_PREF, rollTarget); } catch (_) {} render(); return; }
  if (act === "tab") { tab = el.dataset.t; if (tab === "party") await loadHeroNames(); render(); return; }
  if (act === "focus") {
    const e = find(state, id);
    if (!e) return;
    await OBR.player.select(e.items, true);
    try { await OBR.viewport.animateToBounds(await OBR.scene.items.getItemBounds(e.items)); } catch (_) {}
    return;
  }
  if (act === "stat") {
    const e = find(state, id);
    if (openStat.has(id)) openStat.delete(id); else { openStat.add(id); if (e) loadStat(e); }
    render();
    return;
  }
  if (act.startsWith("lib")) return handleLib(act, el);
  if (act.startsWith("pty")) return handleParty(act, el);
  if (act === "dmg" || act === "heal" || act === "temp") {
    const inp = app.querySelector(`input[data-act=hpamt][data-id="${id}"]`);
    const n = Math.abs(Number(inp && inp.value) || 0);
    if (!n) return;
    if (inp) inp.value = "";
    inp && inp.blur();
    await updateState((s) => {
      const e = find(s, id);
      if (!e) return false;
      const tid = e.items[0];
      const cur = hpOf(e, tid);
      if (act === "temp") { giveTemp(e, tid, n); return; }
      if (act === "dmg") damage(e, tid, n); else e.hp[tid] = Math.min(e.maxHp, cur + n);
      if (act === "dmg" && e.kind === "legendary" && cur > e.maxHp / 2 && e.hp[tid] <= e.maxHp / 2) OBR.notification.show(`${e.name} is Bloodied!`, "WARNING");
      if (act === "dmg" && e.kind === "legendary" && cur > 0 && e.hp[tid] === 0) OBR.notification.show(`${e.name}: Last Stand!`, "ERROR");
    });
    return;
  }
  await updateState((s) => {
    const e = id ? find(s, id) : null;
    switch (act) {
      case "start":
        s.started = true; s.round = 1; s.done = []; s.legQueue = []; s.active = null; s.phase = "pick";
        rescaleLegendary(s);
        for (const x of s.entries) { x.pips = startingPips(x); x.react = {}; x.assessed = []; resetMovement(x); resetUses(x, ["turn", "round", "encounter"]); }
        { const n = nextUp(s); if (n) startTurn(s, n.id); }
        break;
      case "stop":
        s.started = false; s.round = 0; s.done = []; s.legQueue = []; s.active = null; s.phase = "pick";
        for (const x of s.entries) { x.pips = isMonsterKind(x.kind) ? freshPips(x.nact) : freshPips(); x.react = {}; x.assessed = []; resetMovement(x); x.init = null; }
        condsOnCombatEnd(s);
        for (const x of s.entries) resetUses(x, ["turn", "round", "encounter"]);
        break;
      case "clear":
        return Object.assign(s, emptyState());
      case "next": {
        if (s.active) finishTurn(s, s.active);
        if (s.phase === "pick") {
          let n = nextUp(s);
          if (!n) { newRound(s); n = nextUp(s); }
          if (n) startTurn(s, n.id);
        }
        break;
      }
      case "take":
        if (!e || e.kind === "legendary" || s.active === e.id) return false;
        jumpTo(s, e.id);
        break;
      case "toggledone":
        if (!e) return false;
        if (s.done.includes(e.id)) s.done = s.done.filter((x) => x !== e.id); else s.done.push(e.id);
        break;
      case "endturn":
        if (!e || s.active !== e.id) return false;
        finishTurn(s, e.id);
        if (s.phase === "pick" && !nextUp(s)) newRound(s);
        break;
      case "remove": {
        s.entries = s.entries.filter((x) => x.id !== id);
        s.done = s.done.filter((x) => x !== id);
        s.legQueue = s.legQueue.filter((x) => x !== id);
        if (s.active === id) { s.active = s.legQueue[0] || null; if (!s.active) s.phase = "pick"; }
        break;
      }
      case "pip": {
        if (!e) return false;
        const i = Number(el.dataset.i);
        const p = e.pips[i];
        if (p === "reaction") return false; // undo it from the reaction marker instead
        e.pips[i] = p === "ready" ? "spent" : "ready";
        break;
      }
      case "unassess": {
        if (!e) return false;
        const k = el.dataset.k;
        if (!e.assessed.includes(k)) return false;
        e.assessed = e.assessed.filter((x) => x !== k);
        const i = e.pips.lastIndexOf("spent");
        if (i >= 0) e.pips[i] = "ready"; // give the action back
        break;
      }
      case "react":
        if (!e || !toggleReaction(e, el.dataset.k)) return false;
        break;
      case "init": {
        if (!e) return false;
        const n = Number(el.dataset.n);
        e.init = e.init === n ? null : n;
        if (s.started && s.round === 1 && !s.done.includes(e.id) && !e.pips.some((p) => p === "spent" || p === "reaction")) e.pips = startingPips(e);
        break;
      }
      case "move": {
        if (!e) return false;
        const i = e.pips.indexOf("ready");
        if (i < 0) return false;
        e.pips[i] = "spent";
        e.budget += Number(e.speed) || 0;
        break;
      }
      case "mv":
        if (!e) return false;
        e.budget = Math.max(0, e.budget + Number(el.dataset.d));
        break;
      case "nact":
        if (!e) return false;
        e.nact = Math.max(1, Math.min(3, e.nact + Number(el.dataset.d)));
        while (e.pips.length < e.nact) e.pips.push("ready");
        e.pips.length = e.nact;
        break;
      default:
        return false;
    }
  });
}

// ================================================================ party bar settings
let roomMd = {};
let players = [];
let heroNames = new Map(); // image url -> token name in this scene
let confirmDel = null;      // image url waiting for a second click on Remove
let confirmReset = false;
const STATS_KEY = "com.shade.nimble-initiative/talkstats";

function renderParty() {
  const p = partyOf(roomMd);
  const heroes = Array.isArray(roomMd[HEROES_KEY]) ? roomMd[HEROES_KEY] : [];
  const ordered = [...p.order.filter((u) => heroes.includes(u)), ...heroes.filter((u) => !p.order.includes(u))];
  const rows = ordered.map((u, i) => {
    const m = p.members[u] || {};
    const nm = m.name || heroNames.get(u) || "";
    return `<div class="prow ${m.hidden ? "hid" : ""}" data-url="${esc(u)}">
      <img src="${esc(directLink(m.portrait) || u)}" alt="">
      <div class="pf">
        <input type="text" placeholder="${esc(heroNames.get(u) || "Character name")}" value="${esc(m.name || "")}" data-act="ptyname" data-url="${esc(u)}" title="Character name (blank = token name)">
        <div class="pr2">
          <select data-act="ptycls" data-url="${esc(u)}" title="Class icon"><option value="">Class…</option>${CLASSES.map((c) => `<option ${m.cls === c ? "selected" : ""}>${c}</option>`).join("")}</select>
          <select data-act="ptypid" data-url="${esc(u)}" title="Which player plays this hero (their card lights up when they talk)"><option value="">Player…</option>${players.map((pl) => `<option value="${esc(pl.id)}" ${m.pid === pl.id ? "selected" : ""}>${esc(pl.name)}</option>`).join("")}${m.pid && !players.some((pl) => pl.id === m.pid) ? `<option value="${esc(m.pid)}" selected>${esc(m.pname || "Offline player")}</option>` : ""}</select>
        </div>
        <input type="text" placeholder="${p.style === "cutouts" ? "Cut-out PNG link (transparent background)" : "Portrait image link (optional)"}" value="${esc(m.portrait || "")}" data-act="ptyport" data-url="${esc(u)}">
        <div class="psize" title="This hero's size on the bar">Size
          <button data-act="ptyscale" data-url="${esc(u)}" data-d="-0.1">−</button><b>${Math.round((Number(m.scale) || 1) * 100)}%</b><button data-act="ptyscale" data-url="${esc(u)}" data-d="0.1">+</button></div>
      </div>
      <div class="pbtns">
        <button data-act="ptyup" data-url="${esc(u)}" ${i === 0 ? "disabled" : ""} title="Move left">◀</button>
        <button data-act="ptydown" data-url="${esc(u)}" ${i === ordered.length - 1 ? "disabled" : ""} title="Move right">▶</button>
        <button data-act="ptyhide" data-url="${esc(u)}" title="${m.hidden ? "Show on the bar" : "Hide from the bar"}">${m.hidden ? "Show" : "Hide"}</button>
        <button class="pdel ${confirmDel === u ? "sure" : ""}" data-act="ptydel" data-url="${esc(u)}" title="Remove from the party and unmark as hero">${confirmDel === u ? "Sure?" : "Remove"}</button>
      </div>
    </div>`;
  }).join("");
  return `<div class="ptop">
      <label class="auto"><input type="checkbox" data-act="ptyshow" ${p.show ? "checked" : ""}> Show the party bar to everyone</label>
      <label class="auto" title="Your bird in the bottom-right corner: its speech bubble shows whenever you talk (turn on its 🎙 by hovering it)"><input type="checkbox" data-act="ptybird" ${p.bird ? "checked" : ""}> Show the GM bird</label>
      <label class="auto" title="Hides the bar on your screen only, so Owlbear's bottom toolbar is free. Players still see theirs."><input type="checkbox" data-act="ptyhideme" ${barHiddenForMe() ? "checked" : ""}> Hide it on my screen</label>
      <label class="auto">Bar style <select data-act="ptystyle">
        <option value="cards" ${p.style !== "cutouts" ? "selected" : ""}>Portrait cards</option>
        <option value="cutouts" ${p.style === "cutouts" ? "selected" : ""}>Cut-outs (character PNGs, dim until they talk)</option></select></label>
      <label class="auto" title="How big the heroes are (they shrink to fit if there isn't room)">Size
        <button data-act="ptysize" data-d="-10">−</button><b>${p.size}px</b><button data-act="ptysize" data-d="10">+</button></label>
      <label class="auto" title="Space between heroes">Spacing
        <button data-act="ptygap" data-d="-4">−</button><b>${p.gap}px</b><button data-act="ptygap" data-d="4">+</button></label>
      <label class="auto" title="Pushes the pictures down past the bottom edge so the screen cuts them">Sink below edge
        <button data-act="ptyoff" data-d="-4">−</button><b>${p.offset}px</b><button data-act="ptyoff" data-d="4">+</button></label>
      <div class="muted small">Heroes come from <b>Mark as Hero</b>. Pick each hero's player so their card lights up when they talk: each player turns on the 🎙 button on their own card.</div>
    </div>
    <div class="plist">${rows || `<div class="empty">No heroes yet. Right-click hero tokens and choose <b>Mark as Hero</b>.</div>`}</div>
    ${renderRecap(ordered, p)}`;
}

// Session recap from the party bar: airtime, raised hands, reactions, speech bubbles and whispers
function renderRecap(ordered, p) {
  const st = roomMd[STATS_KEY] || { since: Date.now(), p: {} };
  const rows = ordered.map((u) => ({ u, m: p.members[u] || {} })).filter((r) => r.m.pid);
  if (!rows.length) return "";
  const total = Math.max(1, rows.reduce((t, r) => t + ((st.p[r.m.pid] || {}).ms || 0), 0));
  const mins = Math.max(1, Math.round((Date.now() - st.since) / 60000));
  const fmt = (ms) => (ms >= 60000 ? `${Math.round(ms / 60000)}m` : `${Math.round(ms / 1000)}s`);
  const sorted = [...rows].sort((a, b) => ((st.p[a.m.pid] || {}).ms || 0) - ((st.p[b.m.pid] || {}).ms || 0));
  return `<div class="recap"><div class="rhead"><b>Session recap</b><span class="muted small">last ${mins} min</span>
      <button data-act="ptyreset" title="Start counting a new session">${confirmReset ? "Sure?" : "Reset"}</button></div>
    <table><tr><th></th><th>Talk</th><th>✋</th><th>😀</th><th>💬</th><th>✉</th><th>✦</th></tr>
    ${sorted.map(({ u, m }) => { const x = st.p[m.pid] || {}; const ms = x.ms || 0; return `<tr>
      <td>${esc(m.name || heroNames.get(u) || "Hero")}</td>
      <td><span class="rbar"><i style="width:${Math.round((ms / total) * 100)}%"></i></span> ${Math.round((ms / total) * 100)}% <span class="muted">${fmt(ms)}</span></td>
      <td>${x.hands || 0}</td><td>${x.emotes || 0}</td><td>${x.says || 0}</td><td>${x.whispers || 0}</td><td>${Number(m.insp) || 0}</td></tr>`; }).join("")}
    </table><div class="muted small">Talk only counts players with the 🎙 talking light on. Least talking at the top.</div></div>`;
}

async function saveParty(fn) {
  const md = await OBR.room.getMetadata();
  const p = partyOf(md);
  const heroes = Array.isArray(md[HEROES_KEY]) ? md[HEROES_KEY] : [];
  p.order = [...p.order.filter((u) => heroes.includes(u)), ...heroes.filter((u) => !p.order.includes(u))];
  fn(p);
  await OBR.room.setMetadata({ [PARTY_KEY]: p });
}

async function handleParty(act, el) {
  const u = el.dataset.url;
  const mem = (p) => (p.members[u] ||= {});
  if (act === "ptyup" || act === "ptydown") {
    await saveParty((p) => {
      const i = p.order.indexOf(u), j = act === "ptyup" ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= p.order.length) return;
      [p.order[i], p.order[j]] = [p.order[j], p.order[i]];
    });
  }
  if (act === "ptyhide") await saveParty((p) => { mem(p).hidden = !mem(p).hidden; });
  if (act === "ptysize") await saveParty((p) => { p.size = Math.max(80, Math.min(400, p.size + Number(el.dataset.d))); });
  if (act === "ptygap") await saveParty((p) => { p.gap = Math.max(0, Math.min(80, p.gap + Number(el.dataset.d))); });
  if (act === "ptyscale") await saveParty((p) => { const m = mem(p); m.scale = Math.round(Math.max(0.5, Math.min(2.5, (Number(m.scale) || 1) + Number(el.dataset.d))) * 10) / 10; });
  if (act === "ptyoff") await saveParty((p) => { p.offset = Math.max(0, Math.min(80, p.offset + Number(el.dataset.d))); });
  if (act === "ptyreset") {
    if (!confirmReset) { confirmReset = true; render(); setTimeout(() => { confirmReset = false; render(); }, 4000); return; }
    confirmReset = false;
    await OBR.room.setMetadata({ [STATS_KEY]: { since: Date.now(), p: {} } });
  }
  if (act === "ptydel") {
    if (confirmDel !== u) { confirmDel = u; render(); setTimeout(() => { if (confirmDel === u) { confirmDel = null; render(); } }, 4000); return; }
    confirmDel = null;
    // forget the hero: drop the image from the room's hero list and its bar settings, and unmark tokens here
    const md = await OBR.room.getMetadata();
    const heroes = (Array.isArray(md[HEROES_KEY]) ? md[HEROES_KEY] : []).filter((x) => x !== u);
    const p = partyOf(md);
    delete p.members[u];
    p.order = p.order.filter((x) => x !== u);
    await OBR.room.setMetadata({ [HEROES_KEY]: heroes, [PARTY_KEY]: p });
    if (await OBR.scene.isReady()) {
      const mine = (i) => i.image && i.image.url === u && i.metadata[HERO_FLAG] === true;
      const toks = (await OBR.scene.items.getItems(mine)).filter(mine);
      if (toks.length) await OBR.scene.items.updateItems(toks.map((t) => t.id), (ds) => { for (const d of ds) delete d.metadata[HERO_FLAG]; });
    }
    await updateState((s) => {
      let n = 0;
      for (const e of s.entries) if (e.kind === "hero" && e.img === u) { e.kind = "monster"; n++; }
      return n ? s : false;
    });
  }
}

function barHiddenForMe() { try { return localStorage.getItem(BAR_HIDDEN_KEY) === "1"; } catch (_) { return false; } }

async function partyField(el) {
  const u = el.dataset.url;
  if (el.dataset.act === "ptybird") { await saveParty((p) => { p.bird = el.checked; }); return; }
  if (el.dataset.act === "ptyhideme") {
    try { localStorage.setItem(BAR_HIDDEN_KEY, el.checked ? "1" : "0"); } catch (_) {}
    sceneBc.postMessage({ barHidden: el.checked });
    return;
  }
  const v = el.type === "checkbox" ? el.checked : el.value.trim();
  await saveParty((p) => {
    if (el.dataset.act === "ptyshow") { p.show = v; return; }
    if (el.dataset.act === "ptystyle") { p.style = v; return; }
    const m = (p.members[u] ||= {});
    if (el.dataset.act === "ptyname") m.name = v;
    if (el.dataset.act === "ptycls") m.cls = v;
    if (el.dataset.act === "ptyport") m.portrait = directLink(v);
    if (el.dataset.act === "ptypid") { m.pid = v; m.pname = (players.find((pl) => pl.id === v) || {}).name || ""; }
  });
}

async function loadHeroNames() {
  heroNames = new Map();
  if (!(await OBR.scene.isReady())) return;
  const heroes = Array.isArray(roomMd[HEROES_KEY]) ? roomMd[HEROES_KEY] : [];
  for (const it of await OBR.scene.items.getItems((i) => i.layer === "CHARACTER")) {
    const url = it.image && it.image.url;
    if (url && isHero(it, heroes) && !heroNames.has(url)) heroNames.set(url, itemName(it));
  }
}

// ================================================================ library
const TYPES = [["all", "All"], ["standard", "Standard"], ["minion", "Minion"], ["legendary", "Legendary"]];

function renderLibrary() {
  const mons = Object.values(lib.monsters);
  const q = libQuery.toLowerCase();
  const lvl = (m) => (m.level === "1/4" ? 0.25 : m.level === "1/3" ? 0.33 : m.level === "1/2" ? 0.5 : Number(m.level) || 0);
  const shown = mons.filter((m) => (libType === "all" || m.type === libType) && (!q || m.name.toLowerCase().includes(q)))
    .sort((a, b) => lvl(a) - lvl(b) || a.name.localeCompare(b.name));
  const targets = linkTargets && linkTargets.length ? linkTargets : selection;
  const tgt = targets.length;
  return `
    <div class="libtop">
      ${linkTargets ? `<div class="banner">Linking <b>${linkTargets.length}</b> token${linkTargets.length > 1 ? "s" : ""}: pick a monster below or paste a link. <button class="mini" data-act="libcancel">Cancel</button></div>`
        : `<div class="muted small">${tgt ? `<b>${tgt}</b> token${tgt > 1 ? "s" : ""} selected on the map.` : "Select tokens on the map to link them."}</div>`}
      <div class="paste"><input type="text" placeholder="Paste a nimble.nexus monster link" data-act="libpaste"><button data-act="libadd" class="primary">Add</button></div>
      ${libMsg ? `<div class="msg">${libMsg}</div>` : ""}
      ${!lib.gmg ? `<button class="gmg" data-act="libgmg" ${libBusy ? "disabled" : ""}>Load the Game Master's Guide monsters (${GMG_NAMES.length})</button>` : ""}
      <div class="filters"><input type="search" placeholder="Search" value="${esc(libQuery)}" data-act="libq">
        ${TYPES.map(([k, l]) => `<button class="chip ${libType === k ? "on" : ""}" data-act="libtype" data-k="${k}">${l}</button>`).join("")}</div>
    </div>
    <div class="liblist">${shown.length ? shown.map((m) => libRow(m, tgt)).join("") : `<div class="empty">${mons.length ? "No monsters match." : "Your library is empty. Load the GMG monsters or paste a link."}</div>`}</div>
    <div class="libfoot">
      <button data-act="libunlink" ${tgt ? "" : "disabled"} title="Remove the stat block from the selected tokens">Unlink selected</button>
      <button data-act="libexport" title="Save your library as a file">Export</button>
      <label class="imp">Import<input type="file" accept=".json,application/json" data-act="libimport"></label>
      ${lib.gmg ? `<button data-act="libgmg" ${libBusy ? "disabled" : ""} title="Download the GMG monsters again">Refresh GMG</button>` : ""}
    </div>`;
}

function libRow(m, tgt) {
  const open = libOpen === m.nid;
  return `<div class="lrow ${open ? "open" : ""}">
    <div class="lhead">
      <button class="lname" data-act="libopen" data-nid="${m.nid}" title="Show stat block">${esc(m.name)}</button>
      <span class="badge">Lvl ${esc(m.level || "–")}</span>
      ${m.type !== "standard" ? `<span class="badge ${m.type}">${cap(m.type)}</span>` : ""}
      ${m.armor && m.armor !== "none" ? `<span class="badge armor ${m.armor}">${cap(m.armor)}</span>` : ""}
      ${m.gmg ? `<span class="badge src">GMG</span>` : ""}
      <span class="lbtns">
        <button data-act="liblink" data-nid="${m.nid}" ${tgt ? "" : "disabled"} title="Link to the selected tokens">Link</button>
        <button data-act="liblinkadd" data-nid="${m.nid}" ${tgt ? "" : "disabled"} title="Link, then add to the initiative">Link + Add</button>
        ${m.gmg ? "" : `<button class="x" data-act="libdel" data-nid="${m.nid}" title="Remove from library">✕</button>`}
      </span>
    </div>
    ${open ? `<div class="stat">${statHtml(m)}</div>` : ""}
  </div>`;
}

async function linkTo(mon, add) {
  const ids = linkTargets && linkTargets.length ? linkTargets : selection;
  if (!ids.length) return;
  const clean = { ...mon }; delete clean.gmg;
  await OBR.scene.items.updateItems(ids, (ds) => { for (const d of ds) d.metadata[MON_KEY] = clean; });
  for (const id of ids) statCache.set(id, clean);
  // Entries already in the tracker pick the stat block up too.
  await updateState((s) => {
    let touched = false;
    const heroCount = s.entries.filter((e) => e.kind === "hero").length;
    for (const e of s.entries) {
      if (e.kind === "hero" || !e.items.some((i) => ids.includes(i))) continue;
      if (e.items.length === 1) e.kind = entryKindFor(clean);
      if (e.kind === "minion" && e.items.length > 1 && clean.type !== "minion") continue;
      applyMonster(e, clean, heroCount);
      if (!s.started || s.active !== e.id) e.pips = freshPips(e.nact);
      e.name = e.kind === "minion" && e.items.length > 1 ? `${clean.name} (minions)` : clean.name;
      touched = true;
    }
    return touched ? s : false;
  });
  if (add) {
    const items = await OBR.scene.items.getItems(ids);
    await addTokens(items);
    tab = "init";
  }
  OBR.notification.show(`Linked ${ids.length} token${ids.length > 1 ? "s" : ""} to ${mon.name}`);
  linkTargets = null;
  render();
}

async function handleLib(act, el) {
  const nid = el.dataset.nid;
  const mon = nid ? lib.monsters[nid] : null;
  switch (act) {
    case "libopen": libOpen = libOpen === nid ? null : nid; render(); return;
    case "libtype": libType = el.dataset.k; render(); return;
    case "libcancel": linkTargets = null; render(); return;
    case "liblink": if (mon) await linkTo(mon, false); return;
    case "liblinkadd": if (mon) await linkTo(mon, true); return;
    case "libdel": delete lib.monsters[nid]; saveLibrary(lib); render(); return;
    case "libadd": {
      const inp = app.querySelector("input[data-act=libpaste]");
      const nidNew = parseNexusId(inp && inp.value);
      if (!nidNew) { libMsg = "That doesn't look like a nimble.nexus monster link."; render(); return; }
      libMsg = "Fetching…"; render();
      try {
        const m = await fetchMonster(nidNew);
        const prev = lib.monsters[m.nid];
        lib.monsters[m.nid] = { ...m, gmg: prev ? prev.gmg : false };
        saveLibrary(lib);
        libMsg = `Added <b>${esc(m.name)}</b> to your library.`;
        libOpen = m.nid; libQuery = "";
        if (inp) inp.value = "";
      } catch (err) { libMsg = `Couldn't fetch it: ${esc(err.message)}`; }
      render();
      return;
    }
    case "libgmg": {
      libBusy = true;
      let done = 0, found = 0;
      const missing = [];
      const queue = [...GMG_NAMES];
      const worker = async () => {
        while (queue.length) {
          const name = queue.shift();
          try {
            const m = await findOfficial(name);
            if (m) { lib.monsters[m.nid] = { ...m, gmg: true }; found++; } else missing.push(name);
          } catch (_) { missing.push(name); }
          done++;
          libMsg = `Loading GMG monsters… ${done}/${GMG_NAMES.length}`;
          render();
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      lib.gmg = found > 0;
      saveLibrary(lib);
      libBusy = false;
      libMsg = found ? `Loaded <b>${found}</b> GMG monsters.${missing.length ? ` Not found on nimble.nexus: ${esc(missing.join(", "))}.` : ""}` : "Couldn't reach nimble.nexus. Check your connection and try again.";
      render();
      return;
    }
    case "libunlink": {
      const ids = linkTargets && linkTargets.length ? linkTargets : selection;
      if (!ids.length) return;
      await OBR.scene.items.updateItems(ids, (ds) => { for (const d of ds) delete d.metadata[MON_KEY]; });
      for (const id of ids) statCache.delete(id);
      await updateState((s) => {
        for (const e of s.entries) if (e.items.some((i) => ids.includes(i))) { e.linked = false; }
      });
      OBR.notification.show("Unlinked");
      return;
    }
    case "libexport": {
      const blob = new Blob([JSON.stringify(lib, null, 1)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = "nimble-monster-library.json";
      document.body.appendChild(a); a.click(); a.remove();
      return;
    }
    default:
  }
}

// ================================================================ events
app.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-act]");
  if (!el || el.disabled || el.tagName === "INPUT" || el.tagName === "LABEL") return;
  handle(el.dataset.act, el);
});
app.addEventListener("keydown", (ev) => {
  const el = ev.target;
  if (ev.key !== "Enter") return;
  if (el.dataset.act === "libpaste") handleLib("libadd", el);
  if (el.dataset.act === "hpamt") handle(ev.shiftKey ? "heal" : "dmg", el);
});
app.addEventListener("input", (ev) => {
  const el = ev.target;
  if (el.dataset.cp && cp && el.tagName === "INPUT") { cp[el.dataset.cp] = el.value; return; }
  if (el.dataset.act === "scurl" || el.dataset.act === "sctitle" || el.dataset.act === "scsub") {
    const d = sceneDraft || (sceneDraft = { url: "", kind: "", title: "", sub: "" });
    if (el.dataset.act === "scurl") { d.url = directLink(el.value); d.kind = ""; }
    if (el.dataset.act === "sctitle") d.title = el.value;
    if (el.dataset.act === "scsub") d.sub = el.value;
    const prev = app.querySelector(".sprev");
    if (prev) {
      if (el.dataset.act === "scurl") prev.querySelector(".sp").outerHTML = d.url ? mediaTag(d.url, d.kind, "sp") : `<div class="sp empty">Pick a picture or paste a link</div>`;
      prev.querySelector(".scap .t").textContent = d.title;
      prev.querySelector(".scap .s").textContent = d.sub;
    }
    const go = app.querySelector('[data-act="scshow"]'), sv = app.querySelector('[data-act="scsave"]');
    if (go) go.disabled = !d.url; if (sv) sv.disabled = !d.url;
    return;
  }
  if (el.dataset.act === "libq") {
    libQuery = el.value;
    const list = app.querySelector(".liblist");
    if (list) { const tmp = document.createElement("div"); tmp.innerHTML = renderLibrary(); list.replaceWith(tmp.querySelector(".liblist")); }
  }
});
app.addEventListener("change", async (ev) => {
  const el = ev.target;
  if (el.dataset.cp && cp) {
    cp[el.dataset.cp] = el.value;
    if (el.dataset.cp === "k") { const d = condDef(el.value); cp.dur = d ? d.dur || "until" : "until"; }
    if (el.tagName === "SELECT") render();
    return;
  }
  if (el.dataset.act && el.dataset.act.startsWith("pty")) { partyField(el); return; }
  if (el.dataset.act === "assess") {
    const k = el.value;
    if (!k) return;
    updateState((s) => {
      const e = find(s, el.dataset.id);
      if (!e || e.assessed.includes(k)) return false;
      const i = e.pips.indexOf("ready");
      if (i < 0) return false;
      e.pips[i] = "spent";
      e.assessed.push(k);
    });
    return;
  }
  if (el.dataset.act === "auto") { updateState((s) => { s.autoMove = el.checked; }); return; }
  if (el.dataset.act === "libimport") {
    const f = el.files && el.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const n = Object.keys(data.monsters || {}).length;
      Object.assign(lib.monsters, data.monsters || {});
      lib.gmg = lib.gmg || !!data.gmg;
      saveLibrary(lib);
      libMsg = `Imported <b>${n}</b> monsters.`;
    } catch (_) { libMsg = "That file isn't a monster library."; }
    render();
    return;
  }
  if (el.dataset.act !== "speed") return;
  const v = Math.max(0, Math.min(99, Number(el.value) || 0));
  updateState((s) => { const e = find(s, el.dataset.id); if (!e) return false; e.speed = v; });
});

// ---- drag to reorder (GM) ----
app.addEventListener("dragstart", (ev) => {
  const r = ev.target.closest(".row");
  if (!r) return;
  dragId = r.dataset.id;
  r.classList.add("dragging");
  ev.dataTransfer.effectAllowed = "move";
});
app.addEventListener("dragend", () => { dragId = null; app.querySelectorAll(".row").forEach((r) => r.classList.remove("dragging", "over")); });
app.addEventListener("dragover", (ev) => {
  const r = ev.target.closest(".row");
  if (!r || !dragId) return;
  ev.preventDefault();
  app.querySelectorAll(".row.over").forEach((x) => x.classList.remove("over"));
  if (r.dataset.id !== dragId) r.classList.add("over");
});
app.addEventListener("drop", (ev) => {
  const r = ev.target.closest(".row");
  if (!r || !dragId || r.dataset.id === dragId) return;
  ev.preventDefault();
  const from = dragId, to = r.dataset.id;
  updateState((s) => {
    const fi = s.entries.findIndex((e) => e.id === from);
    const [moved] = s.entries.splice(fi, 1);
    const ti = s.entries.findIndex((e) => e.id === to);
    s.entries.splice(fi <= ti ? ti + 1 : ti, 0, moved);
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

function checkOpenRequest() {
  try {
    const v = JSON.parse(localStorage.getItem(OPEN_KEY) || "null");
    if (v && Date.now() - v.t < 15000) {
      localStorage.removeItem(OPEN_KEY);
      tab = v.tab === "library" ? "lib" : "init";
      linkTargets = v.items || null;
      render();
    }
  } catch (_) {}
}
window.addEventListener("storage", (ev) => { if (ev.key === OPEN_KEY) checkOpenRequest(); });
setInterval(checkOpenRequest, 700); // same-window fallback (the storage event only fires in other windows)

OBR.onReady(async () => {
  role = await OBR.player.getRole();
  roomMd = await OBR.room.getMetadata();
  OBR.room.onMetadataChange(async (md) => { roomMd = md; if (tab === "party") { await loadHeroNames(); render(); } else if (tab === "scene") render(); });
  try { players = await OBR.party.getPlayers(); } catch (_) {}
  OBR.party.onChange((pl) => { players = pl; if (tab === "party") render(); });
  applyTheme(await OBR.theme.getTheme());
  OBR.theme.onChange(applyTheme);
  try { selection = (await OBR.player.getSelection()) || []; } catch (_) {}
  OBR.player.onChange((p) => {
    const sel = p.selection || [];
    const selChanged = sel.join() !== selection.join();
    selection = sel;
    if (p.role !== role) { role = p.role; render(); }
    else if (selChanged) {
      render();
      // bring the selected token's row into view
      const r = tab === "init" && app.querySelector(".row.sel");
      if (r) r.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  });

  const load = async () => {
    if (!(await OBR.scene.isReady())) {
      app.innerHTML = `<div class="empty">Open a scene to use the tracker.</div>`;
      return;
    }
    const md = await OBR.scene.getMetadata();
    state = migrateState(md[STATE_KEY] ? structuredClone(md[STATE_KEY]) : emptyState());
    render();
    checkOpenRequest();
    fillMissingUses().catch(() => {});
    refreshVisible().catch(() => {});
  };
  OBR.scene.items.onChange((items) => { refreshVisible(items).catch(() => {}); });
  OBR.scene.onReadyChange(load);
  OBR.scene.onMetadataChange((md) => {
    state = migrateState(md[STATE_KEY] ? structuredClone(md[STATE_KEY]) : emptyState());
    for (const id of openStat) { const e = find(state, id); if (e && !statCache.has(e.items[0])) loadStat(e); }
    render();
    fillMissingUses().catch(() => {});
  });
  load();
});
