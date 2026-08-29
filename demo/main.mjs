/**
 * Page wiring for the canonical village map.
 *
 * Two controls, because the map only has two variables: which institutions have
 * been founded, and how prosperous the village is. Everything else is authored.
 */

import { INSTITUTION_STAMPS } from "../module/helpers/village-stamp-art.mjs";
import { INSTITUTION_TYPES, createMap, toPng, updateMap } from "./village.mjs";

/** C:2232 — the six a village is founded with. */
const STARTING_SIX = ["blacksmith", "crypt", "generalStore", "inn", "temple", "stables"];

const INSTITUTIONS = INSTITUTION_TYPES.map(type => ({
  type,
  label: INSTITUTION_STAMPS[type]?.label ?? type
}));

const state = {
  prosperity: 4,
  founded: new Set(STARTING_SIX)
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
  const list = params.get("founded");
  if (list !== null) {
    const known = new Set(INSTITUTION_TYPES);
    state.founded = new Set(list.split(",").filter(type => known.has(type)));
  }
}

function writeHash() {
  const params = new URLSearchParams({
    prosperity: String(state.prosperity),
    founded: [...state.founded].join(",")
  });
  history.replaceState(null, "", `#${params}`);
}

/* -------------------------------------------- */
/*  Render                                      */
/* -------------------------------------------- */

function render() {
  const projection = updateMap(map, state);
  showStats(projection);
  writeHash();
}

function showStats(projection) {
  const cells = [
    ["Institutions", `${state.founded.size} of ${INSTITUTIONS.length}`],
    ["Homes", projection.housing.length],
    ["Fields", projection.farmland.length],
    ["Trees & dressing", projection.dressing.length],
    ["Tiles on the scene", projection.tiles.length]
  ];
  el("stats").innerHTML = cells
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
    .join("");
}

/** The Prosperity readout, which has to make sense before anything is drawn. */
function syncProsperity() {
  el("prosperity-value").textContent = state.prosperity > 0 ? `+${state.prosperity}` : String(state.prosperity);
}

/* -------------------------------------------- */
/*  Controls                                    */
/* -------------------------------------------- */

function buildInstitutionChips() {
  el("institutions").innerHTML = INSTITUTIONS.map(({ type, label }) => `
    <label class="chip">
      <input type="checkbox" value="${type}"${state.founded.has(type) ? " checked" : ""}>
      <span>${label}</span>
    </label>`).join("");

  el("institutions").addEventListener("change", event => {
    const { value, checked } = event.target;
    if (checked) state.founded.add(value);
    else state.founded.delete(value);
    render();
  });
}

function paintControls() {
  el("prosperity").value = String(state.prosperity);
  for (const box of el("institutions").querySelectorAll("input")) {
    box.checked = state.founded.has(box.value);
  }
  syncProsperity();
}

function wire() {
  el("prosperity").addEventListener("input", event => {
    state.prosperity = Number(event.target.value);
    syncProsperity();
    render();
  });

  el("starting-six").addEventListener("click", () => {
    state.founded = new Set(STARTING_SIX);
    paintControls();
    render();
  });

  el("all-institutions").addEventListener("click", () => {
    state.founded = new Set(INSTITUTION_TYPES);
    paintControls();
    render();
  });

  el("no-institutions").addEventListener("click", () => {
    state.founded = new Set();
    paintControls();
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
}

/* -------------------------------------------- */
/*  Boot                                        */
/* -------------------------------------------- */

readHash();
buildInstitutionChips();
paintControls();
map = createMap(el("map"));
wire();
render();
