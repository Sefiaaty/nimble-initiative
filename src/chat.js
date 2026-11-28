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
const hhmm = (t) => { const d = new Date(t); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`; };

function render() {
  const list = readLog();
  const atBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
  logEl.innerHTML = list.length ? list.map((m) => {
    const who = `<b>${esc(m.name || "Someone")}</b>`;
    const body = m.url
      ? (m.kind === "video" ? `<video class="g" src="${esc(m.url)}" autoplay loop muted playsinline></video>` : `<img class="g" src="${esc(m.url)}" alt="GIF" loading="lazy">`)
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

// ---------- GIF picker (GIPHY) ----------
// GIPHY's free key allows about 100 searches an hour for everyone together, so it only searches on Enter,
// and the trending list is kept for 10 minutes.
const TRENDING = "nimble-giphy-trending";
function showPicker(open, words) {
  picker.hidden = !open;
  gifBtn.classList.toggle("on", open);
  if (!open) return;
  renderFoot();
  if (!giphyKey) { noKey(); return; }
  ginput.focus();
  if (words) { ginput.value = words; gsearch.requestSubmit(); } else trending(); // searching right away skips trending (saves a call)
}
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
function showResults(items) {
  if (!items.length) { grid.innerHTML = `<div class="msg">No GIFs found.</div>`; return; }
  grid.innerHTML = items.map((g) => `<img src="${esc(g.preview)}" data-url="${esc(g.url)}" alt="${esc(g.title)}" title="${esc(g.title)}" loading="lazy">`).join("");
}
grid.addEventListener("click", (e) => {
  const img = e.target.closest("img[data-url]");
  if (!img) return;
  send({ k: "gif", url: img.dataset.url, kind: "img" });
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
    if (c && Date.now() - c.at < 600000) { showResults(c.items); return; }
  } catch (_) {}
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
