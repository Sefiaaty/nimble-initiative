// Table chat: a small panel in Owlbear so nobody has to switch to Discord to type or share a GIF.
// What you send also pops up above your card on the party bar (the GM's above the bird).
// The background page keeps the log (it never closes); this panel shows it and sends.
import OBR from "@owlbear-rodeo/sdk";
import { EV_CH, GIPHY_KEY, CHAT_BC, chatLogKey, gifFrom } from "./common.js";

const logEl = document.getElementById("log");
const form = document.getElementById("send");
const input = form.querySelector("input");
const gifBtn = document.getElementById("gifbtn");
const picker = document.getElementById("picker");
const grid = document.getElementById("grid");
const pfoot = document.getElementById("pfoot");
const gsearch = document.getElementById("gsearch");
const ginput = gsearch.querySelector("input");
const bc = new BroadcastChannel(CHAT_BC);

let me = { id: "", role: "PLAYER" };
let LOG = "";
let giphyKey = "";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const readLog = () => { try { const v = JSON.parse(localStorage.getItem(LOG) || "[]"); return Array.isArray(v) ? v : []; } catch (_) { return []; } };
// Starred GIFs, kept in this browser (they cost no GIPHY searches)
const FAVS = "nimble-gif-favs";
const readFavs = () => { try { const v = JSON.parse(localStorage.getItem(FAVS) || "[]"); return Array.isArray(v) ? v : []; } catch (_) { return []; } };
const saveFavs = (l) => { try { localStorage.setItem(FAVS, JSON.stringify(l.slice(0, 80))); } catch (_) {} };
const isFav = (url) => readFavs().some((f) => f.url === url);
function toggleFav(g) {
  const l = readFavs();
  const i = l.findIndex((f) => f.url === g.url);
  if (i >= 0) l.splice(i, 1); else l.unshift({ url: g.url, preview: g.preview || g.url, title: g.title || "GIF", kind: g.kind || "img" });
  saveFavs(l);
  return i < 0;
}
const star = (on) => `<button type="button" class="fav${on ? " on" : ""}" title="${on ? "Remove from saved GIFs" : "Save this GIF"}">${on ? "★" : "☆"}</button>`;
const hhmm = (t) => { const d = new Date(t); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`; };

function render() {
  const list = readLog();
  const atBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
  logEl.innerHTML = list.length ? list.map((m) => {
    const who = `<b>${esc(m.name || "Someone")}</b>`;
    const body = m.url
      ? `<span class="gw" data-url="${esc(m.url)}" data-kind="${m.kind === "video" ? "video" : "img"}">${m.kind === "video" ? `<video class="g" src="${esc(m.url)}" autoplay loop muted playsinline></video>` : `<img class="g" src="${esc(m.url)}" alt="GIF" loading="lazy">`}${star(isFav(m.url))}</span>`
      : esc(m.text);
    return `<div class="m${m.gm ? " gm" : ""}${m.pid === me.id ? " me" : ""}">${who}<i>${hhmm(m.at)}</i>${m.url ? body : ` ${body}`}</div>`;
  }).join("") : `<div class="empty">Say something, or share a GIF. It also pops up above your card on the party bar.</div>`;
  if (atBottom || !render.done) logEl.scrollTop = logEl.scrollHeight;
  render.done = true;
  // a GIF that loads later grows the log, so keep the newest message in view
  for (const g of logEl.querySelectorAll(".g")) g.addEventListener("load", () => { if (atBottom) logEl.scrollTop = logEl.scrollHeight; }, { once: true });
}

const newId = () => `${me.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
function send(data) {
  OBR.broadcast.sendMessage(EV_CH, { ...data, pid: me.id, at: Date.now(), id: newId() }, { destination: "ALL" }).catch(() => {});
}
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  // "/gif some words" searches GIFs for those words, like Discord
  const slash = text.match(/^\/gif\s*(.*)$/i);
  if (slash) { input.value = ""; searchFor(slash[1]); return; }
  const gif = gifFrom(text);
  if (gif) send({ k: "gif", url: gif.url, kind: gif.kind });
  else send({ k: "say", text: text.slice(0, 140) });
  input.value = "";
});
document.getElementById("close").addEventListener("click", () => bc.postMessage({ chat: "close" }));
// Drag the title bar to move the chat; it jumps to where you let go. Double-click it to send it back home.
const head = document.querySelector("header");
let drag = null;
head.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || e.target.closest("button")) return;
  drag = { x: e.screenX, y: e.screenY, moved: false };
  head.setPointerCapture(e.pointerId);
});
head.addEventListener("pointermove", (e) => {
  if (!drag) return;
  drag.lx = e.screenX; drag.ly = e.screenY;
  if (!drag.moved && Math.abs(e.screenX - drag.x) + Math.abs(e.screenY - drag.y) > 5) { drag.moved = true; document.body.classList.add("moving"); }
});
const endDrag = (e) => {
  if (!drag) return;
  const d = drag; drag = null;
  document.body.classList.remove("moving");
  // if the browser stops sending the pointer once it leaves the panel, use the last place we saw it
  const x = e.type === "pointerup" ? e.screenX : d.lx, y = e.type === "pointerup" ? e.screenY : d.ly;
  if (d.moved && x !== undefined) bc.postMessage({ chatMove: { dx: x - d.x, dy: y - d.y } });
};
head.addEventListener("pointerup", endDrag);
head.addEventListener("pointercancel", endDrag);
head.addEventListener("lostpointercapture", endDrag);
head.addEventListener("dblclick", (e) => { if (!e.target.closest("button")) bc.postMessage({ chatMove: { home: true } }); });
logEl.addEventListener("click", (e) => {
  const b = e.target.closest(".fav"), w = b && b.closest(".gw");
  if (!w) return;
  const on = toggleFav({ url: w.dataset.url, kind: w.dataset.kind });
  b.outerHTML = star(on);
  if (!picker.hidden && view === "saved") showSaved();
});

// ---------- GIF picker (GIPHY) ----------
// GIPHY's free key allows about 100 searches an hour for everyone together, so it only searches on Enter,
// and the trending list is kept for 10 minutes.
const TRENDING = "nimble-giphy-trending";
let view = "saved"; // "saved" | "trending" | "search"
const vSaved = document.getElementById("vsaved"), vTrend = document.getElementById("vtrend");
function setView(v) { view = v; vSaved.classList.toggle("on", v === "saved"); vTrend.classList.toggle("on", v === "trending"); }
function showPicker(open, words) {
  picker.hidden = !open;
  gifBtn.classList.toggle("on", open);
  if (!open) return;
  renderFoot();
  ginput.focus();
  if (words && giphyKey) { ginput.value = words; gsearch.requestSubmit(); return; } // searching right away skips the rest (saves a call)
  // open on your saved GIFs when you have some: they cost no searches
  if (readFavs().length || !giphyKey) showSaved(); else trending();
}
function showSaved() {
  setView("saved");
  const favs = readFavs();
  if (favs.length) { showResults(favs, true); return; }
  if (!giphyKey) { noKey(); return; }
  grid.innerHTML = `<div class="msg">No saved GIFs yet. Tap ☆ on any GIF, here or in the chat, to keep it here.</div>`;
}
vSaved.addEventListener("click", showSaved);
vTrend.addEventListener("click", () => { if (giphyKey) trending(); else noKey(); });
// GIF button: with words in the chat box it searches for them, otherwise it opens the picker
gifBtn.addEventListener("click", () => {
  const words = input.value.trim();
  if (words && !gifFrom(words)) { input.value = ""; searchFor(words); return; }
  showPicker(picker.hidden);
});
function searchFor(words) { showPicker(true, words); }
document.getElementById("pclose").addEventListener("click", () => showPicker(false));
function noKey() {
  grid.innerHTML = me.role === "GM"
    ? `<div class="msg">GIF search needs a free GIPHY key. Make one at <a href="https://developers.giphy.com/dashboard/" target="_blank" rel="noopener">developers.giphy.com</a> (create an app, choose API) and paste it below. Until then, anyone can paste a GIF link in the chat box.</div>`
    : `<div class="msg">GIF search isn't set up yet (the GM can turn it on). You can still paste a GIF link in the chat box.</div>`;
}
function renderFoot() {
  pfoot.innerHTML = (giphyKey ? `<span>Powered by GIPHY</span>` : "")
    + (me.role === "GM" ? `<input type="text" id="key" placeholder="GIPHY key" value="${esc(giphyKey)}"><button type="button" id="savekey">Save key</button>` : "");
  const save = pfoot.querySelector("#savekey");
  if (save) save.addEventListener("click", async () => {
    const k = pfoot.querySelector("#key").value.trim();
    await OBR.room.setMetadata({ [GIPHY_KEY]: k || undefined });
    giphyKey = k; renderFoot(); if (k) trending(); else noKey();
  });
}
function showResults(items, saved) {
  if (!items.length) { grid.innerHTML = `<div class="msg">No GIFs found.</div>`; return; }
  const favs = new Set(readFavs().map((f) => f.url));
  grid.innerHTML = items.map((g) => `<div class="tile" data-url="${esc(g.url)}" data-preview="${esc(g.preview)}" data-title="${esc(g.title)}" data-kind="${esc(g.kind || "img")}">`
    + `<img src="${esc(g.preview)}" alt="${esc(g.title)}" title="${esc(g.title)}" loading="lazy">${star(saved || favs.has(g.url))}</div>`).join("");
}
grid.addEventListener("click", (e) => {
  const tile = e.target.closest(".tile");
  if (!tile) return;
  const g = { url: tile.dataset.url, preview: tile.dataset.preview, title: tile.dataset.title, kind: tile.dataset.kind };
  const b = e.target.closest(".fav");
  if (b) {
    const on = toggleFav(g);
    if (view === "saved" && !on) { tile.remove(); if (!grid.querySelector(".tile")) showSaved(); }
    else b.outerHTML = star(on);
    render(); // the stars in the chat follow
    return;
  }
  send({ k: "gif", url: g.url, kind: g.kind === "video" ? "video" : "img" });
  showPicker(false);
});
async function giphy(path, params) {
  const q = new URLSearchParams({ api_key: giphyKey, limit: "24", rating: "pg-13", ...params });
  const r = await fetch(`https://api.giphy.com/v1/gifs/${path}?${q}`);
  if (r.status === 401 || r.status === 403) throw new Error("key");
  if (r.status === 429) throw new Error("busy");
  if (!r.ok) throw new Error("http");
  const j = await r.json();
  return (j.data || []).map((g) => ({
    title: g.title || "GIF",
    preview: (g.images.fixed_width_small && (g.images.fixed_width_small.webp || g.images.fixed_width_small.url)) || g.images.fixed_height.url,
    url: g.images.fixed_height.webp || g.images.fixed_height.url,
  }));
}
function oops(err) {
  grid.innerHTML = `<div class="msg">${err.message === "key" ? "The GIPHY key doesn't work. The GM can check it below." : err.message === "busy" ? "Too many GIF searches this hour (GIPHY's free limit). Try again in a bit, or paste a link." : "Couldn't reach GIPHY right now."}</div>`;
}
async function trending() {
  try {
    const c = JSON.parse(sessionStorage.getItem(TRENDING) || "null");
    if (c && Date.now() - c.at < 600000) { setView("trending"); showResults(c.items); return; }
  } catch (_) {}
  setView("trending");
  grid.innerHTML = `<div class="msg">Loading…</div>`;
  try {
    const items = await giphy("trending", {});
    try { sessionStorage.setItem(TRENDING, JSON.stringify({ at: Date.now(), items })); } catch (_) {}
    showResults(items);
  } catch (err) { oops(err); }
}
gsearch.addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = ginput.value.trim();
  if (!giphyKey) return;
  if (!q) { trending(); return; }
  setView("search");
  grid.innerHTML = `<div class="msg">Searching…</div>`;
  try { showResults(await giphy("search", { q })); } catch (err) { oops(err); }
});
ginput.addEventListener("keydown", (e) => { if (e.key === "Escape") showPicker(false); });

OBR.onReady(async () => {
  me = { id: await OBR.player.getId(), role: await OBR.player.getRole() };
  LOG = chatLogKey(OBR.room.id);
  const md = await OBR.room.getMetadata();
  giphyKey = md[GIPHY_KEY] || "";
  OBR.room.onMetadataChange((m) => { const k = m[GIPHY_KEY] || ""; if (k !== giphyKey) { giphyKey = k; if (!picker.hidden) showPicker(true); } });
  OBR.player.onChange((p) => { if (p.role !== me.role) { me.role = p.role; if (!picker.hidden) renderFoot(); } });
  bc.onmessage = (e) => { if (e.data && e.data.log) render(); };
  window.addEventListener("storage", (e) => { if (e.key === LOG) render(); });
  render();
  input.focus();
});
