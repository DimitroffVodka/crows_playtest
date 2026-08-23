import "./shim/foundry.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { CROWS } from "../module/config.mjs";
import {
  allocateDamage, chooseWoundSlots, fallbackWoundSlots
} from "../module/helpers/damage.mjs";
import {
  CONDITION_TO_STATUS, STATUS_TO_CONDITION, CONDITION_KEYS, END_OF_DT_CONDITIONS,
  ROLL_PIPELINE_LABEL_KEYS,
  conditionMirrorPlan, targetRef,
  rollLevelLabels, targetLabels, buildAttackLabels,
  COUNTER_TRIGGERS, counterOpportunity, rangedMissConsequence, critConsequences,
  silentArmorConsequence, attackOutcome
} from "../module/helpers/combat.mjs";
import {
  evalDamage, attackCharacteristic, isMeleeAttack, blessedDamageBonus, weaponAttackPayload
} from "../module/helpers/attack.mjs";
import { buildTestResult } from "../module/helpers/roll.mjs";

/**
 * T1.7 — damage, conditions, combat resolution.
 *
 * Every test here pins a RULE with its citation, not an implementation detail.
 * The five the brief named as acceptance are marked ACCEPTANCE.
 *
 * NB the filename: `node --test "test/**\/*.test.mjs"` matches `.test.mjs` only.
 * A `.js` file here would never run while the suite still reported green.
 */

/* ------------------------------------------------------------------ helpers */

const armor = (current, name = "Mail", id = "a1") => ({ id, name, current });

/** A Layout as `slots.mjs` builds one, trimmed to the backpack. */
function backpack(spec) {
  return {
    actorId: "actor1",
    capacities: { backpack: spec.length },
    slots: spec.map((s, index) => ({
      container: "backpack",
      index,
      items: s.items ?? [],
      wound: !!s.wound,
      spanId: null
    })),
    coin: { loose: 0, purses: [] }
  };
}

const committed = (over = {}) => ({
  actorId: "actor1", characteristic: "strength", kind: "attack",
  rawSum: 10, charVal: 2, mods: [], eb: { numeric: 0, tierShift: 0, edges: [], banes: [], explanation: "" },
  total: 12, tier: 2, doom: false, crit: false, terminal: null,
  targets: [], expertiseSpent: null, state: "committed", commitReason: "no-legal-spend",
  ...over
});

/* ============================================================== allocateDamage
 * R:508 AD -> R:516 Stamina -> R:524 wounds.
 */

describe("allocateDamage — AD, then Stamina, then wounds", () => {
  test("armor absorbs first and Stamina takes the remainder", () => {
    const r = allocateDamage({ amount: 8, armor: [armor(3)], stamina: 10, woundCapacity: 10 });
    assert.equal(r.absorbed.armor, 3);
    assert.equal(r.absorbed.stamina, 5);
    assert.equal(r.absorbed.wounds, 0);
    assert.equal(r.stamina.after, 5);
  });

  test("R:512 — piercing skips AD entirely and hits Stamina first", () => {
    const r = allocateDamage({ amount: 4, piercing: true, armor: [armor(10)], stamina: 10, woundCapacity: 10 });
    assert.equal(r.absorbed.armor, 0);
    assert.equal(r.absorbed.stamina, 4);
    assert.equal(r.armor.length, 0, "an untouched pool is not reported as touched");
  });

  test("R:524 — 1 wound per 1 damage once AD and Stamina are 0", () => {
    const r = allocateDamage({ amount: 7, armor: [armor(1)], stamina: 2, woundCapacity: 10, woundsHeld: 0 });
    assert.equal(r.absorbed.wounds, 4);
    assert.equal(r.wounds.after, 4);
  });

  test("R:508 — a pool emptied by this hit is reported broken, once", () => {
    const r = allocateDamage({ amount: 5, armor: [armor(2, "Shield", "s1"), armor(9, "Mail", "m1")], stamina: 10 });
    assert.deepEqual(r.armor.map(a => [a.id, a.absorbed, a.broken]), [["s1", 2, true], ["m1", 3, false]]);
  });

  test("a pool that was ALREADY 0 is skipped, not re-broken", () => {
    const r = allocateDamage({ amount: 3, armor: [armor(0, "Broken", "b1"), armor(5)], stamina: 10 });
    assert.deepEqual(r.armor.map(a => a.id), ["a1"]);
  });

  test("consumption follows the order given — R:508 gives the wearer the choice", () => {
    const chosen = allocateDamage({ amount: 4, armor: [armor(9, "Mail", "m1"), armor(2, "Shield", "s1")], stamina: 9 });
    assert.equal(chosen.armor[0].id, "m1", "the caller's order is honoured, not a hardcoded priority");
  });
});

describe("Vulnerable — R:544", () => {
  // ACCEPTANCE: vulnerable adds 1d6 and it IS absorbed by AD.
  test("the 1d6 is added BEFORE AD, so armor absorbs it like any other damage", () => {
    const r = allocateDamage({
      amount: 2, vulnerable: true, vulnerableRoll: 5,
      armor: [armor(10)], stamina: 10, woundCapacity: 10
    });
    assert.equal(r.vulnerableBonus, 5);
    assert.equal(r.total, 7, "2 + 1d6");
    assert.equal(r.absorbed.armor, 7, "ALL of it lands on AD — the die is not piercing");
    assert.equal(r.absorbed.stamina, 0);
    assert.equal(r.stamina.after, 10, "Stamina is untouched behind live armor");
  });

  test("the die is NOT piercing-like: same numbers, applied after AD, would differ", () => {
    const asWritten = allocateDamage({ amount: 2, vulnerable: true, vulnerableRoll: 5, armor: [armor(3)], stamina: 10 });
    // If the 1d6 bypassed AD, armor would eat only the base 2 and Stamina 5.
    assert.equal(asWritten.absorbed.armor, 3);
    assert.equal(asWritten.absorbed.stamina, 4);
    assert.notEqual(asWritten.absorbed.stamina, 5, "5 here would mean the die skipped AD");
  });

  test("vulnerable stacks with piercing without becoming it twice", () => {
    const r = allocateDamage({ amount: 2, piercing: true, vulnerable: true, vulnerableRoll: 3, armor: [armor(10)], stamina: 10 });
    assert.equal(r.total, 5);
    assert.equal(r.absorbed.stamina, 5);
  });

  test("a creature that is not vulnerable never rolls the die", () => {
    const r = allocateDamage({ amount: 2, vulnerable: false, vulnerableRoll: 6, stamina: 10 });
    assert.equal(r.vulnerableBonus, 0);
    assert.equal(r.total, 2);
  });
});

describe("Death is adjudicated at the wound GAIN, never from derived state", () => {
  test("R:524 — dies when the gain fills the last backpack slot", () => {
    const r = allocateDamage({ amount: 3, stamina: 0, woundCapacity: 10, woundsHeld: 7 });
    assert.equal(r.wounds.after, 10);
    assert.equal(r.defeated, true);
    assert.equal(r.becameDefeated, true);
  });

  test("a hit that does NOT fill the last slot kills nobody", () => {
    const r = allocateDamage({ amount: 2, stamina: 0, woundCapacity: 10, woundsHeld: 7 });
    assert.equal(r.defeated, false);
    assert.equal(r.becameDefeated, false);
  });

  test("`becameDefeated` is a TRANSITION — an already-full creature does not re-die", () => {
    const r = allocateDamage({ amount: 4, stamina: 0, woundCapacity: 10, woundsHeld: 10 });
    assert.equal(r.absorbed.wounds, 0, "no room left");
    assert.equal(r.defeated, true);
    assert.equal(r.becameDefeated, false);
    assert.equal(r.unallocated, 4, "damage with nowhere to go is reported, not dropped");
  });

  test("capacity 0 kills nobody — that is the shrunk-capacity trap, not a death", () => {
    const r = allocateDamage({ amount: 5, stamina: 0, woundCapacity: 0, woundsHeld: 0 });
    assert.equal(r.defeated, false);
    assert.equal(r.becameDefeated, false);
  });

  test("F:698 — a creature with NO slots dies at 0 Stamina instead", () => {
    const r = allocateDamage({ amount: 6, stamina: 6, takesWounds: false, woundCapacity: 0 });
    assert.equal(r.stamina.after, 0);
    assert.equal(r.absorbed.wounds, 0);
    assert.equal(r.becameDefeated, true);
  });

  test("F:698 — a human or animal WITH slots takes wounds like a PC", () => {
    const r = allocateDamage({ amount: 5, stamina: 2, takesWounds: true, woundCapacity: 10, woundsHeld: 0 });
    assert.equal(r.absorbed.wounds, 3);
    assert.equal(r.becameDefeated, false);
  });

  test("a slotless creature already at 0 Stamina does not die a second time", () => {
    const r = allocateDamage({ amount: 3, stamina: 0, takesWounds: false });
    assert.equal(r.defeated, true);
    assert.equal(r.becameDefeated, false);
  });
});

/* ========================================================== wound placement */

describe("chooseWoundSlots — R:524, a backpack slot of the PC's CHOICE", () => {
  const layout = backpack([
    { items: [{ id: "i1", kind: "rope" }] },
    {},
    { wound: true },
    { items: [{ id: "i2", kind: "torch" }] },
    {}
  ]);

  test("the player's pick wins", () => {
    const r = chooseWoundSlots(layout, 1, { preferred: [3] });
    assert.deepEqual(r.indices, [3]);
  });

  test("automatic placement prefers EMPTY slots — a wound sharing a slot costs 1 speed", () => {
    const r = chooseWoundSlots(layout, 2);
    assert.deepEqual(r.indices, [1, 4]);
    assert.deepEqual(r.occupied, [], "no speed penalty was incurred unnecessarily");
  });

  test("it spills into occupied slots only once the empty ones run out", () => {
    const r = chooseWoundSlots(layout, 3);
    assert.deepEqual(r.indices, [1, 4, 0]);
    assert.deepEqual(r.occupied, [0], "the speed-costing placement is surfaced");
  });

  test("a slot that already holds a wound is never offered twice", () => {
    const r = chooseWoundSlots(layout, 4);
    assert.ok(!r.indices.includes(2));
  });

  test("`short` reports wounds with nowhere to go rather than silently dropping them", () => {
    const r = chooseWoundSlots(layout, 9);
    assert.equal(r.indices.length, 4);
    assert.equal(r.short, 5);
  });

  test("a preferred slot that is illegal is ignored, not obeyed", () => {
    const r = chooseWoundSlots(layout, 1, { preferred: [2] });   // 2 already holds a wound
    assert.deepEqual(r.indices, [1], "falls through to the automatic choice");
  });

  test("the degraded fallback fills the lowest free index and skips held ones", () => {
    assert.deepEqual(fallbackWoundSlots(5, [0, 2], 2), [1, 3]);
    assert.deepEqual(fallbackWoundSlots(2, [0, 1], 1), [], "never invents a slot past capacity");
  });
});

/* ================================================================ conditions */

describe("Conditions — booleans are authoritative, statuses mirror (CONTRACT §5b)", () => {
  test("every PT2 condition maps to a status, and `dead` is the only renamed one", () => {
    for (const key of CROWS.conditions) assert.equal(CONDITION_TO_STATUS[key], key);
    assert.equal(CONDITION_TO_STATUS.defeated, "dead");
    assert.equal(STATUS_TO_CONDITION.dead, "defeated");
    assert.ok(!CONDITION_KEYS.includes("boned"), "R: `boned` is deleted, not remapped");
  });

  test("`defeated` has ONE mapping, with no actor-type branch", () => {
    const mapped = Object.entries(STATUS_TO_CONDITION).filter(([, k]) => k === "defeated");
    assert.equal(mapped.length, 1);
  });

  test("R:532/R:544/R:556 — only blessed, vulnerable and weakened expire at end of DT", () => {
    assert.deepEqual([...END_OF_DT_CONDITIONS].sort(), ["blessed", "vulnerable", "weakened"]);
    for (const k of ["grabbed", "prone", "unconscious", "defeated"]) {
      assert.ok(!END_OF_DT_CONDITIONS.includes(k), `${k} does not expire on its own`);
    }
  });

  test("the mirror is a NO-OP when the two already agree — this is the loop guard", () => {
    const plan = conditionMirrorPlan({ prone: true, weakened: false }, new Set(["prone"]));
    assert.deepEqual(plan, { add: [], remove: [], inSync: true });
  });

  test("a boolean without its status adds it; a status without its boolean removes it", () => {
    const plan = conditionMirrorPlan({ weakened: true, prone: false }, new Set(["prone"]));
    assert.deepEqual(plan.add, ["weakened"]);
    assert.deepEqual(plan.remove, ["prone"]);
    assert.equal(plan.inSync, false);
  });

  test("`defeated: true` adds the `dead` status, not a `defeated` one", () => {
    const plan = conditionMirrorPlan({ defeated: true }, new Set());
    assert.deepEqual(plan.add, ["dead"]);
  });

  test("mirroring twice changes nothing the second time", () => {
    const conditions = { vulnerable: true };
    const first = conditionMirrorPlan(conditions, new Set());
    const statuses = new Set(first.add);
    assert.equal(conditionMirrorPlan(conditions, statuses).inSync, true);
  });

  test("R:528 — a TargetRef snapshot is strictly boolean, never a count", () => {
    const ref = targetRef("tok1", { prone: 1, blessed: true, boned: 3 });
    assert.equal(ref.tokenId, "tok1");
    assert.equal(ref.conditions.prone, true);
    assert.equal(ref.conditions.grabbed, false, "absent means false, not undefined");
    assert.ok(!("boned" in ref.conditions), "a deleted condition cannot re-enter through a snapshot");
  });
});

/* ==================================================== edges, banes and mods */

describe("Condition labels — the rules, in full", () => {
  test("R:532 blessed is an EDGE and R:556 weakened is a BANE — never numeric (R:286)", () => {
    const r = rollLevelLabels({ conditions: { blessed: true, weakened: true } });
    assert.deepEqual(r.edges.map(e => e.key), ["blessed"]);
    assert.deepEqual(r.banes.map(b => b.key), ["weakened"]);
    assert.deepEqual(r.mods, [], "conditionNet is gone: no ±1 on the total");
  });

  test("R:542 — your own prone banes your MELEE attacks only", () => {
    assert.equal(rollLevelLabels({ conditions: { prone: true }, isMelee: true }).banes.length, 1);
    assert.equal(rollLevelLabels({ conditions: { prone: true }, isMelee: false }).banes.length, 0);
  });

  test("R:1023 — an improvised weapon takes a bane", () => {
    assert.ok(rollLevelLabels({ improvised: true }).banes.some(b => b.key === "improvised"));
  });

  test("R:542 — a prone TARGET is an edge in melee and a bane at range", () => {
    assert.equal(targetLabels({ conditions: { prone: true }, isMelee: true }).edges.length, 1);
    assert.equal(targetLabels({ conditions: { prone: true }, isMelee: false }).banes.length, 1);
  });

  test("R:536 — attacks against a grabbed target gain an edge either way", () => {
    assert.ok(targetLabels({ conditions: { grabbed: true }, isMelee: true }).edges.some(e => e.key === "grabbed-target"));
    assert.ok(targetLabels({ conditions: { grabbed: true }, isMelee: false }).edges.some(e => e.key === "grabbed-target"));
  });

  test("R:554 — an unconscious target emits NO label: the tier is forced, not nudged", () => {
    const r = targetLabels({ conditions: { unconscious: true }, isMelee: true });
    assert.deepEqual([...r.edges, ...r.banes], []);
  });

  test("R:965 flanking is melee-only; R:973 high ground applies to any attack", () => {
    assert.equal(targetLabels({ flanking: true, isMelee: true }).edges.length, 1);
    assert.equal(targetLabels({ flanking: true, isMelee: false }).edges.length, 0);
    assert.equal(targetLabels({ highGround: true, isMelee: false }).edges.length, 1);
  });

  test("R:757/R:763 — cover is one bane, light concealment is one bane", () => {
    assert.equal(targetLabels({ cover: true }).banes.length, 1);
    assert.equal(targetLabels({ concealment: "light" }).banes.length, 1);
  });

  test("R:767/R:771 — heavy concealment and invisibility are a DOUBLE bane: two labels", () => {
    assert.equal(targetLabels({ concealment: "heavy" }).banes.length, 2);
    assert.equal(targetLabels({ concealment: "invisible" }).banes.length, 2);
  });
});

describe("Ranged geometry — two channels, and they do not mix (R:286)", () => {
  // ACCEPTANCE: the range penalty is a mod; adjacent-ranged is a bane.
  test("R:941 — beyond normal range is a numeric MOD of -2 per square", () => {
    const r = targetLabels({ isMelee: false, distance: 5, normalRange: 2 });
    assert.deepEqual(r.mods, [{ key: "range", label: "Beyond normal range (3 sq)", value: -6 }]);
    assert.deepEqual(r.banes, [], "a penalty is not a bane");
    assert.ok(!r.banes.some(b => b.key === "range"));
  });

  test("R:947 — a ranged attack at an adjacent target is a BANE", () => {
    const r = targetLabels({ isMelee: false, adjacent: true, distance: 1, normalRange: 10 });
    assert.deepEqual(r.banes.map(b => b.key), ["ranged-adjacent"]);
    assert.deepEqual(r.mods, [], "a bane is not a penalty");
  });

  test("both at once stay in their own channels", () => {
    const r = targetLabels({ isMelee: false, adjacent: true, distance: 4, normalRange: 1 });
    assert.equal(r.mods.length, 1);
    assert.equal(r.mods[0].value, -6);
    assert.deepEqual(r.banes.map(b => b.key), ["ranged-adjacent"]);
  });

  test("within normal range costs nothing, and melee never pays either", () => {
    assert.deepEqual(targetLabels({ isMelee: false, distance: 2, normalRange: 6 }).mods, []);
    assert.deepEqual(targetLabels({ isMelee: true, distance: 9, normalRange: 0 }).mods, []);
  });

  test("the two channels survive assembly into one attack", () => {
    const built = buildAttackLabels({
      isMelee: false,
      normalRange: 2,
      targets: [{ tokenId: "t1", distance: 4, adjacent: true }]
    });
    assert.equal(built.mods.filter(m => m.key === "range").length, 1);
    assert.equal(built.banes.filter(b => b.key === "ranged-adjacent").length, 1);
    assert.ok(!built.mods.some(m => m.key === "ranged-adjacent"));
    assert.ok(!built.banes.some(b => b.key === "range"));
  });
});

describe("buildAttackLabels — no double counting with the roll pipeline", () => {
  test("condition labels are dropped: rollTest derives them itself, and edges are COUNTED", () => {
    const built = buildAttackLabels({
      attacker: { id: "a1", conditions: { blessed: true, weakened: true } },
      targets: [{ tokenId: "t1", conditions: { grabbed: true }, flanking: true }]
    });
    for (const key of ROLL_PIPELINE_LABEL_KEYS) {
      assert.ok(!built.edges.some(e => e.key === key), `${key} must not be emitted twice`);
      assert.ok(!built.banes.some(b => b.key === key), `${key} must not be emitted twice`);
    }
    assert.deepEqual(built.edges.map(e => e.key), ["flanking"], "only what the pipeline cannot see");
  });

  test("they are still available for a caller that wants the whole rules picture", () => {
    const built = buildAttackLabels({
      attacker: { id: "a1", conditions: { blessed: true } },
      targets: [],
      includeConditionLabels: true
    });
    assert.deepEqual(built.edges.map(e => e.key), ["blessed"]);
  });

  test("a multi-target attack warns rather than silently applying one target's cover to all", () => {
    const built = buildAttackLabels({
      isMelee: false, normalRange: 1,
      targets: [{ tokenId: "t1", distance: 4 }, { tokenId: "t2", cover: true }]
    });
    assert.deepEqual(built.mods, [], "not promoted to roll level, where it would hit both");
    assert.deepEqual(built.edges, []);
    assert.equal(built.warnings.length, 1);
    assert.equal(built.targets[1].banes[0].key, "cover", "still reachable per target");
  });
});

/* ================================================== multi-target resolution */

describe("Multiple targets — R:961, ONE roll, per-target tiers", () => {
  // ACCEPTANCE: an edge on A and a bane on B resolve to DIFFERENT tiers from one roll.
  // Run through T1.1's real `buildTestResult`, not a local re-implementation.
  test("an edge on A and a bane on B give different tiers from a single rawSum", () => {
    const attack = { isMelee: false, t2: 3, t3: 5 };
    const result = buildTestResult({
      actorId: "a1", characteristic: "agility", kind: "attack",
      rawSum: 12, charVal: 0, attack,
      targets: [
        targetRef("A", { grabbed: true }),   // R:536 — an edge
        targetRef("B", { prone: true })      // R:542 at range — a bane
      ]
    });

    assert.equal(result.targets.length, 2);
    const [a, b] = result.targets;
    assert.equal(a.tokenId, "A");
    assert.equal(b.tokenId, "B");
    assert.notEqual(a.tier, b.tier, "one roll, two tiers — this is the whole point of R:961");
    assert.equal(a.tier, 2, "12 + an edge (+2) = 14, tier 2");
    assert.equal(b.tier, 1, "12 - a bane (-2) = 10, tier 1");
    // The roll-level tier is the BASE resolution — no target, no target labels.
    // A bare 12 is tier 2, which is exactly B's tier BEFORE its bane. Reading it
    // instead of targets[].tier is how a miss gets adjudicated as a hit.
    assert.equal(result.tier, 2, "the roll-level tier describes the ROLL alone");
    assert.notEqual(result.tier, b.tier, "and it disagrees with B — read the target's");
  });

  test("damage reads targets[].tier, never the roll-level tier", () => {
    const result = committed({
      tier: 1,
      targets: [
        { tokenId: "A", tier: 3, edges: [], banes: [], terminal: null },
        { tokenId: "B", tier: 1, edges: [], banes: [], terminal: null }
      ]
    });
    const outcome = attackOutcome(result, { t2: 4, t3: 9, isMelee: true });
    assert.equal(outcome.targets[0].damage, 9, "A took the tier 3 damage");
    assert.equal(outcome.targets[1].damage, 0, "B was missed");
    assert.equal(outcome.targets[1].miss, true);
  });
});

/* ==================================================================== counter */

describe("Counter — R:983", () => {
  const defender = { wieldingMelee: true, withinReach: true, reactionsRemaining: 1, conditions: {} };

  // ACCEPTANCE: tier 2 normally, tier 3 on the trigger's doom.
  test("deals the counterer's weapon tier 2 result", () => {
    const r = counterOpportunity({ trigger: { kind: "melee-attack", tier: 1, doom: false }, defender });
    assert.equal(r.canCounter, true);
    assert.equal(r.damageTier, 2);
  });

  test("deals tier 3 when the TRIGGERING test result was a doom", () => {
    const r = counterOpportunity({ trigger: { kind: "melee-attack", tier: 1, doom: true }, defender });
    assert.equal(r.canCounter, true);
    assert.equal(r.damageTier, 3);
  });

  // ACCEPTANCE: it does NOT fire off a tier 1 opportunity attack.
  test("R:955 — a tier 1 OPPORTUNITY ATTACK cannot be countered", () => {
    const r = counterOpportunity({ trigger: { kind: "opportunity-attack", tier: 1, doom: false }, defender });
    assert.equal(r.canCounter, false);
    assert.equal(r.damageTier, null);
    assert.match(r.reason, /opportunity attack/);
  });

  test("...not even on a doom, which is the strongest tier 1 there is", () => {
    const r = counterOpportunity({ trigger: { kind: "opportunity-attack", tier: 1, doom: true }, defender });
    assert.equal(r.canCounter, false);
  });

  test("all four listed triggers open the window, and nothing else does", () => {
    assert.deepEqual([...COUNTER_TRIGGERS], ["melee-attack", "grab", "knockback", "escape-grab"]);
    for (const kind of COUNTER_TRIGGERS) {
      assert.equal(counterOpportunity({ trigger: { kind, tier: 1 }, defender }).canCounter, true, kind);
    }
    assert.equal(counterOpportunity({ trigger: { kind: "ranged-attack", tier: 1 }, defender }).canCounter, false);
    assert.equal(counterOpportunity({ trigger: { kind: "spell", tier: 1 }, defender }).canCounter, false);
  });

  test("a hit does not open a counter window", () => {
    for (const tier of [2, 3]) {
      const r = counterOpportunity({ trigger: { kind: "melee-attack", tier }, defender });
      assert.equal(r.canCounter, false, `tier ${tier}`);
      assert.match(r.reason, /tier 1/);
    }
  });

  test("it needs a wielded melee weapon, the reach to use it, and a reaction left", () => {
    const t = { kind: "melee-attack", tier: 1 };
    assert.equal(counterOpportunity({ trigger: t, defender: { ...defender, wieldingMelee: false } }).canCounter, false);
    assert.equal(counterOpportunity({ trigger: t, defender: { ...defender, withinReach: false } }).canCounter, false);
    assert.equal(counterOpportunity({ trigger: t, defender: { ...defender, reactionsRemaining: 0 } }).canCounter, false);
  });

  test("R:552 — an unconscious creature cannot take the reaction", () => {
    const r = counterOpportunity({
      trigger: { kind: "melee-attack", tier: 1 },
      defender: { ...defender, conditions: { unconscious: true } }
    });
    assert.equal(r.canCounter, false);
    assert.match(r.reason, /reaction/);
  });
});

/* ================================================= ranged misses and crits */

describe("A ranged miss with allies adjacent — R:943 / R:945", () => {
  const allies = ["ally1", "ally2"];

  test("an ODD die hits a random ally for the weapon's tier 2 damage", () => {
    const r = rangedMissConsequence({ isRanged: true, tier: 1, alliesAdjacent: allies, die: 7 });
    assert.equal(r.hitsAlly, true);
    assert.equal(r.damageTier, 2);
    assert.equal(r.automatic, false);
  });

  test("an EVEN die hits nobody", () => {
    const r = rangedMissConsequence({ isRanged: true, tier: 1, alliesAdjacent: allies, die: 4 });
    assert.equal(r.hitsAlly, false);
  });

  test("a DOOM hits automatically for tier 3, with no die rolled at all", () => {
    const r = rangedMissConsequence({ isRanged: true, tier: 1, doom: true, alliesAdjacent: allies });
    assert.equal(r.hitsAlly, true);
    assert.equal(r.damageTier, 3);
    assert.equal(r.automatic, true);
  });

  test("the doom REPLACES the odd-die check rather than stacking a second hit", () => {
    const even = rangedMissConsequence({ isRanged: true, tier: 1, doom: true, alliesAdjacent: allies, die: 4 });
    assert.equal(even.damageTier, 3, "an even die does not cancel the doom's automatic hit");
  });

  test("no allies adjacent, a hit, or a melee attack: nothing strays", () => {
    assert.equal(rangedMissConsequence({ isRanged: true, tier: 1, alliesAdjacent: [], die: 3 }).hitsAlly, false);
    assert.equal(rangedMissConsequence({ isRanged: true, tier: 2, alliesAdjacent: allies, die: 3 }).hitsAlly, false);
    assert.equal(rangedMissConsequence({ isRanged: false, tier: 1, alliesAdjacent: allies, die: 3 }).hitsAlly, false);
  });

  test("the ally picked is deterministic given the index, and never out of range", () => {
    assert.equal(rangedMissConsequence({ isRanged: true, tier: 1, doom: true, alliesAdjacent: allies, pickIndex: 1 }).allyId, "ally2");
    assert.equal(rangedMissConsequence({ isRanged: true, tier: 1, doom: true, alliesAdjacent: allies, pickIndex: 5 }).allyId, "ally2");
  });
});

describe("Crit — R:957", () => {
  test("a crit grants an extra action, immediate only off your own turn", () => {
    assert.deepEqual(critConsequences({ crit: true, onOwnTurn: true }), { extraAction: true, mustUseImmediately: false });
    assert.deepEqual(critConsequences({ crit: true, onOwnTurn: false }), { extraAction: true, mustUseImmediately: true });
    assert.deepEqual(critConsequences({ crit: false }), { extraAction: false, mustUseImmediately: false });
  });

  test("R:554 — the crit against an unconscious target still grants it", () => {
    const outcome = attackOutcome(committed({
      crit: true, tier: 3, terminal: "unconscious",
      targets: [{ tokenId: "A", tier: 3, edges: [], banes: [], terminal: "unconscious" }]
    }), { t2: 2, t3: 4 });
    assert.equal(outcome.extraAction, true, "read `crit`, not `terminal`");
  });
});

/* ============================================================ attackOutcome */

describe("attackOutcome — reads the COMMITTED tier and nothing earlier", () => {
  test("a PENDING result is refused: an expertise can still convert the miss", () => {
    const r = attackOutcome(committed({ state: "pending", commitReason: null }), { t2: 3 });
    assert.equal(r.ok, false);
    assert.match(r.reason, /pending/);
  });

  test("R:921 — tier 1 IS the miss; tier 2 and 3 are hits", () => {
    const mk = (tier) => attackOutcome(
      committed({ targets: [{ tokenId: "A", tier, edges: [], banes: [], terminal: null }] }),
      { t2: 4, t3: 7, isMelee: true }
    ).targets[0];
    assert.deepEqual([mk(1).hit, mk(2).hit, mk(3).hit], [false, true, true]);
    assert.deepEqual([mk(1).damage, mk(2).damage, mk(3).damage], [0, 4, 7]);
  });

  test("R:997 — a melee miss offers the target a counter window; a hit does not", () => {
    const miss = attackOutcome(committed({ targets: [{ tokenId: "A", tier: 1 }] }), { isMelee: true });
    const hit = attackOutcome(committed({ targets: [{ tokenId: "A", tier: 2 }] }), { isMelee: true, t2: 3 });
    assert.equal(miss.targets[0].counterWindow, true);
    assert.equal(hit.targets[0].counterWindow, false);
  });

  test("a RANGED miss offers no counter — it offers the stray-ally roll instead", () => {
    const r = attackOutcome(
      committed({ targets: [{ tokenId: "A", tier: 1 }] }),
      { isMelee: false, t2: 5, alliesAdjacent: ["ally1"], strayDie: 3 }
    );
    assert.equal(r.targets[0].counterWindow, false);
    assert.deepEqual(r.stray, { allyId: "ally1", damageTier: 2, damage: 5, automatic: false });
  });

  test("R:532 — blessed adds the attack's characteristic to the damage, on either tier", () => {
    const r = attackOutcome(
      committed({ targets: [{ tokenId: "A", tier: 2 }, { tokenId: "B", tier: 3 }] }),
      { t2: 4, t3: 6, blessedBonus: 3 }
    );
    assert.equal(r.targets[0].damage, 7);
    assert.equal(r.targets[1].damage, 9);
  });

  test("piercing rides through to the damage application", () => {
    const r = attackOutcome(committed({ targets: [{ tokenId: "A", tier: 2 }] }), { t2: 3, piercing: true });
    assert.equal(r.targets[0].piercing, true);
  });

  test("a result with no targets still resolves the roll's own tier", () => {
    const r = attackOutcome(committed({ tier: 3, targets: [] }), { t2: 2, t3: 5 });
    assert.equal(r.targets.length, 1);
    assert.equal(r.targets[0].damage, 5);
    assert.equal(r.targets[0].tokenId, null);
  });

  test("an unevaluated damage formula is passed through, never turned into NaN", () => {
    const r = attackOutcome(committed({ targets: [{ tokenId: "A", tier: 2 }] }), { t2: "1 + S", blessedBonus: 2 });
    assert.equal(r.targets[0].damage, "1 + S");
  });
});

/* ============================================================= silent armor */

describe("Silent armor — C:2140", () => {
  test("a tier 1 hide or sneak test makes the wearer weakened", () => {
    const r = silentArmorConsequence({ wearingSilent: true, isHideOrSneak: true, tier: 1 });
    assert.equal(r.weakened, true);
    assert.deepEqual(r.mods, [{ key: "silent-armor", label: "Silent armor", value: 1 }]);
  });

  test("a tier 2 or 3 result gives the +1 and no condition", () => {
    assert.equal(silentArmorConsequence({ wearingSilent: true, isHideOrSneak: true, tier: 2 }).weakened, false);
  });

  test("it never fires on a test that is not a hide or a sneak", () => {
    const r = silentArmorConsequence({ wearingSilent: true, isHideOrSneak: false, tier: 1 });
    assert.equal(r.weakened, false);
    assert.deepEqual(r.mods, []);
  });
});

/* ============================================================ weapon attacks */

describe("Weapon attack assembly", () => {
  const actor = (over = {}) => ({
    id: "a1", name: "Crow", type: "crow",
    system: {
      characteristics: { agility: { value: 2 }, mind: { value: 1 }, strength: { value: 3 } },
      conditions: {},
      ...over
    }
  });

  test("damage formulas substitute the characteristics and evaluate", () => {
    assert.equal(evalDamage("1 + S", actor()), 4);
    assert.equal(evalDamage("2 + A", actor()), 4);
    assert.equal(evalDamage("2 + A or S", actor()), 5, "'A or S' takes the better of the two");
    assert.equal(evalDamage("", actor()), 0);
  });

  test("a negative characteristic subtracts rather than corrupting the formula", () => {
    const weak = actor({ characteristics: { agility: { value: -1 }, mind: { value: 0 }, strength: { value: -2 } } });
    assert.equal(evalDamage("3 + S", weak), 1);
  });

  test("the attack characteristic follows the weapon, and `either` takes the better", () => {
    const a = actor();
    assert.equal(attackCharacteristic(a, { system: { attackStat: "agility" } }), "agility");
    assert.equal(attackCharacteristic(a, { system: { attackStat: "strength" } }), "strength");
    assert.equal(attackCharacteristic(a, { system: { attackStat: "either" } }), "strength", "S 3 beats A 2");
  });

  test("R:993 — a thrown weapon's melee/ranged choice is the caller's, made before the test", () => {
    const dagger = { system: { range: { melee: 1, ranged: 5 } } };
    assert.equal(isMeleeAttack(dagger), true, "defaults to melee");
    assert.equal(isMeleeAttack(dagger, { thrown: true }), false);
    assert.equal(isMeleeAttack({ system: { range: { melee: 0, ranged: 8 } } }), false);
    assert.equal(isMeleeAttack({ system: { range: { melee: 1, ranged: 0 } } }), true);
  });

  test("R:532 — the blessed damage bonus is the characteristic, floored at 0", () => {
    assert.equal(blessedDamageBonus(actor({ conditions: { blessed: true } }), "strength"), 3);
    assert.equal(blessedDamageBonus(actor(), "strength"), 0, "not blessed, no bonus");
    const cursed = actor({
      conditions: { blessed: true },
      characteristics: { agility: { value: -4 }, mind: { value: 0 }, strength: { value: 0 } }
    });
    assert.equal(blessedDamageBonus(cursed, "agility"), 0, "a blessing never reduces damage");
  });

  test("the payload carries what the committed result needs to compute damage", () => {
    const weapon = {
      id: "w1", name: "Spear",
      system: { type: "stabbing", piercing: true, range: { melee: 1, ranged: 4 }, damage: { t2: "1 + S", t3: "2 + S" } }
    };
    const p = weaponAttackPayload(actor({ conditions: { blessed: true } }), weapon, {
      isMelee: true, characteristic: "strength"
    });
    assert.equal(p.t2, 4);
    assert.equal(p.t3, 5);
    assert.equal(p.piercing, true);
    assert.equal(p.weaponType, "stabbing", "gates which expertise may be spent (R:913)");
    assert.equal(p.blessedBonus, 3);
    assert.equal(p.normalRange, 4);
  });

  test("the Boon of Fury raises both tiers, since which one lands is not yet known", () => {
    const weapon = { system: { damage: { t2: "1 + S", t3: "2 + S" } } };
    const p = weaponAttackPayload(actor(), weapon, { isMelee: true, characteristic: "strength", furyBonus: 2 });
    assert.equal(p.t2, 6);
    assert.equal(p.t3, 7);
  });
});
