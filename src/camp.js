// Make Camp: a campfire in the middle of the scene backdrop, the heroes sitting around it.
// Runs inside the main slice of the scene backdrop (scene.js) while the scene is a camp.
// Everyone: poke the fire (embers fly, it crackles), sound on/off. GM: something in the dark, flare, dawn.
import OBR from "@owlbear-rodeo/sdk";
import { TALK_CH, CAMP_CH, partyOf, partyList, barLayout, directLink } from "./common.js";

const SOUND_PREF = "nimble-camp-sound";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const rand = (a, b) => a + Math.random() * (b - a);

let root = null, cv = null, cx = null, ring = null, ctl = null;
let me = { id: "", role: "PLAYER" };
let md = {};
let W = 0, H = 0, S = 1, B = 1.7, F = { x: 0, y: 0 };
let raf = 0, last = 0;
let running = false;
// the fire: heat 1 is a steady campfire, more is a flare, less is guttering
const fire = { heat: 0.05, target: 1, dark: 0, dawn: 0, until: 0 };
const flames = [], embers = [];
const sprites = {};
const heroes = new Map(); // url -> { el, pid, home, seat }
const talking = new Map(); // pid -> last time heard
let lastPoke = 0;
let snd = null;

// ---------- sprites: soft glowing dots, drawn once ----------
function sprite(r, g, b) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d");
  const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, `rgba(${r},${g},${b},1)`);
  gr.addColorStop(0.4, `rgba(${r},${g},${b},.55)`);
  gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  return c;
}

// ---------- sound: a crackling fire made on the fly, nothing to download ----------
class FireSound {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain(); this.master.gain.value = 0; this.master.connect(this.ctx.destination);
    // the low roar: brown noise through a low-pass filter
    const len = this.ctx.sampleRate * 3, buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = buf.getChannelData(0);
    let v = 0;
    for (let i = 0; i < len; i++) { v = (v + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = v * 3.2; }
    this.roarSrc = this.ctx.createBufferSource(); this.roarSrc.buffer = buf; this.roarSrc.loop = true;
    this.roarLp = this.ctx.createBiquadFilter(); this.roarLp.type = "lowpass"; this.roarLp.frequency.value = 520;
    this.roar = this.ctx.createGain(); this.roar.gain.value = 0.5;
    this.roarSrc.connect(this.roarLp).connect(this.roar).connect(this.master); this.roarSrc.start();
    // white noise for the crackles
    const n = this.ctx.sampleRate, wb = this.ctx.createBuffer(1, n, this.ctx.sampleRate), w = wb.getChannelData(0);
    for (let i = 0; i < n; i++) w[i] = Math.random() * 2 - 1;
    this.white = wb;
    this.heat = 1;
    this.timer = setInterval(() => this.tick(), 40);
  }
  get on() { return this.ctx.state === "running" && this.enabled; }
  setOn(v) {
    this.enabled = v;
    if (v) this.ctx.resume().catch(() => {});
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(v ? 0.55 : 0, t, 0.4);
  }
  crackle(loud = 1, at = 0) {
    const t = this.ctx.currentTime + at;
    const s = this.ctx.createBufferSource(); s.buffer = this.white; s.playbackRate.value = rand(0.6, 1.6);
    const bp = this.ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = rand(1200, 4200); bp.Q.value = rand(0.7, 2.5);
    const g = this.ctx.createGain(); const dur = rand(0.006, 0.03);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(rand(0.08, 0.32) * loud, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(bp).connect(g).connect(this.master); s.start(t, rand(0, 0.9), dur + 0.02);
  }
  pop(at = 0) {
    const t = this.ctx.currentTime + at;
    const o = this.ctx.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(rand(120, 220), t); o.frequency.exponentialRampToValueAtTime(50, t + 0.08);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.14);
    this.crackle(1.6, at);
  }
  whoosh(len = 0.7, from = 260, to = 1400) {
    const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource(); s.buffer = this.white; s.loop = true;
    const bp = this.ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(from, t); bp.frequency.exponentialRampToValueAtTime(to, t + len * 0.6);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + len * 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    s.connect(bp).connect(g).connect(this.master); s.start(t); s.stop(t + len + 0.05);
  }
  poke() { if (!this.on) return; this.whoosh(0.5, 300, 1100); for (let i = 0; i < 16; i++) (Math.random() < 0.25 ? this.pop(rand(0, 0.7)) : this.crackle(1.3, rand(0, 0.8))); }
  setHeat(h) {
    this.heat = h;
    const t = this.ctx.currentTime;
    this.roar.gain.setTargetAtTime(0.2 + 0.4 * Math.min(2, h), t, 0.3);
    this.roarLp.frequency.setTargetAtTime(300 + 320 * Math.min(2, h), t, 0.3);
  }
  tick() {
    if (!this.on) return;
    const rate = 7 * Math.max(0.15, this.heat); // crackles per second
    if (Math.random() < rate * 0.04) (Math.random() < 0.08 ? this.pop() : this.crackle());
  }
  close() { clearInterval(this.timer); try { this.ctx.close(); } catch (_) {} }
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
  F = { x: W * 0.5, y: H * 0.74 };
}

// where each hero sits on the party bar (so they can glide up from it) and around the fire
function places() {
  const p = partyOf(md);
  const vw = W + 32, vh = H + 32; // the main slice is 32px short of the window
  const L = barLayout(md, vw);
  const here = L.urls.filter((u) => !(p.members[u] || {}).absent);
  const sink = Math.max(0, Math.min(80, p.offset));
  let x = vw / 2 - L.total / 2 + 8;
  const home = {};
  for (const u of L.urls) {
    const w = L.widths[u];
    home[u] = { cx: x + w / 2, bottom: vh + sink, h: w * 1.4 };
    x += w + L.gap;
  }
  const n = here.length;
  const rx = Math.min(W * 0.34, 125 * S * Math.max(3, n));
  const ry = 125 * S;
  const seat = {};
  here.forEach((u, i) => {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const a = Math.PI * (1.04 + 0.92 * t); // from the left, round the back of the fire, to the right
    const depth = 0.78 + 0.22 * (1 - Math.abs(Math.sin(a)));
    seat[u] = { cx: F.x + rx * Math.cos(a), bottom: F.y + 30 * S + ry * Math.sin(a), h: 250 * S * depth, z: Math.round(100 + ry * Math.sin(a)) };
  });
  return { home, seat, here };
}

function place(el, pos) {
  el.style.left = (pos.cx - pos.h * 0.45) + "px";
  el.style.width = (pos.h * 0.9) + "px";
  el.style.top = (pos.bottom - pos.h) + "px";
  el.style.height = pos.h + "px";
}

function buildHeroes(glide) {
  const p = partyOf(md);
  const { home, seat, here } = places();
  const want = new Set(here);
  for (const [u, h] of heroes) if (!want.has(u)) { h.el.remove(); heroes.delete(u); }
  for (const u of here) {
    const m = p.members[u] || {};
    let h = heroes.get(u);
    if (!h) {
      const el = document.createElement("div");
      el.className = "hero";
      el.innerHTML = `<img alt="" draggable="false">`;
      ring.appendChild(el);
      h = { el };
      heroes.set(u, h);
      el.classList.add("still");
      if (glide) { place(el, home[u] || seat[u]); el.style.opacity = "0"; } else place(el, seat[u]);
    }
    const src = directLink(m.portrait) || u;
    const img = h.el.firstChild;
    if (img.getAttribute("src") !== src) img.setAttribute("src", src);
    const fr = (m.frame && m.frame.cutouts) || {};
    img.style.translate = `${(Number(fr.x) || 0)}% ${(Number(fr.y) || 0)}%`;
    img.style.scale = String(Number(fr.z) || 1);
    h.pid = m.pid || "";
    h.home = home[u]; h.seat = seat[u];
    h.el.dataset.pid = h.pid;
    h.el.title = m.name || "";
    h.el.style.zIndex = String(seat[u].z);
  }
  // let the browser draw the start positions, then glide to the seats
  requestAnimationFrame(() => requestAnimationFrame(() => {
    let i = 0;
    for (const h of heroes.values()) {
      h.el.style.transitionDelay = h.el.classList.contains("still") ? `${i++ * 90}ms` : "0ms";
      h.el.classList.remove("still");
      h.el.style.opacity = "";
      place(h.el, h.seat);
    }
  }));
}

function goHome() {
  let i = 0;
  for (const h of heroes.values()) {
    h.el.style.transitionDelay = `${i++ * 70}ms`;
    if (h.home) place(h.el, h.home);
    h.el.style.opacity = "0";
  }
}

// ---------- the fire ----------
function burst(n) {
  for (let i = 0; i < n; i++) embers.push({ x: F.x + rand(-25, 25) * S * B, y: F.y - rand(5, 30) * S * B, vx: rand(-60, 60) * S * B, vy: rand(-260, -120) * S * B, life: rand(1.6, 3.4), age: 0, size: rand(1.4, 3) * S * B, sway: rand(0, 6.28) });
}

function step(dt, now) {
  // heat follows its target; flares and darkness wear off
  if (fire.until && now > fire.until) { fire.until = 0; fire.target = fire.dawn ? 0.15 : 1; fire.dark = 0; }
  fire.heat += (fire.target - fire.heat) * Math.min(1, dt * (fire.heat < fire.target ? 1.3 : 0.9));
  if (snd) snd.setHeat(fire.heat);
  const h = fire.heat;
  // flames
  const spawn = 70 * Math.max(0.12, h) * dt;
  for (let i = 0; i < spawn; i++) {
    flames.push({ x: F.x + rand(-30, 30) * S * B * Math.min(1.4, 0.6 + h * 0.4), y: F.y - rand(0, 8) * S * B, vx: rand(-14, 14) * S * B, vy: -rand(70, 150) * S * B * Math.min(1.8, 0.5 + h * 0.6), life: rand(0.5, 1.0) * Math.min(1.5, 0.6 + h * 0.4), age: 0, size: rand(22, 38) * S * B * Math.min(1.6, 0.55 + h * 0.45) });
  }
  if (Math.random() < 0.9 * h * dt) burst(1);
  for (const f of flames) { f.age += dt; f.x += f.vx * dt + Math.sin((f.age + f.size) * 9) * 10 * S * B * dt; f.y += f.vy * dt; f.vx += (F.x - f.x) * 1.6 * dt; }
  for (let i = flames.length - 1; i >= 0; i--) if (flames[i].age > flames[i].life) flames.splice(i, 1);
  for (const e of embers) { e.age += dt; e.vy += 40 * S * B * dt; e.vy *= 0.985; e.x += (e.vx + Math.sin(e.age * 3 + e.sway) * 30 * S * B) * dt; e.y += e.vy * dt; }
  for (let i = embers.length - 1; i >= 0; i--) if (embers[i].age > embers[i].life) embers.splice(i, 1);
}

function draw(now) {
  const h = fire.heat;
  cx.clearRect(0, 0, W, H);
  cx.globalCompositeOperation = "source-over";
  // night around the fire: dark at the edges, darker when something is out there
  const r0 = Math.max(60, 260 * S * B * Math.min(1.6, h));
  const vg = cx.createRadialGradient(F.x, F.y - 40 * S * B, r0 * 0.4, F.x, F.y - 40 * S * B, Math.max(W, H) * 0.75);
  const edge = Math.min(0.92, 0.5 + fire.dark * 0.35 + (1 - Math.min(1, h)) * 0.2);
  vg.addColorStop(0, "rgba(0,0,10,0)");
  vg.addColorStop(0.45, `rgba(0,0,12,${edge * 0.55})`);
  vg.addColorStop(1, `rgba(0,0,14,${edge})`);
  cx.fillStyle = vg; cx.fillRect(0, 0, W, H);
  // dawn: the sky warms from the top
  if (fire.dawn) {
    const dg = cx.createLinearGradient(0, 0, 0, H);
    dg.addColorStop(0, `rgba(255,170,120,${0.35 * fire.dawn})`); dg.addColorStop(0.6, `rgba(255,200,160,${0.18 * fire.dawn})`); dg.addColorStop(1, "rgba(0,0,0,0)");
    cx.fillStyle = dg; cx.fillRect(0, 0, W, H);
  }
  const flick = 0.85 + 0.15 * Math.sin(now / 90) * Math.sin(now / 37);
  // warm light on the ground
  cx.globalCompositeOperation = "lighter";
  const gl = cx.createRadialGradient(F.x, F.y, 0, F.x, F.y, 330 * S * B * Math.min(1.8, h) * flick);
  gl.addColorStop(0, `rgba(255,150,60,${0.32 * Math.min(1.5, h)})`); gl.addColorStop(0.5, `rgba(255,110,40,${0.12 * Math.min(1.5, h)})`); gl.addColorStop(1, "rgba(0,0,0,0)");
  cx.fillStyle = gl; cx.fillRect(0, 0, W, H);
  cx.globalCompositeOperation = "source-over";
  // stones and logs
  cx.fillStyle = "rgba(40,36,34,.95)";
  for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; cx.beginPath(); cx.ellipse(F.x + Math.cos(a) * 52 * S * B, F.y + 6 * S * B + Math.sin(a) * 15 * S * B, 11 * S * B, 7 * S * B, 0, 0, Math.PI * 2); cx.fill(); }
  for (const [ang, len] of [[-0.35, 78], [0.35, 78], [0.05, 70]]) {
    cx.save(); cx.translate(F.x, F.y + 3 * S * B); cx.rotate(ang);
    cx.fillStyle = "#2b1a10"; cx.fillRect(-len * S * B / 2, -6 * S * B, len * S * B, 12 * S * B);
    cx.fillStyle = `rgba(255,120,40,${0.35 + 0.35 * Math.min(1, h) * flick})`; cx.fillRect(-len * S * B / 2.6, -2 * S * B, len * S * B / 1.3, 3 * S * B);
    cx.restore();
  }
  // flames and embers glow on top of each other
  cx.globalCompositeOperation = "lighter";
  for (const f of flames) {
    const t = f.age / f.life;
    const sp = t < 0.25 ? sprites.white : t < 0.6 ? sprites.orange : sprites.red;
    const size = f.size * (1 - t * 0.6);
    cx.globalAlpha = Math.max(0, (1 - t) * 0.55);
    cx.drawImage(sp, f.x - size / 2, f.y - size / 2, size, size);
  }
  for (const e of embers) {
    const t = e.age / e.life;
    cx.globalAlpha = Math.max(0, 1 - t) * (0.6 + 0.4 * Math.sin(e.age * 20 + e.sway));
    const s = e.size * 4;
    cx.drawImage(sprites.ember, e.x - s / 2, e.y - s / 2, s, s);
  }
  cx.globalAlpha = 1;
  cx.globalCompositeOperation = "source-over";
  // the heroes catch the firelight
  const lit = Math.max(0.25, Math.min(1.15, 0.45 + 0.4 * h * flick - fire.dark * 0.25 + fire.dawn * 0.3));
  ring.style.setProperty("--lit", lit.toFixed(3));
  const t = Date.now();
  for (const hh of heroes.values()) {
    const on = hh.pid && talking.has(hh.pid) && t - talking.get(hh.pid) < 2500;
    if (hh.el.classList.contains("talk") !== !!on) hh.el.classList.toggle("talk", !!on);
  }
}

function loop(ts) {
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
    burst(28);
    fire.heat = Math.min(2.4, fire.heat + 0.55);
    if (snd) snd.poke();
    const h = [...heroes.values()].find((x) => x.pid && x.pid === d.pid);
    if (h) { h.el.classList.remove("poked"); void h.el.offsetWidth; h.el.classList.add("poked"); }
  } else if (d.k === "flare") {
    fire.heat = 2.4; fire.target = 1; burst(50);
    if (snd && snd.on) { snd.whoosh(1.1, 200, 1600); for (let i = 0; i < 12; i++) snd.pop(rand(0, 0.9)); }
  } else if (d.k === "dark") {
    fire.target = 0.3; fire.dark = 1; fire.until = now + 5000;
    if (snd && snd.on) snd.whoosh(1.4, 900, 180);
  } else if (d.k === "dawn") {
    fire.dawn = 0.01; fire.target = 0.15; fire.until = 0;
    const t0 = performance.now();
    const rise = () => { if (!running) return; fire.dawn = Math.min(1, (performance.now() - t0) / 2500); if (fire.dawn < 1) requestAnimationFrame(rise); };
    rise();
    setTimeout(goHome, 900);
    if (snd) { const g = snd.master.gain, ct = snd.ctx.currentTime; g.cancelScheduledValues(ct); g.setTargetAtTime(0, ct, 0.9); }
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
  if (running) { md = roomMd; buildHeroes(false); return; }
  running = true;
  md = roomMd;
  me = { id: await OBR.player.getId(), role: await OBR.player.getRole() };
  root = container;
  root.innerHTML = `<canvas class="fire"></canvas><div class="ring"></div><div class="ctl"></div>`;
  root.classList.add("on");
  cv = root.querySelector("canvas"); cx = cv.getContext("2d");
  ring = root.querySelector(".ring"); ctl = root.querySelector(".ctl");
  if (!sprites.white) { sprites.white = sprite(255, 236, 170); sprites.orange = sprite(255, 150, 40); sprites.red = sprite(210, 60, 15); sprites.ember = sprite(255, 170, 60); }
  measure();
  fire.heat = 0.05; fire.target = 1; fire.dark = 0; fire.dawn = 0; fire.until = 0;
  flames.length = 0; embers.length = 0;
  buildHeroes(true);
  renderCtl();
  // sound needs a click on this page first; any click turns it on if the player wants it
  if (soundPref()) { const s = ensureSound(); if (s) { s.setOn(true); renderCtl(); } }
  root.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-c]");
    if (soundPref() && snd && !snd.on && (!b || b.dataset.c !== "sound")) { snd.setOn(true); renderCtl(); }
    if (!b) {
      // clicking the fire itself pokes it too
      if (Math.hypot(e.clientX - F.x, e.clientY - (F.y - 40 * S * B)) < 90 * S * B) poke();
      return;
    }
    const c = b.dataset.c;
    if (c === "poke") poke();
    else if (c === "sound") { const s = ensureSound(); const v = !(s && s.on); setSoundPref(v); if (s) s.setOn(v); setTimeout(renderCtl, 60); }
    else if (me.role === "GM" && (c === "dark" || c === "flare" || c === "dawn")) send(c);
  });
  last = 0;
  raf = requestAnimationFrame(loop);
}

export function updateCamp(roomMd) { if (!running) return; md = roomMd; buildHeroes(false); }

export function stopCamp() {
  if (!running) return;
  running = false;
  cancelAnimationFrame(raf);
  if (snd) { snd.close(); snd = null; }
  heroes.clear();
  if (root) { root.innerHTML = ""; root.classList.remove("on"); }
}

let hooked = false;
export function hookCamp() {
  if (hooked) return;
  hooked = true;
  OBR.broadcast.onMessage(CAMP_CH, (e) => { if (running) onCamp(e.data || {}); });
  OBR.broadcast.onMessage(TALK_CH, (e) => { const { pid, on } = e.data || {}; if (!pid) return; if (on) talking.set(pid, Date.now()); else talking.delete(pid); });
  window.addEventListener("resize", () => { if (running) { measure(); buildHeroes(false); } });
}
