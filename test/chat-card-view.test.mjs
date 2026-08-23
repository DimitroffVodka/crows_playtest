import "./shim/foundry.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildTestResult, testCardData } from "../module/helpers/roll.mjs";
import { bindTestCardActions } from "../module/helpers/expertise.mjs";

const TEMPLATE = new URL("../templates/chat/test-card.hbs", import.meta.url);
const STYLES = new URL("../css/crows.css", import.meta.url);

function crow({ isOwner = true, expertises = {} } = {}) {
  return {
    id: "Actor.crow",
    name: '<img src=x onerror="actor()">',
    isOwner,
    system: { expertises, conditions: {}, characteristics: {} }
  };
}

function pendingAttack(actor) {
  return buildTestResult({
    actorId: actor.id,
    kind: "attack",
    rawSum: 12,
    charVal: 1,
    mods: [{ key: "tool", label: "Fine bow", value: 1 }],
    edges: [{ key: "highGround", label: "High ground" }],
    attack: { weaponName: '<script>item()</script>', t2: 3, t3: 5, piercing: false },
    targets: [
      { tokenId: "Token.one", conditions: {} },
      { tokenId: "Token.two", conditions: { grabbed: true } }
    ],
    actor
  });
}

describe("interactive test-card view data", () => {
  test("legalExpertiseSpends is the button authority, including the discipline gate", () => {
    const actor = crow({ expertises: {
      alteration: { value: 1, max: 1 },
      necromancy: { value: 2, max: 2 }
    } });
    const result = buildTestResult({
      actorId: actor.id,
      kind: "casting",
      rawSum: 12,
      casting: { discipline: "alteration", rank: 1, spellbookName: "Change" },
      actor
    });
    const data = testCardData(result, { actor });
    assert.deepEqual(data.expertiseButtons.map((button) => button.key), ["alteration"]);
    assert.equal(data.showExpertiseDecision, true);
  });

  test("a non-owner and a doom never receive expertise buttons", () => {
    const owner = crow({ expertises: { bow: { value: 1, max: 1 } } });
    const pending = pendingAttack(owner);
    const nonOwner = { ...owner, isOwner: false };
    const hidden = testCardData(pending, { actor: nonOwner });
    assert.equal(hidden.showExpertiseDecision, false);
    assert.equal(hidden.awaitingOwner, true);
    assert.deepEqual(hidden.expertiseButtons, []);

    const doom = buildTestResult({ actorId: owner.id, kind: "attack", rawSum: 2, actor: owner });
    const terminal = testCardData(doom, { actor: owner });
    assert.equal(terminal.doom, true);
    assert.equal(terminal.showExpertiseDecision, false);
    assert.deepEqual(terminal.expertiseButtons, []);
  });

  test("multi-target rows use each target's tier, never the message-level tier", () => {
    const actor = crow({ expertises: { bow: { value: 1, max: 1 } } });
    const result = pendingAttack(actor);
    const data = testCardData(result, {
      actor,
      resolveTargetName: (_id, index) => `Creature ${index + 1}`
    });
    assert.equal(data.tier, 2);
    assert.deepEqual(data.targets.map((target) => target.tier), [2, 3]);
    assert.deepEqual(data.targets.map((target) => target.name), ["Creature 1", "Creature 2"]);
  });

  test("user-controlled names stay on escaped Handlebars paths", () => {
    const template = readFileSync(TEMPLATE, "utf8");
    assert.match(template, /\{\{actorName\}\}/);
    assert.match(template, /\{\{itemName\}\}/);
    assert.match(template, /\{\{casting\.spellbookName\}\}/);
    assert.doesNotMatch(template, /\{\{\{(?:actorName|itemName|casting\.spellbookName)\}\}\}/);
    assert.doesNotMatch(template, /<button(?![^>]*type="button")[^>]*data-action="crows-/);
  });

  test("the shared crow-panel selectors keep the T2.1 markup contract", () => {
    const css = readFileSync(STYLES, "utf8");
    assert.match(css, /\.cc-expertise-panel/);
    assert.match(css, /\.cc-expertise-groups/);
    assert.match(css, /\.cc-expertise-group/);
    assert.match(css, /\.cc-expertise-row/);
    assert.match(css, /\.cc-belt-grid\s*\{\s*grid-template-columns:\s*repeat\(4,/);
    assert.match(css, /\.cc-magic-grid/);
    assert.match(css, /\.cc-condition-grid/);
    assert.match(css, /\.cc-condition-toggle/);
    for (const behaviorClass of [
      "cc-expertise-spend", "cc-expertise-warning", "cc-slot-continuation",
      "cc-wound-toggle", "cc-wound-marker", "cc-inventory-warning"
    ]) {
      assert.match(css, new RegExp(`\\.${behaviorClass}\\b`), behaviorClass);
    }
  });
});

function fakeButton(action, expertise = null) {
  return {
    dataset: { action, ...(expertise ? { expertise } : {}) },
    listeners: [],
    addEventListener(type, listener) { this.listeners.push({ type, listener }); }
  };
}

function fakeHtml(buttons) {
  const card = {};
  return {
    card,
    querySelector(selector) { return selector === ".crows.test-card" ? card : null; },
    querySelectorAll() { return buttons; }
  };
}

describe("renderChatMessageHTML integration seam", () => {
  test("the hook firing twice coalesces to one flag render and one listener", async () => {
    const actor = crow({ expertises: { bow: { value: 1, max: 1 } } });
    const result = pendingAttack(actor);
    const message = { flavor: "Shoot", flags: { crows: { test: result } } };
    const spend = fakeButton("crows-spend-expertise", "bow");
    const decline = fakeButton("crows-decline-expertise");
    const html = fakeHtml([spend, decline]);
    let renders = 0;
    let replacements = 0;
    const options = {
      getActor: () => actor,
      renderTemplate: async (data) => { renders++; return data; },
      replaceCard: (_card, data) => { replacements++; return data; }
    };

    const first = bindTestCardActions(message, html, options);
    const second = bindTestCardActions(message, html, options);
    assert.equal(first, second, "both v14 hook calls share the in-flight render");
    await Promise.all([first, second]);

    assert.equal(renders, 1);
    assert.equal(replacements, 1);
    assert.equal(spend.listeners.length, 1);
    assert.equal(decline.listeners.length, 1);
  });

  test("a slower pending render cannot overwrite a newer committed flag", async () => {
    const actor = crow({ expertises: { bow: { value: 1, max: 1 } } });
    const pending = pendingAttack(actor);
    const message = { flavor: "Shoot", flags: { crows: { test: pending } } };
    const html = fakeHtml([]);
    const waiting = [];
    const replacements = [];
    const options = {
      getActor: () => actor,
      renderTemplate: (data) => new Promise((resolve) => waiting.push({ state: data.state, resolve })),
      replaceCard: (_card, content) => { replacements.push(content); return content; }
    };

    const first = bindTestCardActions(message, html, options);
    while (waiting.length < 1) await new Promise((resolve) => setImmediate(resolve));

    message.flags.crows.test = { ...pending, state: "committed", commitReason: "declined" };
    const second = bindTestCardActions(message, html, options);
    while (waiting.length < 2) await new Promise((resolve) => setImmediate(resolve));

    waiting.find((entry) => entry.state === "committed").resolve("committed");
    await second;
    waiting.find((entry) => entry.state === "pending").resolve("pending");
    await first;

    assert.deepEqual(replacements, ["committed"]);
  });
});
