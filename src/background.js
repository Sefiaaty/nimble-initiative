// Background script: context menus, cleanup, auto movement and GM-only minion group links.
import OBR, { buildCurve, buildEffect, buildImage, buildLabel, buildShape } from "@owlbear-rodeo/sdk";
import {
  ID, HERO_FLAG, HEROES_KEY, MON_KEY, OPEN_KEY, GROUP_COLORS, STATE_KEY, partyOf, partyList, barLayout, sceneOf, PEEK_KEY, SCENE_CH, BAR_HIDDEN_KEY, condDef, COND_ORDER, TOD_KEY, todOf, todLook, LIGHT_KEY, LIGHT_TOOL, LIGHT_MAX, LIGHTS_OFF_KEY, isLightMarker, CARRY_KINDS, CARRY_LAST_KEY, LIGHT_PRESETS, lightPreset, lightOf, hexRgb,
  getHeroImages, getState, setState, updateState, addTokens, maxMoved,
} from "./common.js";

const CHAR = { key: "layer", value: "CHARACTER" };
const LINK_PREFIX = `${ID}-grp-`;

OBR.onReady(async () => {
  // Shift+F: turn the selected token(s) to face the other way (mirror left/right)
  await OBR.contextMenu.create({
    id: `${ID}/flip`,
    shortcut: "Shift+F",
    icons: [{ icon: new URL("flip.svg", import.meta.url).href, label: "Face the other way", filter: { every: [CHAR] } }],
    async onClick(ctx) {
      await OBR.scene.items.updateItems(ctx.items.filter((i) => i.layer === "CHARACTER").map((i) => i.id), (items) => {
        for (const it of items) it.scale = { x: -(it.scale?.x || 1), y: it.scale?.y || 1 };
      });
    },
  });

  await OBR.contextMenu.create({
    id: `${ID}/add`,
    icons: [{ icon: new URL("add.svg", import.meta.url).href, label: "Add to Nimble Initiative", filter: { every: [CHAR], roles: ["GM"] } }],
    async onClick(ctx) {
      const n = await addTokens(ctx.items);
      if (n) OBR.notification.show("Added to Nimble Initiative");
    },
  });

  await OBR.contextMenu.create({
    id: `${ID}/minions`,
    icons: [{ icon: new URL("minions.svg", import.meta.url).href, label: "Add as Minion Group", filter: { min: 2, every: [CHAR], roles: ["GM"] } }],
    async onClick(ctx) { await addTokens(ctx.items, { forceGroup: true }); },
  });

  // Link a nimble.nexus stat block: opens the tracker on the Library tab for the selected tokens.
  await OBR.contextMenu.create({
    id: `${ID}/link`,
    icons: [{ icon: new URL("link.svg", import.meta.url).href, label: "Link Nimble Monster", filter: { every: [CHAR], roles: ["GM"] } }],
    async onClick(ctx) {
      try { localStorage.setItem(OPEN_KEY, JSON.stringify({ tab: "library", items: ctx.items.map((i) => i.id), t: Date.now() })); } catch (_) {}
      await OBR.action.open();
    },
  });

  await OBR.contextMenu.create({
    id: `${ID}/hero`,
    icons: [
      { icon: new URL("hero.svg", import.meta.url).href, label: "Unmark as Hero", filter: { every: [CHAR, { key: ["metadata", HERO_FLAG], value: true }], roles: ["GM"] } },
      { icon: new URL("hero.svg", import.meta.url).href, label: "Mark as Hero", filter: { every: [CHAR], roles: ["GM"] } },
    ],
    async onClick(ctx) {
      const makeHero = !ctx.items.every((i) => i.metadata[HERO_FLAG] === true);
      await OBR.scene.items.updateItems(ctx.items.map((i) => i.id), (drafts) => {
        for (const d of drafts) {
          if (makeHero) d.metadata[HERO_FLAG] = true;
          else delete d.metadata[HERO_FLAG];
        }
      });
      const urls = ctx.items.map((i) => i.image?.url).filter(Boolean);
      let heroes = await getHeroImages();
      heroes = makeHero ? [...new Set([...heroes, ...urls])] : heroes.filter((u) => !urls.includes(u));
      await OBR.room.setMetadata({ [HEROES_KEY]: heroes });
      await updateState((s) => {
        for (const e of s.entries) {
          if (e.kind !== "hero" && e.kind !== "monster") continue;
          if (ctx.items.some((i) => e.items.includes(i.id))) e.kind = makeHero ? "hero" : "monster";
        }
      });
      OBR.notification.show(makeHero ? "Marked as hero" : "No longer a hero");
    },
  });

  // ---- token geometry ----
  let dpi = 150;
  const center = (it) => {
    if (!it.image || !it.grid) return { x: it.position.x, y: it.position.y };
    const k = (dpi / (it.grid.dpi || dpi));
    const ox = (it.image.width / 2 - it.grid.offset.x) * k * (it.scale?.x || 1);
    const oy = (it.image.height / 2 - it.grid.offset.y) * k * (it.scale?.y || 1);
    return { x: it.position.x + ox, y: it.position.y + oy };
  };
  const radius = (it) => {
    if (!it.image || !it.grid) return dpi / 2;
    return (it.image.width * (dpi / (it.grid.dpi || dpi)) * Math.abs(it.scale?.x || 1)) / 2;
  };
  const circle = (r, n = 40) => Array.from({ length: n + 1 }, (_, i) => ({ x: Math.cos((i / n) * 2 * Math.PI) * r, y: Math.sin((i / n) * 2 * Math.PI) * r }));


  // ---- whose turn it is: a gold ring under the acting token(s), drawn for everyone (local items) ----
  const ACT = `${ID}-turn-`;
  let actBusy = Promise.resolve();
  async function drawActive() {
    if (!(await OBR.scene.isReady())) return;
    const md = await OBR.scene.getMetadata();
    const s = md[STATE_KEY];
    const e = s && s.started && Array.isArray(s.entries) ? s.entries.find((x) => x.id === s.active) : null;
    const ids = e ? e.items : [];
    const want = new Set(ids.flatMap((id) => [`${ACT}glow-${id}`, `${ACT}ring-${id}`]));
    const have = await OBR.scene.local.getItems((i) => i.id.startsWith(ACT));
    const del = have.filter((i) => !want.has(i.id)).map((i) => i.id);
    if (del.length) await OBR.scene.local.deleteItems(del);
    const haveIds = new Set(have.map((i) => i.id));
    const missing = ids.filter((id) => !haveIds.has(`${ACT}ring-${id}`));
    if (!missing.length) return;
    const toks = await OBR.scene.items.getItems(missing);
    const add = [];
    for (const t of toks) {
      const r = radius(t);
      const base = (id, rr, w, op) => buildCurve().id(id).points(circle(rr, 56)).position(center(t)).strokeColor("#ffcf4a")
        .strokeOpacity(op).strokeWidth(w).fillOpacity(0).tension(0).closed(true).layer("DRAWING").locked(true)
        .disableHit(true).name("Current turn").attachedTo(t.id).disableAttachmentBehavior(["COPY"]).build();
      add.push(base(`${ACT}glow-${t.id}`, r * 1.13, Math.max(10, r * 0.26), 0.3));
      add.push(base(`${ACT}ring-${t.id}`, r * 1.06, Math.max(5, r * 0.09), 1));
    }
    if (add.length) await OBR.scene.local.addItems(add);
  }
  const runActive = () => { actBusy = actBusy.then(drawActive).catch((err) => console.warn("[nimble]", err)); };
  OBR.scene.onMetadataChange(runActive);
  OBR.scene.onReadyChange(async (ready) => { if (ready) { try { dpi = await OBR.scene.grid.getDpi(); } catch (_) {} } runActive(); });
  (async () => { try { if (await OBR.scene.isReady()) dpi = await OBR.scene.grid.getDpi(); } catch (_) {} runActive(); })();

  // ---- time of day and lights: one post-process effect over the whole view, for everyone ----
  // It reads each pixel of the scene (map, tokens, fog), grades it for the time of day, then adds back
  // light around each lamp. Lights show softly by day and strongly at night.
  const TOD_FX = `${ID}-tod`, TOD_OLD = [`${ID}-tod-tint`, `${ID}-tod-sat`];
  const lookSksl = (n) => {
    let u = "", sum = "";
    for (let i = 0; i < n; i++) { u += `uniform vec3 lp${i};\nuniform vec3 lc${i};\nuniform vec3 lf${i};\n`; sum += `  L += lamp(coord, lp${i}, lc${i}, lf${i}, t);\n`; }
    return `uniform shader scene;
uniform mat3 view;
uniform float time;
uniform vec3 tint;
uniform float amount;
uniform float glow;
${u}
vec3 lamp(vec2 w, vec3 p, vec3 c, vec3 f, float t) {
  float s = f.z;
  float flick = 1.0 - f.x * (0.10 + 0.08 * sin(t * 9.1 + s) + 0.06 * sin(t * 15.7 + s * 1.7) + 0.05 * sin(t * 23.3 + s * 2.9) + 0.04 * sin(t * 4.3 + s * 3.1));
  float pulse = 1.0 - f.y * (0.5 + 0.5 * sin(t * 1.3 + s));
  float r = p.z * (1.0 + f.x * 0.035 * sin(t * 7.3 + s * 1.3));
  float a = clamp(1.0 - distance(w, p.xy) / r, 0.0, 1.0);
  a = a * a * (3.0 - 2.0 * a);
  return c * (a * a) * flick * pulse;
}
half4 main(float2 coord) {
  vec2 uv = (vec3(coord, 1) * view).xy;
  half4 c = scene.eval(uv);
  float t = mod(time, 3600.0);
  vec3 g = vec3(c.rgb);
  float l = dot(g, vec3(0.299, 0.587, 0.114));
  g = mix(g, vec3(l), amount);
  vec3 L = vec3(0.0);
${sum}  L *= glow;
  vec3 o = g * (tint + L) + L * 0.08 * float(c.a);
  return half4(half3(o), c.a);
}`;
  };
  let lookSig = "", lookN = -1, toolOff = null;
  // the toolbar button shows "all off" or "all on" depending on this map
  const syncLightsTool = (off) => { if (off === toolOff) return; toolOff = off; OBR.tool.setMetadata(LIGHT_TOOL, { allOff: off }).catch(() => {}); };
  async function drawLook() {
    if (!(await OBR.scene.isReady())) return;
    const smd = await OBR.scene.getMetadata();
    const tod = todOf(smd);
    const allOff = !!smd[LIGHTS_OFF_KEY];
    syncLightsTool(allOff);
    const gmView = (await OBR.player.getRole()) === "GM";
    // markers are always hidden on purpose; a hidden token's light stays hidden from players
    const marks = allOff ? [] : (await OBR.scene.items.getItems((i) => !!(i.metadata && i.metadata[LIGHT_KEY])))
      .filter((i) => gmView || i.visible || isLightMarker(i)).slice(0, LIGHT_MAX);
    const lamps = [];
    const gdpi = dpi || 150;
    for (const m of marks) {
      const L = lightOf(m);
      if (!L || !L.on) continue;
      const [r, g, b] = hexRgb(L.color);
      const seed = (parseInt(m.id.replace(/[^0-9a-f]/gi, "").slice(-6), 16) || 7) % 1000 / 31.7;
      lamps.push({ p: { x: m.position.x, y: m.position.y, z: L.r * gdpi }, c: { x: r * L.power, y: g * L.power, z: b * L.power }, f: { x: L.flame, y: L.pulse, z: seed } });
    }
    const look = tod.on ? todLook(tod.t) : { tint: [1, 1, 1], desat: 0, glow: 0.55 };
    const want = tod.on || lamps.length > 0;
    const sig = JSON.stringify([want, look, lamps]);
    if (sig === lookSig) return; // only touch the effect when something changed
    lookSig = sig;
    const have = await OBR.scene.local.getItems((i) => i.id === TOD_FX || TOD_OLD.includes(i.id));
    let fx = have.find((i) => i.id === TOD_FX);
    const old = have.filter((i) => i.id !== TOD_FX || (!want) || lamps.length !== lookN).map((i) => i.id);
    if (old.length) { await OBR.scene.local.deleteItems(old); if (old.includes(TOD_FX)) fx = null; }
    if (!want) { lookN = -1; return; }
    const uniforms = [
      { name: "tint", value: { x: look.tint[0], y: look.tint[1], z: look.tint[2] } },
      { name: "amount", value: look.desat }, { name: "glow", value: look.glow },
    ];
    lamps.forEach((l, i) => uniforms.push({ name: `lp${i}`, value: l.p }, { name: `lc${i}`, value: l.c }, { name: `lf${i}`, value: l.f }));
    if (fx) { await OBR.scene.local.updateItems([TOD_FX], (items) => { for (const it of items) it.uniforms = uniforms; }); return; }
    lookN = lamps.length;
    await OBR.scene.local.addItems([
      buildEffect().id(TOD_FX).effectType("VIEWPORT").sksl(lookSksl(lamps.length)).uniforms(uniforms)
        .layer("POST_PROCESS").locked(true).disableHit(true).name("Time of day and lights").build(),
    ]);
  }
  let lookBusy = Promise.resolve(), lookT = 0;
  const runLook = () => { lookBusy = lookBusy.then(drawLook).catch((err) => { lookSig = ""; console.warn("[nimble look]", err); }); };
  const runLookSoon = () => { clearTimeout(lookT); lookT = setTimeout(runLook, 60); };
  OBR.scene.onMetadataChange(runLook);
  OBR.scene.items.onChange(runLookSoon);
  OBR.scene.onReadyChange((ready) => { lookSig = ""; lookN = -1; if (ready) setTimeout(runLook, 300); });
  runLook();

  // ---- a small badge on a token that carries a light, like it is holding the torch (local, for everyone) ----
  const HELD = `${ID}-held-`;
  let heldSig = "";
  async function drawHeld() {
    if (!(await OBR.scene.isReady())) return;
    const allOff = !!(await OBR.scene.getMetadata())[LIGHTS_OFF_KEY];
    const gm = (await OBR.player.getRole()) === "GM";
    const toks = allOff ? [] : (await OBR.scene.items.getItems((i) => !!(i.metadata && i.metadata[LIGHT_KEY]) && !isLightMarker(i)))
      .filter((t) => (gm || t.visible !== false) && lightOf(t) && lightOf(t).on);
    const face = (t) => ((t.scale?.x || 1) < 0 ? -1 : 1);
    const sig = JSON.stringify([dpi, toks.map((t) => [t.id, lightOf(t).k, Math.round(radius(t)), face(t)])]);
    if (sig === heldSig) return;
    heldSig = sig;
    const have = await OBR.scene.local.getItems((i) => i.id.startsWith(HELD));
    if (have.length) await OBR.scene.local.deleteItems(have.map((i) => i.id));
    const add = toks.map((t) => {
      const r = radius(t), c0 = center(t), size = r * 0.42, k = lightOf(t).k;
      return buildImage({ url: new URL(`lights/held-${k}.png`, import.meta.url).href, mime: "image/png", width: 96, height: 96 }, { dpi: (96 * dpi) / size, offset: { x: 48, y: 48 } })
        .id(`${HELD}${t.id}`).position({ x: c0.x + r * 0.66 * face(t), y: c0.y + r * 0.62 }).layer("ATTACHMENT")
        .locked(true).disableHit(true).attachedTo(t.id).disableAttachmentBehavior(["COPY", "SCALE"]).name("Carried light").build();
    });
    if (add.length) await OBR.scene.local.addItems(add);
  }
  let heldBusy = Promise.resolve(), heldT = 0;
  const runHeld = () => { heldBusy = heldBusy.then(drawHeld).catch((err) => { heldSig = ""; console.warn("[nimble held]", err); }); };
  OBR.scene.items.onChange(() => { clearTimeout(heldT); heldT = setTimeout(runHeld, 120); });
  OBR.scene.onMetadataChange(runHeld);
  OBR.scene.onReadyChange((ready) => { heldSig = ""; if (ready) setTimeout(runHeld, 300); });
  runHeld();

  // ---- the Lights tool (GM): pick a kind of light in the toolbar, click the map to place it ----
  const lightIcon = (k) => new URL(`lights/${k}.svg`, import.meta.url).href;
  (async () => { try {
  await OBR.tool.create({
    id: LIGHT_TOOL,
    icons: [{ icon: lightIcon("tool"), label: "Lights", filter: { roles: ["GM"] } }],
    defaultMode: `${LIGHT_TOOL}/torch`,
    defaultMetadata: { allOff: false },
  });
  const allIcon = (off) => ({ icon: lightIcon(off ? "all-on" : "all-off"), label: off ? "Turn all lights back on" : "Turn all lights off",
    filter: { activeTools: [LIGHT_TOOL], metadata: [{ key: "allOff", value: true, operator: off ? "==" : "!=" }] } });
  await OBR.tool.createAction({
    id: `${LIGHT_TOOL}/all`,
    icons: [allIcon(false), allIcon(true)],
    async onClick() {
      const off = !!(await OBR.scene.getMetadata())[LIGHTS_OFF_KEY];
      await OBR.scene.setMetadata({ [LIGHTS_OFF_KEY]: !off });
      OBR.notification.show(off ? "Lights back on" : "All lights off on this map");
    },
  });
  for (const p of LIGHT_PRESETS) {
    await OBR.tool.createMode({
      id: `${LIGHT_TOOL}/${p.k}`,
      icons: [{ icon: lightIcon(p.k), label: `Place ${p.name.toLowerCase()}`, filter: { activeTools: [LIGHT_TOOL] } }],
      cursors: [{ cursor: "crosshair" }],
      async onToolClick(_ctx, ev) {
        if (ev.target && ev.target.metadata && ev.target.metadata[LIGHT_KEY]) return false; // clicking a light lets you drag it
        const d = dpi || (await OBR.scene.grid.getDpi());
        const mark = buildShape().shapeType("CIRCLE").width(d * 0.45).height(d * 0.45)
          .fillColor(p.color).fillOpacity(0.9).strokeColor("#ffffff").strokeOpacity(0.9).strokeWidth(3)
          .position(ev.pointerPosition).layer("PROP").visible(false).name(p.name)
          .metadata({ [LIGHT_KEY]: { k: p.k, marker: true } }).build();
        await OBR.scene.items.addItems([mark]);
        return true;
      },
    });
  }
  await OBR.contextMenu.create({
    id: `${ID}/light-menu`,
    icons: [{ icon: lightIcon("tool"), label: "Light", filter: { roles: ["GM"], every: [{ key: ["metadata", LIGHT_KEY], operator: "!=", value: undefined }] } }],
    embed: { url: new URL("light.html", import.meta.url).href, height: 212 },
  });
  // anyone can give a token a light to carry: a torch, a lantern, a light spell, fire in hand...
  await OBR.contextMenu.create({
    id: `${ID}/carry-menu`,
    icons: [{ icon: lightIcon("torch"), label: "Carry a light", filter: { max: 1, every: [CHAR] } }],
    embed: { url: new URL("light.html?carry=1", import.meta.url).href, height: 184 },
  });
  // Shift+L: light up the selected token(s) with the last kind picked, or put the light out
  const HAS_LIT = { key: ["metadata", LIGHT_KEY, "on"], value: false, operator: "!=" };
  const HAS_LIGHT = { key: ["metadata", LIGHT_KEY], value: undefined, operator: "!=" };
  await OBR.contextMenu.create({
    id: `${ID}/carry-toggle`,
    shortcut: "Shift+L",
    icons: [
      { icon: lightIcon("all-off"), label: "Put out the light", filter: { every: [CHAR, HAS_LIGHT, HAS_LIT] } },
      { icon: lightIcon("all-on"), label: "Light up", filter: { every: [CHAR] } },
    ],
    async onClick(ctx) {
      const toks = ctx.items.filter((i) => i.layer === "CHARACTER");
      const allLit = toks.length && toks.every((t) => lightOf(t) && lightOf(t).on);
      let last = "torch";
      try { const v = localStorage.getItem(CARRY_LAST_KEY); if (CARRY_KINDS.includes(v)) last = v; } catch (_) {}
      await OBR.scene.items.updateItems(toks.map((t) => t.id), (items) => {
        for (const it of items) {
          const m = it.metadata[LIGHT_KEY];
          if (allLit) it.metadata[LIGHT_KEY] = { ...m, on: false };
          else it.metadata[LIGHT_KEY] = m ? { ...m, on: true } : { k: last };
        }
      });
    },
  });
  } catch (err) { console.warn("[nimble lights]", err); } })();

  // ---- conditions on the map, for everyone (local items): up to 2 as text, 3+ as icons (max 4, then +N) ----
  const CND = `${ID}-cond-`;
  let condSig = "";
  const condName = (c) => (c.k === "custom" ? c.name : (condDef(c.k) || {}).name || c.k) + (c.x !== undefined ? ` ${c.x}` : "");
  const iconUrl = (k) => new URL(`conds/${condDef(k) ? k : "custom"}.png`, import.meta.url).href;
  async function drawConds() {
    if (!(await OBR.scene.isReady())) return;
    const md = await OBR.scene.getMetadata();
    const st = md[STATE_KEY];
    const gm = (await OBR.player.getRole()) === "GM";
    const wanted = [];
    for (const e of (st && Array.isArray(st.entries) ? st.entries : [])) {
      const cs = (e.conds || []).slice().sort((a, b) => COND_ORDER.indexOf(a.k) - COND_ORDER.indexOf(b.k));
      if (cs.length) for (const tid of e.items) wanted.push({ tid, cs });
    }
    const toks = wanted.length ? await OBR.scene.items.getItems(wanted.map((w) => w.tid)) : [];
    const byId = new Map(toks.map((t) => [t.id, t]));
    const sig = JSON.stringify([gm, dpi, wanted.map((w) => { const t = byId.get(w.tid); return [w.tid, w.cs.map(condName), t ? [Math.round(radius(t)), t.visible !== false, Math.sign(t.scale?.x || 1)] : 0]; })]);
    if (sig === condSig) return;
    condSig = sig;
    const have = await OBR.scene.local.getItems((i) => i.id.startsWith(CND));
    if (have.length) await OBR.scene.local.deleteItems(have.map((i) => i.id));
    const add = [];
    const common = (b, t, name) => b.locked(true).disableHit(true).attachedTo(t.id).disableAttachmentBehavior(["COPY", "SCALE"]).name(name);
    for (const w of wanted) {
      const t = byId.get(w.tid);
      if (!t || (!gm && t.visible === false)) continue;
      const r = radius(t), c0 = center(t);
      if (w.cs.length <= 2) {
        add.push(common(buildLabel().id(`${CND}${t.id}-txt`).plainText(w.cs.map(condName).join(" · "))
          .position({ x: c0.x, y: c0.y - r * 1.02 }).pointerDirection("DOWN").pointerHeight(Math.max(4, r * 0.07)).pointerWidth(Math.max(6, r * 0.12))
          .fontSize(Math.max(12, r * 0.22)).fontWeight(700).fillColor("#ffffff").backgroundColor("#1e2231").backgroundOpacity(0.9)
          .cornerRadius(Math.max(6, r * 0.12)).padding(Math.max(4, r * 0.07)).layer("TEXT"), t, "Conditions").build());
        continue;
      }
      const shown = w.cs.slice(0, 4), extra = w.cs.length - shown.length;
      const size = r * 0.5, gap = size * 0.08, n = shown.length + (extra ? 1 : 0);
      let x = c0.x - (n * size + (n - 1) * gap) / 2 + size / 2;
      const y = c0.y - r - size * 0.3;
      for (const c of shown) {
        add.push(common(buildImage({ url: iconUrl(c.k), mime: "image/png", width: 96, height: 96 }, { dpi: (96 * dpi) / size, offset: { x: 48, y: 48 } })
          .id(`${CND}${t.id}-${c.cid}`).position({ x, y }).layer("ATTACHMENT"), t, condName(c)).build());
        x += size + gap;
      }
      if (extra) add.push(common(buildLabel().id(`${CND}${t.id}-more`).plainText(`+${extra}`).position({ x, y: y + size * 0.32 })
        .pointerDirection("DOWN").pointerHeight(0).pointerWidth(0).fontSize(Math.max(12, size * 0.42)).fontWeight(800).fillColor("#ffffff")
        .backgroundColor("#1e2231").backgroundOpacity(0.9).cornerRadius(size * 0.3).padding(Math.max(3, size * 0.1)).layer("TEXT"), t, "More conditions").build());
    }
    if (add.length) await OBR.scene.local.addItems(add);
  }
  let condBusy = Promise.resolve(), condTimer = null;
  const runConds = () => { condBusy = condBusy.then(drawConds).catch((err) => console.warn("[nimble conds]", err)); };
  const soonConds = () => { clearTimeout(condTimer); condTimer = setTimeout(runConds, 250); };
  OBR.scene.onMetadataChange(runConds);
  OBR.scene.items.onChange(soonConds);
  OBR.scene.onReadyChange((ready) => { condSig = ""; if (ready) runConds(); });
  runConds();

  // ---- party bar along the bottom of the screen, for everyone ----
  const BAR_ID = `${ID}/bar`;
  let barKey = "";
  let barRaise = false; // reopen the bar so it sits above a scene backdrop
  let barHidden = false; // the GM can hide the bar on their own screen
  try { barHidden = localStorage.getItem(BAR_HIDDEN_KEY) === "1"; } catch (_) {}
  async function syncBar() {
    const md = await OBR.room.getMetadata();
    const n = partyList(md).length;
    const show = partyOf(md).show && n > 0 && !barHidden;
    const vw = await OBR.viewport.getWidth();
    const vh = await OBR.viewport.getHeight();
    const L = barLayout(md, vw);
    const width = Math.min(vw - 20, L.total);
    const height = Math.round(L.maxW * (partyOf(md).style === "cutouts" ? 1.4 : 1.37)) + 120; // card + name + plate, plus room above for speech bubbles, emotes and panels
    const key = show ? `${vw}x${vh}:${width}x${height}:${partyOf(md).style}` : "off";
    if (key === barKey && !barRaise) return;
    if (!show) { await OBR.popover.close(BAR_ID); barKey = key; barRaise = false; return; }
    if (barRaise) { barRaise = false; await OBR.popover.close(BAR_ID); }
    await OBR.popover.open({
      id: BAR_ID,
      url: new URL("bar.html", import.meta.url).href,
      width, height,
      anchorReference: "POSITION",
      anchorPosition: { left: Math.round(vw / 2), top: vh },
      anchorOrigin: { horizontal: "CENTER", vertical: "BOTTOM" },
      transformOrigin: { horizontal: "CENTER", vertical: "BOTTOM" },
      hidePaper: true,
      disableClickAway: true,
      marginThreshold: 0,
    });
    barKey = key; // only once it opened, so a failed open is retried
  }
  let barBusy = Promise.resolve();
  const runBar = () => { barBusy = barBusy.then(syncBar).catch((err) => console.warn("[nimble bar]", err)); };
  OBR.room.onMetadataChange(runBar);
  setInterval(runBar, 2000); // follows window resizes
  runBar();

  // ---- the GM's bird in the bottom-right corner, for everyone ----
  const BIRD_ID = `${ID}/gmbird`;
  let birdKey = "", birdRaise = false;
  async function syncBird() {
    const md = await OBR.room.getMetadata();
    const show = partyOf(md).bird;
    const vw = await OBR.viewport.getWidth();
    const vh = await OBR.viewport.getHeight();
    const key = show ? `${vw}x${vh}` : "off";
    if (key === birdKey && !birdRaise) return;
    if (!show) { await OBR.popover.close(BIRD_ID); birdKey = key; birdRaise = false; return; }
    if (birdRaise) { birdRaise = false; await OBR.popover.close(BIRD_ID); }
    await OBR.popover.open({
      id: BIRD_ID, url: new URL("bird.html", import.meta.url).href, width: 230, height: 200,
      anchorReference: "POSITION", anchorPosition: { left: vw, top: vh - 70 },
      anchorOrigin: { horizontal: "RIGHT", vertical: "BOTTOM" }, transformOrigin: { horizontal: "RIGHT", vertical: "BOTTOM" },
      hidePaper: true, disableClickAway: true, marginThreshold: 0,
    });
    birdKey = key;
  }
  let birdBusy = Promise.resolve();
  const runBird = () => { birdBusy = birdBusy.then(syncBird).catch((err) => console.warn("[nimble bird]", err)); };
  OBR.room.onMetadataChange(runBird);
  setInterval(runBird, 2000);
  runBird();

  // ---- scene backdrop over the whole screen, for everyone (GM can peek behind it) ----
  const SCENE_ID = `${ID}/scene`, PILL_ID = `${ID}/scenepill`;
  const SCENE_PARTS = [
    { k: "main", rect: (vw, vh, M) => ({ x: 0, y: 0, w: vw - M, h: vh - M }) },
    { k: "right", rect: (vw, vh, M) => ({ x: vw - M, y: 0, w: M, h: vh - M }) },
    { k: "bottom", rect: (vw, vh, M) => ({ x: 0, y: vh - M, w: vw - M, h: M }) },
    { k: "corner", rect: (vw, vh, M) => ({ x: vw - M, y: vh - M, w: M, h: M }) },
  ];
  const myRole = await OBR.player.getRole();
  let peek = false;
  try { peek = myRole === "GM" && localStorage.getItem(PEEK_KEY) === "1"; } catch (_) {}
  let sceneKey = "", pillOpen = false, closeTimer = null;
  const bc = new BroadcastChannel(SCENE_CH);
  async function syncScene() {
    const md = await OBR.room.getMetadata();
    const sc = sceneOf(md);
    const gm = (await OBR.player.getRole()) === "GM";
    const vw = await OBR.viewport.getWidth();
    const vh = await OBR.viewport.getHeight();
    const wantPill = sc.on && gm && peek;
    if (wantPill !== pillOpen) {
      if (wantPill) {
        await OBR.popover.open({
          id: PILL_ID, url: new URL("scene.html?mode=pill", import.meta.url).href, width: 420, height: 48,
          anchorReference: "POSITION", anchorPosition: { left: Math.round(vw / 2), top: 10 },
          anchorOrigin: { horizontal: "CENTER", vertical: "TOP" }, transformOrigin: { horizontal: "CENTER", vertical: "TOP" },
          hidePaper: true, disableClickAway: true, marginThreshold: 0,
        });
      } else await OBR.popover.close(PILL_ID);
      pillOpen = wantPill;
    }
    const key = sc.on && !(gm && peek) ? `${vw}x${vh}` : "off";
    if (key === sceneKey) return;
    if (key === "off") {
      if (closeTimer) return;
      // give the page time to fade out before it goes
      closeTimer = setTimeout(async () => {
        closeTimer = null;
        for (const pt of SCENE_PARTS) await OBR.popover.close(`${SCENE_ID}/${pt.k}`).catch(() => {});
        sceneKey = "off";
      }, sceneKey === "" || peek ? 0 : 900);
      return;
    }
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    // Owlbear keeps a popover 32px short of the window's right and bottom edges, so the backdrop is the main
    // piece plus a right strip, a bottom strip and the corner, each showing its own slice of the same picture.
    const M = 32;
    for (const pt of SCENE_PARTS) {
      const r = pt.rect(vw, vh, M);
      const q = new URLSearchParams({ mode: "full", part: pt.k, x: r.x, y: r.y, vw, vh });
      await OBR.popover.open({
        id: `${SCENE_ID}/${pt.k}`, url: new URL(`scene.html?${q}`, import.meta.url).href, width: r.w, height: r.h,
        anchorReference: "POSITION", anchorPosition: { left: r.x, top: r.y },
        anchorOrigin: { horizontal: "LEFT", vertical: "TOP" }, transformOrigin: { horizontal: "LEFT", vertical: "TOP" },
        hidePaper: true, disableClickAway: true, marginThreshold: 0,
      });
    }
    sceneKey = key;
    barRaise = true; runBar(); // keep the party bar on top of the backdrop
    birdRaise = true; runBird();
  }
  let sceneBusy = Promise.resolve();
  const runScene = () => { sceneBusy = sceneBusy.then(syncScene).catch((err) => console.warn("[nimble scene]", err)); };
  bc.onmessage = (e) => {
    if (e.data && "peek" in e.data) { peek = !!e.data.peek; runScene(); }
    if (e.data && "barHidden" in e.data) { barHidden = !!e.data.barHidden; runBar(); }
    if (e.data && e.data.sceneClosed && sceneKey !== "off" && sceneKey !== "" && !closeTimer) { sceneKey = ""; runScene(); }
  };
  OBR.room.onMetadataChange(runScene);
  setInterval(runScene, 2000);
  runScene();

  // Everything below runs for the GM only, so there is one writer.
  const role = await OBR.player.getRole();
  if (role !== "GM") return;

  let lastPos = new Map();
  let busy = Promise.resolve();

  const sync = async (items) => {
    if (!(await OBR.scene.isReady())) return;
    const byId = new Map(items.map((i) => [i.id, i]));
    const s = await getState();
    let changed = false;

    // 1. Drop deleted tokens (and empty entries).
    for (const e of s.entries) {
      const keep = e.items.filter((id) => byId.has(id));
      if (keep.length !== e.items.length) { e.items = keep; changed = true; }
    }
    const gone = s.entries.filter((e) => !e.items.length).map((e) => e.id);
    if (gone.length) {
      s.entries = s.entries.filter((e) => e.items.length);
      s.done = s.done.filter((x) => !gone.includes(x));
      s.legQueue = s.legQueue.filter((x) => !gone.includes(x));
      if (gone.includes(s.active)) { s.active = s.legQueue[0] || null; s.phase = s.active ? s.phase : "pick"; }
      changed = true;
    }

    // 2. Auto movement for whoever is acting right now (shoves and GM repositioning don't count).
    const next = new Map();
    for (const e of s.entries) {
      for (const id of e.items) {
        const it = byId.get(id);
        const prev = lastPos.get(id);
        next.set(id, { x: it.position.x, y: it.position.y });
        if (!prev || (prev.x === it.position.x && prev.y === it.position.y)) continue;
        if (!s.started || s.autoMove === false || s.active !== e.id) continue;
        const d = await OBR.scene.grid.getDistance(prev, it.position);
        if (!d) continue;
        e.moved[id] = Math.round(((e.moved[id] || 0) + d) * 10) / 10;
        // Heroes out of movement spend another action on Move, if one is ready. Monsters just have their Speed.
        while (e.kind === "hero" && maxMoved(e) > e.budget) {
          const i = e.pips.indexOf("ready");
          if (i < 0 || !(Number(e.speed) > 0)) break;
          e.pips[i] = "spent";
          e.budget += Number(e.speed);
        }
        changed = true;
      }
    }
    lastPos = next;
    if (changed) await setState(s);
    await drawGroups(s, byId);
  };

  // ---- GM-only rings and link lines for minion groups (local items: only this browser sees them) ----
  async function drawGroups(s, byId) {
    const want = new Map();
    for (const e of s.entries) {
      if (e.kind !== "minion") continue;
      const col = GROUP_COLORS[e.color % GROUP_COLORS.length];
      const toks = e.items.map((id) => byId.get(id)).filter(Boolean);
      for (const t of toks) {
        const r = radius(t) * 1.04;
        want.set(`${LINK_PREFIX}ring-${t.id}`, { kind: "ring", col, pos: center(t), pts: circle(r), attach: t.id, r });
      }
      for (let i = 0; i + 1 < toks.length; i++) {
        const a = center(toks[i]), b = center(toks[i + 1]);
        const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
        const ra = radius(toks[i]) * 1.04, rb = radius(toks[i + 1]) * 1.04;
        if (len <= ra + rb) continue;
        const ux = dx / len, uy = dy / len;
        want.set(`${LINK_PREFIX}line-${toks[i].id}-${toks[i + 1].id}`, {
          kind: "line", col, pos: { x: a.x + ux * ra, y: a.y + uy * ra },
          pts: [{ x: 0, y: 0 }, { x: dx - ux * (ra + rb), y: dy - uy * (ra + rb) }],
        });
      }
    }
    const have = (await OBR.scene.local.getItems((i) => i.id.startsWith(LINK_PREFIX)));
    const haveIds = new Set(have.map((i) => i.id));
    const del = have.filter((i) => !want.has(i.id)).map((i) => i.id);
    if (del.length) await OBR.scene.local.deleteItems(del);
    const upd = have.filter((i) => want.has(i.id));
    const same = (i, w) => Math.abs(i.position.x - w.pos.x) < 0.5 && Math.abs(i.position.y - w.pos.y) < 0.5
      && i.points.length === w.pts.length && Math.abs(i.points[i.points.length - 1].x - w.pts[w.pts.length - 1].x) < 0.5
      && Math.abs(i.points[i.points.length - 1].y - w.pts[w.pts.length - 1].y) < 0.5 && i.style.strokeColor === w.col;
    const stale = upd.filter((i) => want.get(i.id).kind === "line" && !same(i, want.get(i.id))
      || want.get(i.id).kind === "ring" && i.style.strokeColor !== want.get(i.id).col);
    if (stale.length) {
      await OBR.scene.local.updateItems(stale.map((i) => i.id), (ds) => {
        for (const d of ds) {
          const w = want.get(d.id);
          d.style.strokeColor = w.col;
          if (w.kind === "line") { d.position = w.pos; d.points = w.pts; }
        }
      });
    }
    const add = [...want.entries()].filter(([id]) => !haveIds.has(id)).map(([id, w]) => {
      let b = buildCurve().id(id).points(w.pts).position(w.pos).strokeColor(w.col).strokeOpacity(0.9)
        .strokeWidth(w.kind === "ring" ? Math.max(4, w.r * 0.08) : 4).fillOpacity(0).tension(0)
        .closed(w.kind === "ring").layer("DRAWING").locked(true).disableHit(true).name("Minion group");
      if (w.kind === "line") b = b.strokeDash([18, 12]);
      if (w.attach) b = b.attachedTo(w.attach).disableAttachmentBehavior(["COPY"]);
      return b.build();
    });
    if (add.length) await OBR.scene.local.addItems(add);
  }

  const run = (items) => { busy = busy.then(() => sync(items)).catch((e) => console.warn("[nimble]", e)); };
  OBR.scene.items.onChange(run);
  const init = async () => {
    if (await OBR.scene.isReady()) {
      try { dpi = await OBR.scene.grid.getDpi(); } catch (_) {}
      lastPos = new Map();
      run(await OBR.scene.items.getItems());
    }
  };
  OBR.scene.onReadyChange(init);
  OBR.scene.onMetadataChange(async () => run(await OBR.scene.items.getItems()));
  init();
});
