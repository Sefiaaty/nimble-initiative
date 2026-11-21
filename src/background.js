// Background script: context menus, cleanup, auto movement and GM-only minion group links.
import OBR, { buildCurve } from "@owlbear-rodeo/sdk";
import {
  ID, HERO_FLAG, HEROES_KEY, MON_KEY, OPEN_KEY, GROUP_COLORS, STATE_KEY, partyOf, partyList,
  getHeroImages, getState, setState, updateState, addTokens, maxMoved,
} from "./common.js";

const CHAR = { key: "layer", value: "CHARACTER" };
const LINK_PREFIX = `${ID}-grp-`;

OBR.onReady(async () => {
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

  // ---- party bar along the bottom of the screen, for everyone ----
  const BAR_ID = `${ID}/bar`;
  let barKey = "";
  async function syncBar() {
    const md = await OBR.room.getMetadata();
    const n = partyList(md).length;
    const show = partyOf(md).show && n > 0;
    const vw = await OBR.viewport.getWidth();
    const vh = await OBR.viewport.getHeight();
    const cw = Math.max(70, Math.min(150, Math.floor((vw - 80) / Math.max(n, 1)) - 6));
    const width = Math.min(vw - 40, n * (cw + 6) + 16);
    const height = Math.round(cw * (partyOf(md).style === "cutouts" ? 1.55 : 1.37)) + 120; // card + name + plate, plus room above for speech bubbles, emotes and panels
    const key = show ? `${vw}x${vh}:${n}` : "off";
    if (key === barKey) return;
    barKey = key;
    if (!show) { await OBR.popover.close(BAR_ID); return; }
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
  }
  let barBusy = Promise.resolve();
  const runBar = () => { barBusy = barBusy.then(syncBar).catch((err) => console.warn("[nimble bar]", err)); };
  OBR.room.onMetadataChange(runBar);
  setInterval(runBar, 2000); // follows window resizes
  runBar();

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
