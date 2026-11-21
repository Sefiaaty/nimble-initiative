// Party bar: hero cards along the bottom of the screen, for everyone.
// A card rises and glows while its player talks (each player's own microphone, shared with the room).
import OBR from "@owlbear-rodeo/sdk";
import { ID, STATE_KEY, TALK_CH, partyOf, partyList, isHero, getHeroImages, itemName } from "./common.js";
import { CLASS_ICONS } from "./classIcons.js";

const MIC_PREF = `${ID}/mic`;
const QUIET_MIN = 10; // GM sees a "quiet" tag after this many minutes without talking
const bar = document.getElementById("bar");

let me = { id: null, role: "PLAYER" };
let roomMd = {};
let tokens = new Map(); // image url -> { id, name }
let turnUrls = new Set();
const talking = new Map(); // player id -> last "on" time
const lastTalk = new Map(); // player id -> time they last talked or were spotlit
const started = Date.now();
let mic = { state: "off", stream: null, ctx: null, timer: null, on: false, sentAt: 0, note: "" };

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const prefOn = () => { try { return localStorage.getItem(MIC_PREF) === "on"; } catch (_) { return false; } };
const setPref = (v) => { try { localStorage.setItem(MIC_PREF, v ? "on" : "off"); } catch (_) {} };

function cardWidth(n) {
  const w = Math.floor((window.innerWidth - 12) / Math.max(n, 1)) - 6;
  return Math.max(70, Math.min(150, w));
}

function render() {
  const p = partyOf(roomMd);
  const urls = partyList(roomMd);
  const w = cardWidth(urls.length);
  const now = Date.now();
  const gm = me.role === "GM";
  bar.innerHTML = urls.map((u) => {
    const m = p.members[u] || {};
    const tok = tokens.get(u);
    const name = m.name || (tok && tok.name) || "Hero";
    const pid = m.pid || "";
    const isTalking = pid && talking.has(pid) && now - talking.get(pid) < 2500;
    const mine = pid && pid === me.id;
    const quietFor = pid ? Math.floor((now - (lastTalk.get(pid) || started)) / 60000) : 0;
    const quiet = gm && pid && quietFor >= QUIET_MIN;
    const icon = m.cls && CLASS_ICONS[m.cls] ? `<div class="badge" title="${esc(m.cls)}"><svg viewBox="0 0 512 512">${CLASS_ICONS[m.cls]}</svg></div>` : "";
    const micBtn = mine ? `<button class="mic ${mic.state}" data-act="mic" title="${mic.state === "blocked" ? esc(mic.note) : "Light up my card when I talk"}">${mic.state === "on" ? "🎙 on" : mic.state === "blocked" ? "🎙 blocked" : "🎙 off"}</button>` : "";
    const star = gm && pid ? `<button class="star" data-act="star" data-pid="${esc(pid)}" title="Had a moment (resets the quiet timer)">★</button>` : "";
    return `<div class="card ${isTalking ? "talk" : ""} ${turnUrls.has(u) ? "turn" : ""} ${quiet ? "isquiet" : ""}" style="--w:${w}px" data-url="${esc(u)}">
      <div class="frame"><div class="art" style="background-image:url('${esc(m.portrait || u)}')"></div>${icon}${micBtn}${star}${quiet ? `<div class="quiet">quiet ${quietFor}m</div>` : ""}</div>
      <div class="name">${esc(name)}</div>
      <div class="player">${esc(m.pname || "")}</div>
    </div>`;
  }).join("") + (mic.note && mic.state === "blocked" ? `<div class="note">${esc(mic.note)}</div>` : "");
}

// ---------- microphone ----------
async function startMic() {
  try {
    mic.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (err) {
    mic.state = "blocked";
    mic.note = err && err.name === "NotAllowedError"
      ? "Microphone not allowed here. Check your browser's mic permission for Owlbear, or Owlbear may not allow extensions to use it."
      : "No microphone found.";
    setTimeout(() => { mic.note = ""; render(); }, 8000);
    render();
    return;
  }
  mic.ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = mic.ctx.createMediaStreamSource(mic.stream);
  const an = mic.ctx.createAnalyser();
  an.fftSize = 1024;
  src.connect(an);
  const buf = new Float32Array(an.fftSize);
  let floor = 0.01, above = 0, below = 0;
  mic.state = "on";
  setPref(true);
  render();
  mic.timer = setInterval(() => {
    if (mic.ctx.state === "suspended") mic.ctx.resume().catch(() => {});
    an.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    if (!mic.on) floor = floor * 0.98 + rms * 0.02; // follow the room's background noise
    const thr = Math.max(0.012, floor * 2.6);
    if (rms > thr) { above += 1; below = 0; } else { below += 1; above = 0; }
    const now = Date.now();
    if (!mic.on && above >= 3) send(true);                  // ~150 ms of speech
    else if (mic.on && below >= 14) send(false);            // ~700 ms of quiet
    else if (mic.on && now - mic.sentAt > 1500) send(true); // keep-alive while talking
  }, 50);
}

function stopMic() {
  clearInterval(mic.timer);
  if (mic.stream) mic.stream.getTracks().forEach((t) => t.stop());
  if (mic.ctx) mic.ctx.close().catch(() => {});
  if (mic.on) send(false);
  mic = { state: "off", stream: null, ctx: null, timer: null, on: false, sentAt: 0, note: "" };
  setPref(false);
  render();
}

function send(on) {
  mic.on = on;
  mic.sentAt = Date.now();
  OBR.broadcast.sendMessage(TALK_CH, { pid: me.id, on }, { destination: "ALL" }).catch(() => {});
}

// ---------- events ----------
bar.addEventListener("click", async (ev) => {
  const btn = ev.target.closest("[data-act]");
  if (btn) {
    ev.stopPropagation();
    if (btn.dataset.act === "mic") { if (mic.state === "on") stopMic(); else startMic(); }
    if (btn.dataset.act === "star") { lastTalk.set(btn.dataset.pid, Date.now()); render(); }
    return;
  }
  const card = ev.target.closest(".card");
  if (!card) return;
  const tok = tokens.get(card.dataset.url);
  if (!tok) return;
  try { await OBR.viewport.animateToBounds(await OBR.scene.items.getItemBounds([tok.id])); } catch (_) {}
});
window.addEventListener("resize", render);

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
  await loadTokens();
  render();
  OBR.room.onMetadataChange((md) => { roomMd = md; render(); });
  OBR.player.onChange((pl) => { if (pl.role !== me.role) { me.role = pl.role; render(); } });
  OBR.scene.onReadyChange(async () => { await loadTokens(); render(); });
  OBR.scene.items.onChange(async () => { await loadTokens(); render(); });
  OBR.scene.onMetadataChange(async () => { await loadTokens(); render(); });
  OBR.broadcast.onMessage(TALK_CH, (event) => {
    const { pid, on } = event.data || {};
    if (!pid) return;
    if (on) { talking.set(pid, Date.now()); lastTalk.set(pid, Date.now()); } else talking.delete(pid);
    render();
  });
  setInterval(render, 1000); // fade out stale "talking" and update quiet timers
  if (prefOn()) startMic();
});
