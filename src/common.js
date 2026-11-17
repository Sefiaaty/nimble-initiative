// Shared state helpers for the Nimble Initiative extension.
import OBR from "@owlbear-rodeo/sdk";

export const ID = "com.shade.nimble-initiative";
export const STATE_KEY = `${ID}/state`; // scene metadata: the encounter
export const HEROES_KEY = `${ID}/heroes`; // room metadata: token images marked as heroes
export const HERO_FLAG = `${ID}/hero`; // item metadata: this token is a hero

export const MAX_ACTIONS = 3;

export function emptyState() {
  return { entries: [], round: 0, turn: 0, started: false, autoMove: true };
}

export async function getState() {
  const md = await OBR.scene.getMetadata();
  return md[STATE_KEY] ? structuredClone(md[STATE_KEY]) : emptyState();
}

export async function setState(state) {
  await OBR.scene.setMetadata({ [STATE_KEY]: state });
}

// Read-modify-write helper. Return false from fn to skip the write.
export async function updateState(fn) {
  const s = await getState();
  const out = fn(s);
  if (out === false) return s; // nothing changed
  await setState(out || s);
  return out || s;
}

export async function getHeroImages() {
  const md = await OBR.room.getMetadata();
  return Array.isArray(md[HEROES_KEY]) ? md[HEROES_KEY] : [];
}

export function isHero(item, heroImages) {
  if (item.metadata && item.metadata[HERO_FLAG] === true) return true;
  const url = item.image && item.image.url;
  return !!url && heroImages.includes(url);
}

export function itemName(item) {
  const t = item.text && item.text.plainText && item.text.plainText.trim();
  return t || item.name || "Unnamed";
}

export function freshPips(n = MAX_ACTIONS) {
  return Array.from({ length: n }, () => "ready");
}

export function newEntry({ kind, items, name, img }) {
  return {
    id: Math.random().toString(36).slice(2, 10),
    kind, // "hero" | "monster" | "minion"
    items, // token ids
    name,
    img: img || "",
    init: null, // heroes only: 1 Hesitant, 2 Ready, 3 Vigilant
    pips: freshPips(),
    speed: 6, // spaces per Move action (the GM can change it)
    budget: 0, // spaces granted by Move actions this turn
    moved: {}, // token id -> spaces moved this turn
  };
}

// Older saves stored a single moveLeft number.
export function migrateEntry(e) {
  if (e.budget === undefined) e.budget = Number(e.moveLeft) || 0;
  if (!e.moved || typeof e.moved !== "object") e.moved = {};
  delete e.moveLeft;
  return e;
}

// Minion groups share actions, but each minion moves on its own: the furthest one counts.
export function maxMoved(e) {
  const v = Object.values(e.moved || {});
  return v.length ? Math.max(...v) : 0;
}

export function movesLeft(e) {
  return Math.round(((Number(e.budget) || 0) - maxMoved(e)) * 10) / 10;
}

export function resetMovement(e) {
  e.budget = 0;
  e.moved = {};
}

// Pips at the start of combat: heroes only get as many actions as initiative allows.
export function startingPips(entry) {
  const pips = freshPips();
  if (entry.kind === "hero" && entry.init) {
    for (let i = entry.init; i < MAX_ACTIONS; i++) pips[i] = "locked";
  }
  return pips;
}
