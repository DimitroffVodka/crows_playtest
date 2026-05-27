/**
 * Crafting + Identify Item — Rules pp.1415–1475.
 *
 * Crafting workflow:
 *   - Each craftable item has a skill prereq + bonus, materials, recipe,
 *     and a crafting goal (number of accumulated points to finish).
 *   - The Craft Equipment rest activity makes a special Mind test:
 *       2d10 + M + skillBonus
 *     A doom result accrues 0 points; a crit grants a free re-roll.
 *     Otherwise the total (min 1) is added to the project's points.
 *   - When points ≥ goal, materials are expended and the item is built.
 *
 * Identify Item (Rules p.1465):
 *   2d10 + M, no skill:
 *     Tier 1 (≤11): you accidentally activate the item (Ref-determined).
 *     Tier 2 (12-16): you learn nothing.
 *     Tier 3 (17+): you learn all the item's properties.
 */

const SKILLS_OK = new Set([
  "alchemy", "blacksmithing", "enchanting"  // typical crafting skills
]);

/**
 * Start a new crafting project on the actor. Returns the project id.
 * Validates prerequisites loosely — the player/GM passes goal/skill/etc.
 * directly; this helper does not enforce material possession (M3 inventory
 * tagging is out of scope).
 */
export async function startCraftingProject(actor, {
  name, skill, goal, prereqBonus = 1,
  materials = [], hasRecipe = true, notes = ""
} = {}) {
  if (!actor || actor.type !== "crow") return { ok: false, error: "not a crow" };
  if (!name || !skill || !goal) return { ok: false, error: "need name, skill, goal" };

  // Skill prereq check (Rules p.1423): need skill bonus ≥ prereqBonus.
  const bonus = actor.system?.skills?.[skill]?.bonus ?? 0;
  if (bonus < prereqBonus) {
    ui.notifications?.warn(`${actor.name} lacks the skill prereq: needs ${skill}+${prereqBonus}, has +${bonus}.`);
    return { ok: false, error: "below skill prereq" };
  }
  // Recipe rule (Rules p.1427): if you outclass the prereq, no recipe required.
  const needsRecipe = bonus <= prereqBonus;
  if (needsRecipe && !hasRecipe) {
    ui.notifications?.warn(`${actor.name} needs a recipe to craft ${name} (skill bonus +${bonus} not above prereq +${prereqBonus}).`);
    return { ok: false, error: "needs recipe" };
  }

  const id = `proj-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;
  const project = {
    id, name, skill,
    goal: Math.max(1, Math.floor(Number(goal) || 100)),
    points: 0,
    prereqBonus: Math.max(0, Math.min(2, Math.floor(Number(prereqBonus) || 0))),
    materials: Array.isArray(materials) ? materials.map(String) : [],
    hasRecipe: !!hasRecipe,
    notes
  };
  const next = [...(actor.system?.crafting?.projects ?? []), project];
  await actor.update({ "system.crafting.projects": next });
  await ChatMessage.create({
    content: `<div class="crows crafting-start">
      <header><strong>${actor.name}</strong> starts a crafting project: <strong>${name}</strong></header>
      <div>Skill: <em>${skill}</em> (prereq +${project.prereqBonus}) · Goal: <strong>${project.goal}</strong> pts${project.materials.length ? ` · Materials: ${project.materials.join(", ")}` : ""}</div>
    </div>`,
    speaker: ChatMessage.getSpeaker({ actor })
  });
  return { ok: true, id, project };
}

/** Cancel a project, removing its entry without expending materials. */
export async function cancelProject(actor, id) {
  if (!actor || actor.type !== "crow") return { ok: false, error: "not a crow" };
  const projects = actor.system?.crafting?.projects ?? [];
  const next = projects.filter(p => p.id !== id);
  if (next.length === projects.length) return { ok: false, error: "not found" };
  const removed = projects.find(p => p.id === id);
  await actor.update({ "system.crafting.projects": next });
  await ChatMessage.create({
    content: `<div class="crows crafting-cancel"><strong>${actor.name}</strong> cancels <strong>${removed.name}</strong> at ${removed.points}/${removed.goal} pts.</div>`,
    speaker: ChatMessage.getSpeaker({ actor })
  });
  return { ok: true };
}

/**
 * Make a single crafting roll on a project. Returns:
 *   { ok, points, total, doom, crit, complete }.
 * Crit grants the caller a flag to call again; we expose the
 * re-roll as the `crit` boolean rather than recursing here.
 */
export async function makeCraftingRoll(actor, projectId) {
  if (!actor || actor.type !== "crow") return { ok: false, error: "not a crow" };
  const projects = [...(actor.system?.crafting?.projects ?? [])];
  const idx = projects.findIndex(p => p.id === projectId);
  if (idx < 0) return { ok: false, error: "project not found" };
  const project = { ...projects[idx] };
  if (project.points >= project.goal) return { ok: false, error: "already complete" };

  // Special Mind test: 2d10 + M + skill. We don't use rollTest because we
  // need to consult the raw doom/crit faces ourselves (no tier classification).
  const mind = actor.system?.characteristics?.mind?.value ?? 0;
  const skillBonus = actor.system?.skills?.[project.skill]?.bonus ?? 0;
  const formula = `2d10 + ${mind} + ${skillBonus}`;
  const roll = await new Roll(formula).evaluate();
  const d10s = roll.dice.find(d => d.faces === 10);
  const rawSum = d10s ? d10s.results.reduce((a, r) => a + r.result, 0) : roll.total;
  // Doom/Crit by config (same as rollTest).
  const { CROWS } = await import("../config.mjs");
  const doom = CROWS.doomFaces.includes(rawSum);
  const crit = CROWS.critFaces.includes(rawSum);
  const pointsThisRoll = doom ? 0 : Math.max(1, roll.total);

  project.points += pointsThisRoll;
  projects[idx] = project;
  await actor.update({ "system.crafting.projects": projects });

  const complete = project.points >= project.goal;
  const lines = [
    `<div>Roll: 2d10(${d10s?.results?.map(x => x.result).join(",") ?? rawSum}) + M ${mind} + ${project.skill} +${skillBonus} = <strong>${roll.total}</strong>${doom ? " <em>(DOOM)</em>" : crit ? " <em>(CRIT)</em>" : ""}</div>`,
    `<div>Points: +<strong>${pointsThisRoll}</strong> → ${project.points}/${project.goal}${complete ? " <strong>COMPLETE</strong>" : ""}</div>`
  ];
  if (crit && !complete) lines.push(`<div><em>Crit — make another crafting roll for this project (free).</em></div>`);
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `Crafting roll — ${project.name}`,
    content: `<div class="crows crafting-roll">
      <header><strong>${actor.name}</strong> works on <strong>${project.name}</strong></header>
      ${lines.join("")}
    </div>`
  });

  return { ok: true, points: pointsThisRoll, total: roll.total, doom, crit, complete, project };
}

/**
 * Finalize a completed project: removes it from the actor's project list
 * and posts a "completed" card. The actual created item is left to the
 * GM (drag-drop from compendium) — M3 will add an item-creation hook.
 */
export async function completeProject(actor, projectId) {
  if (!actor || actor.type !== "crow") return { ok: false, error: "not a crow" };
  const projects = actor.system?.crafting?.projects ?? [];
  const project = projects.find(p => p.id === projectId);
  if (!project) return { ok: false, error: "not found" };
  if (project.points < project.goal) return { ok: false, error: "not yet complete" };
  const next = projects.filter(p => p.id !== projectId);
  await actor.update({ "system.crafting.projects": next });
  await ChatMessage.create({
    content: `<div class="crows crafting-done">
      <header><strong>${actor.name}</strong> finishes <strong>${project.name}</strong>! (${project.points}/${project.goal} pts)</header>
      ${project.materials.length ? `<div>Materials expended: ${project.materials.join(", ")}</div>` : ""}
      <em>GM grants the finished item via drag-drop from compendium.</em>
    </div>`,
    speaker: ChatMessage.getSpeaker({ actor })
  });
  return { ok: true, project };
}

/**
 * Identify Item magic-property test (Rules p.1465–1475):
 *   2d10 + M:
 *     ≤11 → tier 1: accidentally activates harmfully (Ref-determined).
 *     12-16 → tier 2: learn nothing.
 *     17+ → tier 3: learn all properties.
 *
 * One attempt per item. We don't enforce that gate here (no per-item
 * flag exists for it yet); GM should remember.
 */
export async function identifyMagicItem(actor, { itemId = null, itemName = null } = {}) {
  if (!actor || actor.type !== "crow") return { ok: false, error: "not a crow" };
  const item = itemId ? actor.items.get(itemId) : null;
  const label = item?.name ?? itemName ?? "<em>(unnamed item)</em>";
  const mind = actor.system?.characteristics?.mind?.value ?? 0;
  const formula = `2d10 + ${mind}`;
  const roll = await new Roll(formula).evaluate();
  const total = roll.total;
  const tier = total <= 11 ? 1 : total <= 16 ? 2 : 3;
  const outcome = ({
    1: { id: "activate", text: `Accidentally activates ${label} in a harmful way (Ref decides).` },
    2: { id: "blank",    text: `Learns nothing about ${label}.` },
    3: { id: "full",     text: `Learns ALL of ${label}'s properties.${item ? ` <em>(reveals item description)</em>` : ""}` }
  })[tier];
  let descBlock = "";
  if (tier === 3 && item?.system?.description) {
    descBlock = `<div class="id-item-desc">${item.system.description}</div>`;
  }
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `Identify Item: ${item?.name ?? itemName ?? "(unnamed)"}`,
    content: `<div class="crows identify-roll tier${tier}">
      <header><strong>${actor.name}</strong> tries to identify <strong>${label}</strong></header>
      <div>2d10 + M = <strong>${total}</strong> → <strong>Tier ${tier}</strong></div>
      <div class="id-outcome">${outcome.text}</div>
      ${descBlock}
    </div>`
  });
  return { ok: true, tier, total, outcome };
}
