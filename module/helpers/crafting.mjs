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
 * - **Materials are inventory-backed.** The pure planner authorizes sets from
 *   identified material gear; Finalize consumes those exact quantities through
 *   a prepared/quantities-applied/items-deleted journal and leaves the output
 *   Item to the Ref.
 *
 * ## Deliberate concurrency boundary
 *
 * The settled option-(b) boundary uses deterministic `activeGM` designation,
 * mandatory `txId`/expected revision, durable receipts, live re-resolution
 * immediately before each write, and post-hoc reconciliation. This module does
 * not invent a lease, epoch, fence, or compare-and-swap; the residual
 * GM-transition window is therefore detectable and recoverable rather than
 * claimed atomic. `craftingWriterAuthority` is the single choke point for the
 * future authority check.
 *
 * The pure half — prerequisites, point arithmetic, tier lookup — is what
 * `test/village.test.mjs` exercises; the `Roll` / `ChatMessage` half is below it.
 */

import { CROWS } from "../config.mjs";
import { readExpertiseUses } from "./expertise.mjs";
import {
  EQUIPMENT_UPGRADE_KEYS,
  MATERIAL_IDENTITY_KEYS,
  MATERIAL_FORMS,
  MATERIAL_SIZES,
  EQUIPMENT_UPGRADE_MATERIALS,
  equipmentUpgradeKeyFor,
  normalizeCraftingMaterialRequirement,
  planCraftingMaterials,
  materialItemMatches
} from "./materials.mjs";

export {
  EQUIPMENT_UPGRADE_KEYS,
  MATERIAL_IDENTITY_KEYS,
  EQUIPMENT_UPGRADE_MATERIALS,
  equipmentUpgradeKeyFor,
  planCraftingMaterials,
  materialItemMatches
};

export { planCraftingMaterials as planMaterials };

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

/** Compatibility aliases for the lifecycle module's former names. */
export const CRAFTING_MATERIAL_IDENTITIES = Object.freeze([
  ...MATERIAL_IDENTITY_KEYS, "creatureTypeParts"
]);
export const CRAFTING_MATERIAL_FORMS = MATERIAL_FORMS;
export const CRAFTING_MATERIAL_SIZES = MATERIAL_SIZES;

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

/** Shared shape migration name retained for callers of the lifecycle module. */
export { normalizeCraftingMaterialRequirement };

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
  if (planner && typeof planner === "object") {
    return planner.availableSets ?? planner.materialSets ?? 0;
  }
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
      ? null : suppliedSets === Number.POSITIVE_INFINITY
        ? Number.POSITIVE_INFINITY
        : Math.max(0, Math.floor(Number(suppliedSets) || 0)),
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
 * workshop (C:2368) and the Crafty connection (C:2561) — all plain addends.
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
export function outputClaimFor(project, index = 0, { transactionId = "" } = {}) {
  const output = normalizeCraftingOutput(project?.output, project?.name);
  return {
    id: randomId("claim"),
    projectId: String(project?.id ?? ""),
    transactionId: String(transactionId ?? ""),
    copy: Math.max(1, Math.floor(Number(index) || 0) + 1),
    kind: output.kind,
    name: output.name,
    label: output.label,
    output: cloneValue(output),
    target: cloneValue(output.target),
    state: "ready"
  };
}

/* -------------------------------------------------------------------------- */
/* Journaled material transaction                                              */
/* -------------------------------------------------------------------------- */

function actorItems(actor) {
  const items = actor?.items;
  if (!items) return [];
  if (Array.isArray(items)) return [...items];
  if (Array.isArray(items.contents)) return [...items.contents];
  if (typeof items.values === "function") return [...items.values()];
  try { return [...items]; } catch { return []; }
}

function actorItem(actor, id) {
  const key = String(id ?? "");
  if (!key) return null;
  const items = actor?.items;
  if (typeof items?.get === "function") return items.get(key) ?? null;
  return actorItems(actor).find(item => String(item?.id ?? item?._id ?? "") === key) ?? null;
}

function itemQuantityForTransaction(item) {
  const n = Number(item?.system?.quantity);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 1;
}

function craftingRevisionFor(actor) {
  const revision = actor?.system?.crafting?.revision;
  if (Number.isFinite(Number(revision))) return String(Math.max(0, Math.floor(Number(revision))));
  return String(actor?._stats?.modifiedTime ?? actor?._stats?.lastModified ?? "");
}

function nextCraftingRevision(actor) {
  const revision = Number(actor?.system?.crafting?.revision);
  return Number.isFinite(revision) && revision >= 0 ? Math.floor(revision) + 1 : 1;
}

function fingerprint(value) {
  try { return JSON.stringify(cloneValue(value)); }
  catch { return String(value ?? ""); }
}

function transactionList(actor) {
  return Array.isArray(actor?.system?.crafting?.transactions)
    ? actor.system.crafting.transactions : [];
}

function transactionById(actor, txId) {
  return transactionList(actor).find(entry => String(entry?.txId ?? "") === String(txId ?? "")) ?? null;
}

async function persistTransaction(actor, transaction, { append = false } = {}) {
  if (typeof actor?.update !== "function") throw new Error("actor.update unavailable");
  const current = transactionList(actor).map(cloneValue);
  const index = current.findIndex(entry => String(entry?.txId ?? "") === String(transaction.txId));
  if (index >= 0) current[index] = cloneValue(transaction);
  else if (append) current.push(cloneValue(transaction));
  else throw new Error(`crafting transaction ${transaction.txId} is missing`);
  await actor.update({ "system.crafting.transactions": current });
  return transaction;
}

/**
 * The one authority seam. The current implementation intentionally does not
 * inspect `activeGM`, mint an epoch, or claim a lock: Commerce C1 has not yet
 * defined an executable writer fence. A later designated-writer implementation
 * can be injected as `authorityCheck` without changing the journal protocol.
 */
export async function craftingWriterAuthority(actor, context = {}, options = {}) {
  const check = options?.authorityCheck ?? options?.authority;
  if (typeof check !== "function") {
    return { ok: true, guaranteed: false, reason: "authority-contract-pending", actor, context };
  }
  const result = await check(actor, context);
  if (result === false) return { ok: false, error: "authority-unavailable" };
  if (result && typeof result === "object" && result.ok === false) {
    return { ...result, error: result.error ?? "authority-unavailable" };
  }
  return { ok: true, ...(result && typeof result === "object" ? result : {}) };
}

export const craftingAuthorityCheck = craftingWriterAuthority;

function transactionFromPlan(actor, project, plan, txId) {
  const preQuantities = plan.consumption.map(entry => ({
    itemId: entry.itemId,
    before: entry.beforeQuantity,
    after: entry.afterQuantity,
    delete: entry.delete === true
  }));
  return {
    txId: String(txId),
    phase: "prepared",
    failedPhase: "",
    actorRevision: craftingRevisionFor(actor),
    projectRevision: fingerprint(project),
    projectId: String(project?.id ?? ""),
    copies: Math.max(1, nonNegativeInteger(project?.completed, 1)),
    preQuantities,
    postQuantities: preQuantities.map(entry => ({
      itemId: entry.itemId,
      quantity: entry.after,
      present: entry.after > 0
    })),
    updates: cloneValue(plan.updates),
    exhaustedIds: [...plan.exhaustedIds],
    error: "",
    result: {}
  };
}

function quantityStates(actor, transaction) {
  return (transaction.preQuantities ?? []).map(entry => {
    const item = actorItem(actor, entry.itemId);
    if (!item) return entry.after === 0 ? "post" : "divergent";
    const quantity = itemQuantityForTransaction(item);
    if (quantity === entry.before) return "pre";
    if (quantity === entry.after) return "post";
    return "divergent";
  });
}

function allStates(states, value) {
  return states.every(state => state === value);
}

function transactionFailure(transaction, error, state = "unknown") {
  return {
    ok: false,
    error,
    state,
    transaction: cloneValue(transaction)
  };
}

async function markTransactionRecovery(actor, transaction, failedPhase, error) {
  transaction.phase = "recovery-required";
  transaction.failedPhase = failedPhase;
  transaction.error = String(error?.message ?? error ?? `crafting ${failedPhase} write failed`);
  try {
    await persistTransaction(actor, transaction);
  } catch (persistError) {
    return transactionFailure(transaction, "write-failed");
  }
  return transactionFailure(transaction, "recovery-required");
}

async function applyTransactionQuantities(actor, transaction) {
  if (transaction.phase !== "prepared" && transaction.phase !== "recovery-required") return { ok: true };
  const states = quantityStates(actor, transaction);
  if (!states.length || allStates(states, "post")) {
    transaction.phase = "quantities-applied";
    transaction.failedPhase = "";
    try { await persistTransaction(actor, transaction); }
    catch (error) { return transactionFailure(transaction, "write-failed"); }
    return { ok: true };
  }
  if (!allStates(states, "pre")) {
    return markTransactionRecovery(actor, transaction, "quantities", "mixed or divergent quantity state");
  }
  if (typeof actor?.updateEmbeddedDocuments !== "function") {
    transaction.error = "actor.updateEmbeddedDocuments unavailable";
    return transactionFailure(transaction, "write-failed");
  }
  try {
    // Foundry v14 separates embedded updates from embedded deletes. Every
    // decrement, including a zero result, belongs in this update call.
    await actor.updateEmbeddedDocuments("Item", cloneValue(transaction.updates ?? []));
  } catch (error) {
    const afterFailure = quantityStates(actor, transaction);
    if (allStates(afterFailure, "post")) {
      transaction.phase = "quantities-applied";
      transaction.failedPhase = "";
      try { await persistTransaction(actor, transaction); }
      catch (persistError) { return transactionFailure(transaction, "write-failed"); }
      return { ok: true };
    }
    if (allStates(afterFailure, "pre")) {
      transaction.error = String(error?.message ?? error ?? "quantity update rejected");
      return transactionFailure(transaction, "write-failed");
    }
    return markTransactionRecovery(actor, transaction, "quantities", error);
  }
  const after = quantityStates(actor, transaction);
  if (!allStates(after, "post")) {
    return markTransactionRecovery(actor, transaction, "quantities", "quantity update did not reach the planned post-state");
  }
  transaction.phase = "quantities-applied";
  transaction.failedPhase = "";
  try { await persistTransaction(actor, transaction); }
  catch (error) { return transactionFailure(transaction, "write-failed"); }
  return { ok: true };
}

async function applyTransactionDeletes(actor, transaction) {
  if (transaction.phase !== "quantities-applied" && transaction.phase !== "recovery-required") return { ok: true };
  const states = quantityStates(actor, transaction);
  if (states.some(state => state === "pre" || state === "divergent")) {
    return markTransactionRecovery(actor, transaction, "delete", "quantity post-state is not confirmed");
  }
  const exhausted = [...(transaction.exhaustedIds ?? [])].map(String);
  let present = exhausted.filter(id => actorItem(actor, id));
  if (!present.length) {
    transaction.phase = "items-deleted";
    transaction.failedPhase = "";
    try { await persistTransaction(actor, transaction); }
    catch (error) { return transactionFailure(transaction, "write-failed"); }
    return { ok: true };
  }
  if (typeof actor?.deleteEmbeddedDocuments !== "function") {
    return markTransactionRecovery(actor, transaction, "delete", "actor.deleteEmbeddedDocuments unavailable");
  }
  const deleteOnce = async ids => actor.deleteEmbeddedDocuments("Item", ids);
  try {
    // Deletion is a separate Foundry operation; never pass deletion objects to
    // updateEmbeddedDocuments. A retry here is idempotent and only includes
    // exhausted Items still present after the first result.
    await deleteOnce(present);
  } catch (error) {
    present = exhausted.filter(id => actorItem(actor, id));
    if (present.length) {
      try { await deleteOnce(present); }
      catch (retryError) { return markTransactionRecovery(actor, transaction, "delete", retryError); }
    }
  }
  present = exhausted.filter(id => actorItem(actor, id));
  if (present.length) return markTransactionRecovery(actor, transaction, "delete", "exhausted Item deletion is not confirmed");
  transaction.phase = "items-deleted";
  transaction.failedPhase = "";
  try { await persistTransaction(actor, transaction); }
  catch (error) { return transactionFailure(transaction, "write-failed"); }
  return { ok: true };
}

function postStateConfirmed(actor, transaction) {
  for (const entry of transaction.preQuantities ?? []) {
    const item = actorItem(actor, entry.itemId);
    if (entry.delete) {
      if (item) return false;
    } else if (!item || itemQuantityForTransaction(item) !== entry.after) {
      return false;
    }
  }
  return true;
}

function outputClaimsForTransaction(actor, txId) {
  return (Array.isArray(actor?.system?.crafting?.outputClaims)
    ? actor.system.crafting.outputClaims : [])
    .filter(claim => String(claim?.transactionId ?? "") === String(txId));
}

async function finalizeTransaction(actor, transaction, plan) {
  if (!postStateConfirmed(actor, transaction)) {
    return markTransactionRecovery(actor, transaction, "finalize", "material post-state is divergent");
  }
  const projects = Array.isArray(actor?.system?.crafting?.projects)
    ? actor.system.crafting.projects : [];
  const index = projects.findIndex(project => String(project?.id ?? "") === String(transaction.projectId));
  const existingForTransaction = outputClaimsForTransaction(actor, transaction.txId);
  if (index < 0) {
    if (existingForTransaction.length >= transaction.copies) {
      transaction.phase = "finalized";
      transaction.result = {
        ok: true,
        project: null,
        claims: cloneValue(existingForTransaction),
        remainder: null,
        plan: cloneValue(plan)
      };
      try { await persistTransaction(actor, transaction); }
      catch (error) { return transactionFailure(transaction, "write-failed"); }
      return { ...transaction.result, transaction: cloneValue(transaction), recovered: true };
    }
    return markTransactionRecovery(actor, transaction, "finalize", "project disappeared before claim persistence");
  }

  const project = normalizeCraftingProject(projects[index]);
  const completed = nonNegativeInteger(project.completed, 0);
  if (completed < transaction.copies) {
    return markTransactionRecovery(actor, transaction, "finalize", "project completion count changed during transaction");
  }

  const claims = [];
  for (let copy = 0; copy < transaction.copies; copy++) {
    const id = `${transaction.txId}-claim-${copy + 1}`;
    const existing = existingForTransaction.find(claim => String(claim?.id ?? "") === id);
    if (existing) claims.push(cloneValue(existing));
    else {
      const claim = outputClaimFor(project, copy, { transactionId: transaction.txId });
      claim.id = id;
      claims.push(claim);
    }
  }
  const existingClaims = Array.isArray(actor.system?.crafting?.outputClaims)
    ? actor.system.crafting.outputClaims : [];
  const claimIds = new Set(claims.map(claim => claim.id));
  const nextClaims = [
    ...existingClaims.filter(claim => !claimIds.has(claim?.id)),
    ...claims
  ];

  // Pending copies are handed to the Ref. Any below-goal points remain on the
  // project for the next copy; only an empty remainder removes the project.
  const remainderPoints = nonNegativeInteger(project.points, 0);
  const remainder = remainderPoints > 0
    ? {
      ...project,
      completed: Math.max(0, completed - transaction.copies),
      points: remainderPoints,
      status: remainderPoints >= Math.max(1, nonNegativeInteger(project.goal, 1))
        ? "blocked" : "active"
    }
    : null;
  // If the project had more completed copies than this transaction's bounded
  // claim, retain them for the next explicit Finalize instead of dropping them.
  if (completed > transaction.copies) {
    const retained = { ...project, completed: completed - transaction.copies, status: "pending" };
    if (remainder) retained.points = remainder.points;
    else retained.points = 0;
    if (remainder) retained.status = remainder.status;
    else retained.status = "pending";
    // `remainder` is const for the common one-copy path; this branch replaces
    // it through the next-project calculation below.
    const nextProjects = projects.map((entry, entryIndex) => entryIndex === index ? retained : entry);
    const finalTransaction = {
      ...transaction,
      phase: "finalized",
      failedPhase: "",
      error: "",
      result: { ok: true, project, claims, remainder: retained, plan: cloneValue(plan) }
    };
    try {
      await actor.update({
        "system.crafting.projects": nextProjects,
        "system.crafting.outputClaims": nextClaims,
        "system.crafting.transactions": transactionList(actor).map(entry =>
          String(entry?.txId ?? "") === transaction.txId ? finalTransaction : entry),
        "system.crafting.revision": nextCraftingRevision(actor)
      });
    } catch (error) {
      transaction.error = String(error?.message ?? error ?? "finalize write rejected");
      return transactionFailure(transaction, "write-failed");
    }
    return { ...finalTransaction.result, transaction: cloneValue(finalTransaction) };
  }

  const nextProjects = remainder
    ? projects.map((entry, entryIndex) => entryIndex === index ? remainder : entry)
    : projects.filter((_, entryIndex) => entryIndex !== index);
  const finalTransaction = {
    ...transaction,
    phase: "finalized",
    failedPhase: "",
    error: "",
    result: { ok: true, project, claims, remainder, plan: cloneValue(plan) }
  };
  try {
    await actor.update({
      "system.crafting.projects": nextProjects,
      "system.crafting.outputClaims": nextClaims,
      "system.crafting.transactions": transactionList(actor).map(entry =>
        String(entry?.txId ?? "") === transaction.txId ? finalTransaction : entry),
      "system.crafting.revision": nextCraftingRevision(actor)
    });
  } catch (error) {
    transaction.error = String(error?.message ?? error ?? "finalize write rejected");
    return transactionFailure(transaction, "write-failed");
  }
  return { ...finalTransaction.result, transaction: cloneValue(finalTransaction) };
}

async function runCraftingTransaction(actor, transaction, plan) {
  if (transaction.phase === "finalized") {
    return transaction.result && typeof transaction.result === "object"
      ? { ...cloneValue(transaction.result), transaction: cloneValue(transaction), recovered: true }
      : transactionFailure(transaction, "already-finalized");
  }

  // A recovery-required journal may resume only the phase whose post-state is
  // observable. It never replays a quantity decrement after quantities landed.
  if (transaction.phase === "recovery-required") {
    if (transaction.failedPhase === "finalize") {
      if (!postStateConfirmed(actor, transaction)) return transactionFailure(transaction, "recovery-required");
      transaction.phase = "items-deleted";
    } else if (transaction.failedPhase === "delete") {
      const states = quantityStates(actor, transaction);
      if (!allStates(states, "post")) return transactionFailure(transaction, "recovery-required");
      transaction.phase = "quantities-applied";
    } else if (transaction.failedPhase === "quantities") {
      const states = quantityStates(actor, transaction);
      if (!allStates(states, "pre")) return transactionFailure(transaction, "recovery-required");
      transaction.phase = "prepared";
    } else {
      return transactionFailure(transaction, "recovery-required");
    }
  }

  let result = await applyTransactionQuantities(actor, transaction);
  if (!result.ok) return result;
  result = await applyTransactionDeletes(actor, transaction);
  if (!result.ok) return result;
  return finalizeTransaction(actor, transaction, plan);
}

async function postFinalizeChat(actor, result) {
  if (typeof globalThis.ChatMessage?.create !== "function") return;
  const project = result?.project;
  if (!project) return;
  const consumed = result?.plan?.consumption ?? [];
  const materialLine = consumed.length
    ? `<div>Materials consumed: ${consumed.map(entry =>
      `${entry.quantity} ${entry.itemName || entry.itemId}`).join(", ")}</div>`
    : "";
  await ChatMessage.create({
    content: `<div class="crows crafting-done">
      <header><strong>${actor.name}</strong> finishes <strong>${project.name}</strong>!</header>
      ${materialLine}
      <div>${(result.claims ?? []).length} output claim${(result.claims ?? []).length === 1 ? "" : "s"} recorded for the Ref.</div>
      <em>The Ref grants the finished item.</em>
    </div>`,
    speaker: ChatMessage.getSpeaker({ actor })
  });
}

/**
 * Finalize completed copies and post their Ref handoff.
 *
 * The bounded protocol is deliberately two Foundry calls for material writes:
 * update every planned quantity (including zeroes), then delete exhausted
 * Items. Each phase is journaled only after its call succeeds. The finished
 * Item is still the Ref's to grant; this helper only records output claims.
 */
export async function completeProject(actor, projectId, options = {}) {
  if (!actor || actor.type !== "crow") return { ok: false, error: "not a crow" };
  const projects = Array.isArray(actor.system?.crafting?.projects)
    ? actor.system.crafting.projects : [];
  const idx = projects.findIndex(project => project?.id === projectId);

  const txId = String(options?.txId ?? "").trim();
  const authority = await craftingWriterAuthority(actor, { projectId, txId }, options);
  if (!authority.ok) return { ok: false, error: authority.error ?? "authority-unavailable" };

  if (txId) {
    const existing = transactionById(actor, txId);
    if (existing) {
      if (String(existing.projectId ?? "") !== String(projectId)) {
        return { ok: false, error: "conflict", transaction: cloneValue(existing) };
      }
      // A prior finalize write may have removed the project before its claim
      // acknowledgement was observed. Recovery still uses the journal and
      // must not fail early on the now-missing project.
      const existingPlan = planCraftingMaterials(actor, idx < 0 ? { materials: [] } : projects[idx], {
        copies: existing.copies
      });
      const result = await runCraftingTransaction(actor, cloneValue(existing), existingPlan);
      if (result.ok && !result.recovered) await postFinalizeChat(actor, result);
      return result;
    }
  }

  if (idx < 0) return { ok: false, error: "not found" };

  // Re-read and reconcile in memory. A late material grant can authorize a
  // blocked goal; no document write occurs until the durable completion guard,
  // unresolved check, and exact inventory preflight all pass.
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

  const plan = planCraftingMaterials(actor, project, { copies: completed });
  if (plan.unresolved.length) {
    return { ok: false, error: "unresolved-material", project, plan };
  }
  if (Number.isFinite(plan.fullSets) && plan.fullSets < completed) {
    return { ok: false, error: "insufficient-material", project, plan };
  }
  if (plan.requirements.length && plan.copies !== completed) {
    return { ok: false, error: "insufficient-material", project, plan };
  }

  const transaction = transactionFromPlan(actor, project, plan, txId || randomId("craft-tx"));
  try {
    // `prepared` is durable before the first Item mutation. This is the only
    // new write on a successful preflight and the first recovery boundary.
    if (typeof actor.update !== "function") return transactionFailure(transaction, "write-failed");
    const journals = [...transactionList(actor).map(cloneValue), cloneValue(transaction)];
    await actor.update({ "system.crafting.transactions": journals });
  } catch (error) {
    transaction.error = String(error?.message ?? error ?? "prepared journal write rejected");
    return transactionFailure(transaction, "write-failed");
  }

  const result = await runCraftingTransaction(actor, transaction, plan);
  if (result.ok && !result.recovered) await postFinalizeChat(actor, result);
  return result;
}

/** Resume a durable transaction by token without constructing a new plan. */
export async function recoverCraftingTransaction(actor, txId, options = {}) {
  const transaction = transactionById(actor, txId);
  if (!transaction) return { ok: false, error: "not found" };
  const project = (actor?.system?.crafting?.projects ?? [])
    .find(entry => String(entry?.id ?? "") === String(transaction.projectId));
  const plan = planCraftingMaterials(actor, project ?? { materials: [] }, { copies: transaction.copies });
  const authority = await craftingWriterAuthority(actor, {
    projectId: transaction.projectId, txId: transaction.txId, recovery: true
  }, options);
  if (!authority.ok) return { ok: false, error: authority.error ?? "authority-unavailable" };
  const result = await runCraftingTransaction(actor, cloneValue(transaction), plan);
  if (result.ok && !result.recovered) await postFinalizeChat(actor, result);
  return result;
}

export const consumeCraftingMaterials = completeProject;

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
