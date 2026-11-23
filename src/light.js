// Settings for the selected light(s), shown inside the right-click menu (GM only).
import OBR from "@owlbear-rodeo/sdk";
import { LIGHT_KEY, LIGHT_PRESETS, CARRY_KINDS, CARRY_LAST_KEY, lightPreset, lightOf, WATER_KEY, WATER_STYLES, waterOf } from "./common.js";

const app = document.getElementById("app");
const carry = new URLSearchParams(location.search).has("carry"); // a token carrying a light, not a GM marker
const kinds = carry ? LIGHT_PRESETS.filter((p) => CARRY_KINDS.includes(p.k)) : LIGHT_PRESETS;
let ids = [];
let cur = null;
const icon = (k) => new URL(`lights/${k}.svg`, import.meta.url).href;
const fmt = { r: (v) => `${v} sq`, power: (v) => `${Math.round(v * 100)}%`, flame: (v) => `${Math.round(v * 100)}%`, pulse: (v) => `${Math.round(v * 100)}%` };

const kindRow = () => `<div class="kinds" style="grid-template-columns:repeat(${carry ? kinds.length + 1 : 5},1fr)">${kinds.map((x) =>
  `<button data-kind="${x.k}" class="${cur && x.k === cur.k ? "on" : ""}" title="${x.name}"><i style="--ic:url('${icon(x.k)}')"></i></button>`).join("")}${
  carry ? `<button data-kind="" class="${cur ? "" : "on"}" title="No light"><span>✕</span></button>` : ""}</div>`;
function render() {
  if (!ids.length) { app.innerHTML = `<div class="top"><b>Nothing selected</b></div>`; return; }
  if (!cur) { app.innerHTML = `${kindRow()}<div class="top"><b>Pick a light to carry</b></div><div class="hint">It moves with the token, and everyone sees it glow.</div>`; return; }
  const p = lightPreset(cur.k);
  const slider = (key, label, min, max, step) =>
    `<div class="row"><label>${label}</label><input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${cur[key]}"><output data-o="${key}">${fmt[key](cur[key])}</output></div>`;
  app.innerHTML = `
    ${kindRow()}
    <div class="top"><b>${p.name}${ids.length > 1 ? ` (${ids.length} lights)` : ""}</b>
      <input type="color" data-k="color" value="${cur.color}" title="Colour">
      <label title="Turn the light off without deleting it"><input type="checkbox" data-k="on" ${cur.on ? "checked" : ""}>Lit</label></div>
    ${slider("r", "Size", 0.5, 15, 0.5)}
    ${slider("power", "Brightness", 0, 2.5, 0.05)}
    ${slider("flame", "Flicker", 0, 1, 0.05)}
    ${slider("pulse", "Pulse", 0, 1, 0.05)}`;
}

let pending = null, timer = 0;
function save(patch, now) {
  pending = { ...(pending || {}), ...patch };
  clearTimeout(timer);
  const go = async () => {
    const pt = pending; pending = null;
    await OBR.scene.items.updateItems(ids, (items) => {
      for (const it of items) {
        if (pt.k === "") { delete it.metadata[LIGHT_KEY]; continue; } // stop carrying a light
        const m = { ...(it.metadata[LIGHT_KEY] || {}) };
        if (pt.k) { const marker = m.marker; for (const key of Object.keys(m)) delete m[key]; m.k = pt.k; if (marker) m.marker = true; if (!carry) it.name = lightPreset(pt.k).name; }
        for (const [key, v] of Object.entries(pt)) if (key !== "k") m[key] = v;
        it.metadata[LIGHT_KEY] = m;
        const L = lightOf(it);
        if (it.style && !carry) it.style.fillColor = L.color;
      }
    });
  };
  if (now) go(); else timer = setTimeout(go, 70);
}

app.addEventListener("click", (e) => {
  const b = e.target.closest("[data-kind]");
  if (!b) return;
  if (!b.dataset.kind) { cur = null; render(); save({ k: "" }, true); return; }
  const p = lightPreset(b.dataset.kind);
  if (carry) try { localStorage.setItem(CARRY_LAST_KEY, p.k); } catch (_) {}
  cur = { k: p.k, color: p.color, r: p.r, power: p.power, flame: p.flame, pulse: p.pulse, on: cur ? cur.on : true };
  render();
  save({ k: p.k, on: cur.on }, true);
});
app.addEventListener("input", (e) => {
  const el = e.target, key = el.dataset.k;
  if (!key || !cur) return;
  if (key === "on") { cur.on = el.checked; save({ on: el.checked }, true); return; }
  if (key === "color") { cur.color = el.value; save({ color: el.value }); return; }
  const v = Number(el.value);
  cur[key] = v;
  const o = app.querySelector(`[data-o="${key}"]`);
  if (o) o.textContent = fmt[key](v);
  save({ [key]: v });
});

// ---------- water mode: the right-click menu on a shape or drawing ----------
const waterMode = new URLSearchParams(location.search).has("water");
let wid = null, wcur = null, wtimer = 0;
function renderWater() {
  if (!wid) { app.innerHTML = `<div class="top"><b>Select one shape</b></div>`; return; }
  const btns = WATER_STYLES.map((x) => `<button class="wbtn ${wcur && wcur.k === x.k ? "on" : ""}" data-wk="${x.k}">${x.name.replace(/ \(.*\)/, "")}</button>`).join("");
  if (!wcur) { app.innerHTML = `<div class="wrow">${btns}</div><div class="hint">Make this shape water. Players see the water move but not the shape.</div>`; return; }
  const sl = (key, label) => `<div class="row"><label>${label}</label><input type="range" data-wv="${key}" min="0" max="3" step="0.05" value="${wcur[key]}"><output data-o="${key}">${Math.round(wcur[key] * 100)}%</output></div>`;
  app.innerHTML = `<div class="wrow">${btns}</div>${sl("amp", "Strength")}${sl("speed", "Speed")}
    <div class="top">${wcur.k === "river" ? `<label><input type="checkbox" data-wv="reverse" ${wcur.reverse ? "checked" : ""}>Flow the other way</label>` : "<span></span>"}<b></b><button class="wbtn" data-wk="">Not water</button></div>`;
}
async function saveWater(patch, mark) {
  await OBR.scene.items.updateItems([wid], (items) => {
    for (const it of items) {
      if (patch === null) { // stop being water: show the shape again
        delete it.metadata[WATER_KEY]; it.visible = true;
        if (it.style) { it.style.fillOpacity = 0.25; it.style.strokeOpacity = 1; }
        continue;
      }
      it.metadata[WATER_KEY] = { ...(it.metadata[WATER_KEY] || {}), ...patch };
      if (mark) { // hidden from players, a faint blue outline for the GM
        it.visible = false;
        if (it.style) { it.style.fillColor = "#4fa3ff"; it.style.fillOpacity = 0.12; it.style.strokeColor = "#9fd0ff"; it.style.strokeOpacity = 0.8; }
      }
    }
  });
}
if (waterMode) {
  app.addEventListener("click", (e) => {
    const b = e.target.closest("[data-wk]");
    if (!b || !wid) return;
    e.stopImmediatePropagation();
    if (!b.dataset.wk) { wcur = null; renderWater(); saveWater(null); return; }
    const first = !wcur;
    wcur = { ...(wcur || { amp: 1, speed: 1, reverse: false }), k: b.dataset.wk };
    renderWater();
    saveWater({ k: wcur.k }, first);
  }, true);
  app.addEventListener("input", (e) => {
    const el = e.target, key = el.dataset.wv;
    if (!key || !wcur) return;
    e.stopImmediatePropagation();
    const v = el.type === "checkbox" ? el.checked : Number(el.value);
    wcur[key] = v;
    const o = app.querySelector(`[data-o="${key}"]`); if (o) o.textContent = `${Math.round(v * 100)}%`;
    clearTimeout(wtimer); wtimer = setTimeout(() => saveWater({ [key]: v }), 70);
  }, true);
}

OBR.onReady(async () => {
  try { const t = await OBR.theme.getTheme(); document.documentElement.classList.toggle("light", t.mode === "LIGHT"); } catch (_) {}
  const sel = (await OBR.player.getSelection()) || [];
  const items = await OBR.scene.items.getItems(sel);
  if (waterMode) {
    const it = items.find((i) => i.type === "SHAPE" || i.type === "CURVE");
    wid = it ? it.id : null; wcur = it ? waterOf(it) : null;
    renderWater(); return;
  }
  const lights = items.filter((i) => lightOf(i));
  if (carry) { ids = items.map((i) => i.id); cur = lights.length ? lightOf(lights[0]) : null; }
  else { ids = lights.map((i) => i.id); cur = lights.length ? lightOf(lights[0]) : null; }
  render();
});
