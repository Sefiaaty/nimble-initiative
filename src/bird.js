// The GM's little bird in the corner: its speech bubble pops up whenever the GM talks (everyone sees it).
import OBR from "@owlbear-rodeo/sdk";
import { TALK_CH } from "./common.js";

const micBtn = document.getElementById("mic");
const PREF = "nimble-gm-bird-mic";
let me = { id: null, role: "PLAYER" };
let gmIds = new Set();
let talkingAt = 0;
let helper = null, micOn = false;

function update() {
  document.body.classList.toggle("talk", Date.now() - talkingAt < 2500);
  document.body.classList.toggle("gm", me.role === "GM");
  micBtn.classList.toggle("on", micOn);
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
  if (!w) { if (fromClick) OBR.notification.show("Allow pop-ups for Owlbear so the mic helper can open", "WARNING"); return; }
  let fresh = false;
  try { fresh = w.location.href === "about:blank"; } catch (_) { fresh = false; }
  if (fresh) w.location.href = url; else w.postMessage({ type: "nimble-hello" }, location.origin);
  helper = w; micOn = true; setPref(true); update();
}
function micOff() {
  micOn = false; setPref(false);
  try { if (helper && !helper.closed) helper.close(); } catch (_) {}
  helper = null;
  OBR.broadcast.sendMessage(TALK_CH, { pid: me.id, on: false }, { destination: "ALL" }).catch(() => {});
  update();
}
micBtn.addEventListener("click", () => (micOn ? micOff() : openHelper(true)));
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
  OBR.broadcast.onMessage(TALK_CH, (ev) => {
    const { pid, on } = ev.data || {};
    if (!pid || !gmIds.has(pid)) return;
    talkingAt = on ? Date.now() : 0;
    update();
  });
  // reconnect to an open helper window after a reload
  let pref = false;
  try { pref = localStorage.getItem(PREF) === "1"; } catch (_) {}
  if (me.role === "GM" && pref) openHelper(false);
  update();
});
