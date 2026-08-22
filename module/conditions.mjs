/**
 * Foundry status effects — Playtest 2.
 *
 * CONTRACT: `system.conditions` on the actor is AUTHORITATIVE. These status
 * effects MIRROR it for the token HUD. The roll pipeline reads
 * `system.conditions` directly (Weakened -> a bane, Blessed -> an edge), and two
 * sources of truth for "is this creature weakened" would desync mid-roll.
 *
 * THE COMMAND FLOW — freeze this, not just the source of truth. "Driven from the
 * boolean, never the reverse" was too blunt: taken literally, a Ref toggling a
 * condition on the Token HUD would create a status effect and the roll engine
 * would never see it. What is actually one-way is AUTHORITY, not user intent:
 *
 *   1. HUD toggle is INTERCEPTED and translated into an update to
 *      `system.conditions.<key>` — the toggle expresses intent, it does not
 *      write state.
 *   2. The boolean is canonical and is what every rule reads.
 *   3. An idempotent, LOOP-GUARDED mirror then adds or removes the matching
 *      status effect to match the boolean.
 *
 * The guard matters: without it step 3 re-triggers step 1. Mirror only when the
 * effect's presence actually disagrees with the boolean, and make the write a
 * no-op when they already agree.
 *
 * The `dead` status maps to `conditions.defeated`, not to a same-named boolean —
 * it is the one id where the two vocabularies differ.
 *
 * T1.7's brief says "bidirectional Active Effect sync". Read it as the flow
 * above; a naive two-way sync loops or leaves two sources disagreeing.
 *
 * Do NOT implement condition mechanics as Active Effect `changes`. Active
 * Effects remain correct for durational backlash effects (R:1561) and magic
 * items — and when you write one, note that v14 changed the shape:
 *
 *   changes: [{ key: "system.speed", value: "-1", type: "add" }]   // STRING type
 *
 * The numeric `mode:` field is legacy and auto-migrates to `{type, phase}`.
 * `CONST.ACTIVE_EFFECT_CHANGE_TYPES` holds PRIORITIES, not modes — `.add` is
 * 20 — so assigning its value to `type:` writes 20 where "add" was meant.
 * Verified live on Foundry 14.367; see .planning/API-NOTES.md §1.
 */
export const CROWS_STATUS = [
  { id: "blessed",     name: "CROWS.Condition.blessed",     img: "icons/svg/angel.svg" },
  { id: "grabbed",     name: "CROWS.Condition.grabbed",     img: "icons/svg/net.svg" },
  { id: "prone",       name: "CROWS.Condition.prone",       img: "icons/svg/falling.svg" },
  { id: "unconscious", name: "CROWS.Condition.unconscious", img: "icons/svg/unconscious.svg" },
  // NEW in Playtest 2 (R:544, R:556).
  { id: "vulnerable",  name: "CROWS.Condition.vulnerable",  img: "icons/svg/blood.svg" },
  { id: "weakened",    name: "CROWS.Condition.weakened",    img: "icons/svg/downgrade.svg" },
  // Creature reduced to 0 Stamina (F:698) — applied automatically by applyDamage.
  { id: "dead",        name: "CROWS.Condition.defeated",    img: "icons/svg/skull.svg" }
];

// CONTRACT: `boned` is DELETED (replaced by banes + Weakened), and
// `hidden`/`invisible` are gone — hiding is a TEST in PT2 (R:408), not a
// condition, so nothing should be able to read them as rules-backed state.
// A world carrying any of the three gets them reported by the migration.
export const REMOVED_STATUS_IDS = ["boned", "hidden", "invisible"];

export function registerConditions() {
  CONFIG.statusEffects = CROWS_STATUS.map(s => ({ ...s }));
}
