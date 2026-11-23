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
export const PARTY_KEY = `${ID}/party`;   // room metadata: party bar settings
export const TALK_CH = `${ID}/talk`;      // broadcast channel: who is talking
export const SCENE_KEY = `${ID}/scene`;   // room metadata: the scene backdrop shown to everyone
export const PEEK_KEY = `${ID}/peek`;     // GM's browser: hide the backdrop for me only
export const SCENE_CH = "nimble-scene";
export const BAR_HIDDEN_KEY = `${ID}/barHiddenForMe`; // this browser only: don't show the party bar here   // BroadcastChannel between this browser's extension frames
export function sceneOf(md) {
  const s = (md && md[SCENE_KEY]) || {};
  return { on: !!s.on && !!s.url, url: directLink(s.url || ""), kind: s.kind || "", title: s.title || "", sub: s.sub || "", at: s.at || 0 };
}
// Turn share links into direct file links so pictures and videos load:
// Dropbox (www.dropbox.com/...?dl=0) -> dl.dropboxusercontent.com, keeping the rlkey that opens the file;
// Google Drive file pages -> a direct image link.
export function directLink(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  let u;
  try { u = new URL(raw); } catch (_) { return raw; }
  const host = u.hostname.replace(/^www\./, "");
  if (host === "dropbox.com" || host === "dl.dropbox.com" || host === "dl.dropboxusercontent.com") {
    const out = new URL(`https://dl.dropboxusercontent.com${u.pathname}`);
    const rlkey = u.searchParams.get("rlkey");
    if (rlkey) out.searchParams.set("rlkey", rlkey);
    return out.href;
  }
  if (host === "drive.google.com") {
    const m = u.pathname.match(/\/file\/d\/([^/]+)/);
    const id = m ? m[1] : u.searchParams.get("id");
    if (id) return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w4000`;
  }
  return raw;
}
// ---------- time of day: a colour grade over the whole map (per scene) ----------
export const TOD_KEY = `${ID}/tod`;
export function todOf(md) { const t = (md && md[TOD_KEY]) || {}; return { on: !!t.on, t: Number.isFinite(Number(t.t)) ? Math.max(0, Math.min(1, Number(t.t))) : 0.25 }; }
// t: 0 morning ... 0.25 noon ... 0.45 afternoon ... 0.62 evening ... 0.78 dusk ... 1 night
const TOD_STOPS = [
  { t: 0.0, name: "Morning", tint: [1.0, 0.91, 0.82], desat: 0.0, glow: 0.3 },
  { t: 0.25, name: "Noon", tint: [1.0, 1.0, 1.0], desat: 0.0, glow: 0.2 },
  { t: 0.45, name: "Afternoon", tint: [1.0, 0.95, 0.86], desat: 0.0, glow: 0.3 },
  { t: 0.62, name: "Evening", tint: [1.0, 0.76, 0.52], desat: 0.0, glow: 0.6 },
  { t: 0.78, name: "Dusk", tint: [0.66, 0.53, 0.76], desat: 0.15, glow: 0.85 },
  { t: 1.0, name: "Night", tint: [0.42, 0.48, 0.72], desat: 0.35, glow: 1.0 },
];
export function todLook(t) {
  let i = 0;
  while (i < TOD_STOPS.length - 2 && t > TOD_STOPS[i + 1].t) i++;
  const a = TOD_STOPS[i], b = TOD_STOPS[i + 1];
  const k = Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t)));
  const ease = k * k * (3 - 2 * k);
  return { tint: a.tint.map((v, j) => v + (b.tint[j] - v) * ease), desat: a.desat + (b.desat - a.desat) * ease, glow: a.glow + (b.glow - a.glow) * ease, name: (k < 0.5 ? a : b).name };
}
export const TOD_NAMES = TOD_STOPS.map((x) => ({ t: x.t, name: x.name }));

// ---------- lights: glowing spots on the map (torches, mushrooms, chandeliers...) ----------
// Each light is a small hidden marker item that the GM can move; everyone draws the glow from it.
export const LIGHT_KEY = `${ID}/light`;
export const LIGHT_TOOL = `${ID}/lights`;
export const LIGHT_MAX = 32;
// color, size in squares, brightness, flame flicker 0..1, slow pulse 0..1
export const LIGHT_PRESETS = [
  { k: "torch", name: "Torch", icon: "torch", color: "#ff9a40", r: 4, power: 1.1, flame: 1, pulse: 0 },
  { k: "candle", name: "Candle", icon: "candle-light", color: "#ffc070", r: 2, power: 0.8, flame: 0.6, pulse: 0 },
  { k: "campfire", name: "Campfire", icon: "campfire", color: "#ff7e30", r: 6, power: 1.3, flame: 1, pulse: 0 },
  { k: "chandelier", name: "Chandelier", icon: "ceiling-light", color: "#ffd28c", r: 7, power: 1.0, flame: 0.25, pulse: 0 },
  { k: "lantern", name: "Lantern", icon: "lantern-flame", color: "#ffc874", r: 5, power: 1.0, flame: 0.35, pulse: 0 },
  { k: "mushrooms", name: "Glowing mushrooms", icon: "mushrooms-cluster", color: "#b45cff", r: 3, power: 1.3, flame: 0, pulse: 0.45 },
  { k: "crystal", name: "Crystals", icon: "crystal-cluster", color: "#5cc8ff", r: 3, power: 1.0, flame: 0, pulse: 0.35 },
  { k: "lava", name: "Lava", icon: "lava", color: "#ff5a1e", r: 5, power: 1.2, flame: 0.2, pulse: 0.3 },
];
export const lightPreset = (k) => LIGHT_PRESETS.find((p) => p.k === k) || LIGHT_PRESETS[0];
const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
export function lightOf(item) {
  const m = item && item.metadata && item.metadata[LIGHT_KEY];
  if (!m) return null;
  const p = lightPreset(m.k);
  return {
    k: p.k,
    color: /^#[0-9a-f]{6}$/i.test(m.color || "") ? m.color : p.color,
    r: num(m.r, p.r, 0.5, 30), power: num(m.power, p.power, 0, 3),
    flame: num(m.flame, p.flame, 0, 1), pulse: num(m.pulse, p.pulse, 0, 1),
    on: m.on !== false,
  };
}
export const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
export const isVideo = (url, kind) => kind === "video" || /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url || "");
export const CLASSES = ["Berserker", "Commander", "Hunter", "Mage", "Oathsworn", "Shadowmancer", "Shepherd", "Songweaver", "Stormshifter", "The Cheat", "Zephyr"];
export function partyOf(md) {
  const p = (md && md[PARTY_KEY]) || {};
  return { show: p.show !== false, style: p.style === "cutouts" ? "cutouts" : "cards", bird: p.bird !== false, offset: Number.isFinite(Number(p.offset)) ? Number(p.offset) : 0, size: Number.isFinite(Number(p.size)) ? Number(p.size) : 150, gap: Number.isFinite(Number(p.gap)) ? Number(p.gap) : 12, members: p.members || {}, order: Array.isArray(p.order) ? p.order : [] };
}
// Card widths for the bar: overall size, spacing and each hero's own size, shrunk to fit the screen.
export function barLayout(md, vw) {
  const p = partyOf(md);
  const urls = partyList(md);
  const n = urls.length;
  const scale = (u) => Math.max(0.5, Math.min(2.5, Number((p.members[u] || {}).scale) || 1));
  const sum = urls.reduce((a, u) => a + scale(u), 0) || 1;
  const avail = vw - 60 - p.gap * Math.max(0, n - 1);
  const base = Math.min(p.size, avail / sum);
  const widths = {};
  for (const u of urls) widths[u] = Math.max(40, Math.round(base * scale(u)));
  const ws = Object.values(widths);
  const total = ws.reduce((a, b) => a + b, 0) + p.gap * Math.max(0, n - 1) + 16;
  const maxW = ws.length ? Math.max(...ws) : 0;
  return { urls, widths, gap: p.gap, total, maxW };
}
// Heroes in bar order: saved order first, then any new ones; hidden ones left out.
export function partyList(md) {
  const heroes = Array.isArray(md[HEROES_KEY]) ? md[HEROES_KEY] : [];
  const p = partyOf(md);
  const ordered = [...p.order.filter((u) => heroes.includes(u)), ...heroes.filter((u) => !p.order.includes(u))];
  return ordered.filter((u) => !(p.members[u] && p.members[u].hidden));
}

export const MAX_ACTIONS = 3;
export const REACTIONS = [
  { k: "d", label: "Def", name: "Defend" },
  { k: "i", label: "Int", name: "Interpose" },
  { k: "o", label: "Opp", name: "Opportunity Attack" },
  { k: "h", label: "Help", name: "Help" },
];
export const SKILLS = ["Arcana", "Examination", "Finesse", "Influence", "Insight", "Lore", "Might", "Naturecraft", "Perception", "Stealth"];
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
// Limited-use abilities in a stat block: "(1/encounter)", "2/round", "1/turn", "1/day", "1/Safe Rest".
const USE_RE = /\b(\d+)\s*\/\s*(turn|round|encounter|combat|day|safe rest|field rest|rest)\b/i;
export function extractUses(mon) {
  const list = [];
  const scan = (arr) => {
    for (const a of arr || []) {
      const m = `${a.name || ""} ${a.desc || ""}`.match(USE_RE);
      if (!m) continue;
      const per = m[2].toLowerCase() === "combat" ? "encounter" : m[2].toLowerCase();
      const name = clean(a.name || "").replace(/\s*\(?\b\d+\s*\/\s*(turn|round|encounter|combat|day|safe rest|field rest|rest)\b\)?\.?/i, "").trim() || "Ability";
      if (!list.some((u) => u.name === name && u.per === per)) list.push({ name, max: Math.max(1, Math.min(9, Number(m[1]))), per, used: 0 });
    }
  };
  if (!mon) return list;
  scan(mon.abilities); scan(mon.actions);
  for (const mm of mon.members || []) { scan(mm.abilities); scan(mm.actions); }
  return list;
}
// Refresh uses from a stat block, keeping what was already spent.
export function setUses(e, mon) {
  const old = Array.isArray(e.uses) ? e.uses : [];
  e.uses = extractUses(mon).map((u) => { const o = old.find((x) => x.name === u.name && x.per === u.per); return o ? { ...u, used: Math.min(u.max, o.used) } : u; });
}
export function resetUses(e, pers) { for (const u of e.uses || []) if (pers.includes(u.per)) u.used = 0; }

export function applyMonster(e, mon, heroCount = 0) {
  e.linked = true;
  setUses(e, mon);
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
  if (!Array.isArray(e.assessed)) e.assessed = [];
  if (!e.hp) e.hp = {};
  if (!e.temp) e.temp = {};
  if (e.nact === undefined) e.nact = 1;
  if (e.maxHp === undefined) e.maxHp = 0;
  if (e.armor === undefined) e.armor = "";
  if (e.color === undefined) e.color = 0;
  if (!Array.isArray(e.conds)) e.conds = [];
  if (e.kind === "hero") { if (e.wounds === undefined) e.wounds = 0; if (!e.maxWounds) e.maxWounds = 6; }
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

// ---------- conditions (Nimble core rules + glossary), with turn/round timers ----------
const INCAP = "Incapacitated: can't do anything. Attacks against you have advantage, and melee attacks that hit, crit.";
export const CONDITIONS = [
  { k: "blind", name: "Blind", tip: "Can't see. Attacks against you have advantage, and your attacks have disadvantage." },
  { k: "charged", name: "Charged", dur: "combat", tip: "Some spells and abilities have extra effects when Charged. Gained from lightning damage; lasts 1 minute or until combat ends." },
  { k: "charmed", name: "Charmed", tip: "Sees the charmer as an ally. The charmer has advantage on social interactions with you." },
  { k: "conc", name: "Concentrating", tip: "Can only Concentrate on 1 thing at a time. DC 10 STR save when crit, or it breaks." },
  { k: "dazed", name: "Dazed", dur: "endNext", tip: "Heroes lose 1 action; monsters lose their move OR 1 attack on their next turn." },
  { k: "deafened", name: "Deafened", tip: "Can't hear." },
  { k: "distracted", name: "Distracted", tip: "Adjacent to or Taunted by an ally, or can't see you. Does nothing on its own; some abilities have extra effects against it." },
  { k: "dying", name: "Dying", tip: "At 0 HP. Max 1 action. Taking damage causes 2 Wounds (a crit 3). Attacking causes 1 Wound unless you pass a DC 10 STR save." },
  { k: "empowered", name: "Empowered", x: true, tip: "Attack damage increased by X." },
  { k: "frightened", name: "Frightened", tip: "Disadvantage on rolls when the source of fear is near; Speed halved when moving closer to it." },
  { k: "grappled", name: "Grappled", tip: "Held by another creature. Attacks against either of you have advantage." },
  { k: "guilty", name: "Guilty", tip: "A creature who crits is Guilty. Some abilities have extra effects against it." },
  { k: "hampered", name: "Hampered", tip: "Actions or movement reduced (Dazed, Grappled/Restrained, Prone, Slowed, in Difficult Terrain). Some abilities have extra effects against it." },
  { k: "incap", name: "Incapacitated", tip: "Can't do anything. Attacks against you have advantage, and melee attacks that hit, crit." },
  { k: "invisible", name: "Invisible", tip: "Can't be seen. Your attacks have advantage, and attacks against you have disadvantage." },
  { k: "paralyzed", name: "Paralyzed", tip: INCAP },
  { k: "petrified", name: "Petrified", tip: "Incapacitated, and a rock: immune to most damage except large explosions, picks or similar tools." },
  { k: "poisoned", name: "Poisoned", tip: "Disadvantage on all rolls (typically, healing ends it)." },
  { k: "prone", name: "Prone", tip: "Movement costs twice as much, and disadvantage on attacks. Melee attacks against you have advantage; ranged have disadvantage. Spend 3 spaces of Speed to stand up." },
  { k: "restrained", name: "Restrained", tip: "Can't move. Attacks against you have advantage." },
  { k: "riding", name: "Riding", tip: "You move with the creature you're riding; it attacks you with disadvantage, and attacks that miss you strike it." },
  { k: "silenced", name: "Silenced", tip: "Can't cast spells or use other abilities that require speaking (e.g. Commander's Orders)." },
  { k: "slowed", name: "Slowed", dur: "endNext", tip: "Speed halved during your next turn." },
  { k: "smoldering", name: "Smoldering", tip: "Does nothing on its own. Some spells and abilities have extra effects against Smoldering creatures, ending the condition (e.g. Ignite, Pyroclasm)." },
  { k: "stunned", name: "Stunned", tip: INCAP },
  { k: "taunted", name: "Taunted", dur: "endNext", tip: "Disadvantage on attacks except against the most recent taunter." },
  { k: "unconscious", name: "Unconscious", tip: INCAP },
  { k: "weakened", name: "Weakened", x: true, tip: "Attack damage decreased by X." },
];
export const condDef = (k) => CONDITIONS.find((c) => c.k === k);
// What a creature can do comes first; setup markers last.
export const COND_ORDER = ["incap", "paralyzed", "stunned", "unconscious", "petrified", "dying", "restrained", "grappled", "dazed", "prone", "frightened", "blind", "charmed", "silenced", "taunted", "slowed", "poisoned", "invisible", "deafened", "riding", "empowered", "weakened", "hampered", "conc", "charged", "distracted", "smoldering", "guilty", "custom"];
export const DURATIONS = [
  { k: "endNext", label: "Until the end of its next turn" },
  { k: "startNext", label: "Until the start of its next turn" },
  { k: "endThis", label: "Until the end of this turn" },
  { k: "endSrc", label: "Until the end of the current creature's next turn" },
  { k: "rounds", label: "For a number of rounds" },
  { k: "combat", label: "Until combat ends" },
  { k: "save", label: "Until it saves (remove by hand)" },
  { k: "until", label: "Until removed" },
];

// Add a condition. Named conditions don't stack (Nimble): a repeat replaces the old one with the new timer.
export function addCond(s, e, { k, name, x, dur, n }) {
  if (!Array.isArray(e.conds)) e.conds = [];
  const c = { cid: Math.random().toString(36).slice(2, 9), k: k || "custom", name: String(name || "").slice(0, 40), dur: dur || "until", seen: 0, srcSeen: 0 };
  if (x !== undefined && x !== "" && Number.isFinite(Number(x))) c.x = Number(x);
  if (dur === "endThis" || dur === "endSrc") {
    if (!s.active) c.dur = "until";
    else { c.src = s.active; c.need = dur === "endThis" ? 0 : 1; c.dur = "endSrc"; }
  }
  if (dur === "rounds") c.until = Math.max(1, s.round || 1) + Math.max(1, Number(n) || 1);
  if (c.k !== "custom") e.conds = e.conds.filter((o) => o.k !== c.k);
  e.conds.push(c);
}
export function removeCond(e, cid) { e.conds = (e.conds || []).filter((c) => c.cid !== cid); }
function condsOnStart(s, e) {
  if (!e) return;
  e.conds = (e.conds || []).filter((c) => c.dur !== "startNext");
  for (const c of e.conds) c.seen = (c.seen || 0) + 1;
  for (const o of s.entries) for (const c of o.conds || []) if (c.dur === "endSrc" && c.src === e.id) c.srcSeen = (c.srcSeen || 0) + 1;
}
function condsOnEnd(s, e) {
  if (!e) return;
  e.conds = (e.conds || []).filter((c) => !(c.dur === "endNext" && c.seen >= 1));
  for (const o of s.entries) o.conds = (o.conds || []).filter((c) => !(c.dur === "endSrc" && c.src === e.id && (c.srcSeen || 0) >= (c.need ?? 1)));
}
function condsOnRound(s) {
  for (const o of s.entries) o.conds = (o.conds || []).filter((c) => !(c.dur === "rounds" && s.round >= c.until));
}
// When combat ends, everything with a timer goes; "until removed" and "until it saves" stay.
export function condsOnCombatEnd(s) {
  for (const o of s.entries) o.conds = (o.conds || []).filter((c) => c.dur === "until" || c.dur === "save");
}
// Short timer text for a condition chip.
export function condTimer(s, c) {
  const src = c.src && s.entries.find((x) => x.id === c.src);
  switch (c.dur) {
    case "endNext": return c.seen >= 1 ? "ends this turn" : "till end of next turn";
    case "startNext": return "till its next turn";
    case "endSrc": return !src ? "" : (c.need === 0 || c.srcSeen >= 1) && s.active === c.src ? `ends with ${src.name}'s turn` : c.need === 0 ? "till end of this turn" : `till end of ${src.name}'s next turn`;
    case "rounds": return `till round ${c.until}`;
    case "combat": return "till combat ends";
    case "save": return "save ends";
    default: return "";
  }
}

// ---------- turn flow ----------
const legendaries = (s) => s.entries.filter((e) => e.kind === "legendary");
export const actors = (s) => s.entries.filter((e) => e.kind !== "legendary");

export function startTurn(s, id) {
  const e = s.entries.find((x) => x.id === id);
  if (!e) return false;
  s.active = id;
  s.phase = "turn";
  onTurnStart(e);
  condsOnStart(s, e);
  resetUses(e, ["turn"]);
}

export function finishTurn(s, id) {
  const e = s.entries.find((x) => x.id === id);
  if (!e) return false;
  if (s.phase === "legendary") {
    onTurnEnd(e);
    condsOnEnd(s, e);
    s.legQueue = s.legQueue.filter((x) => x !== id);
    if (s.legQueue.length) {
      s.active = s.legQueue[0];
      onTurnStart(s.entries.find((x) => x.id === s.active));
      condsOnStart(s, s.entries.find((x) => x.id === s.active));
    } else {
      s.active = null; s.phase = "pick";
      startPending(s);
    }
    return;
  }
  onTurnEnd(e);
  condsOnEnd(s, e);
  if (!s.done.includes(id)) s.done.push(id);
  const legs = legendaries(s);
  if (e.kind === "hero" && legs.length) {
    s.phase = "legendary";
    s.legQueue = legs.map((x) => x.id);
    s.active = s.legQueue[0];
    onTurnStart(legs[0]);
    condsOnStart(s, legs[0]);
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
  condsOnRound(s);
  for (const o of s.entries) resetUses(o, ["round"]);
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
