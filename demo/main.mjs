/**
 * Demo UI for the Crows village generator.
 *
 * Everything below the control panel is the shipped generator: `buildVillagePlan`
 * lays the settlement out and `renderVillageSvg` draws it. This file only turns
 * form controls into a Village record and puts the resulting SVG on the page.
 */

import { buildVillagePlan, INSTITUTION_PLACEMENT, PLAN_FORMS, housingCountFor, defaultPlanParams }
  from "../module/helpers/village-plan.mjs";
import { INSTITUTION_STAMPS } from "../module/helpers/village-stamp-art.mjs";
import { loadStampArt, renderVillageSvg } from "./render.mjs";

/* -------------------------------------------- */
/*  Catalogue                                   */
/* -------------------------------------------- */

/** The twelve institution types the placement model knows, in catalogue order. */
const INSTITUTIONS = Object.keys(INSTITUTION_PLACEMENT).map(type => ({
  type,
  label: INSTITUTION_STAMPS[type]?.label ?? type
}));

/** C:2232 — the six a village is founded with. */
const STARTING_SIX = ["blacksmith", "crypt", "generalStore", "inn", "temple", "stables"];

const NAME_PARTS = [
  ["Bal", "Cor", "Dun", "Eld", "Grim", "Hald", "Kel", "Mor", "Rav", "Thur", "Vasc", "Wynd"],
  ["haun", "mar", "ker", "wold", "bry", "thorn", "fell", "mere", "gard", "hollow", "vale", "reach"],
  ["is", "en", "ock", "ay", "", "", "wick", "ford"]
];

/* -------------------------------------------- */
/*  State                                       */
/* -------------------------------------------- */

const state = {
  name: "Balhaunis",
  seed: "balhaunis-32",
  form: PLAN_FORMS.RUIN,
  prosperity: 6,
  institutions: new Set(STARTING_SIX),
  style: "crows",
  stamps: true,
  showTitle: false
};

/** The plan on screen, kept so a stage can be redrawn against it. */
let plan = null;
let art = null;
/** The SVG as rendered, before the page strips its size for layout. */
let svgSource = "";
/** How long the plan on screen took to lay out. */
let lastPlanMs = 0;

const el = id => document.getElementById(id);
const rng = () => Math.random().toString(36).slice(2, 8);

/* -------------------------------------------- */
/*  Permalink                                   */
/* -------------------------------------------- */

function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  if (!params.has("seed")) return;
  const number = (key, fallback) => {
    const value = Number(params.get(key));
    return Number.isFinite(value) ? value : fallback;
  };
  state.seed = params.get("seed");
  state.name = params.get("name") ?? state.name;
  state.form = params.get("form") === PLAN_FORMS.OPEN ? PLAN_FORMS.OPEN : PLAN_FORMS.RUIN;
  state.prosperity = Math.max(0, Math.min(10, number("prosperity", state.prosperity)));
  state.style = params.get("style") === "slate" ? "slate" : "crows";
  state.stamps = params.get("art") !== "drawn";
  state.showTitle = params.get("title") === "1";
  const list = params.get("inst");
  if (list !== null) {
    const known = new Set(INSTITUTIONS.map(i => i.type));
    state.institutions = new Set(list.split(",").filter(type => known.has(type)));
  }
}

function writeHash() {
  const params = new URLSearchParams({
    name: state.name,
    seed: state.seed,
    form: state.form,
    prosperity: String(state.prosperity),
    style: state.style,
    art: state.stamps ? "stamps" : "drawn",
    title: state.showTitle ? "1" : "0",
    inst: [...state.institutions].join(",")
  });
  history.replaceState(null, "", `#${params}`);
}

/* -------------------------------------------- */
/*  Generation                                  */
/* -------------------------------------------- */

function villageRecord() {
  return {
    name: state.name,
    sceneSeed: state.seed,
    prosperity: state.prosperity,
    institutions: [...state.institutions].map((type, index) => ({
      id: `${type}-${index}`,
      type,
      level: 1
    }))
  };
}

/**
 * Lay the village out again.
 *
 * `locks` names the stages to carry over from the plan already on screen, which
 * is what lets "new streets" reuse a boundary while everything downstream of it
 * is redrawn from a fresh seed.
 */
function generate({ locks = null } = {}) {
  const village = villageRecord();
  const previous = locks ? plan : null;

  const started = performance.now();
  plan = buildVillagePlan(village, {
    params: { form: state.form },
    previous,
    // Stages absent from `locks` are explicitly unlocked: handed a previous
    // plan the planner otherwise reuses every physical stage by default.
    locks: locks ? { boundary: false, streets: false, plots: false, dressing: false, ...locks } : null
  });
  lastPlanMs = performance.now() - started;
  draw();
}

/**
 * Draw the plan already in hand.
 *
 * Palette, buildings and the drawn title are appearance, not layout, so they
 * must not re-plan: doing so would throw away whatever a "new streets" reroll
 * had just locked in, and change the village out from under someone who only
 * asked for a darker map.
 */
function draw() {
  if (!plan) return;
  const svg = renderVillageSvg(plan, {
    art,
    style: state.style,
    showTitle: state.showTitle,
    stamps: state.stamps
  });

  svgSource = svg;
  el("map").innerHTML = svg;
  // Dropped so the element scales with its column; the download keeps them, so
  // the file opens at the plan's real size rather than at whatever fills a page.
  el("map").firstElementChild?.removeAttribute("width");
  el("map").firstElementChild?.removeAttribute("height");
  showStats(lastPlanMs, svg.length);
  writeHash();
}

function showStats(planMs, bytes) {
  const s = plan.stats;
  const cells = [
    ["Plots", `${s.plots}${s.vacant ? ` (${s.vacant} free)` : ""}`],
    ["Institutions", `${s.institutions}${s.unplacedInstitutions ? ` of ${s.institutions + s.unplacedInstitutions}` : ""}`],
    ["Houses", `${s.housing}${s.unbuiltHousing ? ` of ${s.housing + s.unbuiltHousing}` : ""}`],
    ["Streets", s.streets],
    ["Planned in", `${planMs.toFixed(1)} ms`],
    ["SVG size", `${Math.round(bytes / 1024)} KB`]
  ];
  el("stats").innerHTML = cells
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
    .join("");

  const shortfall = [];
  if (s.unplacedInstitutions) shortfall.push(`${s.unplacedInstitutions} institution(s) found no plot`);
  if (s.unbuiltHousing) shortfall.push(`${s.unbuiltHousing} house(s) had nowhere to stand`);
  if (s.growth?.exhausted) shortfall.push("the shell is full — no further lane fits");
  el("shortfall").textContent = shortfall.length ? `Shortfall: ${shortfall.join("; ")}.` : "";
  el("shortfall").hidden = !shortfall.length;
}

/* -------------------------------------------- */
/*  Controls                                    */
/* -------------------------------------------- */

function buildInstitutionChips() {
  el("institutions").innerHTML = INSTITUTIONS.map(({ type, label }) => `
    <label class="chip">
      <input type="checkbox" value="${type}"${state.institutions.has(type) ? " checked" : ""}>
      <span>${label}</span>
    </label>`).join("");

  el("institutions").addEventListener("change", event => {
    const { value, checked } = event.target;
    if (checked) state.institutions.add(value);
    else state.institutions.delete(value);
    syncDerived();
    generate();
  });
}

/** Readouts that follow from the controls rather than from a built plan. */
function syncDerived() {
  const params = defaultPlanParams({ form: state.form });
  const houses = housingCountFor(villageRecord(), params);
  el("prosperity-value").textContent = `${state.prosperity} — ${houses} homes`;
  el("institution-count").textContent = `${state.institutions.size} of ${INSTITUTIONS.length}`;
}

function segmented(id, key, apply) {
  el(id).addEventListener("click", event => {
    const button = event.target.closest("button[data-value]");
    if (!button) return;
    const raw = button.dataset.value;
    state[key] = raw === "true" ? true : raw === "false" ? false : raw;
    for (const sibling of el(id).querySelectorAll("button")) {
      sibling.setAttribute("aria-pressed", String(sibling === button));
    }
    apply();
  });
}

function paintControls() {
  el("name").value = state.name;
  el("seed").value = state.seed;
  el("prosperity").value = String(state.prosperity);
  el("title").checked = state.showTitle;
  for (const group of document.querySelectorAll("[data-segmented]")) {
    const key = group.dataset.segmented;
    for (const button of group.querySelectorAll("button")) {
      button.setAttribute("aria-pressed", String(String(state[key]) === button.dataset.value));
    }
  }
  for (const box of el("institutions").querySelectorAll("input")) {
    box.checked = state.institutions.has(box.value);
  }
  syncDerived();
}

function wire() {
  // The name only labels the plan, so it is a redraw rather than a re-plan —
  // typing a name should not shuffle the streets under the cursor.
  el("name").addEventListener("input", event => {
    state.name = event.target.value;
    if (plan) plan.name = state.name;
    draw();
  });

  el("seed").addEventListener("input", event => {
    state.seed = event.target.value;
    generate();
  });

  el("prosperity").addEventListener("input", event => {
    state.prosperity = Number(event.target.value);
    syncDerived();
    generate();
  });

  el("title").addEventListener("change", event => {
    state.showTitle = event.target.checked;
    draw();
  });

  segmented("form-group", "form", () => { syncDerived(); generate(); });
  segmented("art-group", "stamps", draw);
  segmented("style-group", "style", draw);

  el("new-village").addEventListener("click", () => {
    const [a, b, c] = NAME_PARTS.map(part => part[Math.floor(Math.random() * part.length)]);
    state.name = `${a}${b}${c}`;
    state.seed = `${state.name.toLowerCase()}-${rng()}`;
    el("name").value = state.name;
    el("seed").value = state.seed;
    plan = null;
    generate();
  });

  // The plan's stages draw from independent RNG streams, so a fresh seed with
  // the upstream stages locked redraws only what sits below the lock.
  el("reroll-streets").addEventListener("click", () => {
    state.seed = `${state.seed.replace(/~.*$/, "")}~${rng()}`;
    el("seed").value = state.seed;
    generate({ locks: { boundary: true } });
  });

  el("reroll-plots").addEventListener("click", () => {
    state.seed = `${state.seed.replace(/~.*$/, "")}~${rng()}`;
    el("seed").value = state.seed;
    generate({ locks: { boundary: true, streets: true } });
  });

  el("download").addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([svgSource], { type: "image/svg+xml" }));
    const link = Object.assign(document.createElement("a"), {
      href: url,
      download: `${(state.name || "village").toLowerCase().replace(/\W+/g, "-")}.svg`
    });
    link.click();
    URL.revokeObjectURL(url);
  });

  el("copy-link").addEventListener("click", async event => {
    await navigator.clipboard?.writeText(location.href);
    const button = event.currentTarget;
    const was = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => { button.textContent = was; }, 1200);
  });

  el("starting-six").addEventListener("click", () => {
    state.institutions = new Set(STARTING_SIX);
    paintControls();
    generate();
  });

  el("all-institutions").addEventListener("click", () => {
    state.institutions = new Set(INSTITUTIONS.map(i => i.type));
    paintControls();
    generate();
  });
}

/* -------------------------------------------- */
/*  Boot                                        */
/* -------------------------------------------- */

async function boot() {
  readHash();
  buildInstitutionChips();
  paintControls();
  wire();

  // Drawn first: the map should be on screen before the art finishes arriving,
  // and the drawn path needs no art at all.
  art = null;
  generate();

  try {
    art = await loadStampArt();
    if (art.failed) {
      el("art-note").textContent = `${art.failed} art file(s) did not load; those elements are drawn instead.`;
      el("art-note").hidden = false;
    }
  } catch {
    el("art-note").textContent = "The art set did not load; showing drawn buildings.";
    el("art-note").hidden = false;
  }
  // Same plan, now with somewhere to stand the buildings.
  draw();
}

boot();
