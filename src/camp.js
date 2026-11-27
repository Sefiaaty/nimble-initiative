// Make Camp: night falls over the scene backdrop, the party cards glide up from the bar into a ring,
// and the fire is heard rather than seen. Runs inside the main slice of the scene backdrop (scene.js).
// Everyone: poke the fire (it crackles, embers drift up from the bottom of the screen), sound on/off.
// GM: drag the cards anywhere; something in the dark, flare, dawn. Positions only last while the camp does.
import OBR from "@owlbear-rodeo/sdk";
import { TALK_CH, CAMP_CH, SCENE_KEY, partyOf, barLayout, directLink } from "./common.js";
import { CLASS_ICONS, SUBCLASS_ICONS } from "./classIcons.js";

const SOUND_PREF = "nimble-camp-sound";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const rand = (a, b) => a + Math.random() * (b - a);

let root = null, cv = null, cx = null, ring = null, ctl = null;
let me = { id: "", role: "PLAYER" };
let md = {};
let W = 0, H = 0, S = 1;
let raf = 0, last = 0;
let running = false;
// heat 1 is a steady fire, more is a flare, less is guttering; it drives the light, the embers and the sound
const fire = { heat: 0.2, target: 1, dark: 0, dawn: 0, until: 0 };
const embers = [];
let emberSprite = null;
const seats = new Map(); // url -> { el, card, pid, home, spot }
const talking = new Map(); // pid -> last time heard
let lastPoke = 0;
let snd = null;
let drag = null; // { u, el, dx, dy }

// ---------- sound: a real campfire recording, with real crackles and a stick on wood for pokes ----------
// Fire: "Nighttime Campfire", Hubs Sound Pack (Hubs Foundation), CC BY 2.0. Stick: Kenney Impact Sounds, CC0.
const AUDIO = new URL("camp/", import.meta.url).href;
const pick = (a) => a[Math.floor(Math.random() * a.length)];
class FireSound {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain(); this.master.gain.value = 0; this.master.connect(this.ctx.destination);
    this.lp = this.ctx.createBiquadFilter(); this.lp.type = "lowpass"; this.lp.frequency.value = 12000;
    this.bed = this.ctx.createGain(); this.bed.gain.value = 0.8;
    this.lp.connect(this.bed).connect(this.master);
    this.heat = 1;
    this.enabled = false;
    this.bufs = { loop: null, bursts: [], sticks: [] };
    const load = (f) => fetch(AUDIO + f).then((r) => r.arrayBuffer()).then((d) => new Promise((ok, no) => this.ctx.decodeAudioData(d, ok, no)));
    load("fire-loop.mp3").then((b) => {
      this.bufs.loop = b;
      const src = this.ctx.createBufferSource(); src.buffer = b; src.loop = true;
      src.connect(this.lp); src.start(0, Math.random() * b.duration);
    }).catch(() => {});
    ["fire-burst1.mp3", "fire-burst2.mp3", "fire-burst3.mp3"].forEach((f) => load(f).then((b) => this.bufs.bursts.push(b)).catch(() => {}));
    ["stick-000.mp3", "stick-001.mp3", "stick-002.mp3"].forEach((f) => load(f).then((b) => this.bufs.sticks.push(b)).catch(() => {}));
  }
  get on() { return this.ctx.state === "running" && this.enabled; }
  setOn(v) {
    this.enabled = v;
    if (v) this.ctx.resume().catch(() => {});
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(v ? 0.7 : 0, t, 0.4);
  }
  play(buf, { at = 0, gain = 1, rate = 1 } = {}) {
    if (!buf) return;
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
    const g = this.ctx.createGain(); g.gain.value = gain;
    s.connect(g).connect(this.master); s.start(this.ctx.currentTime + at);
  }
  // the stick knocks a log, shoves it, and the fire answers with a burst of crackles
  poke() {
    if (!this.on) return;
    this.play(pick(this.bufs.sticks), { gain: 0.55, rate: rand(0.72, 0.9) });
    this.play(pick(this.bufs.sticks), { at: rand(0.1, 0.18), gain: 0.3, rate: rand(0.6, 0.8) });
    this.play(pick(this.bufs.bursts), { at: 0.08, gain: 0.95, rate: rand(0.94, 1.06) });
  }
  flare() {
    if (!this.on) return;
    this.play(pick(this.bufs.bursts), { gain: 1, rate: rand(0.9, 1) });
    this.play(pick(this.bufs.bursts), { at: 0.35, gain: 0.8, rate: rand(0.85, 0.95) });
  }
  // heat 1 is a steady fire: louder and brighter as it flares, quieter and duller as it gutters
  setHeat(h) {
    this.heat = h;
    const t = this.ctx.currentTime, k = Math.min(2.4, h);
    this.bed.gain.setTargetAtTime(0.25 + 0.55 * k, t, 0.3);
    this.lp.frequency.setTargetAtTime(Math.min(16000, 1200 + 10000 * k), t, 0.3);
  }
  fadeOut() { const g = this.master.gain, ct = this.ctx.currentTime; g.cancelScheduledValues(ct); g.setTargetAtTime(0, ct, 0.9); }
  close() { try { this.ctx.close(); } catch (_) {} }
}
const soundPref = () => { try { return localStorage.getItem(SOUND_PREF) !== "off"; } catch (_) { return true; } };
const setSoundPref = (v) => { try { localStorage.setItem(SOUND_PREF, v ? "on" : "off"); } catch (_) {} };
function ensureSound() {
  if (!snd) { try { snd = new FireSound(); } catch (_) { return null; } }
  return snd;
}

// ---------- layout ----------
function measure() {
  const dpr = window.devicePixelRatio || 1;
  W = root.clientWidth; H = root.clientHeight;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  cv.style.width = W + "px"; cv.style.height = H + "px";
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  S = Math.max(0.55, Math.min(1.6, H / 1000));
}

const cardHeight = (w, style) => style === "cutouts" ? w * 1.4 : w * 1.37;

// where each card sits on the party bar (so it can glide up from there) and in the ring
function places() {
  const p = partyOf(md);
  const vw = W + 32, vh = H + 32; // the main slice is 32px short of the window
  const L = barLayout(md, vw);
  const here = L.urls.filter((u) => !(p.members[u] || {}).absent);
  const sink = Math.max(0, Math.min(80, p.offset));
  let x = vw / 2 - L.total / 2 + 8;
  const home = {}, spot = {};
  for (const u of L.urls) {
    const w = L.widths[u], h = cardHeight(w, p.style);
    home[u] = { x: x + w / 2, y: vh + sink - h / 2, w, h };
    x += w + L.gap;
  }
  const saved = ((md[SCENE_KEY] || {}).campPos) || {};
  const n = here.length;
  const rx = W * 0.34, ry = H * 0.3;
  here.forEach((u, i) => {
    const w = L.widths[u], h = cardHeight(w, p.style);
    const a = -Math.PI / 2 + (i / Math.max(1, n)) * Math.PI * 2; // evenly round the ring, starting at the top
    const s = saved[u];
    spot[u] = s ? { x: s[0] * W, y: s[1] * H, w, h } : { x: W / 2 + rx * Math.cos(a), y: H * 0.5 + ry * Math.sin(a), w, h };
  });
  return { home, spot, here, style: p.style };
}

function put(el, pos) { el.style.left = (pos.x - pos.w / 2) + "px"; el.style.top = (pos.y - pos.h / 2) + "px"; }

function cardHtml(u, m, style) {
  const src = directLink(m.portrait) || u;
  const subIcon = m.cls && m.sub ? SUBCLASS_ICONS[`${m.cls}/${m.sub}`] : null;
  const icon = subIcon || (m.cls && CLASS_ICONS[m.cls]) ? `<div class="badge"><svg viewBox="0 0 512 512">${subIcon || CLASS_ICONS[m.cls]}</svg></div>` : "";
  return `<div class="frame"><div class="art" style="background-image:url('${esc(src)}')"></div><img class="cut" src="${esc(src)}" alt="" draggable="false">${icon}</div>
    <div class="name">${esc(m.name || "Hero")}</div><div class="player">${esc(m.pname || "")}</div>`;
}

function buildCards(glide) {
  const p = partyOf(md);
  const { home, spot, here, style } = places();
  document.body.classList.toggle("cutouts", style === "cutouts");
  const want = new Set(here);
  for (const [u, s] of seats) if (!want.has(u)) { s.el.remove(); seats.delete(u); }
  for (const u of here) {
    const m = p.members[u] || {};
    let s = seats.get(u);
    if (!s) {
      const el = document.createElement("div");
      el.className = "seat still";
      el.dataset.url = u;
      el.innerHTML = `<div class="card"></div>`;
      ring.appendChild(el);
      s = { el, card: el.firstChild, html: "" };
      seats.set(u, s);
      if (glide && home[u]) { put(el, home[u]); el.style.opacity = "0"; } else put(el, spot[u]);
    }
    const html = cardHtml(u, m, style);
    if (s.html !== html) { s.card.innerHTML = html; s.html = html; }
    const w = (spot[u] || home[u]).w;
    s.card.style.setProperty("--w", `${w}px`);
    const fr = (m.frame && m.frame[style]) || {};
    s.card.style.setProperty("--fx", String(Number(fr.x) || 0));
    s.card.style.setProperty("--fy", String(Number(fr.y) || 0));
    s.card.style.setProperty("--fz", String(Number(fr.z) || 1));
    s.pid = m.pid || ""; s.home = home[u]; s.spot = spot[u];
    s.el.classList.toggle("movable", me.role === "GM");
  }
  // let the browser draw where they start, then glide them into place
  requestAnimationFrame(() => requestAnimationFrame(() => {
    let i = 0;
    for (const [u, s] of seats) {
      if (drag && drag.u === u) continue;
      const fresh = s.el.classList.contains("still");
      s.el.style.transitionDelay = fresh && glide ? `${i++ * 90}ms` : "0ms";
      s.el.classList.remove("still");
      s.el.style.opacity = "";
      put(s.el, s.spot);
    }
  }));
}

function goHome() {
  let i = 0;
  for (const s of seats.values()) {
    s.el.classList.remove("dragging");
    s.el.style.transitionDelay = `${i++ * 70}ms`;
    if (s.home) put(s.el, s.home);
    s.el.style.opacity = "0";
  }
}

// ---------- the GM moves cards around ----------
function onDown(e) {
  if (me.role !== "GM") return;
  const el = e.target.closest(".seat");
  if (!el) return;
  e.preventDefault();
  const r = el.getBoundingClientRect();
  drag = { u: el.dataset.url, el, dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false };
  el.classList.add("dragging");
  el.setPointerCapture(e.pointerId);
}
function onMove(e) {
  if (!drag) return;
  drag.moved = true;
  drag.el.style.left = (e.clientX - drag.dx) + "px";
  drag.el.style.top = (e.clientY - drag.dy) + "px";
}
async function onUp() {
  if (!drag) return;
  const d = drag; drag = null;
  d.el.classList.remove("dragging");
  if (!d.moved) return;
  const r = d.el.getBoundingClientRect();
  const cxp = Math.max(0, Math.min(1, (r.left + r.width / 2) / W)), cyp = Math.max(0, Math.min(1, (r.top + r.height / 2) / H));
  const live = (await OBR.room.getMetadata())[SCENE_KEY] || {};
  if (!live.on || !live.camp) return;
  await OBR.room.setMetadata({ [SCENE_KEY]: { ...live, campPos: { ...(live.campPos || {}), [d.u]: [Math.round(cxp * 1000) / 1000, Math.round(cyp * 1000) / 1000] } } });
}

// ---------- embers and light ----------
function burst(n, wide = 0.6) {
  for (let i = 0; i < n; i++) {
    embers.push({ x: W / 2 + rand(-W * wide / 2, W * wide / 2), y: H + rand(0, 40), vx: rand(-25, 25) * S, vy: -rand(120, 260) * S, life: rand(2.4, 4.8), age: rand(0, 0.3), size: rand(1.6, 3.4) * S, sway: rand(0, 6.28) });
  }
}

function step(dt, now) {
  if (fire.until && now > fire.until) { fire.until = 0; fire.target = fire.dawn ? 0.15 : 1; fire.dark = 0; }
  fire.heat += (fire.target - fire.heat) * Math.min(1, dt * (fire.heat < fire.target ? 1.3 : 0.9));
  if (snd) snd.setHeat(fire.heat);
  if (Math.random() < 0.7 * fire.heat * dt) burst(1, 0.5); // a slow trickle while the fire burns
  for (const e of embers) { e.age += dt; e.vy *= 0.995; e.x += (e.vx + Math.sin(e.age * 2.4 + e.sway) * 34 * S) * dt; e.y += e.vy * dt; }
  for (let i = embers.length - 1; i >= 0; i--) if (embers[i].age > embers[i].life || embers[i].y < -20) embers.splice(i, 1);
}

function draw(now) {
  const h = fire.heat;
  cx.clearRect(0, 0, W, H);
  // night: darker edges, darker still when something is out there
  const edge = Math.min(0.9, 0.42 + fire.dark * 0.4 + (1 - Math.min(1, h)) * 0.15);
  const vg = cx.createRadialGradient(W / 2, H * 0.62, Math.min(W, H) * 0.2, W / 2, H * 0.62, Math.max(W, H) * 0.8);
  vg.addColorStop(0, `rgba(0,0,12,${edge * 0.25})`); vg.addColorStop(1, `rgba(0,0,14,${edge})`);
  cx.fillStyle = vg; cx.fillRect(0, 0, W, H);
  if (fire.dawn) {
    const dg = cx.createLinearGradient(0, 0, 0, H);
    dg.addColorStop(0, `rgba(255,170,120,${0.35 * fire.dawn})`); dg.addColorStop(0.6, `rgba(255,200,160,${0.18 * fire.dawn})`); dg.addColorStop(1, "rgba(0,0,0,0)");
    cx.fillStyle = dg; cx.fillRect(0, 0, W, H);
  }
  // warm light from below, where the fire would be, flickering with it
  const flick = 0.82 + 0.18 * Math.sin(now / 90) * Math.sin(now / 37);
  cx.globalCompositeOperation = "lighter";
  const gl = cx.createRadialGradient(W / 2, H + 60 * S, 0, W / 2, H + 60 * S, H * 0.75 * Math.min(1.6, 0.6 + 0.4 * h));
  gl.addColorStop(0, `rgba(255,140,50,${0.26 * Math.min(1.6, h) * flick})`); gl.addColorStop(0.55, `rgba(255,100,30,${0.08 * Math.min(1.6, h)})`); gl.addColorStop(1, "rgba(0,0,0,0)");
  cx.fillStyle = gl; cx.fillRect(0, 0, W, H);
  for (const e of embers) {
    const t = e.age / e.life;
    cx.globalAlpha = Math.max(0, Math.min(1, (1 - t) * 1.4)) * (0.6 + 0.4 * Math.sin(e.age * 18 + e.sway));
    const s = e.size * 4;
    cx.drawImage(emberSprite, e.x - s / 2, e.y - s / 2, s, s);
  }
  cx.globalAlpha = 1;
  cx.globalCompositeOperation = "source-over";
  // talking cards light up, like on the bar
  const t = Date.now();
  for (const s of seats.values()) {
    const on = s.pid && talking.has(s.pid) && t - talking.get(s.pid) < 2500;
    if (s.card.classList.contains("talk") !== !!on) s.card.classList.toggle("talk", !!on);
  }
}

function loop() {
  if (!running) return;
  const now = performance.now();
  const dt = Math.min(0.05, (now - (last || now)) / 1000);
  last = now;
  step(dt, now);
  draw(now);
  raf = requestAnimationFrame(loop);
}

// ---------- events ----------
function onCamp(d) {
  const now = performance.now();
  if (d.k === "poke") {
    burst(34);
    fire.heat = Math.min(2.4, fire.heat + 0.5);
    if (snd) snd.poke();
    const s = [...seats.values()].find((x) => x.pid && x.pid === d.pid);
    if (s) { s.card.classList.remove("poked"); void s.card.offsetWidth; s.card.classList.add("poked"); }
  } else if (d.k === "flare") {
    fire.heat = 2.4; fire.target = 1; burst(70, 0.9);
    if (snd) snd.flare();
  } else if (d.k === "dark") {
    fire.target = 0.3; fire.dark = 1; fire.until = now + 5000;
  } else if (d.k === "dawn") {
    fire.dawn = 0.01; fire.target = 0.15; fire.until = 0;
    const t0 = performance.now();
    const rise = () => { if (!running) return; fire.dawn = Math.min(1, (performance.now() - t0) / 2500); if (fire.dawn < 1) requestAnimationFrame(rise); };
    rise();
    setTimeout(goHome, 900);
    if (snd) snd.fadeOut();
  }
}

function send(k) { OBR.broadcast.sendMessage(CAMP_CH, { k, pid: me.id, at: Date.now() }, { destination: "ALL" }).catch(() => {}); }

function poke() {
  const now = Date.now();
  if (now - lastPoke < 1200) return;
  lastPoke = now;
  if (soundPref()) { const s = ensureSound(); if (s && !s.enabled) s.setOn(true); }
  send("poke");
  renderCtl();
}

function renderCtl() {
  const on = snd && snd.on;
  const gm = me.role === "GM";
  ctl.innerHTML = `<button class="poke" data-c="poke" title="Poke the fire with a stick">🪵 Poke the fire</button>
    <button class="snd ${on ? "on" : ""}" data-c="sound" title="${on ? "Mute the fire" : "Hear the fire"}">${on ? "🔊" : "🔇"}</button>
    ${gm ? `<div class="lev"><button data-c="dark" title="The fire gutters and the dark closes in">🌑 Something in the dark</button><button data-c="flare" title="The fire roars up">🔥 Flare</button><button class="dawn" data-c="dawn" title="Morning comes: the camp fades back to the map">🌅 Dawn</button></div>` : ""}`;
}

// ---------- start / stop ----------
export async function startCamp(container, roomMd) {
  if (running) { md = roomMd; buildCards(false); return; }
  running = true;
  md = roomMd;
  me = { id: await OBR.player.getId(), role: await OBR.player.getRole() };
  root = container;
  root.innerHTML = `<canvas class="fire"></canvas><div class="ring"></div><div class="ctl"></div>`;
  root.classList.add("on");
  cv = root.querySelector("canvas"); cx = cv.getContext("2d");
  ring = root.querySelector(".ring"); ctl = root.querySelector(".ctl");
  if (!emberSprite) {
    emberSprite = document.createElement("canvas"); emberSprite.width = emberSprite.height = 64;
    const x = emberSprite.getContext("2d"), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,220,150,1)"); gr.addColorStop(0.3, "rgba(255,150,50,.7)"); gr.addColorStop(1, "rgba(255,90,20,0)");
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  }
  measure();
  Object.assign(fire, { heat: 0.2, target: 1, dark: 0, dawn: 0, until: 0 });
  embers.length = 0;
  buildCards(true);
  renderCtl();
  if (soundPref()) { const s = ensureSound(); if (s) { s.setOn(true); renderCtl(); } }
  ring.addEventListener("pointerdown", onDown);
  ring.addEventListener("pointermove", onMove);
  ring.addEventListener("pointerup", onUp);
  ring.addEventListener("pointercancel", onUp);
  if (!root.dataset.hooked) root.addEventListener("click", onClick);
  root.dataset.hooked = "1";
  last = 0;
  raf = requestAnimationFrame(loop);
}

function onClick(e) {
  if (!running) return;
  const b = e.target.closest("[data-c]");
  // sound needs a click on this page first; any click turns it on if the player wants it
  if (soundPref() && snd && !snd.on && (!b || b.dataset.c !== "sound")) { snd.setOn(true); renderCtl(); }
  if (!b) return;
  const c = b.dataset.c;
  if (c === "poke") poke();
  else if (c === "sound") { const s = ensureSound(); const v = !(s && s.on); setSoundPref(v); if (s) s.setOn(v); setTimeout(renderCtl, 60); }
  else if (me.role === "GM" && (c === "dark" || c === "flare" || c === "dawn")) send(c);
}

export function updateCamp(roomMd) { if (!running) return; md = roomMd; buildCards(false); }

export function stopCamp() {
  if (!running) return;
  running = false;
  cancelAnimationFrame(raf);
  if (snd) { snd.close(); snd = null; }
  seats.clear();
  drag = null;
  if (root) { root.innerHTML = ""; root.classList.remove("on"); }
  document.body.classList.remove("cutouts");
}

let hooked = false;
export function hookCamp() {
  if (hooked) return;
  hooked = true;
  OBR.broadcast.onMessage(CAMP_CH, (e) => { if (running) onCamp(e.data || {}); });
  OBR.broadcast.onMessage(TALK_CH, (e) => { const { pid, on } = e.data || {}; if (!pid) return; if (on) talking.set(pid, Date.now()); else talking.delete(pid); });
  window.addEventListener("resize", () => { if (running) { measure(); buildCards(false); } });
}
