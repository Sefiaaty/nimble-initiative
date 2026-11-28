// The GM's little bird in the corner: its speech bubble pops up whenever the GM talks (everyone sees it).
// The GM can also type a line for it to say: everyone sees the words in its bubble, and a line ending in ! is shouted.
import OBR from "@owlbear-rodeo/sdk";
import { TALK_CH, BIRD_SAY_CH } from "./common.js";

const micBtn = document.getElementById("mic");
const sayBtn = document.getElementById("saybtn");
const sayEl = document.getElementById("say");
const sayText = sayEl.querySelector("span");
const form = document.getElementById("sayform");
const input = form.querySelector("input");
const PREF = "nimble-gm-bird-mic";
let me = { id: null, role: "PLAYER" };
let gmIds = new Set();
let talkingAt = 0;
let helper = null, micOn = false, micLost = false;
let saying = null; // { text, until }

function update() {
  const now = Date.now();
  const words = saying && now < saying.until;
  if (saying && !words) { saying = null; sayText.textContent = ""; }
  document.body.classList.toggle("talk", now - talkingAt < 2500 || !!words);
  document.body.classList.toggle("words", !!words);
  document.body.classList.toggle("gm", me.role === "GM");
  micBtn.classList.toggle("on", micOn);
  micBtn.classList.toggle("lost", !micOn && micLost);
}
// a typed line: shown in the bubble for a while, longer for longer lines (like the party bar's speech bubbles)
function showSay(text) {
  const t = String(text || "").slice(0, 120);
  if (!t) return;
  saying = { text: t, until: Date.now() + Math.min(16000, 5000 + t.length * 60) };
  sayText.textContent = t;
  sayEl.classList.toggle("shout", /!\s*$/.test(t));
  sayEl.classList.remove("pop"); void sayEl.offsetWidth; sayEl.classList.add("pop");
  update();
}
async function refreshGms() {
  const ps = await OBR.party.getPlayers().catch(() => []);
  gmIds = new Set(ps.filter((p) => p.role === "GM").map((p) => p.id));
  if (me.role === "GM" && me.id) gmIds.add(me.id);
}
function setPref(v) { try { localStorage.setItem(PREF, v ? "1" : "0"); } catch (_) {} }

// The browser blocks the mic inside Owlbear, so (like the party bar) a small helper window listens for us.
function openHelper(fromClick) {
  const url = new URL("mic.html", import.meta.url).href;
  let w = null;
  try { w = window.open("", "nimble-mic", "width=400,height=340"); } catch (_) {}
  if (!w) { if (fromClick) OBR.notification.show("Allow pop-ups for Owlbear so the mic helper can open", "WARNING"); return false; }
  let fresh = false;
  try { fresh = w.location.href === "about:blank"; } catch (_) { fresh = false; }
  if (fresh) w.location.href = url; else w.postMessage({ type: "nimble-hello" }, location.origin);
  helper = w; micOn = true; micLost = false; setPref(true); update();
  return true;
}
function micOff() {
  micOn = false; micLost = false; setPref(false);
  try { if (helper && !helper.closed) helper.close(); } catch (_) {}
  helper = null;
  OBR.broadcast.sendMessage(TALK_CH, { pid: me.id, on: false }, { destination: "ALL" }).catch(() => {});
  update();
}
micBtn.addEventListener("click", () => (micOn ? micOff() : openHelper(true)));
// typing a line for the bird
sayBtn.addEventListener("click", () => {
  const open = !document.body.classList.contains("typing");
  document.body.classList.toggle("typing", open);
  if (open) { input.value = ""; input.focus(); }
});
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  document.body.classList.remove("typing");
  if (text && me.role === "GM") OBR.broadcast.sendMessage(BIRD_SAY_CH, { text: text.slice(0, 120) }, { destination: "ALL" }).catch(() => {});
});
input.addEventListener("keydown", (e) => { if (e.key === "Escape") document.body.classList.remove("typing"); });
window.addEventListener("message", (e) => {
  if (e.origin !== location.origin || !e.data || e.data.type !== "nimble-talk" || me.role !== "GM") return;
  if (!micOn) { micOn = true; update(); }
  OBR.broadcast.sendMessage(TALK_CH, { pid: me.id, on: !!e.data.on }, { destination: "ALL" }).catch(() => {});
});
setInterval(() => { if (micOn && helper && helper.closed) { helper = null; micOff(); } update(); }, 500);

OBR.onReady(async () => {
  me.id = await OBR.player.getId();
  me.role = await OBR.player.getRole();
  await refreshGms();
  OBR.party.onChange(refreshGms);
  OBR.player.onChange(async (p) => { me.role = p.role; await refreshGms(); update(); });
  OBR.broadcast.onMessage(BIRD_SAY_CH, (ev) => showSay((ev.data || {}).text));
  OBR.broadcast.onMessage(TALK_CH, (ev) => {
    const { pid, on } = ev.data || {};
    if (!pid || !gmIds.has(pid)) return;
    talkingAt = on ? Date.now() : 0;
    update();
  });
  // reconnect to an open helper window after a reload
  let pref = false;
  try { pref = localStorage.getItem(PREF) === "1"; } catch (_) {}
  // if the browser won't let us reconnect without a click, light up the mic button so it is one click
  if (me.role === "GM" && pref && !openHelper(false)) { micLost = true; }
  update();
});
