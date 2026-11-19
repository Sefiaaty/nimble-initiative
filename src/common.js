// Shared state helpers for the Nimble Initiative extension (v2).
import OBR from "@owlbear-rodeo/sdk";

export const ID = "com.shade.nimble-initiative";
export const STATE_KEY = `${ID}/state`;   // scene metadata: the encounter
export const HEROES_KEY = `${ID}/heroes`; // room metadata: token images marked as heroes
export const HERO_FLAG = `${ID}/hero`;    // item metadata: this token is a hero
export const MON_KEY = `${ID}/monster`;   // item metadata: linked stat block
export const LIB_KEY = `${ID}/library`;   // localStorage (GM browser): saved stat blocks
export const OPEN_KEY = `${ID}/open`;     // localStorage: ask the popover to open a tab
export const NEXUS = "https://nimble.nexus";

export const MAX_ACTIONS = 3;
export const REACTIONS = [
  { k: "d", label: "Def", name: "Defend" },
  { k: "i", label: "Int", name: "Interpose" },
  { k: "o", label: "Opp", name: "Opportunity Attack" },
  { k: "h", label: "Help", name: "Help" },
];
export const GROUP_COLORS = ["#ff5d5d", "#4fc3f7", "#ffd54f", "#81c784", "#ba68c8", "#ff9f43"];

export function emptyState() {
  return { v: 2, entries: [], round: 0, started: false, autoMove: true, phase: "pick", active: null, done: [], legQueue: [], pendingNext: null };
}

export function migrateState(s) {
  if (!s || typeof s !== "object") return emptyState();
  if (s.v !== 2) {
    // v1 kept a turn index; v2 tracks the active entry and who has acted.
    const active = s.started && s.entries && s.entries[s.turn] ? s.entries[s.turn].id : null;
    s = { ...emptyState(), ...s, v: 2, active, phase: active ? "turn" : "pick", done: [], legQueue: [] };
    delete s.turn;
  }
  s.entries = (s.entries || []).map(migrateEntry);
  s.done = s.done || [];
  s.legQueue = s.legQueue || [];
  return s;
}

export async function getState() {
  const md = await OBR.scene.getMetadata();
  return migrateState(md[STATE_KEY] ? structuredClone(md[STATE_KEY]) : emptyState());
}

export async function setState(state) {
  await OBR.scene.setMetadata({ [STATE_KEY]: state });
}

// Read-modify-write helper. Return false from fn to skip the write.
export async function updateState(fn) {
  const s = await getState();
  const out = fn(s);
  if (out === false) return s;
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

export const isMonsterKind = (k) => k === "monster" || k === "minion" || k === "legendary";

export function newEntry({ kind, items, name, img, mon }) {
  const e = {
    id: Math.random().toString(36).slice(2, 10),
    kind, // "hero" | "monster" | "minion" | "legendary"
    items,
    name,
    img: img || "",
    init: null,
    pips: freshPips(),
    react: {},
    speed: 6,
    budget: 0,
    moved: {},
    nact: 1,
    hp: {},
    maxHp: 0,
    armor: "",
    linked: false,
    color: 0,
  };
  if (mon) applyMonster(e, mon);
  if (isMonsterKind(kind)) e.pips = freshPips(e.nact);
  return e;
}

// Fill an entry from a linked stat block (only the numbers live in the scene; the text stays on the token).
export function applyMonster(e, mon, heroCount = 0) {
  e.linked = true;
  e.armor = mon.armor && mon.armor !== "none" ? mon.armor : "";
  e.speed = mon.speed || 6;
  e.nact = mon.nact || 1;
  e.hpPerHero = mon.hpPerHero || 0;
  if (e.kind === "legendary") {
    e.nact = 1;
    const max = mon.hpPerHero && heroCount ? mon.hpPerHero * heroCount : mon.hp || 0;
    e.maxHp = max;
  } else if (e.kind === "monster") {
    e.maxHp = mon.hp || 0;
  } else {
    e.maxHp = 0;
  }
  for (const id of e.items) if (e.hp[id] === undefined && e.maxHp) e.hp[id] = e.maxHp;
  return e;
}

export function migrateEntry(e) {
  if (e.budget === undefined) e.budget = Number(e.moveLeft) || 0;
  if (!e.moved || typeof e.moved !== "object") e.moved = {};
  delete e.moveLeft;
  if (!e.react) e.react = {};
  if (!e.hp) e.hp = {};
  if (!e.temp) e.temp = {};
  if (e.nact === undefined) e.nact = 1;
  if (e.maxHp === undefined) e.maxHp = 0;
  if (e.armor === undefined) e.armor = "";
  if (e.color === undefined) e.color = 0;
  return e;
}

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

// Heroes start combat with as many actions as their initiative allows.
export function startingPips(entry) {
  if (isMonsterKind(entry.kind)) return freshPips(entry.nact);
  const pips = freshPips();
  if (entry.init) for (let i = entry.init; i < MAX_ACTIONS; i++) pips[i] = "locked";
  return pips;
}

// What happens when a creature's turn (or a legendary's step) starts.
export function onTurnStart(e) {
  e.moved = {};
  if (isMonsterKind(e.kind)) {
    e.pips = freshPips(e.nact);
    e.budget = Number(e.speed) || 0; // monsters simply move up to their Speed
  } else {
    e.budget = 0; // heroes buy movement with Move actions
  }
}

// End of a creature's own turn: heroes get all 3 actions back and their reactions reset.
export function onTurnEnd(e) {
  if (e.kind === "hero") {
    e.pips = freshPips();
    e.react = {};
  } else {
    e.pips = freshPips(e.nact);
  }
  resetMovement(e);
}

// Legendary HP scales with the party: refresh it at the start of combat if it hasn't been hurt yet.
export function rescaleLegendary(s) {
  const heroes = s.entries.filter((e) => e.kind === "hero").length;
  for (const e of s.entries) {
    if (e.kind !== "legendary" || !e.hpPerHero || !heroes) continue;
    const max = e.hpPerHero * heroes;
    const untouched = e.items.every((id) => e.hp[id] === undefined || e.hp[id] === e.maxHp);
    if (untouched && max !== e.maxHp) { e.maxHp = max; for (const id of e.items) e.hp[id] = max; }
  }
}

export const hpOf = (e, id) => (e.hp && e.hp[id] !== undefined ? e.hp[id] : e.maxHp);
export const tempOf = (e, id) => (e.temp && e.temp[id]) || 0;

// Damage eats temp HP first. Temp HP doesn't stack: keep the higher amount.
export function damage(e, id, n) {
  const t = tempOf(e, id);
  const soak = Math.min(t, n);
  e.temp[id] = t - soak;
  e.hp[id] = Math.max(0, hpOf(e, id) - (n - soak));
}
export function giveTemp(e, id, n) { e.temp[id] = Math.max(tempOf(e, id), n); }

// ---------- turn flow ----------
const legendaries = (s) => s.entries.filter((e) => e.kind === "legendary");
export const actors = (s) => s.entries.filter((e) => e.kind !== "legendary");

export function startTurn(s, id) {
  const e = s.entries.find((x) => x.id === id);
  if (!e) return false;
  s.active = id;
  s.phase = "turn";
  onTurnStart(e);
}

export function finishTurn(s, id) {
  const e = s.entries.find((x) => x.id === id);
  if (!e) return false;
  if (s.phase === "legendary") {
    onTurnEnd(e);
    s.legQueue = s.legQueue.filter((x) => x !== id);
    if (s.legQueue.length) {
      s.active = s.legQueue[0];
      onTurnStart(s.entries.find((x) => x.id === s.active));
    } else {
      s.active = null; s.phase = "pick";
      startPending(s);
    }
    return;
  }
  onTurnEnd(e);
  if (!s.done.includes(id)) s.done.push(id);
  const legs = legendaries(s);
  if (e.kind === "hero" && legs.length) {
    s.phase = "legendary";
    s.legQueue = legs.map((x) => x.id);
    s.active = s.legQueue[0];
    onTurnStart(legs[0]);
  } else {
    s.active = null; s.phase = "pick";
    startPending(s);
  }
}

function startPending(s) {
  const id = s.pendingNext;
  s.pendingNext = null;
  if (id && s.entries.some((e) => e.id === id)) { s.done = s.done.filter((x) => x !== id); startTurn(s, id); }
}

// GM jumps someone to the front: the current turn ends first (and any legendary steps happen), then theirs starts.
export function jumpTo(s, id) {
  s.done = s.done.filter((x) => x !== id);
  if (s.active && s.active !== id) {
    s.pendingNext = id;
    if (s.phase === "turn") finishTurn(s, s.active);
    return;
  }
  if (!s.active) startTurn(s, id);
}

// Who goes next when the GM presses Next: heroes first (in list order), then everyone else.
export function nextUp(s) {
  const left = actors(s).filter((e) => !s.done.includes(e.id));
  return left.find((e) => e.kind === "hero") || left[0] || null;
}

export function newRound(s) {
  s.round += 1;
  s.done = [];
  s.active = null;
  s.phase = "pick";
}

// ---------- reactions: each costs 1 action from the next turn and is 1/round ----------
export function toggleReaction(e, k) {
  if (e.react[k]) {
    delete e.react[k];
    const i = e.pips.lastIndexOf("reaction");
    if (i >= 0) e.pips[i] = "ready";
    return true;
  }
  const i = e.pips.lastIndexOf("ready");
  if (i < 0) return false;
  e.pips[i] = "reaction";
  e.react[k] = true;
  return true;
}

// ---------- nimble.nexus ----------
export function parseNexusId(text) {
  const t = String(text || "").trim();
  const m = t.match(/monsters\/([a-z0-9-]+)/i);
  const slug = m ? m[1] : t;
  const last = slug.split("-").pop();
  return /^[a-z0-9]{26}$/i.test(last) ? last.toLowerCase() : null;
}

const firstNumber = (v) => (typeof v === "number" ? v : Number.parseInt(v, 10) || 0);

// How many actions a monster takes on its turn, from the stat block wording.
export function actionCount(attrs) {
  const ins = String(attrs.actionsInstructions || "").toLowerCase();
  const n = (attrs.actions || []).length || 1;
  if (/choose (one|1)\b|either/.test(ins)) return 1;
  if (/choose (twice|two|2)\b/.test(ins)) return 2;
  if (/\bboth\b/.test(ins)) return Math.min(n, 3);
  return Math.max(1, Math.min(n, 3));
}

// nimble.nexus text markup: [[Prone]], [[slug|Label]], @rule:[minions|minion rules] -> plain words.
export const clean = (t) => String(t || "")
  .replace(/@[a-z]+:\[([^\]|]+)\|([^\]]+)\]/gi, "$2")
  .replace(/@[a-z]+:\[([^\]]+)\]/gi, "$1")
  .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
  .replace(/\[\[([^\]]+)\]\]/g, "$1");

// Compact stat block kept on tokens and in the library.
export function compactMonster(id, a) {
  const moves = (a.movement || []).map((m) => ({ mode: m.mode || "", speed: m.speed }));
  const walk = moves.find((m) => !m.mode);
  const type = a.legendary ? "legendary" : a.minion ? "minion" : "standard";
  const dist = (t) => (!t ? "" : t.reach ? `Reach ${t.reach}` : t.range ? `Range ${t.range}` : t.aura ? `Aura ${t.aura}` : "");
  const act = (x) => {
    let d = clean(x.description);
    const roll = x.damage && x.damage.roll;
    if (roll && !d.startsWith(roll)) {
      const where = [dist(x.target), x.area ? `${x.area.shape[0].toUpperCase()}${x.area.shape.slice(1)} ${x.area.size}` : ""].filter(Boolean).join(", ");
      d = `${roll}.${where && !d.includes(where) ? ` (${where})` : ""}${d ? " " + d : ""}`;
    }
    if (x.alternative) d += ` (or ${x.alternative.name}${dist(x.alternative.target) ? `, ${dist(x.alternative.target)}` : ""})`;
    return { name: x.name || "", desc: d.trim(), count: x.attackCount || 0 };
  };
  const members = (a.members || []).map((m) => ({
    name: m.name, hp: m.hp || 0, hpPerHero: m.hpPerHero || 0, armor: m.armor || "none",
    abilities: (m.abilities || []).map((x) => ({ name: x.name, desc: clean(x.description) })),
    actions: (m.actions || []).map(act),
  }));
  return {
    nid: id,
    name: a.name || "Monster",
    level: a.level === undefined ? "" : String(a.level),
    type,
    size: a.size || "",
    kind: a.kind || "",
    hp: firstNumber(a.hp),
    hpPerHero: a.hpPerHero || (members.length ? members.reduce((t, m) => t + (m.hpPerHero || 0), 0) : 0),
    armor: a.armor || "none",
    speed: walk ? walk.speed : moves.length ? moves[0].speed : 6,
    moves,
    nact: a.legendary ? 1 : actionCount(a),
    abilities: (a.abilities || []).map((x) => ({ name: x.name, desc: clean(x.description) })),
    actions: (a.actions || []).map(act),
    instructions: a.actionsInstructions || "",
    bloodied: clean(a.bloodied ? (typeof a.bloodied === "string" ? a.bloodied : a.bloodied.description) : ""),
    lastStand: clean(a.lastStand ? (typeof a.lastStand === "string" ? a.lastStand : a.lastStand.description) : ""),
    saves: a.saves || null,
    members,
    resist: [...(a.resistances || []), ...(a.immunities || []).map((x) => `immune ${x}`)].join(", "),
    vuln: (a.vulnerabilities || []).join(", "),
  };
}

export async function fetchMonster(id) {
  const r = await fetch(`${NEXUS}/api/monsters/${id}`, { headers: { Accept: "application/vnd.api+json" } });
  if (!r.ok) throw new Error(`nimble.nexus said ${r.status}`);
  const j = await r.json();
  return compactMonster(j.data.id, j.data.attributes);
}

const OFFICIAL = "00000000000000000000000000";
export async function findOfficial(name) {
  const r = await fetch(`${NEXUS}/api/monsters?search=${encodeURIComponent(name)}&include=creator&limit=25`, { headers: { Accept: "application/vnd.api+json" } });
  if (!r.ok) throw new Error(`nimble.nexus said ${r.status}`);
  const j = await r.json();
  const users = new Map((j.included || []).filter((x) => x.type === "users").map((u) => [u.id, u]));
  const isOfficial = (m) => {
    const c = m.relationships && m.relationships.creator && m.relationships.creator.data;
    if (!c) return false;
    const u = users.get(c.id);
    return c.id === OFFICIAL || (u && u.attributes && u.attributes.username === "nimble-co");
  };
  const norm = (x) => x.toLowerCase().replace(/[’']/g, "'").trim();
  const hit = (j.data || []).find((m) => isOfficial(m) && norm(m.attributes.name) === norm(name))
    || (j.data || []).find((m) => isOfficial(m));
  return hit ? compactMonster(hit.id, hit.attributes) : null;
}

// The Game Master's Guide bestiary (names only; stat blocks come from nimble.nexus).
export const GMG_NAMES = ["Bandit Minion", "Goblin Minion", "Kobold Minion", "Snakeman Minion", "Bandit", "Goblin", "Kobold", "Skeleton", "Stenchling", "Stirge", "Briarbane Seedling", "Kobold Sneak", "Zombie", "Bandit Hunter", "Cultist", "Tiny Mimic", "Gray Ooze", "Briarbane Acidpod", "Gnoll", "Worg", "Kobold Clanger", "Kobold Trapper", "Kobold Denwarden", "Snakeman", "Ghoul", "Bandit Assassin", "Bandit Bruiser", "Small Mimic", "Briarbane Tangler", "Bugbear", "Goblin Taskmaster", "Goblin Ratrider", "Blue Drake", "Giant Spider", "Fanatic", "Specter", "Bandit Captain", "Bandit Mage", "Spiny Fiend", "Ochre Jelly", "Gnoll Packleader", "Griffon", "Cobra Captain", "Ettercap", "Doomsayer", "Briarbane Rootbreaker", "Ogre Zombie", "Greater Stirge", "Medium Mimic", "Duskprowler", "Mummy", "Nestweaver", "Basilisk", "Black Pudding", "Druid", "Giant Cobra", "Giant Zombie", "Bulette", "Troll", "Wraith", "Umber Hulk", "Elder Ooze", "Hill Giant", "Cloaker", "Glabrezu", "Treant", "Great Worm", "Roc", "Mummy Lord", "Alaric Draegoth, the Crimson Count", "Azriel, Lord of Pain & Flame", "Dravok, All-Seeing Tyrant", "Florindris, Bane of the Forest", "General Flameheart", "Gloomwing the Cruel", "Grimbeak, the Unyielding", "Nalzar, Apex Predator", "Pudge the Blunderer", "Queen Aranya, Broodmother", "Ravager of the Lowlands", "Caerys, the Hollow Star", "Thorn Quickblade", "Titan of the Deep Woods", "Ul'vek, Psionic Despot", "Vael, Undying Necromancer", "Wax Golem", "Ooze Minion", "Elemental Fireling"];

// ---------- library (GM's browser) ----------
export function loadLibrary() {
  try { const v = JSON.parse(localStorage.getItem(LIB_KEY) || "null"); if (v && v.monsters) return v; } catch (_) {}
  return { monsters: {}, gmg: false };
}
export function saveLibrary(lib) {
  try { localStorage.setItem(LIB_KEY, JSON.stringify(lib)); } catch (_) {}
}

// ---------- adding tokens to the tracker ----------
export const entryKindFor = (mon) => (mon.type === "legendary" ? "legendary" : mon.type === "minion" ? "minion" : "monster");

export async function addTokens(items, { forceGroup = false } = {}) {
  const heroes = await getHeroImages();
  let added = 0;
  await updateState((s) => {
    const listed = new Set(s.entries.flatMap((e) => e.items));
    const fresh = items.filter((it) => !listed.has(it.id));
    if (!fresh.length) return false;
    const heroCount = s.entries.filter((e) => e.kind === "hero").length + fresh.filter((it) => isHero(it, heroes)).length;
    const groups = new Map(); // minions: one group per stat block (or one forced group)
    for (const it of fresh) {
      const mon = it.metadata && it.metadata[MON_KEY];
      if (isHero(it, heroes)) {
        s.entries.push(newEntry({ kind: "hero", items: [it.id], name: itemName(it), img: it.image?.url }));
      } else if (forceGroup || (mon && mon.type === "minion")) {
        const key = forceGroup ? "forced" : mon.nid;
        if (!groups.has(key)) groups.set(key, { mon, items: [] });
        groups.get(key).items.push(it);
        continue;
      } else {
        const kind = mon ? entryKindFor(mon) : "monster";
        const e = newEntry({ kind, items: [it.id], name: itemName(it), img: it.image?.url });
        if (mon) { applyMonster(e, mon, heroCount); e.pips = freshPips(e.nact); }
        s.entries.push(e);
      }
      added++;
    }
    for (const g of groups.values()) {
      const base = g.mon ? g.mon.name : itemName(g.items[0]).replace(/\s*\d+$/, "");
      const e = newEntry({ kind: "minion", items: g.items.map((i) => i.id), name: `${base} (minions)`, img: g.items[0].image?.url });
      if (g.mon) applyMonster(e, g.mon);
      e.pips = freshPips(e.nact);
      const used = new Set(s.entries.filter((x) => x.kind === "minion").map((x) => x.color));
      e.color = [...GROUP_COLORS.keys()].find((c) => !used.has(c)) ?? s.entries.length % GROUP_COLORS.length;
      s.entries.push(e);
      added += g.items.length;
    }
    // Heroes first, then monsters; legendaries last (they act between heroes anyway).
    const rank = (e) => (e.kind === "hero" ? 0 : e.kind === "legendary" ? 2 : 1);
    s.entries.sort((a, b) => rank(a) - rank(b));
    if (s.started) for (const e of s.entries) if (!e.pips.length) e.pips = startingPips(e);
  });
  return added;
}
