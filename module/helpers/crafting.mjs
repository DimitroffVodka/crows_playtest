/**
 * Crafting and IDing magic items — Playtest 2.
 *
 * Citations are `R:<line>` into the Rules book
 * (`01 Crows The Rules Book for Playtest 2.md`): crafting R:1665-1713,
 * IDing magic items R:1719-1733, the Craft Equipment and Identify Item rest
 * activities R:646-654.
 *
 * ## What Playtest 2 changed here
 *
 * - **Skills are gone.** A project names an *expertise*
 *   (`crafting.projects[].expertise`, renamed from `.skill`), and `CROWS.skills`
 *   no longer exists.
 * - **The prerequisite is USES OWNED, not a bonus.** R:1673: *"Every craftable
 *   item has an expertise and number of uses associated with it. You must have
 *   the appropriate expertise and number of uses to craft it."* That reads
 *   `expertises[key].max`, never `.value` — spending your alchemy uses on tests
 *   this morning does not make you unable to craft this evening.
 * - **Recipes are gone.** PT1's "if you outclass the prereq you need no recipe"
 *   has no counterpart in the PT2 text. `hasRecipe` / `prereqBonus` are no
 *   longer written.
 * - **An expertise applied to a crafting roll is a flat +4, and you may apply
 *   TWO** (R:1703) — not the usual one-per-test tier improvement. This is why
 *   crafting does not route through `expertise.mjs`'s `canSpendExpertise`,
 *   which enforces the test rule it is not subject to. A spend still decrements
 *   `value` and never touches `max`.
 * - **Materials are generic monster parts**, not named organs (changelog;
 *   R:1691 still calls them organs and vials of blood in flavour text, but the
 *   crafting requirement is a count).
 * - **Surplus points roll into another copy** of the same item (R:1709).
 * - **Interim material planning stays playable.** Until the dependent
 *   material-transaction ticket registers its inventory planner, a
 *   material-bearing project retains PT1's one-set default. Once registered,
 *   that planner owns strict set authorization (including zero).
 *
 * The pure half — prerequisites, point arithmetic, tier lookup — is what
 * `test/village.test.mjs` exercises; the `Roll` / `ChatMessage` half is below it.
 */

import { CROWS } from "../config.mjs";
import { readExpertiseUses } from "./expertise.mjs";

/** R:1681-1687 — the tools each crafting expertise needs. */
export const TOOL_FOR_EXPERTISE = Object.freeze({
  alchemy: "alchemist's tools",
  blacksmithing: "blacksmith's tools",
  enchanting: "enchanter's tools"
});

/** The three expertises anything is crafted with (R:1683-1687). */
export const CRAFTING_EXPERTISES = Object.freeze(Object.keys(TOOL_FOR_EXPERTISE));

/**
 * R:1703 — "When you apply a double edge or an expertise to a crafting roll,
 * the roll gains a +4 bonus instead of the normal benefits. You can only apply
 * up to two expertises per crafting roll. When a double bane applies to a
 * crafting roll, the roll gains a -4 penalty."
 */
export const CRAFTING_EXPERTISE_BONUS = 4;
export const CRAFTING_DOUBLE_EDGE_BONUS = 4;
export const CRAFTING_DOUBLE_BANE_PENALTY = -4;
export const MAX_EXPERTISES_PER_CRAFTING_ROLL = 2;

/** R:1701 — the floor on a crafting roll, unless it is a doom. */
export const CRAFTING_MIN_POINTS = 1;

/** Durable lifecycle values written to `crafting.projects[].status`. */
export const CRAFTING_PROJECT_STATUSES = Object.freeze(["active", "blocked", "pending"]);

/**
 * The material vocabulary belongs to the material planner, but project records
 * need to carry it before that planner is installed. Keeping the currently
 * recognised aliases in this helper means the shape migration and the roll
 * state machine can agree without importing the Foundry data model from the
 * pure arithmetic tests. This list is deliberately not a closed vocabulary:
 * categories unknown to this ticket remain unresolved text for the planner.
 */
export const CRAFTING_MATERIAL_IDENTITIES = Object.freeze([
  "bloodhide", "undeadBone", "demonHide", "angelHide",
  "iron", "hickory", "treatedIron",
  "steel", "archmageObsidian", "necromancerSilver", "starDiamond",
  "yew", "archmageWillow", "necromancerDeathtree", "starwood",
  "elementalEssence"
]);
export const CRAFTING_MATERIAL_FORMS = Object.freeze(["", "bar", "log", "part"]);
export const CRAFTING_MATERIAL_SIZES = Object.freeze(["", "tiny", "small", "medium", "large"]);

const MATERIAL_IDENTITY_ALIASES = Object.freeze([
  ["archmage obsidian", "archmageObsidian"],
  ["necromancer silver", "necromancerSilver"],
  ["star diamond", "starDiamond"],
  ["archmage willow", "archmageWillow"],
  ["necromancer deathtree", "necromancerDeathtree"],
  ["star wood", "starwood"],
  ["starwood", "starwood"],
  ["elemental essence", "elementalEssence"],
  ["elemental tree", "elementalEssence"],
  ["undead bone", "undeadBone"],
  ["demon hide", "demonHide"],
  ["angel hide", "angelHide"],
  ["blood hide", "bloodhide"],
  ["treated iron", "treatedIron"],
  ["necromancer deathtree", "necromancerDeathtree"],
  ["bloodhide", "bloodhide"],
  ["undeadbone", "undeadBone"],
  ["demonhide", "demonHide"],
  ["angelhide", "angelHide"],
  ["treatediron", "treatedIron"],
  ["steels", "steel"],
  ["steel", "steel"],
  ["iron", "iron"],
  ["hickory", "hickory"],
  ["yew", "yew"]
]);

function cloneValue(value) {
  try {
    return structuredClone(value);
  } catch {
    try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
  }
}

function nonNegativeInteger(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function normalizedWords(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");
}

function materialIdentity(value) {
  const words = normalizedWords(value);
  if (!words) return "";
  const alias = MATERIAL_IDENTITY_ALIASES.find(([name]) =>
    new RegExp(`(?:^| )${name.replace(/ /g, " ")}(?:$| )`).test(words)
  );
  return alias?.[1] ?? (CRAFTING_MATERIAL_IDENTITIES.includes(value) ? value : "");
}

function materialForm(value) {
  const form = normalizedWords(value).replace(/s$/, "");
  return CRAFTING_MATERIAL_FORMS.includes(form) ? form : "";
}

function materialSize(value) {
  const size = normalizedWords(value);
  return CRAFTING_MATERIAL_SIZES.includes(size) ? size : "";
}

/**
 * Convert one legacy/display material into the durable requirement shape.
 *
 * This is deliberately only shape work. An empty `identity` means that a Ref
 * still has to identify the generic card; no caller may treat it as a wildcard
 * or consume an arbitrary material for it. The material-consumption ticket
 * owns matching and expenditure.
 */
export function normalizeCraftingMaterialRequirement(material, index = 0) {
  const fallbackId = `req-${Math.max(0, Math.floor(Number(index) || 0)) + 1}`;
  if (material && typeof material === "object" && !Array.isArray(material)) {
    const source = cloneValue(material) ?? {};
    const rawIdentity = String(source.identity ?? "").trim();
    const label = String(source.label ?? source.legacyText ?? rawIdentity).trim();
    const identity = materialIdentity(source.identity);
    const form = materialForm(source.form);
    const size = materialSize(source.size);
    const providedLegacyText = String(source.legacyText ?? "").trim();
    return {
      id: String(source.id ?? fallbackId),
      quantity: Math.max(1, nonNegativeInteger(source.quantity, 1)),
      identity,
      form,
      size,
      label,
      legacyText: identity ? providedLegacyText : (providedLegacyText || label || rawIdentity)
    };
  }

  const text = String(material ?? "").trim();
  const quantityMatch = text.match(/^(\d+)\s+/);
  const quantity = quantityMatch ? Math.max(1, nonNegativeInteger(quantityMatch[1], 1)) : 1;
  const description = quantityMatch ? text.slice(quantityMatch[0].length) : text;
  const identity = materialIdentity(description);
  const formWord = normalizedWords(description).match(/\b(bars?|logs?|parts?)\b/)?.[1] ?? "";
  const sizeWord = normalizedWords(description).match(/\b(tiny|small|medium|large)\b/)?.[1] ?? "";
  return {
    id: fallbackId,
    quantity,
    identity,
    form: materialForm(formWord),
    size: materialSize(sizeWord),
    label: text,
    legacyText: identity ? "" : text
  };
}

function materialLabel(material) {
  if (material && typeof material === "object") {
    return String(material.label ?? material.legacyText ?? "").trim();
  }
  return String(material ?? "").trim();
}

/** Normalize a project output handoff without embedding an Item document. */
export function normalizeCraftingOutput(output, projectName = "") {
  const source = output && typeof output === "object" && !Array.isArray(output)
    ? cloneValue(output) : {};
  const kind = source.kind === "enchantment" ? "enchantment" : "equipment";
  const name = String(source.name ?? source.label ?? projectName ?? "").trim();
  const label = String(source.label ?? name ?? projectName ?? "").trim();
  const targetSource = source.target && typeof source.target === "object" ? source.target : {};
  const target = {
    actorUuid: String(targetSource.actorUuid ?? ""),
    itemId: String(targetSource.itemId ?? ""),
    itemUuidAtStart: String(targetSource.itemUuidAtStart ?? ""),
    fingerprint: String(targetSource.fingerprint ?? "")
  };
  return {
    ...source,
    kind,
    name,
    label,
    template: cloneValue(source.template ?? {}),
    target
  };
}

/**
 * Normalize the durable project shape at every Foundry boundary.
 *
 * Missing lifecycle fields are intentionally conservative: an old project
 * with `points >= goal` is not fabricated into a completion, because there is
 * no persisted proof that its material set was available.
 */
export function normalizeCraftingProject(project = {}, index = 0) {
  const source = project && typeof project === "object" && !Array.isArray(project)
    ? cloneValue(project) : {};
  const goal = Math.max(1, nonNegativeInteger(source.goal, 100));
  const points = nonNegativeInteger(source.points, 0);
  const completed = nonNegativeInteger(source.completed, 0);
  const materials = Array.isArray(source.materials)
    ? source.materials.map((material, materialIndex) => normalizeCraftingMaterialRequirement(material, materialIndex))
    : [];
  const status = completed > 0
    ? "pending"
    : source.status === "blocked" && points >= goal
      ? "blocked"
      : "active";
  return {
    ...source,
    id: String(source.id ?? `proj-${Math.max(0, Math.floor(Number(index) || 0)) + 1}`),
    name: String(source.name ?? ""),
    expertise: String(source.expertise ?? ""),
    goal,
    points,
    completed,
    status,
    materials,
    output: normalizeCraftingOutput(source.output, source.name),
    notes: String(source.notes ?? "")
  };
}

/** Derive the persisted status from durable completions and an optional plan. */
export function craftingProjectStatus(project, { blockedOnMaterials = false } = {}) {
  const completed = nonNegativeInteger(project?.completed, 0);
  const goal = Math.max(1, nonNegativeInteger(project?.goal, 1));
  const points = nonNegativeInteger(project?.points, 0);
  if (completed > 0) return "pending";
  if (blockedOnMaterials || (project?.status === "blocked" && points >= goal)) return "blocked";
  return "active";
}

function materialSetsFrom(options, actor, project) {
  if (Object.prototype.hasOwnProperty.call(options, "materialSets")
      && options.materialSets !== undefined && options.materialSets !== null) {
    return options.materialSets;
  }
  if (Object.prototype.hasOwnProperty.call(options, "availableSets")
      && options.availableSets !== undefined && options.availableSets !== null) {
    return options.availableSets;
  }
  const planner = options.materialPlan ?? options.planner ?? options.materialSetsFor;
  if (typeof planner === "function") {
    const plan = planner(actor, project);
    if (plan && typeof plan === "object") {
      return plan.availableSets ?? plan.materialSets;
    }
    return plan;
  }
  // A project with no material requirements has an unbounded number of
  // authorized sets. Until the material-transaction ticket registers its
  // planner, retain PT1's playable one-set default for material-bearing
  // projects. Once a planner is registered it owns this value, including a
  // strict zero when no matching set exists.
  return Array.isArray(project?.materials) && project.materials.length === 0
    ? Number.POSITIVE_INFINITY : 1;
}

/**
 * Resolve the current production planner, if the material ticket has wired
 * one onto the shared crafting API. The interim fallback is deliberately
 * permissive so this lifecycle ticket does not make existing projects
 * unplayable; the material-transaction ticket flips the behavior by
 * registering a planner that returns the actually authorized set count.
 */
export function craftingMaterialSetsFor(actor, project) {
  const configured = globalThis.game?.crows?.crafting;
  const planner = configured?.planMaterials ?? configured?.materialSetsFor;
  if (typeof planner === "function" && planner !== craftingMaterialSetsFor) {
    const plan = planner(actor, project);
    if (plan && typeof plan === "object") return plan.availableSets ?? plan.materialSets ?? 0;
    if (plan !== undefined && plan !== null) return plan;
    return 0;
  }
  return Array.isArray(project?.materials) && project.materials.length === 0
    ? Number.POSITIVE_INFINITY : 1;
}

/**
 * Pure lifecycle reconciliation seam.
 *
 * A material planner may supply `materialSets` (or `{availableSets}`) through
 * the optional third argument. Before that planner is installed, the
 * interim-compatible one-set fallback keeps existing crafting playable; the
 * planner/Item transaction ticket then owns strict authorization. In either
 * mode, the output Item remains the Ref's responsibility.
 */
export function reconcileCraftingProject(actor, project, options = {}) {
  const before = normalizeCraftingProject(project, options?.index ?? 0);
  const suppliedSets = materialSetsFrom(options ?? {}, actor, before);
  let next = before;
  let accrued = null;
  const goal = Math.max(1, nonNegativeInteger(before.goal, 1));
  const hasBankedGoal = nonNegativeInteger(before.points, 0) >= goal;
  // Only a project already marked blocked (or one with pending copies) is
  // eligible for a no-roll promotion. An old `active` project whose points
  // happen to be at the goal has no durable proof that its materials were
  // available, so Finalize/reload must not manufacture a completion from it.
  const mayPromoteBankedGoal = !hasBankedGoal
    || nonNegativeInteger(before.completed, 0) > 0
    || before.status === "blocked";
  if (suppliedSets !== undefined && suppliedSets !== null && mayPromoteBankedGoal) {
    accrued = accrueCraftingPoints(before, 0, { materialSets: suppliedSets });
    next = {
      ...before,
      points: accrued.points,
      completed: accrued.completed,
      status: craftingProjectStatus({ ...before, ...accrued }, {
        blockedOnMaterials: accrued.blockedOnMaterials
      })
    };
  } else {
    next = { ...before, status: craftingProjectStatus(before) };
  }
  return {
    ok: true,
    actor,
    project: next,
    changed: JSON.stringify(before) !== JSON.stringify(next),
    availableSets: suppliedSets === undefined || suppliedSets === null
      ? null : Math.max(0, Math.floor(Number(suppliedSets) || 0)),
    ...accrued
  };
}

/** Reconcile all projects and persist only when the durable shape changed. */
export async function reconcileCraftingProjects(actor, options = {}) {
  if (!actor || actor.type !== "crow") return { ok: false, error: "not a crow" };
  const current = Array.isArray(actor.system?.crafting?.projects)
    ? actor.system.crafting.projects : [];
  const next = current.map((project, index) => {
    const perProject = { ...(options ?? {}), index };
    return reconcileCraftingProject(actor, project, perProject).project;
  });
  const changed = JSON.stringify(current) !== JSON.stringify(next);
  if (changed && options?.persist !== false && typeof actor.update === "function") {
    await actor.update({ "system.crafting.projects": next });
  }
  return { ok: true, projects: next, changed };
}

/* -------------------------------------------------------------------------- */
/*  Prerequisites (R:1669-1687)                                                */
/* -------------------------------------------------------------------------- */

/**
 * Can this actor start the project?
 *
 * Reads `max` — uses OWNED — for the expertise gate. Reading `value` would make
 * the prerequisite flicker with the day's spending, and would mean a crow who
 * used their last blacksmithing use assisting a test this morning could not
 * begin a project they are plainly qualified for.
 *
 * Tools are checked by name against the actor's items, which is loose by
 * necessity — tool items carry a quality tier in their name. A caller that
 * already knows better can assert `hasTools`.
 *
 * @returns {{ok: boolean, reasons: string[], owned: number, required: number, tool: string|null}}
 */
export function meetsCraftingPrerequisites(actor, { expertise, uses = 1, hasTools = null } = {}) {
  const reasons = [];
  const required = Math.max(0, Math.floor(Number(uses) || 0));
  const owned = expertise ? readExpertiseUses(actor, expertise).max : 0;
  const tool = TOOL_FOR_EXPERTISE[expertise] ?? null;

  if (!expertise) reasons.push("no expertise named");
  else if (!CROWS.expertises.general.includes(expertise) && !CROWS.expertises.spellcasting.includes(expertise)
           && !CROWS.expertises.weapon.includes(expertise)) {
    reasons.push(`unknown expertise: ${expertise}`);
  } else if (owned < required) {
    reasons.push(`needs ${required} ${expertise} use${required === 1 ? "" : "s"}, owns ${owned}`);
  }

  const toolsPresent = hasTools ?? (tool ? actorHasTool(actor, tool) : true);
  if (tool && !toolsPresent) reasons.push(`needs ${tool}`);

  return { ok: reasons.length === 0, reasons, owned, required, tool };
}

/** Loose name match for a tool kit anywhere in the actor's inventory. */
export function actorHasTool(actor, toolName) {
  const needle = String(toolName).toLowerCase().replace(/[’']/g, "'");
  for (const item of actor?.items ?? []) {
    const name = String(item?.name ?? "").toLowerCase().replace(/[’']/g, "'");
    if (name.includes(needle)) return true;
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/*  Roll arithmetic (R:1697-1709)                                              */
/* -------------------------------------------------------------------------- */

/**
 * The bonus a crafting roll carries, from every source that stacks onto it.
 *
 * Expertises are capped at two (R:1703). A double edge is a further flat +4 in
 * its own right, and a double bane a flat -4 — these replace the normal edge
 * mechanics rather than adding to them, so no numeric edge value is consulted.
 *
 * `institutionBonus` covers the artisan crafting for you (C:2645), the rented
 * workshop (C:2724) and the Crafty connection (C:2561) — all plain addends.
 */
export function craftingRollBonus({
  mind = 0, expertisesApplied = 0, doubleEdge = false, doubleBane = false, institutionBonus = 0
} = {}) {
  const applied = Math.max(0, Math.min(MAX_EXPERTISES_PER_CRAFTING_ROLL, Math.floor(Number(expertisesApplied) || 0)));
  return {
    total: Math.floor(Number(mind) || 0)
      + applied * CRAFTING_EXPERTISE_BONUS
      + (doubleEdge ? CRAFTING_DOUBLE_EDGE_BONUS : 0)
      + (doubleBane ? CRAFTING_DOUBLE_BANE_PENALTY : 0)
      + Math.floor(Number(institutionBonus) || 0),
    expertisesApplied: applied,
    expertisesIgnored: Math.max(0, Math.floor(Number(expertisesApplied) || 0) - applied)
  };
}

/**
 * R:1701 — the total becomes crafting points. Minimum 1 even through a bane or
 * penalty; a doom accrues nothing at all.
 */
export function craftingPointsFrom({ total = 0, doom = false } = {}) {
  if (doom) return 0;
  return Math.max(CRAFTING_MIN_POINTS, Math.floor(Number(total) || 0));
}

/**
 * Add points to a project and settle completions.
 *
 * R:1705 — at or past the goal the item is done and its materials are expended.
 * R:1709 — surplus begins another copy of the SAME item, *provided you have the
 * materials*, and that repeats. So the number finished this roll is bounded by
 * material sets on hand, not just by arithmetic: without the second set the
 * surplus stays banked on the project rather than minting a free item.
 *
 * @returns {{points, completed, completedThisRoll, blockedOnMaterials}}
 *   `points` is what remains banked toward the next copy.
 */
export function accrueCraftingPoints({ points = 0, goal = 1, completed = 0 } = {}, gained = 0, { materialSets = 1 } = {}) {
  const g = Math.max(1, Math.floor(Number(goal) || 1));
  const sets = Math.max(0, Math.floor(Number(materialSets) || 0));
  let banked = Math.max(0, Math.floor(Number(points) || 0)) + Math.max(0, Math.floor(Number(gained) || 0));

  let made = 0;
  while (banked >= g && made < sets) { banked -= g; made += 1; }
  const blockedOnMaterials = banked >= g && made >= sets;

  return {
    points: banked,
    completed: Math.max(0, Math.floor(Number(completed) || 0)) + made,
    completedThisRoll: made,
    blockedOnMaterials
  };
}

/**
 * R:1713 — another creature resting with you who meets the tool and expertise
 * prerequisites may spend their own rest activity on your project; their rolls
 * accrue to the same item.
 */
export function canAssistCrafting(helper, project) {
  return meetsCraftingPrerequisites(helper, { expertise: project?.expertise, uses: project?.uses ?? 1 });
}

/* -------------------------------------------------------------------------- */
/*  IDing magic items (R:1719-1733)                                            */
/* -------------------------------------------------------------------------- */

/** Tier of a 2d10 + M identify test, using the shared tier boundaries. */
export function identifyTier(total) {
  const t = Math.floor(Number(total) || 0);
  if (t <= CROWS.tiers.t1Max) return 1;
  if (t <= CROWS.tiers.t2Max) return 2;
  return 3;
}

/** R:1727-1731 — what each tier tells you. */
export const IDENTIFY_OUTCOMES = Object.freeze({
  1: Object.freeze({ id: "activate", source: "R:1727",
    text: "You accidentally activate the item in a harmful way determined by the Ref." }),
  2: Object.freeze({ id: "blank", source: "R:1729",
    text: "You learn nothing about the item." }),
  3: Object.freeze({ id: "full", source: "R:1731",
    text: "You learn all of the item's properties." })
});

/* ========================================================================== */
/*  Foundry-facing half.                                                       */
/* ========================================================================== */

/**
 * Start a crafting project.
 *
 * NB the required-uses count is validated here and NOT persisted: the
 * prerequisite is a gate at the moment you begin, so nothing downstream
 * re-reads it. The lifecycle state (`completed`, `status`, structured
 * materials, and output handoff) is persisted by CrowData; PT1's deleted
 * recipe fields are removed by migration rather than carried forward.
 */
export async function startCraftingProject(actor, {
  name, expertise, uses = 1, goal, materials = [], output = null, notes = "", hasTools = null
} = {}) {
  if (!actor || actor.type !== "crow") return { ok: false, error: "not a crow" };
  if (!name || !expertise || !goal) return { ok: false, error: "need name, expertise, goal" };

  const prereq = meetsCraftingPrerequisites(actor, { expertise, uses, hasTools });
  if (!prereq.ok) {
    ui.notifications?.warn(`${actor.name} can't craft ${name}: ${prereq.reasons.join("; ")}.`);
    return { ok: false, error: prereq.reasons.join("; "), prereq };
  }

  const project = {
    id: `proj-${foundry.utils.randomID(10)}`,
    name: String(name),
    expertise: String(expertise),
    goal: Math.max(1, Math.floor(Number(goal) || 100)),
    points: 0,
    completed: 0,
    status: "active",
    materials: Array.isArray(materials)
      ? materials.map((material, index) => normalizeCraftingMaterialRequirement(material, index)) : [],
    output: normalizeCraftingOutput(output, name),
    notes: String(notes ?? "")
  };
  const next = [...(actor.system?.crafting?.projects ?? []), project];
  await actor.update({ "system.crafting.projects": next });

  await ChatMessage.create({
    content: `<div class="crows crafting-start">
      <header><strong>${actor.name}</strong> starts a crafting project: <strong>${name}</strong></header>
      <div>${expertise} (${prereq.required} use${prereq.required === 1 ? "" : "s"} required, ${prereq.owned} owned)
        &middot; Goal: <strong>${project.goal}</strong> pts${project.materials.length
          ? ` &middot; Materials: ${project.materials.map(materialLabel).join(", ")}` : ""}</div>
    </div>`,
    speaker: ChatMessage.getSpeaker({ actor })
  });
  return { ok: true, id: project.id, project };
}

/** Cancel a project. Materials are not expended (R:1705 only spends on completion). */
export async function cancelProject(actor, id) {
  if (!actor || actor.type !== "crow") return { ok: false, error: "not a crow" };
  const projects = actor.system?.crafting?.projects ?? [];
  const removed = projects.find(p => p.id === id);
  if (!removed) return { ok: false, error: "not found" };
  await actor.update({ "system.crafting.projects": projects.filter(p => p.id !== id) });
  await ChatMessage.create({
    content: `<div class="crows crafting-cancel"><strong>${actor.name}</strong> cancels <strong>${removed.name}</strong> at ${removed.points}/${removed.goal} pts.</div>`,
    speaker: ChatMessage.getSpeaker({ actor })
  });
  return { ok: true };
}

/**
 * One crafting roll: a special Mind test with no tiered outcome (R:1701).
 *
 * `expertises` are the keys applied to THIS roll — up to two (R:1703), each a
 * flat +4, each costing one remaining use. Uses are deducted from `value`;
 * `max` is never touched, so a rest restores them (R:628).
 *
 * A crit lets you roll again for the same item within the same rest activity
 * (R:1701); that loop is the caller's — `rest.mjs` already runs it — so this
 * returns `crit` rather than recursing. `materialSets` is an optional fresh
 * planner result; when omitted, the shared planner seam is consulted and a
 * material-bearing project receives no implicit set.
 */
export async function makeCraftingRoll(actor, projectId, {
  expertises = [], doubleEdge = false, doubleBane = false, institutionBonus = 0, materialSets = undefined
} = {}) {
  if (!actor || actor.type !== "crow") return { ok: false, error: "not a crow" };
  const projects = [...(actor.system?.crafting?.projects ?? [])];
  const idx = projects.findIndex(p => p.id === projectId);
  if (idx < 0) return { ok: false, error: "project not found" };
  // Reconcile a previously blocked goal before constructing dice. The caller
  // supplies the number of *unreserved* material sets; zero is the safe
  // default until the inventory planner has authorized a set. Keeping this
  // explicit prevents the old `materialSets = 1` default from minting a free
  // completion for an actor with no matching material.
  const authorizedMaterialSets = materialSets === undefined
    ? craftingMaterialSetsFor(actor, projects[idx]) : materialSets;
  const reconciliation = reconcileCraftingProject(actor, projects[idx], {
    materialSets: authorizedMaterialSets
  });
  const project = { ...reconciliation.project };
  // Reconciliation may promote a banked goal before this roll. Those copies
  // already reserve sets from the planner result, so the dice contribution
  // may spend only the remainder; otherwise a large surplus could authorize
  // the same physical set twice in one call.
  const reconciledCopies = reconciliation.completedThisRoll ?? 0;
  const rollMaterialSets = authorizedMaterialSets === Number.POSITIVE_INFINITY
    ? authorizedMaterialSets
    : Math.max(0, Math.floor(Number(authorizedMaterialSets) || 0) - reconciledCopies);

  // Which requested spends are actually payable right now (R:1703 caps at two).
  const spends = [];
  for (const key of expertises) {
    if (spends.length >= MAX_EXPERTISES_PER_CRAFTING_ROLL) break;
    if (spends.includes(key)) continue;                 // one use each, not two of one
    if (readExpertiseUses(actor, key).value < 1) continue;
    spends.push(key);
  }

  const mind = actor.system?.characteristics?.mind?.value ?? 0;
  const bonus = craftingRollBonus({
    mind, expertisesApplied: spends.length, doubleEdge, doubleBane, institutionBonus
  });

  const roll = await new Roll(`2d10 + ${bonus.total}`).evaluate();
  const d10s = roll.dice.find(d => d.faces === 10);
  const rawSum = d10s ? d10s.results.reduce((a, r) => a + r.result, 0) : roll.total;
  const doom = CROWS.doomFaces.includes(rawSum);        // 2d10 SUMS, not die faces
  const crit = CROWS.critFaces.includes(rawSum);

  const gained = craftingPointsFrom({ total: roll.total, doom });
  const accrued = accrueCraftingPoints(project, gained, { materialSets: rollMaterialSets });
  project.points = accrued.points;
  project.completed = accrued.completed;
  project.status = craftingProjectStatus(project, { blockedOnMaterials: accrued.blockedOnMaterials });

  projects[idx] = project;
  const update = { "system.crafting.projects": projects };
  // R:1703 spends: decrement `value`, never `max`.
  for (const key of spends) {
    const { value } = readExpertiseUses(actor, key);
    update[`system.expertises.${key}.value`] = Math.max(0, value - 1);
  }
  await actor.update(update);

  const spendNote = spends.length ? ` + ${spends.map(k => `${k} +${CRAFTING_EXPERTISE_BONUS}`).join(" + ")}` : "";
  const lines = [
    `<div>2d10(${d10s?.results?.map(x => x.result).join(",") ?? rawSum}) + M ${mind}${spendNote}${doubleEdge ? ` + double edge +${CRAFTING_DOUBLE_EDGE_BONUS}` : ""}${doubleBane ? ` ${CRAFTING_DOUBLE_BANE_PENALTY}` : ""}${institutionBonus ? ` + ${institutionBonus}` : ""} = <strong>${roll.total}</strong>${doom ? " <em>(DOOM — no points)</em>" : crit ? " <em>(CRIT)</em>" : ""}</div>`,
    `<div>Points: +<strong>${gained}</strong> &rarr; ${project.points}/${project.goal}${accrued.completedThisRoll ? ` &middot; <strong>${accrued.completedThisRoll} completed</strong>` : ""}</div>`
  ];
  if (accrued.blockedOnMaterials) lines.push(`<div><em>Surplus banked — another copy needs another set of materials (R:1709).</em></div>`);
  if (crit && !accrued.completedThisRoll) lines.push(`<div><em>Crit — make another crafting roll for this item, free, in the same rest activity.</em></div>`);

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `Crafting roll — ${project.name}`,
    content: `<div class="crows crafting-roll">
      <header><strong>${actor.name}</strong> works on <strong>${project.name}</strong></header>
      ${lines.join("")}
    </div>`
  });

  return {
    ok: true,
    points: gained,
    total: roll.total,
    doom,
    crit,
    complete: accrued.completedThisRoll > 0,
    completedThisRoll: accrued.completedThisRoll,
    blockedOnMaterials: accrued.blockedOnMaterials,
    expertisesSpent: spends,
    project
  };
}

function randomId(prefix) {
  const id = globalThis.foundry?.utils?.randomID?.(10)
    ?? Math.random().toString(36).slice(2, 12);
  return `${prefix}-${id}`;
}

/** Build one durable, non-Item handoff for a completed copy. */
export function outputClaimFor(project, index = 0) {
  const output = normalizeCraftingOutput(project?.output, project?.name);
  return {
    id: randomId("claim"),
    projectId: String(project?.id ?? ""),
    copy: Math.max(1, Math.floor(Number(index) || 0) + 1),
    kind: output.kind,
    name: output.name,
    label: output.label,
    output: cloneValue(output),
    target: cloneValue(output.target),
    state: "ready"
  };
}

/**
 * Finalize completed copies and post their Ref handoff.
 *
 * This function owns the durable completion guard and output claim only. It
 * deliberately does not create an Item or consume material records: the
 * dependent material-transaction ticket supplies that preflight/commit seam.
 * The finished Item is still the Ref's to grant.
 */
export async function completeProject(actor, projectId, options = {}) {
  if (!actor || actor.type !== "crow") return { ok: false, error: "not a crow" };
  const projects = Array.isArray(actor.system?.crafting?.projects)
    ? actor.system.crafting.projects : [];
  const idx = projects.findIndex(project => project?.id === projectId);
  if (idx < 0) return { ok: false, error: "not found" };

  // Re-read the current project and reconcile in memory. In particular, a
  // late material grant may have authorized a blocked goal; the caller can
  // provide the planner's fresh `availableSets` here. No write occurs until
  // the durable completion guard has passed.
  const reconciliationOptions = { ...(options ?? {}) };
  if (!Object.prototype.hasOwnProperty.call(reconciliationOptions, "materialSets")
      && !Object.prototype.hasOwnProperty.call(reconciliationOptions, "availableSets")
      && !reconciliationOptions.materialPlan && !reconciliationOptions.planner
      && !reconciliationOptions.materialSetsFor) {
    reconciliationOptions.materialSets = craftingMaterialSetsFor(actor, projects[idx]);
  }
  const reconciliation = reconcileCraftingProject(actor, projects[idx], reconciliationOptions);
  const project = reconciliation.project;
  const completed = nonNegativeInteger(project.completed, 0);
  if (completed < 1) return { ok: false, error: "incomplete", project };

  const claims = Array.from({ length: completed }, (_, copy) => outputClaimFor(project, copy));
  const nextClaims = [
    ...(Array.isArray(actor.system?.crafting?.outputClaims)
      ? actor.system.crafting.outputClaims : []),
    ...claims
  ];

  // Pending copies are handed to the Ref. Any below-goal points remain on the
  // project for the next copy; only an empty remainder can be removed. A
  // goal-sized remainder is retained as blocked until the material planner
  // authorizes it, rather than being mistaken for another free completion.
  const remainderPoints = nonNegativeInteger(project.points, 0);
  const remainder = remainderPoints > 0
    ? {
      ...project,
      completed: 0,
      points: remainderPoints,
      status: remainderPoints >= Math.max(1, nonNegativeInteger(project.goal, 1))
        ? "blocked" : "active"
    }
    : null;
  const nextProjects = remainder
    ? projects.map((entry, entryIndex) => entryIndex === idx ? remainder : entry)
    : projects.filter((_, entryIndex) => entryIndex !== idx);
  const update = {
    "system.crafting.projects": nextProjects,
    "system.crafting.outputClaims": nextClaims
  };
  await actor.update(update);
  await ChatMessage.create({
    content: `<div class="crows crafting-done">
      <header><strong>${actor.name}</strong> finishes <strong>${project.name}</strong>!</header>
      ${project.materials.length ? `<div>Materials expended: ${project.materials.map(materialLabel).join(", ")}</div>` : ""}
      <div>${claims.length} output claim${claims.length === 1 ? "" : "s"} recorded for the Ref.</div>
      <em>The Ref grants the finished item.</em>
    </div>`,
    speaker: ChatMessage.getSpeaker({ actor })
  });
  return { ok: true, project, claims, remainder };
}

/**
 * Identify Item (R:1719-1733). 2d10 + M, one attempt per item ever (R:1733) —
 * enforced by a flag on the item so the gate survives a reload, which the PT1
 * "the Ref should remember" comment did not.
 */
export async function identifyMagicItem(actor, { itemId = null, itemName = null } = {}) {
  if (!actor || actor.type !== "crow") return { ok: false, error: "not a crow" };
  const item = itemId ? actor.items.get(itemId) : null;
  const label = item?.name ?? itemName ?? "(unnamed item)";

  if (item?.getFlag?.(CROWS.id, "identifyAttempted")) {
    return { ok: false, error: "you can only make this test once with an item (R:1733)" };
  }

  const mind = actor.system?.characteristics?.mind?.value ?? 0;
  const roll = await new Roll(`2d10 + ${mind}`).evaluate();
  const tier = identifyTier(roll.total);
  const outcome = IDENTIFY_OUTCOMES[tier];

  if (item) await item.setFlag(CROWS.id, "identifyAttempted", true);

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `Identify Item: ${label}`,
    content: `<div class="crows identify-roll tier${tier}">
      <header><strong>${actor.name}</strong> tries to identify <strong>${label}</strong></header>
      <div>2d10 + M = <strong>${roll.total}</strong> &rarr; <strong>Tier ${tier}</strong></div>
      <div class="id-outcome">${outcome.text}</div>
      ${tier === 3 && item?.system?.description ? `<div class="id-item-desc">${item.system.description}</div>` : ""}
    </div>`
  });
  return { ok: true, tier, total: roll.total, outcome };
}
