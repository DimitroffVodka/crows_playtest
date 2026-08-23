/**
 * Crafting and IDing magic items — Playtest 2.
 *
 * Citations are `R:<line>` into the Rules book
 * (`01 Crows The Rules Book for Playtest 2.md`): crafting R:1532-1580,
 * IDing magic items R:1586-1600, the Craft Equipment and Identify Item rest
 * activities R:580-590.
 *
 * ## What Playtest 2 changed here
 *
 * - **Skills are gone.** A project names an *expertise*
 *   (`crafting.projects[].expertise`, renamed from `.skill`), and `CROWS.skills`
 *   no longer exists.
 * - **The prerequisite is USES OWNED, not a bonus.** R:1540: *"Every craftable
 *   item has an expertise and number of uses associated with it. You must have
 *   the appropriate expertise and number of uses to craft it."* That reads
 *   `expertises[key].max`, never `.value` — spending your alchemy uses on tests
 *   this morning does not make you unable to craft this evening.
 * - **Recipes are gone.** PT1's "if you outclass the prereq you need no recipe"
 *   has no counterpart in the PT2 text. `hasRecipe` / `prereqBonus` are no
 *   longer written.
 * - **An expertise applied to a crafting roll is a flat +4, and you may apply
 *   TWO** (R:1570) — not the usual one-per-test tier improvement. This is why
 *   crafting does not route through `expertise.mjs`'s `canSpendExpertise`,
 *   which enforces the test rule it is not subject to. A spend still decrements
 *   `value` and never touches `max`.
 * - **Materials are generic monster parts**, not named organs (changelog;
 *   R:1558 still calls them organs and vials of blood in flavour text, but the
 *   crafting requirement is a count).
 * - **Surplus points roll into another copy** of the same item (R:1576).
 *
 * The pure half — prerequisites, point arithmetic, tier lookup — is what
 * `test/village.test.mjs` exercises; the `Roll` / `ChatMessage` half is below it.
 */

import { CROWS } from "../config.mjs";
import { readExpertiseUses } from "./expertise.mjs";

/** R:1548-1554 — the tools each crafting expertise needs. */
export const TOOL_FOR_EXPERTISE = Object.freeze({
  alchemy: "alchemist's tools",
  blacksmithing: "blacksmith's tools",
  enchanting: "enchanter's tools"
});

/** The three expertises anything is crafted with (R:1550-1554). */
export const CRAFTING_EXPERTISES = Object.freeze(Object.keys(TOOL_FOR_EXPERTISE));

/**
 * R:1570 — "When you apply a double edge or an expertise to a crafting roll,
 * the roll gains a +4 bonus instead of the normal benefits. You can only apply
 * up to two expertises per crafting roll. When a double bane applies to a
 * crafting roll, the roll gains a -4 penalty."
 */
export const CRAFTING_EXPERTISE_BONUS = 4;
export const CRAFTING_DOUBLE_EDGE_BONUS = 4;
export const CRAFTING_DOUBLE_BANE_PENALTY = -4;
export const MAX_EXPERTISES_PER_CRAFTING_ROLL = 2;

/** R:1568 — the floor on a crafting roll, unless it is a doom. */
export const CRAFTING_MIN_POINTS = 1;

/* -------------------------------------------------------------------------- */
/*  Prerequisites (R:1536-1554)                                                */
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
/*  Roll arithmetic (R:1564-1576)                                              */
/* -------------------------------------------------------------------------- */

/**
 * The bonus a crafting roll carries, from every source that stacks onto it.
 *
 * Expertises are capped at two (R:1570). A double edge is a further flat +4 in
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
 * R:1568 — the total becomes crafting points. Minimum 1 even through a bane or
 * penalty; a doom accrues nothing at all.
 */
export function craftingPointsFrom({ total = 0, doom = false } = {}) {
  if (doom) return 0;
  return Math.max(CRAFTING_MIN_POINTS, Math.floor(Number(total) || 0));
}

/**
 * Add points to a project and settle completions.
 *
 * R:1572 — at or past the goal the item is done and its materials are expended.
 * R:1576 — surplus begins another copy of the SAME item, *provided you have the
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
    completed: (Math.floor(Number(completed) || 0)) + made,
    completedThisRoll: made,
    blockedOnMaterials
  };
}

/**
 * R:1580 — another creature resting with you who meets the tool and expertise
 * prerequisites may spend their own rest activity on your project; their rolls
 * accrue to the same item.
 */
export function canAssistCrafting(helper, project) {
  return meetsCraftingPrerequisites(helper, { expertise: project?.expertise, uses: project?.uses ?? 1 });
}

/* -------------------------------------------------------------------------- */
/*  IDing magic items (R:1586-1600)                                            */
/* -------------------------------------------------------------------------- */

/** Tier of a 2d10 + M identify test, using the shared tier boundaries. */
export function identifyTier(total) {
  const t = Math.floor(Number(total) || 0);
  if (t <= CROWS.tiers.t1Max) return 1;
  if (t <= CROWS.tiers.t2Max) return 2;
  return 3;
}

/** R:1594-1598 — what each tier tells you. */
export const IDENTIFY_OUTCOMES = Object.freeze({
  1: Object.freeze({ id: "activate", source: "R:1594",
    text: "You accidentally activate the item in a harmful way determined by the Ref." }),
  2: Object.freeze({ id: "blank", source: "R:1596",
    text: "You learn nothing about the item." }),
  3: Object.freeze({ id: "full", source: "R:1598",
    text: "You learn all of the item's properties." })
});

/* ========================================================================== */
/*  Foundry-facing half.                                                       */
/* ========================================================================== */

/**
 * Start a crafting project.
 *
 * NB the required-uses count is validated here and NOT persisted: `CrowData`'s
 * `crafting.projects` schema has no field for it (it still carries PT1's
 * `prereqBonus` and `hasRecipe`, which PT2 deleted), and an unknown key would
 * be stripped on write. The prerequisite is a gate at the moment you begin,
 * so nothing downstream re-reads it — but a later ticket that wants to
 * re-validate mid-project needs `expertiseUses` added to the schema.
 */
export async function startCraftingProject(actor, {
  name, expertise, uses = 1, goal, materials = [], notes = "", hasTools = null
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
    name,
    expertise,
    goal: Math.max(1, Math.floor(Number(goal) || 100)),
    points: 0,
    materials: Array.isArray(materials) ? materials.map(String) : [],
    notes
  };
  const next = [...(actor.system?.crafting?.projects ?? []), project];
  await actor.update({ "system.crafting.projects": next });

  await ChatMessage.create({
    content: `<div class="crows crafting-start">
      <header><strong>${actor.name}</strong> starts a crafting project: <strong>${name}</strong></header>
      <div>${expertise} (${prereq.required} use${prereq.required === 1 ? "" : "s"} required, ${prereq.owned} owned)
        &middot; Goal: <strong>${project.goal}</strong> pts${project.materials.length ? ` &middot; Materials: ${project.materials.join(", ")}` : ""}</div>
    </div>`,
    speaker: ChatMessage.getSpeaker({ actor })
  });
  return { ok: true, id: project.id, project };
}

/** Cancel a project. Materials are not expended (R:1572 only spends on completion). */
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
 * One crafting roll: a special Mind test with no tiered outcome (R:1568).
 *
 * `expertises` are the keys applied to THIS roll — up to two (R:1570), each a
 * flat +4, each costing one remaining use. Uses are deducted from `value`;
 * `max` is never touched, so a rest restores them (R:628).
 *
 * A crit lets you roll again for the same item within the same rest activity
 * (R:1568); that loop is the caller's — `rest.mjs` already runs it — so this
 * returns `crit` rather than recursing.
 */
export async function makeCraftingRoll(actor, projectId, {
  expertises = [], doubleEdge = false, doubleBane = false, institutionBonus = 0, materialSets = 1
} = {}) {
  if (!actor || actor.type !== "crow") return { ok: false, error: "not a crow" };
  const projects = [...(actor.system?.crafting?.projects ?? [])];
  const idx = projects.findIndex(p => p.id === projectId);
  if (idx < 0) return { ok: false, error: "project not found" };
  const project = { ...projects[idx] };

  // Which requested spends are actually payable right now (R:1570 caps at two).
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
  const accrued = accrueCraftingPoints(project, gained, { materialSets });
  project.points = accrued.points;

  projects[idx] = project;
  const update = { "system.crafting.projects": projects };
  // R:1570 spends: decrement `value`, never `max`.
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
  if (accrued.blockedOnMaterials) lines.push(`<div><em>Surplus banked — another copy needs another set of materials (R:1576).</em></div>`);
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

/**
 * Finalize a completed project: expend the materials, drop it off the list and
 * post the card. The finished Item is still the Ref's to grant.
 */
export async function completeProject(actor, projectId) {
  if (!actor || actor.type !== "crow") return { ok: false, error: "not a crow" };
  const projects = actor.system?.crafting?.projects ?? [];
  const project = projects.find(p => p.id === projectId);
  if (!project) return { ok: false, error: "not found" };
  await actor.update({ "system.crafting.projects": projects.filter(p => p.id !== projectId) });
  await ChatMessage.create({
    content: `<div class="crows crafting-done">
      <header><strong>${actor.name}</strong> finishes <strong>${project.name}</strong>!</header>
      ${project.materials.length ? `<div>Materials expended: ${project.materials.join(", ")}</div>` : ""}
      <em>The Ref grants the finished item.</em>
    </div>`,
    speaker: ChatMessage.getSpeaker({ actor })
  });
  return { ok: true, project };
}

/**
 * Identify Item (R:1586-1600). 2d10 + M, one attempt per item ever (R:1600) —
 * enforced by a flag on the item so the gate survives a reload, which the PT1
 * "the Ref should remember" comment did not.
 */
export async function identifyMagicItem(actor, { itemId = null, itemName = null } = {}) {
  if (!actor || actor.type !== "crow") return { ok: false, error: "not a crow" };
  const item = itemId ? actor.items.get(itemId) : null;
  const label = item?.name ?? itemName ?? "(unnamed item)";

  if (item?.getFlag?.(CROWS.id, "identifyAttempted")) {
    return { ok: false, error: "you can only make this test once with an item (R:1600)" };
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
