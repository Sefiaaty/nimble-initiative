// Scene backdrop: a picture or looping video over the whole screen for everyone, with a caption.
// mode=full is the backdrop itself; mode=pill is the GM's small "scene is live" bar while peeking.
import OBR from "@owlbear-rodeo/sdk";
import { ID, SCENE_KEY, PEEK_KEY, SCENE_CH, sceneOf, isVideo } from "./common.js";

const qs = new URLSearchParams(location.search);
const mode = qs.get("mode") || "full";
const part = qs.get("part") || "main";   // main, right, bottom or corner slice of the backdrop
const ox = Number(qs.get("x")) || 0, oy = Number(qs.get("y")) || 0;
const fullW = Number(qs.get("vw")) || 0, fullH = Number(qs.get("vh")) || 0;
const stage = document.getElementById("stage");
const cap = document.getElementById("cap");
const gmBox = document.getElementById("gm");
const bc = new BroadcastChannel(SCENE_CH);
let role = "PLAYER";
let shown = { url: "", title: "", sub: "" };

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function setPeek(v) {
  try { localStorage.setItem(PEEK_KEY, v ? "1" : "0"); } catch (_) {}
  bc.postMessage({ peek: v });
}
async function endScene() {
  const md = await OBR.room.getMetadata();
  const sc = md[SCENE_KEY] || {};
  setPeek(false);
  await OBR.room.setMetadata({ [SCENE_KEY]: { ...sc, on: false, at: Date.now() } });
}

function showMedia(sc) {
  if (sc.url === shown.url) return;
  shown.url = sc.url;
  const el = isVideo(sc.url, sc.kind) ? document.createElement("video") : document.createElement("img");
  el.className = "layer";
  if (el.tagName === "VIDEO") { el.autoplay = true; el.loop = true; el.muted = true; el.playsInline = true; }
  const reveal = () => {
    el.classList.add("in");
    // drop the old picture once the new one has faded in
    setTimeout(() => { for (const o of [...stage.children]) if (o !== el) o.remove(); }, 1000);
  };
  el.addEventListener(el.tagName === "VIDEO" ? "loadeddata" : "load", reveal, { once: true });
  el.addEventListener("error", reveal, { once: true });
  el.src = sc.url;
  stage.appendChild(el);
}
function showCaption(sc) {
  if (sc.title === shown.title && sc.sub === shown.sub) return;
  shown.title = sc.title; shown.sub = sc.sub;
  cap.classList.remove("in");
  setTimeout(() => {
    cap.querySelector(".t").textContent = sc.title;
    cap.querySelector(".s").textContent = sc.sub;
    if (sc.title || sc.sub) requestAnimationFrame(() => cap.classList.add("in"));
  }, shown.first ? 350 : 0);
  shown.first = true;
}

function renderFull(md) {
  const sc = sceneOf(md);
  document.body.classList.toggle("out", !sc.on);
  if (!sc.on) return;
  showMedia(sc);
  showCaption(sc);
}
function renderGm() {
  if (role !== "GM" || part !== "main") { gmBox.innerHTML = ""; return; }
  gmBox.innerHTML = `<button data-act="peek" title="Hide the scene for you only, so you can work on the map">👁 Peek</button><button class="end" data-act="end" title="Fade the scene out for everyone">End scene</button>`;
}
function renderPill(md) {
  const sc = sceneOf(md);
  document.body.innerHTML = `<div class="pill"><span>Players see <b>${esc(sc.title || "the scene")}</b></span><button data-act="back">Back to scene</button><button class="end" data-act="end">End scene</button></div>`;
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]");
  if (!b || role !== "GM") return;
  if (b.dataset.act === "peek") setPeek(true);
  if (b.dataset.act === "back") setPeek(false);
  if (b.dataset.act === "end") await endScene();
});

// every slice lays the picture out at full window size, shifted so its own piece shows
if (mode === "full" && fullW && fullH) {
  for (const el of [stage, cap]) Object.assign(el.style, { left: -ox + "px", top: -oy + "px", width: fullW + "px", height: fullH + "px", right: "auto", bottom: "auto" });
  cap.style.top = (-oy + fullH * 0.22) + "px"; cap.style.height = "auto";
}
if (part !== "main") { cap.style.display = "none"; gmBox.style.display = "none"; }

OBR.onReady(async () => {
  role = await OBR.player.getRole();
  document.body.classList.add(mode === "pill" ? "pill" : "full");
  const md = await OBR.room.getMetadata();
  if (mode === "pill") { renderPill(md); OBR.room.onMetadataChange(renderPill); return; }
  // if the backdrop gets closed some other way (Escape), the background reopens it while the scene is on
  if (part === "main") window.addEventListener("pagehide", () => bc.postMessage({ sceneClosed: true }));
  renderGm();
  renderFull(md);
  OBR.room.onMetadataChange(renderFull);
  OBR.player.onChange((p) => { if (p.role !== role) { role = p.role; renderGm(); } });
});
