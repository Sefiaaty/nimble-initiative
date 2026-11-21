// Party bar: hero cards along the bottom of the screen, for everyone.
// Players: talking light, raise hand, quick emotes, say (speech bubble), whisper to the GM, BRB, spend Inspiration.
// GM: soft pings, nudge a player, quiet meter, "ask next", Inspiration, session recap stats.
import OBR from "@owlbear-rodeo/sdk";
import { ID, STATE_KEY, TALK_CH, PARTY_KEY, partyOf, partyList, isHero, getHeroImages, itemName } from "./common.js";
import { CLASS_ICONS } from "./classIcons.js";

const EV_CH = `${ID}/party-ev`;     // broadcast: player state heartbeats and one-off events
const STATS_KEY = `${ID}/talkstats`; // room metadata: session recap (written by the GM's bar)
const MIC_PREF = `${ID}/mic`;
const OWN_PREF = `${ID}/own`;        // this browser: hand / brb, survives a bar reload
const QUIET_MIN = 10;
const EMOTES = ["😂", "😮", "😬", "💀", "❤️", "👍", "🎲", "🔥"];
const bar = document.getElementById("bar");
const layer = document.getElementById("layer");

let me = { id: null, role: "PLAYER" };
let roomMd = {};
let tokens = new Map();   // image url -> { id, name }
let turnUrls = new Set();
const started = Date.now();
const talking = new Map();   // pid -> last "on" time
const lastTalk = new Map();  // pid -> last talked / spotlit
const states = new Map();    // pid -> { mic, brb, hand, at }
const emotes = new Map();    // pid -> { e, at }
const says = new Map();      // pid -> { text, at }
const whispers = new Map();  // pid -> [{ text, at }]  (GM only)
const nudged = new Map();    // pid -> at
let own = { hand: false, brb: false };
try { own = { ...own, ...JSON.parse(localStorage.getItem(OWN_PREF) || "{}") }; } catch (_) {}
let mic = { state: "off", stream: null, ctx: null, timer: null, on: false, sentAt: 0, note: "" };
let openUi = null;           // "emote" | "say" | "whisper" | { read: pid }
let gmBell = false;          // GM has enabled ping sounds (needs a click first)
let audio = null;
let lastHtml = "";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const prefOn = () => { try { return localStorage.getItem(MIC_PREF) === "on"; } catch (_) { return false; } };
const setPref = (v) => { try { localStorage.setItem(MIC_PREF, v ? "on" : "off"); } catch (_) {} };
const saveOwn = () => { try { localStorage.setItem(OWN_PREF, JSON.stringify(own)); } catch (_) {} };
const isGM = () => me.role === "GM";
const ev = (data) => OBR.broadcast.sendMessage(EV_CH, { ...data, pid: data.pid || me.id }, { destination: "ALL" }).catch(() => {});

// ---------- sound ----------
function ensureAudio() {
  if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { return null; } }
  if (audio.state === "suspended") audio.resume().catch(() => {});
  return audio;
}
function chime(kind = "ping") {
  const a = ensureAudio();
  if (!a || a.state !== "running") return;
  const notes = kind === "nudge" ? [659, 880] : kind === "hand" ? [784, 1047] : [880];
  notes.forEach((f, i) => {
    const o = a.createOscillator(), g = a.createGain();
    o.type = "sine"; o.frequency.value = f;
    const t = a.currentTime + i * 0.12;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.08, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + 0.65);
  });
}
const gmPing = (kind) => { if (isGM() && gmBell) chime(kind); };

// ---------- session stats (GM) ----------
let stats = { since: Date.now(), p: {} };
let statsDirty = false;
const talkStart = new Map(); // pid -> start time of the current talking stretch
const recent = new Map();    // pid -> [[start, end], ...] last 10 minutes
function st(pid) { return (stats.p[pid] ||= { ms: 0, hands: 0, emotes: 0, says: 0, whispers: 0 }); }
function bump(pid, key) { if (!isGM() || !pid) return; st(pid)[key] += 1; statsDirty = true; }
function talkOn(pid) { if (!talkStart.has(pid)) talkStart.set(pid, Date.now()); }
function talkOff(pid) {
  const t0 = talkStart.get(pid);
  if (t0 === undefined) return;
  talkStart.delete(pid);
  const t1 = Date.now();
  if (isGM()) { st(pid).ms += t1 - t0; statsDirty = true; }
  const r = (recent.get(pid) || []).filter(([, e]) => t1 - e < 600000);
  r.push([t0, t1]); recent.set(pid, r);
}
const airtime = (pid) => ((stats.p[pid] && stats.p[pid].ms) || 0) + (talkStart.has(pid) ? Date.now() - talkStart.get(pid) : 0);
const recentAir = (pid) => (recent.get(pid) || []).reduce((t, [s, e]) => t + Math.max(0, e - Math.max(s, Date.now() - 600000)), 0)
  + (talkStart.has(pid) ? Date.now() - talkStart.get(pid) : 0);
async function flushStats() {
  if (!isGM() || !statsDirty) return;
  statsDirty = false;
  const snap = { since: stats.since, p: {} };
  for (const [pid, v] of Object.entries(stats.p)) snap.p[pid] = { ...v, ms: airtime(pid) };
  await OBR.room.setMetadata({ [STATS_KEY]: snap }).catch(() => {});
}

// ---------- rendering ----------
function cardWidth(n) {
  const w = Math.floor((window.innerWidth - 12) / Math.max(n, 1)) - 6;
  return Math.max(70, Math.min(150, w));
}
const live = (pid) => { const s = states.get(pid); return s && Date.now() - s.at < 12000 ? s : null; };

function render() {
  const p = partyOf(roomMd);
  const urls = partyList(roomMd);
  const w = cardWidth(urls.length);
  const now = Date.now();
  const gm = isGM();
  // who is "quiet": players with a working mic, here (not BRB), ranked by airtime
  const eligible = urls.map((u) => (p.members[u] || {}).pid).filter((pid) => pid && live(pid) && live(pid).mic && !live(pid).brb);
  const longEnough = now - stats.since > 5 * 60000;
  const byAir = [...eligible].sort((a, b) => airtime(a) - airtime(b));
  const maxAir = Math.max(1, ...eligible.map(airtime));
  const quietSet = gm && longEnough && eligible.length >= 3 ? new Set(byAir.slice(0, eligible.length >= 6 ? 2 : 1)) : new Set();
  const askNext = gm && eligible.length >= 2 ? [...eligible].filter((x) => !talking.has(x)).sort((a, b) => recentAir(a) - recentAir(b) || airtime(a) - airtime(b))[0] : null;

  const cards = urls.map((u) => {
    const m = p.members[u] || {};
    const tok = tokens.get(u);
    const name = m.name || (tok && tok.name) || "Hero";
    const pid = m.pid || "";
    const mine = pid && pid === me.id;
    const s = pid ? (mine ? { mic: mic.state === "on", ...own } : live(pid)) : null;
    const isTalking = pid && talking.has(pid) && now - talking.get(pid) < 2500;
    const brb = s && s.brb;
    const hand = s && s.hand;
    const quietFor = pid ? Math.floor((now - (lastTalk.get(pid) || started)) / 60000) : 0;
    const quietLong = gm && pid && !brb && quietFor >= QUIET_MIN;
    const em = pid && emotes.get(pid);
    const say = pid && says.get(pid);
    const wh = gm && pid && (whispers.get(pid) || []).length;
    const insp = Number(m.insp) || 0;
    const nudgeOn = pid && nudged.has(pid) && now - nudged.get(pid) < 4000;
    const icon = m.cls && CLASS_ICONS[m.cls] ? `<div class="badge" title="${esc(m.cls)}"><svg viewBox="0 0 512 512">${CLASS_ICONS[m.cls]}</svg></div>` : "";
    const tools = mine ? `<div class="tools">
        <button class="${mic.state}" data-act="mic" title="${mic.state === "blocked" ? esc(mic.note) : "Light up my card when I talk"}">🎙</button>
        <button class="${own.hand ? "on" : ""}" data-act="hand" title="Raise / lower your hand">✋</button>
        <button data-act="emote" title="Quick reaction">😀</button>
        <button data-act="say" title="Say something (speech bubble)">💬</button>
        <button data-act="whisper" title="Whisper to the GM (only the GM sees it)">✉</button>
        <button class="${own.brb ? "on" : ""}" data-act="brb" title="Be right back">☕</button>
      </div>` : "";
    const gmTools = gm && pid ? `<div class="gmtools">
        <button data-act="nudge" data-pid="${esc(pid)}" title="Turn to them: their card pulses and they hear a soft chime">🔔</button>
        <button data-act="moment" data-pid="${esc(pid)}" title="Had a moment (resets the quiet timer)">★</button>
        <button data-act="insp+" data-url="${esc(u)}" title="Give Inspiration">✦+</button>
        <button data-act="insp-" data-url="${esc(u)}" title="Take away Inspiration" ${insp ? "" : "disabled"}>✦−</button>
      </div>` : "";
    const meter = gm && pid && s && s.mic ? `<div class="air" title="Share of talking this session"><i style="width:${Math.round((airtime(pid) / maxAir) * 20) * 5}%"></i></div>`
      : gm && pid && !brb ? `<div class="nomic" title="Their talking light is off, so airtime isn't counted">no mic</div>` : "";
    const cls = ["card", isTalking && "talk", turnUrls.has(u) && "turn", quietLong && "isquiet", quietSet.has(pid) && "lowair", brb && "brb", nudgeOn && "nudge", mine && "mine"].filter(Boolean).join(" ");
    return { u, pid, w, cls, inner: `
      ${say && now - say.at < Math.min(16000, 6000 + say.text.length * 60) ? `<div class="say">${esc(say.text)}</div>` : ""}
      ${askNext === pid ? `<div class="asknext">▼ ask next</div>` : ""}
      ${em && now - em.at < 3500 ? `<div class="emote" data-at="${em.at}">${esc(em.e)}</div>` : ""}
      <div class="frame"><div class="art" style="background-image:url('${esc(m.portrait || u)}')"></div>${icon}
        ${hand ? `<button class="hand" data-act="lower" data-pid="${esc(pid)}" title="${mine ? "Lower your hand" : gm ? "Lower their hand" : "Hand raised"}">!</button>` : ""}
        ${wh ? `<button class="mail" data-act="read" data-pid="${esc(pid)}" title="Whisper from ${esc(name)}">✉${wh > 1 ? wh : ""}</button>` : ""}
        ${insp ? `<button class="insp" data-act="spend" data-url="${esc(u)}" title="${mine ? "Spend Inspiration (click twice)" : "Inspiration"}">✦${insp > 1 ? insp : ""}</button>` : ""}
        ${brb ? `<div class="brbtag">BRB</div>` : ""}
        ${quietLong ? `<div class="quiet">quiet ${quietFor}m</div>` : ""}
        ${tools}${gmTools}
      </div>
      <div class="name">${esc(name)}</div>
      <div class="player">${esc(m.pname || "")}</div>${meter}` };
  });
  patchCards(cards);
  const extra = (gm ? `<button class="bell ${gmBell ? "on" : ""}" data-act="bell" title="${gmBell ? "Pings on (hands, whispers, Inspiration)" : "Click to turn on soft pings for you"}">${gmBell ? "🔔" : "🔕"}</button>` : "")
    + (mic.note && mic.state === "blocked" ? `<div class="note">${esc(mic.note)}</div>` : "");
  if (extra !== lastHtml) { extras.innerHTML = extra; lastHtml = extra; }
  renderLayer();
}

// Update cards one by one: a class change (talking, turn...) only swaps classes, so bubbles and
// animations keep running; the inside of a card is only rebuilt when its content changed.
const extras = document.createElement("div");
function patchCards(cards) {
  const keep = new Set(cards.map((c) => c.u));
  for (const el of [...bar.querySelectorAll(":scope > .card")]) if (!keep.has(el.dataset.url)) el.remove();
  let prev = null;
  for (const c of cards) {
    let el = [...bar.querySelectorAll(":scope > .card")].find((x) => x.dataset.url === c.u);
    if (!el) { el = document.createElement("div"); el.dataset.url = c.u; el._inner = null; }
    if (el.className !== c.cls) el.className = c.cls;
    if (el.dataset.pid !== c.pid) el.dataset.pid = c.pid;
    if (el.style.getPropertyValue("--w") !== `${c.w}px`) el.style.setProperty("--w", `${c.w}px`);
    if (el._inner !== c.inner) { el.innerHTML = c.inner; el._inner = c.inner; }
    const want = prev ? prev.nextSibling : bar.firstChild;
    if (want !== el) bar.insertBefore(el, want);
    prev = el;
  }
  if (extras.parentNode !== bar) bar.appendChild(extras);
}

// Composer / emote picker / whisper reader live outside the bar, so the 1-second redraw doesn't eat what you type.
function renderLayer() {
  if (!openUi) { if (layer.innerHTML) layer.innerHTML = ""; return; }
  if (layer.dataset.ui === JSON.stringify(openUi)) return;
  layer.dataset.ui = JSON.stringify(openUi);
  if (openUi === "emote") {
    layer.innerHTML = `<div class="panel emotes">${EMOTES.map((e) => `<button data-act="pick" data-e="${e}">${e}</button>`).join("")}<button class="x" data-act="close">✕</button></div>`;
  } else if (openUi === "say" || openUi === "whisper") {
    layer.innerHTML = `<form class="panel compose" data-act="send">
      <span>${openUi === "say" ? "💬 Say" : "✉ Whisper to GM"}</span>
      <input type="text" maxlength="140" placeholder="${openUi === "say" ? "Shown above your card for everyone" : "Only the GM sees this"}" autocomplete="off">
      <button type="submit">Send</button><button type="button" class="x" data-act="close">✕</button></form>`;
    setTimeout(() => { const i = layer.querySelector("input"); if (i) i.focus(); }, 0);
  } else if (openUi && openUi.read) {
    const list = whispers.get(openUi.read) || [];
    layer.innerHTML = `<div class="panel reader"><b>Whispers</b>${list.map((w) => `<p>${esc(w.text)}</p>`).join("")}
      <button data-act="done" data-pid="${esc(openUi.read)}">Got it</button><button class="x" data-act="close">✕</button></div>`;
  }
  // place it above my card (or the card being read)
  const pid = openUi && openUi.read ? openUi.read : me.id;
  const card = bar.querySelector(`.card[data-pid="${CSS.escape(pid)}"]`);
  const panel = layer.firstElementChild;
  if (card && panel) {
    const r = card.getBoundingClientRect();
    const left = Math.max(4, Math.min(window.innerWidth - panel.offsetWidth - 4, r.left + r.width / 2 - panel.offsetWidth / 2));
    panel.style.left = left + "px";
    panel.style.bottom = (window.innerHeight - r.top + 8) + "px";
  }
}

// ---------- microphone ----------
async function startMic() {
  try {
    mic.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (err) {
    if (await openHelper()) return;
    mic.state = "blocked";
    mic.note = err && err.name === "NotAllowedError"
      ? "Microphone not allowed here. Check your browser's mic permission for Owlbear, or allow pop-ups so the helper window can open."
      : "No microphone found.";
    setTimeout(() => { mic.note = ""; render(); }, 8000);
    render();
    return;
  }
  mic.ctx = new (window.AudioContext || window.webkitAudioContext)();
  const an = mic.ctx.createAnalyser();
  an.fftSize = 1024;
  mic.ctx.createMediaStreamSource(mic.stream).connect(an);
  const buf = new Float32Array(an.fftSize);
  let floor = 0.01, above = 0, below = 0;
  mic.state = "on";
  setPref(true);
  heartbeat();
  render();
  mic.timer = setInterval(() => {
    if (mic.ctx.state === "suspended") mic.ctx.resume().catch(() => {});
    an.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    if (!mic.on) floor = floor * 0.98 + rms * 0.02;
    const thr = Math.max(0.012, floor * 2.6);
    if (rms > thr) { above += 1; below = 0; } else { below += 1; above = 0; }
    const now = Date.now();
    if (!mic.on && above >= 3) send(true);
    else if (mic.on && below >= 14) send(false);
    else if (mic.on && now - mic.sentAt > 1500) send(true);
  }, 50);
}

function micOff() {
  clearInterval(mic.timer);
  if (mic.stream) mic.stream.getTracks().forEach((t) => t.stop());
  if (mic.ctx) mic.ctx.close().catch(() => {});
  if (mic.on) send(false);
  mic = { state: "off", stream: null, ctx: null, timer: null, on: false, sentAt: 0, note: "" };
  setPref(false);
  heartbeat();
  render();
}

function send(on) {
  mic.on = on;
  mic.sentAt = Date.now();
  OBR.broadcast.sendMessage(TALK_CH, { pid: me.id, on }, { destination: "ALL" }).catch(() => {});
}

let helper = null;
async function openHelper() {
  const url = new URL("mic.html", import.meta.url).href;
  let w = null;
  try { w = window.open("", "nimble-mic", "width=400,height=340"); } catch (_) {}
  if (!w) return false;
  let fresh = false;
  try { fresh = w.location.href === "about:blank"; } catch (_) { fresh = false; }
  if (fresh) w.location.href = url; else w.postMessage({ type: "nimble-hello" }, location.origin);
  helper = w;
  mic.state = "on"; mic.helper = true;
  heartbeat();
  render();
  return true;
}
window.addEventListener("message", (e) => {
  if (e.origin !== location.origin || !e.data || e.data.type !== "nimble-talk") return;
  if (mic.state !== "on") { mic.state = "on"; mic.helper = true; heartbeat(); render(); }
  send(!!e.data.on);
});
setInterval(() => {
  if (mic.helper && helper && helper.closed) { helper = null; micOff(); }
}, 1500);

// my state, repeated so late joiners and reloaded bars catch up
function heartbeat() { if (me.id) ev({ k: "st", mic: mic.state === "on", brb: !!own.brb, hand: !!own.hand }); }

// ---------- clicks ----------
async function setInsp(u, delta) {
  const md = await OBR.room.getMetadata();
  const p = partyOf(md);
  const m = (p.members[u] ||= {});
  m.insp = Math.max(0, (Number(m.insp) || 0) + delta);
  await OBR.room.setMetadata({ [PARTY_KEY]: p });
}
let spendArm = null;

async function act(a, el) {
  const pid = el.dataset.pid;
  switch (a) {
    case "mic":
      if (mic.state === "on" && mic.helper) { try { helper && helper.close(); } catch (_) {} helper = null; micOff(); }
      else if (mic.state === "on") micOff();
      else startMic();
      return;
    case "hand":
      own.hand = !own.hand; saveOwn(); heartbeat(); if (own.hand) ev({ k: "hand" }); render(); return;
    case "brb":
      own.brb = !own.brb; if (own.brb) own.hand = false; saveOwn(); heartbeat(); render(); return;
    case "lower":
      if (pid === me.id) { own.hand = false; saveOwn(); heartbeat(); render(); }
      else if (isGM()) { ev({ k: "lower", pid }); const s = states.get(pid); if (s) s.hand = false; render(); }
      return;
    case "emote": case "say": case "whisper":
      openUi = openUi === a ? null : a; layer.dataset.ui = ""; renderLayer(); return;
    case "pick":
      ev({ k: "emote", e: el.dataset.e }); openUi = null; renderLayer(); return;
    case "close":
      openUi = null; renderLayer(); return;
    case "read":
      openUi = { read: pid }; layer.dataset.ui = ""; renderLayer(); return;
    case "done":
      whispers.delete(pid); openUi = null; renderLayer(); render(); return;
    case "bell":
      gmBell = !gmBell; if (gmBell) { ensureAudio(); setTimeout(() => chime("ping"), 50); } render(); return;
    case "nudge":
      ev({ k: "nudge", pid }); lastTalk.set(pid, Date.now()); return;
    case "moment":
      lastTalk.set(pid, Date.now()); render(); return;
    case "insp+": await setInsp(el.dataset.url, 1); return;
    case "insp-": await setInsp(el.dataset.url, -1); return;
    case "spend": {
      const card = el.closest(".card");
      if (!card || card.dataset.pid !== me.id) return;
      if (spendArm !== el.dataset.url) { spendArm = el.dataset.url; el.textContent = "spend?"; setTimeout(() => { spendArm = null; render(); }, 3000); return; }
      spendArm = null;
      await setInsp(el.dataset.url, -1);
      ev({ k: "spent" });
      return;
    }
    default:
  }
}

document.addEventListener("click", async (e) => {
  ensureAudio(); // any click unlocks sound for this window
  const btn = e.target.closest("[data-act]");
  if (btn && btn.tagName !== "FORM") { e.stopPropagation(); if (!btn.disabled) await act(btn.dataset.act, btn); return; }
  const card = e.target.closest(".card");
  if (!card) return;
  const tok = tokens.get(card.dataset.url);
  if (tok) { try { await OBR.viewport.animateToBounds(await OBR.scene.items.getItemBounds([tok.id])); } catch (_) {} }
});
layer.addEventListener("submit", (e) => {
  e.preventDefault();
  const input = layer.querySelector("input");
  const text = input ? input.value.trim() : "";
  if (text) ev({ k: openUi === "say" ? "say" : "whisper", text });
  openUi = null; renderLayer();
});
layer.addEventListener("keydown", (e) => { if (e.key === "Escape") { openUi = null; renderLayer(); } });
window.addEventListener("resize", render);

// ---------- incoming ----------
function onEvent(d) {
  const pid = d.pid;
  if (!pid) return;
  const now = Date.now();
  switch (d.k) {
    case "st": {
      const prev = states.get(pid);
      if (isGM() && d.hand && !(prev && prev.hand) && pid !== me.id) { gmPing("hand"); bump(pid, "hands"); }
      states.set(pid, { mic: !!d.mic, brb: !!d.brb, hand: !!d.hand, at: now });
      break;
    }
    case "hand": break; // the heartbeat carries the hand state
    case "lower": if (pid === me.id) { own.hand = false; saveOwn(); heartbeat(); } break;
    case "emote": emotes.set(pid, { e: String(d.e).slice(0, 4), at: now }); bump(pid, "emotes"); break;
    case "say": says.set(pid, { text: String(d.text).slice(0, 140), at: now }); lastTalk.set(pid, now); bump(pid, "says"); break;
    case "whisper":
      if (isGM()) { const l = whispers.get(pid) || []; l.push({ text: String(d.text).slice(0, 140), at: now }); whispers.set(pid, l); gmPing("ping"); bump(pid, "whispers"); }
      break;
    case "nudge": nudged.set(pid, now); if (pid === me.id) chime("nudge"); break;
    case "spent": gmPing("ping"); break;
    default:
  }
  render();
}

async function loadTokens() {
  tokens = new Map();
  turnUrls = new Set();
  if (!(await OBR.scene.isReady())) return;
  const heroes = await getHeroImages();
  const items = await OBR.scene.items.getItems((i) => i.layer === "CHARACTER");
  for (const it of items) {
    const url = it.image && it.image.url;
    if (url && isHero(it, heroes) && !tokens.has(url)) tokens.set(url, { id: it.id, name: itemName(it) });
  }
  const s = (await OBR.scene.getMetadata())[STATE_KEY];
  const e = s && s.started && Array.isArray(s.entries) ? s.entries.find((x) => x.id === s.active) : null;
  if (e && e.kind === "hero") {
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const id of e.items) { const it = byId.get(id); if (it && it.image) turnUrls.add(it.image.url); }
  }
}

OBR.onReady(async () => {
  me = { id: await OBR.player.getId(), role: await OBR.player.getRole() };
  roomMd = await OBR.room.getMetadata();
  if (roomMd[STATS_KEY] && roomMd[STATS_KEY].p) stats = structuredClone(roomMd[STATS_KEY]);
  await loadTokens();
  render();
  OBR.room.onMetadataChange((md) => {
    roomMd = md;
    const s = md[STATS_KEY];
    if (s && s.since !== stats.since) { stats = structuredClone(s); talkStart.clear(); recent.clear(); } // the GM reset the recap
    render();
  });
  OBR.player.onChange((pl) => { if (pl.role !== me.role) { me.role = pl.role; render(); } });
  OBR.scene.onReadyChange(async () => { await loadTokens(); render(); });
  OBR.scene.items.onChange(async () => { await loadTokens(); render(); });
  OBR.scene.onMetadataChange(async () => { await loadTokens(); render(); });
  OBR.broadcast.onMessage(TALK_CH, (event) => {
    const { pid, on } = event.data || {};
    if (!pid) return;
    const now = Date.now();
    if (on) { talking.set(pid, now); lastTalk.set(pid, now); talkOn(pid); } else { talking.delete(pid); talkOff(pid); }
    // a raised hand drops by itself after its owner has talked for a few seconds
    if (pid === me.id && own.hand && talkStart.has(pid) && now - talkStart.get(pid) > 3000) { own.hand = false; saveOwn(); heartbeat(); }
    render();
  });
  OBR.broadcast.onMessage(EV_CH, (event) => onEvent(event.data || {}));
  setInterval(() => {
    for (const [pid, t] of talking) if (Date.now() - t > 2500) { talking.delete(pid); talkOff(pid); }
    render();
  }, 1000);
  setInterval(heartbeat, 4000);
  setInterval(flushStats, 20000);
  heartbeat();
  if (prefOn() && !mic.helper) {
    try {
      const s = await navigator.permissions.query({ name: "microphone" });
      if (s.state === "granted") startMic();
    } catch (_) {}
  }
});
