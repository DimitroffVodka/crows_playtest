import "./shim/foundry.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SheetBase = class {
  static DEFAULT_OPTIONS = {};
  static PARTS = {};
};
globalThis.foundry.applications = {
  api: {
    HandlebarsApplicationMixin: Base => class extends Base {},
    DialogV2: class DialogV2 {}
  },
  sheets: { ActorSheetV2: SheetBase, ItemSheetV2: SheetBase }
};

const { weaponAttackPayload } = await import("../module/helpers/attack.mjs");
const { buildTestResult, testCardData } = await import("../module/helpers/roll.mjs");
const { monsterAttackPayload } = await import("../module/sheets/monster-sheet.mjs");

const TEMPLATE = new URL("../templates/chat/test-card.hbs", import.meta.url);

function cardFor(actor, attack, characteristicValue = 0) {
  const result = buildTestResult({
    actorId: actor.id,
    kind: "attack",
    rawSum: 12,
    charVal: characteristicValue,
    attack,
    targets: [],
    actor
  });
  return testCardData(result, { actor });
}

describe("Blessed attack damage on Apply buttons", () => {
  test("a Blessed crow's Apply amount includes the attack characteristic", () => {
    const actor = {
      id: "Actor.blessed-crow",
      type: "crow",
      isOwner: true,
      system: {
        conditions: { blessed: true },
        characteristics: {
          agility: { value: 1 },
          mind: { value: 0 },
          strength: { value: 3 }
        }
      }
    };
    const weapon = {
      id: "Item.axe",
      name: "Axe",
      type: "weapon",
      system: {
        attackStat: "strength",
        range: { melee: 1, ranged: 0 },
        damage: { t2: "1 + S", t3: "2 + S" }
      }
    };
    const attack = weaponAttackPayload(actor, weapon, {
      isMelee: true,
      characteristic: "strength"
    });
    const card = cardFor(actor, attack, 3);

    assert.equal(card.attack.applyT2, 7);
    assert.equal(card.attack.applyT3, 8);
  });

  test("a Blessed monster's Apply amount uses its melee Strength", () => {
    const actor = {
      id: "Actor.blessed-monster",
      type: "monster",
      isOwner: true,
      system: {
        conditions: { blessed: true },
        characteristics: { agility: 4, mind: 0, strength: 2 }
      }
    };
    const attack = monsterAttackPayload(actor, {
      name: "Bite",
      range: "Melee 1",
      dmgT2: 3,
      dmgT3: 5,
      piercing: false,
      targets: 1
    });
    const card = cardFor(actor, attack);

    assert.equal(card.attack.applyT2, 5);
    assert.equal(card.attack.applyT3, 7);
  });

  test("the chat card uses the resolved amounts for both button data and labels", () => {
    const template = readFileSync(TEMPLATE, "utf8");
    assert.match(template, /data-amount="\{\{#if attack\.blessedBonus\}\}\{\{attack\.applyT2\}\}\{\{else\}\}\{\{attack\.t2\}\}\{\{\/if\}\}"/);
    assert.match(template, /data-amount="\{\{#if attack\.blessedBonus\}\}\{\{attack\.applyT3\}\}\{\{else\}\}\{\{attack\.t3\}\}\{\{\/if\}\}"/);
    assert.match(template, /Apply T2: \{\{#if attack\.blessedBonus\}\}\{\{attack\.applyT2\}\}\{\{else\}\}\{\{attack\.t2\}\}\{\{\/if\}\}/);
    assert.match(template, /Apply T3: \{\{#if attack\.blessedBonus\}\}\{\{attack\.applyT3\}\}\{\{else\}\}\{\{attack\.t3\}\}\{\{\/if\}\}/);
  });
});
