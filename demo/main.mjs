/**
 * Page wiring for the canonical village map.
 *
 * The map has two variables and this page exposes both: which institutions have
 * been founded and how far each has been raised, and how prosperous the village
 * is. Everything else about Balhaunis is authored.
 */

import { INSTITUTION_STAMPS } from "../module/helpers/village-stamp-art.mjs";
import {
  INSTITUTION_TYPES,
  createMap,
  growthPercent,
  interiorUrl,
  setMapName,
  setWeather,
  toPng,
  updateMap
} from "./village.mjs";
import { institutionPurchasableMaxLevel, institutionRules, institutionServices } from "./rules.mjs";

/** C:2232 — the six a village is founded with. */
const STARTING_SIX = ["blacksmith", "crypt", "generalStore", "inn", "temple", "stables"];

const INSTITUTIONS = INSTITUTION_TYPES.map(type => ({
  type,
  label: INSTITUTION_STAMPS[type]?.label ?? type
}));

const LABELS = new Map(INSTITUTIONS.map(({ type, label }) => [type, label]));

/**
 * How far a chip will raise an institution.
 *
 * The purchasable top, not the table's last row: the temple has a sixth level
 * that Prosperity grants and gold cannot buy, and offering it as a click would
 * be selling something the rules do not.
 */
const topLevel = type => institutionPurchasableMaxLevel(type);

const gc = value => `${Number(value).toLocaleString("en-GB")} gc`;

const escape = value => String(value).replace(/[&<>"]/g, c => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]
));

const DEFAULT_NAME = "Balhaunis";

const state = {
  name: DEFAULT_NAME,
  prosperity: 4,
  /** C:2218 — the ruin is what keeps this off the village. */
  miasma: false,
  night: false,
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
  if (params.has("name")) state.name = params.get("name").slice(0, 28);
  state.miasma = params.get("miasma") === "1";
  state.night = params.get("night") === "1";
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
    return [[type, Number.isFinite(value) ? Math.max(1, Math.min(topLevel(type), value)) : 1]];
  }));
}

function writeHash() {
  const params = new URLSearchParams({
    name: state.name,
    prosperity: String(state.prosperity),
    founded: [...state.founded].map(([type, level]) => `${type}:${level}`).join(",")
  });
  if (state.miasma) params.set("miasma", "1");
  if (state.night) params.set("night", "1");
  if (state.selected) params.set("open", state.selected);
  history.replaceState(null, "", `#${params}`);
}

/* -------------------------------------------- */
/*  Render                                      */
/* -------------------------------------------- */

function render() {
  const projection = updateMap(map, state);
  setMapName(map, state.name);
  setWeather(map, state);
  document.title = state.name ? `${state.name} — Crows Village Map` : "Crows Village Map";
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
    else if (level < topLevel(type)) state.founded.set(type, level + 1);
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
      : `${LABELS.get(type)} — level ${level} of ${topLevel(type)}, drawn ${growthPercent(type, level)}% larger. Click to raise it.`;
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

  const level = state.founded.get(type) ?? null;
  const label = LABELS.get(type);
  const rules = institutionRules(type, level);
  panel.hidden = false;
  el("detail-name").textContent = label;
  el("detail-source").textContent = rules ? rules.roles.map(titleCase).join(" · ") : "";

  const interior = interiorUrl(type);
  const view = el("detail-view");
  if (level === null) {
    // Nothing has been built, so there is no room to look into.
    view.innerHTML = `<p class="empty">This plot is being held for the ${escape(label)}. Found it to see inside.</p>`;
  } else if (interior) {
    view.innerHTML = `<img src="${interior}" alt="Interior of the ${escape(label)}" loading="lazy">`;
  } else {
    view.innerHTML = `<p class="empty">No interior has been drawn for the ${escape(label)} yet.</p>`;
  }

  el("detail-rules").innerHTML = rules
    ? servicesList(type, level, rules) + rulesTable(rules, type, level)
    : "";

  el("detail-level").textContent = level === null ? "Not founded" : `Level ${level} of ${rules.top}`;
  el("detail-down").disabled = level === null;
  el("detail-up").disabled = level !== null && level >= topLevel(type);
  el("detail-up").textContent = level === null
    ? `Found — ${gc(rules.foundingPrice)}`
    : rules.nextPrice != null ? `Raise — ${gc(rules.nextPrice)}` : "Fully raised";
}

/**
 * What you can walk in and do, before what another level would buy.
 *
 * First in the panel because it is the question actually being asked of a
 * building on a map: the ladder underneath is a spending decision, and only
 * matters once you know what the place is for.
 */
function servicesList(type, level, rules) {
  if (level == null) {
    return `<p class="hint services-empty">Founding the ${escape(rules.label)} costs ${gc(rules.foundingPrice)}. Nothing stands here yet.</p>`;
  }
  const services = institutionServices(type, level, state.prosperity);
  if (!services.length) return "";

  const rows = services.map(service => {
    const boons = service.boons ? `
      <ul class="boons">
        ${service.boons.map(b => `<li><b>${escape(b.label.replace(/^Boon of /, ""))}</b> — ${escape(b.summary)}</li>`).join("")}
      </ul>` : "";
    return `<div><dt>${escape(service.name)}</dt><dd>${escape(service.detail)}${boons}</dd></div>`;
  }).join("");

  return `<dl class="services">${rows}</dl>`;
}

/**
 * The institution's advancement table, from the system's own rules data.
 *
 * Shown in full rather than only the current row: the point of the panel is the
 * decision — what the next level costs and what it buys — and that is only
 * legible against the rows either side of it.
 */
function rulesTable(rules, type, level) {
  const grown = growthPercent(type, level);
  // The crypt and the temple have no stocked axis — their level *is* the
  // effect — so the ladder carries prices alone and says why once underneath,
  // rather than repeating one sentence down every row.
  const rows = rules.rows.map(row => `
    <tr${row.current ? ' class="current"' : ""}>
      <th scope="row">${row.level}</th>
      <td class="price">${row.level === 1 ? "founding" : row.price == null ? "—" : gc(row.price)}</td>
      ${rules.ladderNote ? "" : `<td>${escape(row.effect ?? "—")}</td>`}
    </tr>`).join("");

  const capstone = rules.capstone ? `
    <p class="capstone${rules.capstone.met ? " met" : ""}">
      <strong>Level ${rules.capstone.atLevel} at Prosperity 10</strong> —
      ${escape(rules.capstone.text)}
    </p>` : "";

  const unbuyable = rules.purchasableTop < rules.top ? `
    <p class="hint">Level ${rules.top} has no price: Prosperity grants it, gold cannot buy it.</p>` : "";

  return `
    <h3 class="ladder-heading">What another level buys</h3>
    <table class="ladder${rules.ladderNote ? " ladder-narrow" : ""}">
      <caption>Pay now, gain a Prosperity at once, and the level opens next cycle.</caption>
      <thead><tr>
        <th scope="col">Lv</th><th scope="col">To reach</th>
        ${rules.ladderNote ? "" : '<th scope="col">What it buys</th>'}
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${rules.ladderNote ? `<p class="hint">${escape(rules.ladderNote)}</p>` : ""}
    ${capstone}${unbuyable}
    <p class="hint">On the map this one is drawn ${grown === 0 ? "at its authored size" : `${grown}% larger`} — upgrading has no art of its own, so size is the visual difference.</p>`;
}

const titleCase = value => String(value).replace(/^./, c => c.toUpperCase());

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
  el("village-name").addEventListener("input", event => {
    state.name = event.target.value;
    render();
  });

  el("prosperity").addEventListener("input", event => {
    state.prosperity = Number(event.target.value);
    syncProsperity();
    render();
  });

  for (const key of ["miasma", "night"]) {
    el(key).addEventListener("change", event => {
      state[key] = event.target.checked;
      render();
    });
  }

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
    state.founded = new Map(INSTITUTION_TYPES.map(type => [type, topLevel(type)]));
    render();
  });

  el("detail-up").addEventListener("click", () => {
    const level = state.founded.get(state.selected);
    state.founded.set(state.selected, level === undefined ? 1 : Math.min(topLevel(state.selected), level + 1));
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
      const slug = (state.name || "village").toLowerCase().replace(/\W+/g, "-").replace(/^-|-$/g, "");
      Object.assign(document.createElement("a"), {
        href: url,
        download: `${slug || "village"}-prosperity-${state.prosperity}.png`
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
el("village-name").value = state.name;
el("miasma").checked = state.miasma;
el("night").checked = state.night;
el("prosperity").value = String(state.prosperity);
syncProsperity();
map = createMap(el("map"));
buildHover();
wire();
render();
