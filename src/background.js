// Background script: context menus and cleanup when tokens are deleted.
import OBR from "@owlbear-rodeo/sdk";
import { ID, HERO_FLAG, HEROES_KEY, getHeroImages, isHero, itemName, newEntry, updateState } from "./common.js";

const CHAR = { key: "layer", value: "CHARACTER" };

OBR.onReady(async () => {
  // Add each selected token as its own entry (heroes are recognised automatically).
  await OBR.contextMenu.create({
    id: `${ID}/add`,
    icons: [{ icon: new URL("add.svg", import.meta.url).href, label: "Add to Nimble Initiative", filter: { every: [CHAR], roles: ["GM"] } }],
    async onClick(ctx) {
      const heroes = await getHeroImages();
      await updateState((s) => {
        const listed = new Set(s.entries.flatMap((e) => e.items));
        for (const it of ctx.items) {
          if (listed.has(it.id)) continue;
          const hero = isHero(it, heroes);
          s.entries.push(newEntry({ kind: hero ? "hero" : "monster", items: [it.id], name: itemName(it), img: it.image?.url }));
        }
        // Heroes go first by default, monsters after (the GM can reorder).
        s.entries.sort((a, b) => (a.kind === "hero" ? 0 : 1) - (b.kind === "hero" ? 0 : 1));
      });
      OBR.notification.show(`Added to Nimble Initiative`);
    },
  });

  // Add several selected tokens as one minion group that acts together.
  await OBR.contextMenu.create({
    id: `${ID}/minions`,
    icons: [{ icon: new URL("minions.svg", import.meta.url).href, label: "Add as Minion Group", filter: { min: 2, every: [CHAR], roles: ["GM"] } }],
    async onClick(ctx) {
      await updateState((s) => {
        const listed = new Set(s.entries.flatMap((e) => e.items));
        const items = ctx.items.filter((i) => !listed.has(i.id));
        if (!items.length) return false;
        const base = itemName(items[0]).replace(/\s*\d+$/, "");
        s.entries.push(newEntry({ kind: "minion", items: items.map((i) => i.id), name: `${base} (minions)`, img: items[0].image?.url }));
      });
    },
  });

  // Mark / unmark a token as a hero. Heroes are remembered by token image across scenes.
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
      // Update matching entries already in the tracker.
      await updateState((s) => {
        for (const e of s.entries) {
          if (e.kind === "minion") continue;
          if (ctx.items.some((i) => e.items.includes(i.id))) e.kind = makeHero ? "hero" : "monster";
        }
      });
      OBR.notification.show(makeHero ? "Marked as hero" : "No longer a hero");
    },
  });

  // When tokens are deleted, drop them from the tracker (GM only, to avoid duplicate writes).
  const role = await OBR.player.getRole();
  if (role !== "GM") return;
  const prune = async () => {
    if (!(await OBR.scene.isReady())) return;
    const ids = new Set((await OBR.scene.items.getItems()).map((i) => i.id));
    let changed = false;
    await updateState((s) => {
      for (const e of s.entries) {
        const keep = e.items.filter((id) => ids.has(id));
        if (keep.length !== e.items.length) { e.items = keep; changed = true; }
      }
      const before = s.entries.length;
      s.entries = s.entries.filter((e) => e.items.length > 0);
      if (s.entries.length !== before) {
        changed = true;
        if (s.turn >= s.entries.length) s.turn = 0;
      }
      return changed ? s : false;
    }).catch(() => {});
  };
  let timer = null;
  OBR.scene.items.onChange(() => { clearTimeout(timer); timer = setTimeout(prune, 400); });
});
