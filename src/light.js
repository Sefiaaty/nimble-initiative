// Settings for the selected light(s), shown inside the right-click menu (GM only).
import OBR from "@owlbear-rodeo/sdk";
import { LIGHT_KEY, LIGHT_PRESETS, lightPreset, lightOf } from "./common.js";

const app = document.getElementById("app");
let ids = [];
let cur = null;
const icon = (k) => new URL(`lights/${k}.svg`, import.meta.url).href;
const fmt = { r: (v) => `${v} sq`, power: (v) => `${Math.round(v * 100)}%`, flame: (v) => `${Math.round(v * 100)}%`, pulse: (v) => `${Math.round(v * 100)}%` };

function render() {
  if (!cur) { app.innerHTML = `<div class="top"><b>No light selected</b></div>`; return; }
  const p = lightPreset(cur.k);
  const slider = (key, label, min, max, step) =>
    `<div class="row"><label>${label}</label><input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${cur[key]}"><output data-o="${key}">${fmt[key](cur[key])}</output></div>`;
  app.innerHTML = `
    <div class="kinds">${LIGHT_PRESETS.map((x) => `<button data-kind="${x.k}" class="${x.k === cur.k ? "on" : ""}" title="${x.name}"><i style="--ic:url('${icon(x.k)}')"></i></button>`).join("")}</div>
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
        const m = { ...(it.metadata[LIGHT_KEY] || {}) };
        if (pt.k) { for (const key of Object.keys(m)) delete m[key]; m.k = pt.k; it.name = lightPreset(pt.k).name; }
        for (const [key, v] of Object.entries(pt)) if (key !== "k") m[key] = v;
        it.metadata[LIGHT_KEY] = m;
        const L = lightOf(it);
        if (it.style) it.style.fillColor = L.color;
      }
    });
  };
  if (now) go(); else timer = setTimeout(go, 70);
}

app.addEventListener("click", (e) => {
  const b = e.target.closest("[data-kind]");
  if (!b) return;
  const p = lightPreset(b.dataset.kind);
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

OBR.onReady(async () => {
  try { const t = await OBR.theme.getTheme(); document.documentElement.classList.toggle("light", t.mode === "LIGHT"); } catch (_) {}
  const sel = (await OBR.player.getSelection()) || [];
  const items = await OBR.scene.items.getItems(sel);
  const lights = items.filter((i) => lightOf(i));
  ids = lights.map((i) => i.id);
  cur = lights.length ? lightOf(lights[0]) : null;
  render();
});
