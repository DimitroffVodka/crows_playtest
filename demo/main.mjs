/**
 * Page wiring for the canonical village map.
 *
 * The map has two variables and this page exposes both: which institutions have
 * been founded and how far each has been raised, and how prosperous the village
 * is. Everything else about Balhaunis is authored.
 */

import { INSTITUTION_STAMPS } from "../module/helpers/village-stamp-art.mjs";
import {
  CANONICAL_INSTITUTION_LEVEL_SCALE,
  INSTITUTION_TYPES,
  MAX_INSTITUTION_LEVEL,
  createMap,
  interiorUrl,
  toPng,
  updateMap
} from "./village.mjs";

/** C:2232 — the six a village is founded with. */
const STARTING_SIX = ["blacksmith", "crypt", "generalStore", "inn", "temple", "stables"];

const INSTITUTIONS = INSTITUTION_TYPES.map(type => ({
  type,
  label: INSTITUTION_STAMPS[type]?.label ?? type
}));

const LABELS = new Map(INSTITUTIONS.map(({ type, label }) => [type, label]));

/** What each level does to the building, as a percentage for the UI. */
const GROWTH = CANONICAL_INSTITUTION_LEVEL_SCALE.map(scale => Math.round((scale - 1) * 100));

const state = {
  prosperity: 4,
  /** Institution type -> level. Absent means the plot is still waiting. */
  founded: new Map(STARTING_SIX.map(type => [type, 1])),
  /** Which institution the detail panel is showing, if any. */
  selected: null
};

const el = id => document.getElementById(id);
let map = null;

/* -------------------------------------------- */
/*  Permalink                                   */
/* -------------------------------------------- */

function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  if (!params.has("prosperity")) return;
  const prosperity = Number(params.get("prosperity"));
  if (Number.isFinite(prosperity)) state.prosperity = Math.max(-10, Math.min(10, Math.round(prosperity)));

  const known = new Set(INSTITUTION_TYPES);

  // Which panel is open travels too, so a link can point at one building.
  const open = params.get("open");
  if (open && known.has(open)) state.selected = open;

  // `founded` is `type:level` pairs, so a shared link carries the upgrades too.
  const list = params.get("founded");
  if (list === null) return;
  state.founded = new Map(list.split(",").filter(Boolean).flatMap(entry => {
    const [type, level] = entry.split(":");
    if (!known.has(type)) return [];
    const value = Math.round(Number(level));
    return [[type, Number.isFinite(value) ? Math.max(1, Math.min(MAX_INSTITUTION_LEVEL, value)) : 1]];
  }));
}

function writeHash() {
  const params = new URLSearchParams({
    prosperity: String(state.prosperity),
    founded: [...state.founded].map(([type, level]) => `${type}:${level}`).join(",")
  });
  if (state.selected) params.set("open", state.selected);
  history.replaceState(null, "", `#${params}`);
}

/* -------------------------------------------- */
/*  Render                                      */
/* -------------------------------------------- */

function render() {
  const projection = updateMap(map, state);
  showStats(projection);
  paintChips();
  paintDetail();
  writeHash();
}

function showStats(projection) {
  const raised = [...state.founded.values()].filter(level => level > 1).length;
  const cells = [
    ["Institutions", `${state.founded.size} of ${INSTITUTIONS.length}`],
    ["Raised above level 1", raised],
    ["Homes", projection.housing.length],
    ["Fields", projection.farmland.length],
    ["Trees & dressing", projection.dressing.length],
    ["Tiles on the scene", projection.tiles.length]
  ];
  el("stats").innerHTML = cells
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
    .join("");
}

function syncProsperity() {
  el("prosperity-value").textContent = state.prosperity > 0 ? `+${state.prosperity}` : String(state.prosperity);
}

/* -------------------------------------------- */
/*  Institution chips                           */
/* -------------------------------------------- */

function buildInstitutionChips() {
  el("institutions").innerHTML = INSTITUTIONS.map(({ type, label }) => `
    <button type="button" class="chip" data-type="${type}">
      <span class="chip-label">${label}</span>
      <span class="chip-level" aria-hidden="true"></span>
    </button>`).join("");

  el("institutions").addEventListener("click", event => {
    const type = event.target.closest("button[data-type]")?.dataset.type;
    if (!type) return;
    // One control, cycling: waiting -> level 1 -> 2 -> 3 -> waiting. The chip
    // has to say both whether a thing exists and how far it has been raised,
    // and a checkbox plus a stepper for each of twelve is a wall of controls.
    const level = state.founded.get(type);
    if (level === undefined) state.founded.set(type, 1);
    else if (level < MAX_INSTITUTION_LEVEL) state.founded.set(type, level + 1);
    else state.founded.delete(type);
    select(type);
  });
}

function paintChips() {
  for (const chip of el("institutions").querySelectorAll("button[data-type]")) {
    const { type } = chip.dataset;
    const level = state.founded.get(type);
    chip.classList.toggle("founded", level !== undefined);
    chip.classList.toggle("current", type === state.selected);
    chip.querySelector(".chip-level").textContent = level === undefined ? "" : `L${level}`;
    chip.title = level === undefined
      ? `${LABELS.get(type)} — not founded. Click to found it.`
      : `${LABELS.get(type)} — level ${level}, drawn ${GROWTH[level]}% larger. Click to raise it.`;
  }
}

/* -------------------------------------------- */
/*  Detail panel                                */
/* -------------------------------------------- */

function select(type) {
  state.selected = type;
  render();
}

function paintDetail() {
  const type = state.selected;
  const panel = el("detail");
  if (!type) {
    panel.hidden = true;
    return;
  }

  const level = state.founded.get(type);
  const label = LABELS.get(type);
  panel.hidden = false;
  el("detail-name").textContent = label;

  const interior = interiorUrl(type);
  const view = el("detail-view");
  if (level === undefined) {
    // Nothing has been built, so there is no room to look into.
    view.innerHTML = `<p class="empty">This plot is being held for the ${label}. Found it to see inside.</p>`;
  } else if (interior) {
    view.innerHTML = `<img src="${interior}" alt="Interior of the ${label}" loading="lazy">`;
  } else {
    view.innerHTML = `<p class="empty">No interior has been drawn for the ${label} yet.</p>`;
  }

  el("detail-level").textContent = level === undefined ? "Not founded" : `Level ${level} of ${MAX_INSTITUTION_LEVEL}`;
  el("detail-growth").textContent = level === undefined
    ? "The plot draws at its authored size."
    : GROWTH[level] === 0
      ? "Drawn at its authored size."
      : `Drawn ${GROWTH[level]}% larger on the map.`;

  el("detail-down").disabled = level === undefined;
  el("detail-up").disabled = level !== undefined && level >= MAX_INSTITUTION_LEVEL;
  el("detail-up").textContent = level === undefined ? "Found it" : "Raise";
}

/* -------------------------------------------- */
/*  Hover                                       */
/* -------------------------------------------- */

function buildHover() {
  const tip = el("tip");

  el("map").addEventListener("pointerover", event => {
    const type = event.target.closest?.(".institution")?.dataset.type;
    if (!type) return;
    const level = state.founded.get(type);
    tip.textContent = level === undefined
      ? `${LABELS.get(type)} — plot held, not founded`
      : `${LABELS.get(type)} — level ${level}`;
    tip.hidden = false;
    event.target.classList.add("hovered");
  });

  el("map").addEventListener("pointerout", event => {
    event.target.closest?.(".institution")?.classList.remove("hovered");
    tip.hidden = true;
  });

  // Positioned against the page rather than the SVG: the map is scaled to its
  // column, so a coordinate inside it is not a coordinate on screen.
  el("map").addEventListener("pointermove", event => {
    if (tip.hidden) return;
    const bounds = el("map").getBoundingClientRect();
    tip.style.left = `${event.clientX - bounds.left}px`;
    tip.style.top = `${event.clientY - bounds.top}px`;
  });

  el("map").addEventListener("click", event => {
    const type = event.target.closest?.(".institution")?.dataset.type;
    if (type) select(type);
  });
}

/* -------------------------------------------- */
/*  Controls                                    */
/* -------------------------------------------- */

function wire() {
  el("prosperity").addEventListener("input", event => {
    state.prosperity = Number(event.target.value);
    syncProsperity();
    render();
  });

  el("starting-six").addEventListener("click", () => {
    state.founded = new Map(STARTING_SIX.map(type => [type, 1]));
    render();
  });

  el("all-institutions").addEventListener("click", () => {
    state.founded = new Map(INSTITUTION_TYPES.map(type => [type, state.founded.get(type) ?? 1]));
    render();
  });

  el("no-institutions").addEventListener("click", () => {
    state.founded = new Map();
    render();
  });

  el("max-institutions").addEventListener("click", () => {
    state.founded = new Map(INSTITUTION_TYPES.map(type => [type, MAX_INSTITUTION_LEVEL]));
    render();
  });

  el("detail-up").addEventListener("click", () => {
    const level = state.founded.get(state.selected);
    state.founded.set(state.selected, level === undefined ? 1 : Math.min(MAX_INSTITUTION_LEVEL, level + 1));
    render();
  });

  el("detail-down").addEventListener("click", () => {
    const level = state.founded.get(state.selected);
    if (level === undefined) return;
    if (level <= 1) state.founded.delete(state.selected);
    else state.founded.set(state.selected, level - 1);
    render();
  });

  el("detail-close").addEventListener("click", () => {
    state.selected = null;
    render();
  });

  el("download").addEventListener("click", async event => {
    const button = event.currentTarget;
    const was = button.textContent;
    button.disabled = true;
    button.textContent = "Rendering…";
    try {
      const blob = await toPng(map, { scale: 0.5 });
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement("a"), {
        href: url,
        download: `balhaunis-prosperity-${state.prosperity}.png`
      }).click();
      URL.revokeObjectURL(url);
    } catch {
      button.textContent = "Could not render";
      setTimeout(() => { button.textContent = was; button.disabled = false; }, 1600);
      return;
    }
    button.textContent = was;
    button.disabled = false;
  });

  el("copy-link").addEventListener("click", async event => {
    await navigator.clipboard?.writeText(location.href);
    const button = event.currentTarget;
    const was = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => { button.textContent = was; }, 1200);
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && state.selected) {
      state.selected = null;
      render();
    }
  });
}

/* -------------------------------------------- */
/*  Boot                                        */
/* -------------------------------------------- */

readHash();
buildInstitutionChips();
el("prosperity").value = String(state.prosperity);
syncProsperity();
map = createMap(el("map"));
buildHover();
wire();
render();
