import "./shim/foundry.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  cloneGrantItemData,
  grantItem,
  grantItemBatch,
  makeGrantContext,
  planGrantBatch
} from "../module/helpers/item-grants.mjs";
import { emptyLayout, placeAt } from "../module/helpers/slots.mjs";
import { applyUniversalStarterItems } from "../module/helpers/character-creator.mjs";
import { applyBackground } from "../module/helpers/creation.mjs";

function source({
  id = "source-item", name = "Source Item", type = "gear",
  slots = 1, quantity = 1, location = { container: "backpack", index: 7 },
  stackMax = 1, extraSystem = {}, extra = {}
} = {}) {
  const value = {
    _id: id,
    _key: `!items!${id}`,
    id,
    name,
    type,
    pack: "crows.crows-gear",
    folder: "source-folder",
    sort: 100,
    _stats: { compendiumSource: `Compendium.crows.crows-gear.${id}`, modifiedTime: 1 },
    flags: { core: { sourceId: `Compendium.crows.crows-gear.${id}` } },
    system: {
      slots, quantity, stackMax, state: { charged: true }, location, ...extraSystem
    },
    ...extra
  };
  return {
    ...value,
    toObject() { return structuredClone(value); }
  };
}

function actor({ id = "actor-grant", type = "crow", capacity = 10, items = [], isOwner = true } = {}) {
  const target = {
    id,
    uuid: `Actor.${id}`,
    type,
    isOwner,
    items: [...items],
    system: { commerce: { revision: 0, receipts: {} } },
    updates: [],
    creates: [],
    deletes: [],
    async update(changes) {
      this.updates.push(structuredClone(changes));
      if (changes["system.commerce"]) this.system.commerce = structuredClone(changes["system.commerce"]);
      return this;
    },
    async createEmbeddedDocuments(documentName, docs) {
      this.creates.push({ documentName, docs: structuredClone(docs) });
      const created = docs.map((doc, index) => ({
        ...structuredClone(doc),
        id: doc.id ?? doc._id ?? `${this.id}-item-${this.items.length + index + 1}`
      }));
      if (documentName === "Item") this.items.push(...created);
      return created;
    },
    async deleteEmbeddedDocuments(documentName, ids) {
      this.deletes.push({ documentName, ids: [...ids] });
      if (documentName === "Item") this.items = this.items.filter((item) => !ids.includes(item.id));
      return [];
    }
  };
  const base = emptyLayout(id, { backpack: capacity });
  for (const item of items) {
    const location = item.system?.location;
    if (!location) continue;
    placeAt(base, item, [{ container: location.container, index: location.index }], { enforce: false });
  }
  target.layout = base;
  return target;
}

function packFor(documents) {
  const byId = new Map(documents.map((document) => [document.id ?? document._id, document]));
  return {
    index: { contents: documents.map((document) => ({ _id: document.id ?? document._id, name: document.name })) },
    async getIndex() { return this.index; },
    async getDocument(id) { return byId.get(id) ?? null; }
  };
}

function contextFor(target, txId, extra = {}) {
  return makeGrantContext(target, "test", {
    txId,
    expectedRevision: target.system.commerce.revision,
    layout: target.layout,
    ...extra
  });
}

describe("Item grant cloning", () => {
  test("deep-clones gameplay state, strips source identity/placement, and leaves source untouched", async () => {
    const item = source({ quantity: 4, extraSystem: { nested: { value: "source" } } });
    const before = structuredClone(item.toObject());
    const target = actor();
    const result = await grantItem(target, item, contextFor(target, "clone-1", {
      placement: { container: "backpack", index: 0 }
    }));

    assert.equal(result.ok, true, result.error);
    const copy = target.items[0];
    assert.equal(copy.name, item.name);
    assert.equal(copy.system.quantity, 4);
    assert.deepEqual(copy.system.nested, { value: "source" });
    assert.deepEqual(copy.system.location, { container: "backpack", index: 0, length: 1 });
    assert.equal(copy._id, undefined);
    assert.equal(copy._key, undefined);
    assert.equal(copy.pack, undefined);
    assert.equal(copy.folder, undefined);
    assert.equal(copy._stats?.compendiumSource, undefined);
    assert.equal(copy.flags?.core?.sourceId, undefined);
    copy.system.nested.value = "copy";
    assert.deepEqual(item.toObject(), before);
  });

  test("resolves a UUID/compendium source before cloning it", async () => {
    const item = source({ id: "uuid-source", name: "UUID Source" });
    const target = actor();
    const result = await grantItem(target, "Compendium.crows.crows-gear.uuid-source", contextFor(target, "uuid-1", {
      resolveSource: async (uuid) => uuid.endsWith("uuid-source") ? item : null,
      placement: { container: "backpack", index: 0 }
    }));
    assert.equal(result.ok, true, result.error);
    assert.equal(target.items[0].name, "UUID Source");
  });

  test("resolves a compendium index entry before treating it as an Item", async () => {
    const document = source({ id: "index-source", name: "Indexed Source", quantity: 9 });
    const pack = packFor([document]);
    const target = actor();
    const result = await grantItem(target, {
      _id: "index-source", name: "Indexed Source", type: "gear", pack
    }, contextFor(target, "index-1", {
      placement: { container: "backpack", index: 0 }
    }));
    assert.equal(result.ok, true, result.error);
    assert.equal(target.items[0].system.quantity, 9);
  });

  test("invalid source is refused before an embedded write", async () => {
    const target = actor();
    const result = await grantItem(target, { nope: true }, contextFor(target, "invalid-1", {
      placement: { container: "backpack", index: 0 }
    }));
    assert.equal(result.error, "invalid-source");
    assert.equal(target.creates.length, 0);
    assert.equal(target.updates.length, 0);
  });

  test("an unauthorized Actor is refused before source resolution", async () => {
    const target = actor({ isOwner: false });
    let resolved = false;
    const result = await grantItem(target, "Actor.unknown", contextFor(target, "unauth-1", {
      resolveSource: async () => { resolved = true; return source(); },
      placement: { container: "backpack", index: 0 }
    }));
    assert.equal(result.error, "unauthorized");
    assert.equal(resolved, false);
    assert.equal(target.creates.length, 0);
  });
});

describe("Item grant placement and batches", () => {
  test("explicit placement is honored and auto-pack uses the cloned layout", async () => {
    const existing = source({ id: "existing", name: "Existing", location: { container: "backpack", index: 0 } });
    const target = actor({ items: [existing] });
    const result = await grantItem(target, source({ id: "new-item" }), contextFor(target, "auto-1", {
      placement: { policy: "auto-pack", containers: ["backpack"] }
    }));
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(result.plan.placements[0], { container: "backpack", index: 1, length: 1 });
    assert.deepEqual(target.items[1].system.location, { container: "backpack", index: 1, length: 1 });
    assert.deepEqual(existing.system.location, { container: "backpack", index: 0 });
  });

  test("stacking is opt-in and still obeys stack kind/limit", async () => {
    const existing = source({ id: "stacked", name: "Potion A", type: "consumable", stackMax: 5,
      extraSystem: { stackKind: "potion", quantity: 2 }, location: { container: "backpack", index: 0 } });
    const target = actor({ items: [existing], capacity: 1 });
    const placement = { container: "backpack", index: 0 };
    const refused = await grantItem(target, source({ id: "stack-new", type: "consumable", stackMax: 5,
      extraSystem: { stackKind: "potion", quantity: 1 } }), contextFor(target, "stack-1", { placement }));
    assert.equal(refused.error, "no-capacity");
    assert.equal(target.creates.length, 0);

    const accepted = await grantItem(target, source({ id: "stack-new-2", type: "consumable", stackMax: 5,
      extraSystem: { stackKind: "potion", quantity: 1 } }), contextFor(target, "stack-2", {
      placement, allowStacking: true
    }));
    assert.equal(accepted.ok, true, accepted.error);
    assert.equal(target.items.length, 2);
  });

  test("no-capacity refuses before any receipt or Item write", async () => {
    const existing = source({ id: "only", location: { container: "backpack", index: 0 } });
    const target = actor({ items: [existing], capacity: 1 });
    const result = await grantItem(target, source({ id: "blocked" }), contextFor(target, "capacity-1", {
      placement: { policy: "auto-pack", containers: ["backpack"] }
    }));
    assert.equal(result.error, "no-capacity");
    assert.equal(target.creates.length, 0);
    assert.equal(target.updates.length, 0);
  });

  test("bulk preflight is all-or-nothing", async () => {
    const target = actor({ capacity: 2 });
    const result = await grantItemBatch(target, [
      { source: source({ id: "batch-a" }), placement: { policy: "auto-pack", containers: ["backpack"] } },
      { source: source({ id: "batch-b" }), placement: { policy: "auto-pack", containers: ["backpack"] } },
      { source: source({ id: "batch-c" }), placement: { policy: "auto-pack", containers: ["backpack"] } }
    ], contextFor(target, "batch-1"));
    assert.equal(result.error, "no-capacity");
    assert.equal(target.creates.length, 0);
    assert.equal(target.items.length, 0);
  });

  test("quantity override applies only to the clone", async () => {
    const item = source({ quantity: 2 });
    const target = actor();
    const result = await grantItem(target, item, contextFor(target, "quantity-1", {
      quantity: 6,
      placement: { container: "backpack", index: 0 }
    }));
    assert.equal(result.ok, true, result.error);
    assert.equal(target.items[0].system.quantity, 6);
    assert.equal(item.system.quantity, 2);
  });
});

describe("Item grant receipts", () => {
  test("same token replays the deterministic created Item without a duplicate", async () => {
    const target = actor();
    const item = source({ id: "replay-source" });
    const context = contextFor(target, "replay-1", {
      placement: { container: "backpack", index: 0 }
    });
    const first = await grantItem(target, item, context);
    const replay = await grantItem(target, item, context);
    assert.equal(first.ok, true, first.error);
    assert.equal(replay.ok, true, replay.error);
    assert.equal(replay.replayed, true);
    assert.equal(target.creates.length, 1);
    assert.deepEqual(replay.itemIds, first.itemIds);
    assert.equal(target.system.commerce.receipts["replay-1"].phase, "committed");
  });

  test("same token reconciles a create whose committed receipt acknowledgement was lost", async () => {
    const target = actor();
    const originalUpdate = target.update;
    let loseCommitAcknowledgement = true;
    target.update = async function update(changes) {
      const receipt = changes["system.commerce"]?.receipts?.["lost-ack-1"];
      if (loseCommitAcknowledgement && receipt?.phase === "committed") {
        loseCommitAcknowledgement = false;
        throw new Error("connection lost after create");
      }
      return originalUpdate.call(this, changes);
    };
    const item = source({ id: "lost-ack-source" });
    const context = contextFor(target, "lost-ack-1", {
      placement: { container: "backpack", index: 0 }
    });
    const first = await grantItem(target, item, context);
    const retry = await grantItem(target, item, context);
    assert.equal(first.error, "write-failed");
    assert.equal(first.reconciliationRequired, true);
    assert.equal(retry.ok, true, retry.error);
    assert.equal(retry.reconciled, true);
    assert.equal(target.creates.length, 1, "reconciliation never creates a duplicate");
    assert.equal(target.system.commerce.receipts["lost-ack-1"].phase, "committed");
  });

  test("the plan API performs no write and exposes all planned destinations", async () => {
    const target = actor({ capacity: 3 });
    const result = await planGrantBatch(target, [source({ id: "plan-a" }), source({ id: "plan-b" })], {
      placement: { policy: "auto-pack", containers: ["backpack"] }
    });
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(result.placements.map((placement) => placement.index), [0, 1]);
    assert.equal(target.creates.length, 0);
    assert.equal(target.updates.length, 0);
  });

  test("missing transaction metadata is refused", async () => {
    const target = actor();
    const result = await grantItem(target, source(), {
      placement: { container: "backpack", index: 0 }
    });
    assert.equal(result.error, "invalid-request");
    assert.equal(target.creates.length, 0);
  });

  test("no active GM is an authority refusal before a mutation", async () => {
    const target = actor({ isOwner: true });
    const previousGame = globalThis.game;
    globalThis.game = { user: { id: "player", isGM: false }, users: { activeGM: null } };
    try {
      const result = await grantItem(target, source(), contextFor(target, "no-gm-1", {
        placement: { container: "backpack", index: 0 }
      }));
      assert.equal(result.error, "authority-unavailable");
      assert.equal(target.creates.length, 0);
    } finally {
      if (previousGame === undefined) delete globalThis.game;
      else globalThis.game = previousGame;
    }
  });

  test("a stale expected revision refuses before receipt or Item writes", async () => {
    const target = actor();
    target.system.commerce.revision = 1;
    const result = await grantItem(target, source(), {
      txId: "stale-1", expectedRevision: 0,
      placement: { container: "backpack", index: 0 }
    });
    assert.equal(result.error, "conflict");
    assert.equal(target.creates.length, 0);
    assert.equal(target.updates.length, 0);
  });

  test("a Party Actor refuses a non-purse Item with no write", async () => {
    const target = actor({ id: "party-stash", type: "party" });
    const result = await grantItem(target, source({ id: "party-item" }), makeGrantContext(target, "test", {
      txId: "party-1",
      expectedRevision: target.system.commerce.revision,
      placement: { policy: "auto-pack" }
    }));
    assert.equal(result.error, "no-capacity");
    assert.equal(target.creates.length, 0);
    assert.equal(target.updates.length, 0);
  });
});

describe("consolidated character creation callers", () => {
  test("the starter kit keeps one bulk create, filters owned names, and sets ration quantity 6", async () => {
    const purse = source({ id: "purse", name: "Coin Purse", type: "gear" });
    const knife = source({ id: "knife", name: "Knife", type: "weapon" });
    const rope = source({ id: "rope", name: "Rope", type: "gear" });
    const ration = source({ id: "ration", name: "Ration", type: "consumable", extraSystem: { stackMax: 10 } });
    const target = actor({ id: "starter-crow", type: "crow", items: [{ id: "owned-knife", name: "Knife", type: "weapon", system: {} }] });
    const previousGame = globalThis.game;
    globalThis.game = { packs: new Map([
      ["crows.crows-gear", packFor([purse, rope])],
      ["crows.crows-weapons", packFor([knife])],
      ["crows.crows-consumables", packFor([ration])]
    ]) };
    try {
      const result = await applyUniversalStarterItems(target);
      assert.equal(result.ok, true, result.error);
      assert.equal(target.creates.length, 1, "the kit remains one bounded bulk create");
      assert.equal(target.creates[0].docs.length, 3, "owned Knife is filtered");
      assert.equal(target.items.find((item) => item.name === "Ration").system.quantity, 6);
      assert.deepEqual(target.items.filter((item) => item.name !== "Knife")
        .map((item) => item.system.location.index), [0, 1, 2]);
      assert.deepEqual(ration.system.location, { container: "backpack", index: 7 },
        "compendium source was not stamped");
    } finally {
      if (previousGame === undefined) delete globalThis.game;
      else globalThis.game = previousGame;
    }
  });

  test("background equipment is packed sequentially, while spellbooks and traits retain no placement", async () => {
    // Before the grant seam, creation.mjs stamped every equipment copy with
    // backpack index 0. `layoutFor` intentionally read that collision as-is
    // (`placeAt(..., {enforce:false})`), so the overlap was user-visible. The
    // grant's cloned-layout auto-pack is a deliberate correction: the stored
    // locations now match the legal sequential backpack layout.
    const equipmentA = source({ id: "background-a", name: "Background A", type: "gear" });
    const equipmentB = source({ id: "background-b", name: "Background B", type: "gear" });
    const spell = source({ id: "background-spell", name: "Spell", type: "spellbook" });
    const trait = source({ id: "background-trait", name: "Trait", type: "trait" });
    const target = actor({ id: "background-crow", type: "crow" });
    const previousGame = globalThis.game;
    globalThis.game = { packs: new Map([
      ["crows.crows-gear", packFor([equipmentA, equipmentB])],
      ["crows.crows-spellbooks", packFor([spell])],
      ["crows.crows-traits", packFor([trait])]
    ]) };
    try {
      const result = await applyBackground(target, {
        id: "background-1", name: "Background 1",
        system: {
          stamina: 5, expertises: [], equipment: ["Background A", "Background B"],
          spellbooks: ["Spell"], startingTrait: "Tree: Trait"
        }
      });
      assert.equal(result.ok, true, result.error);
      assert.equal(target.creates.length, 1, "background grants retain one atomic batch");
      assert.deepEqual(target.items.filter((item) => item.type === "gear")
        .map((item) => item.system.location.index), [0, 1]);
      assert.equal(target.items.find((item) => item.name === "Spell").system.location, undefined);
      assert.equal(target.items.find((item) => item.name === "Trait").system.location, undefined);
      assert.equal(equipmentA.system.location.container, "backpack", "source remains untouched");
    } finally {
      if (previousGame === undefined) delete globalThis.game;
      else globalThis.game = previousGame;
    }
  });
});

test("the inventory-sheet add path retains owner/fit preflight and delegates creation", () => {
  const sheet = readFileSync(new URL("../module/sheets/crow-sheet.mjs", import.meta.url), "utf8");
  const start = sheet.indexOf("static async _onAddToSlot");
  const end = sheet.indexOf("static async _onRemoveItem", start);
  assert.ok(start >= 0 && end > start, "sheet add/remove seams were not found");
  const addPath = sheet.slice(start, end);
  assert.match(addPath, /if \(!this\.document\.isOwner\)/);
  assert.match(addPath, /packItem\(trial, doc, container, index\)/);
  assert.match(addPath, /grantItem\(this\.document, source/);
  assert.doesNotMatch(addPath, /source\.toObject\(\)/);
  assert.doesNotMatch(addPath, /createEmbeddedDocuments\("Item"/);
});

test("cloneGrantItemData is pure for a source document", () => {
  const item = source({ id: "pure" });
  const clone = cloneGrantItemData(item);
  clone.system.state.charged = false;
  assert.equal(item.system.state.charged, true);
});
