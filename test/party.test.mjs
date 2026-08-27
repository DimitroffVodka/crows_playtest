import "./shim/foundry.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  authorizePartyTransfer,
  canUserMoveMember,
  depositPartyFunds,
  movePartyPurse,
  partyCapacityPolicy,
  partyViewData,
  planPartyCredit,
  planPartyDebit,
  planPartyDeposit,
  planPartyPurseTransfer,
  planPartyWithdraw,
  withdrawPartyFunds
} from "../module/helpers/party.mjs";
import { layoutFor, coinSummary } from "../module/helpers/slots.mjs";
import { migrateActorDocument } from "../module/helpers/migration.mjs";

function setPath(target, path, value) {
  const parts = path.split(".");
  const last = parts.pop();
  let cursor = target;
  for (const part of parts) cursor = cursor[part] ??= {};
  cursor[last] = value;
}

function item({ id, held = 0, capacity = 500, container = "backpack", parent = null } = {}) {
  const source = {
    id,
    _id: id,
    name: `Purse ${id}`,
    type: "gear",
    img: "icons/svg/item-bag.svg",
    system: {
      slots: 1,
      purse: { isPurse: true, held, baseCapacity: capacity },
      ...(container ? { location: { container, index: 0, length: 1 } } : {})
    },
    parent,
    toObject() { return structuredClone({ ...this, parent: undefined, toObject: undefined }); }
  };
  return source;
}

function actor({
  id,
  type = "crow",
  currency = 0,
  items = [],
  owner = true,
  capacity = undefined,
  failUpdate = false,
  failEmbedded = false,
  failDelete = false,
  emptyCreate = false
} = {}) {
  const document = {
    id,
    _id: id,
    uuid: `Actor.${id}`,
    type,
    name: id,
    isOwner: owner,
    ownership: owner ? { player: 3 } : { player: 1 },
    items,
    system: { currency, ...(capacity ? { capacity } : {}) },
    updates: [],
    embeddedUpdates: [],
    deleted: [],
    async update(patch) {
      this.updates.push(patch);
      if (failUpdate) throw new Error(`${id} update failed`);
      for (const [path, value] of Object.entries(patch)) setPath(this, path, value);
    },
    async updateEmbeddedDocuments(_type, updates) {
      this.embeddedUpdates.push(updates);
      if (failEmbedded) throw new Error(`${id} embedded update failed`);
      for (const update of updates) {
        const found = this.items.find(entry => entry.id === update._id);
        if (found && update["system.purse.held"] !== undefined) {
          found.system.purse.held = update["system.purse.held"];
        }
      }
      return updates;
    },
    async createEmbeddedDocuments(_type, sources) {
      if (emptyCreate) return [];
      const created = sources.map((source, index) => ({
        ...structuredClone(source),
        id: `${id}-new-${index}`,
        _id: `${id}-new-${index}`,
        parent: this,
        async delete() { await document.deleteEmbeddedDocuments("Item", [this.id]); }
      }));
      this.items.push(...created);
      return created;
    },
    async deleteEmbeddedDocuments(_type, ids) {
      if (failDelete) throw new Error(`${id} delete failed`);
      this.deleted.push(...ids);
      this.items = this.items.filter(entry => !ids.includes(entry.id));
      return ids;
    }
  };
  for (const entry of items) entry.parent = document;
  return document;
}

function user({ gm = false, id = "player" } = {}) { return { id, isGM: gm }; }

function testCommercePort() {
  async function apply(plan) {
    if (Object.keys(plan.actorUpdate ?? {}).length) await plan.actor.update(plan.actorUpdate);
    if (plan.itemUpdates?.length) await plan.actor.updateEmbeddedDocuments("Item", plan.itemUpdates);
  }
  return {
    async deposit({ plan }) {
      await apply(plan.source);
      await apply(plan.destination);
      return { ok: true, receipt: "deposit-test" };
    },
    async withdraw({ plan }) {
      await apply(plan.source);
      await apply(plan.destination);
      return { ok: true, receipt: "withdraw-test" };
    }
  };
}

describe("Party actor stash policy", () => {
  test("layoutFor keeps Party coin/purses but never borrows Crow carrying slots", () => {
    const purse = item({ id: "purse", held: 125, container: null });
    const party = actor({ id: "party", type: "party", currency: 75, items: [purse] });
    const layout = layoutFor(party);

    assert.equal(layout.party, true);
    assert.deepEqual(layout.capacities, {
      hand: 0, belt: 0, backpack: 0, head: 0, neck: 0,
      waist: 0, arms: 0, finger: 0, feet: 0
    });
    assert.deepEqual(coinSummary(layout), {
      loose: 75,
      looseSlots: 1,
      purses: [{ id: "purse", held: 125, cap: 500, over: 0 }],
      purseHeld: 125,
      purseCapacity: 500,
      purseRoom: 375,
      totalHeld: 200,
      overflow: 0
    });
    assert.equal(layout.partyCapacity.state, "unresolved");
  });

  test("the unresolved capacity state is explicit and does not choose a bound", () => {
    const party = actor({ id: "party", type: "party" });
    const policy = partyCapacityPolicy(party);
    assert.equal(policy.resolved, false);
    assert.equal(policy.limit, null);
    assert.equal(policy.reason, "capacity-undecided");
    assert.ok(policy.alternatives.length >= 3);
  });

  test("Party view contains money/purses and no creature-derived fields", () => {
    const party = actor({ id: "party", type: "party", currency: 10 });
    const view = partyViewData(party, { user: user() });
    assert.equal(view.coin.loose, 10);
    assert.equal(view.capacityUndecided, true);
    assert.equal("speed" in view, false);
    assert.equal("wounds" in view, false);
  });

  test("the existing world migration path leaves a new Party shape untouched", () => {
    const party = actor({ id: "party", type: "party", currency: 125 });
    const result = migrateActorDocument(party);
    assert.equal(result.type, "party");
    assert.deepEqual(result.updates, {});
    assert.equal(party.updates.length, 0);
  });
});

describe("Party authority and typed fund transfers", () => {
  test("non-owner is refused before either Actor is inspected or written", async () => {
    const party = actor({ id: "party", type: "party", owner: false });
    const source = actor({ id: "source", currency: 100, owner: false });
    const result = await depositPartyFunds(party, source, 10, { user: user() });
    assert.equal(result.reason, "unauthorized");
    assert.equal(party.updates.length, 0);
    assert.equal(source.updates.length, 0);
    assert.equal(canUserMoveMember(user(), party, source), false);
  });

  test("GM always has authority, but unresolved Party capacity still refuses a loose deposit", () => {
    const party = actor({ id: "party", type: "party" });
    const source = actor({ id: "source", currency: 100 });
    const result = planPartyDeposit(party, source, 10, { user: user({ gm: true }) });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "capacity-undecided");
    assert.equal(authorizePartyTransfer(party, source, { user: user({ gm: true }) }).ok, true);
  });

  test("uncapped is an explicit policy choice and supports a preflighted deposit", async () => {
    const party = actor({
      id: "party", type: "party", currency: 5,
      capacity: { mode: "uncapped", limit: 0 }
    });
    const source = actor({ id: "source", currency: 100 });
    const plan = planPartyDeposit(party, source, 60, { user: user() });
    assert.equal(plan.ok, true);
    assert.equal(plan.sourcePlan.actorUpdate["system.currency"], 40);
    assert.equal(plan.destinationPlan.actorUpdate["system.currency"], 65);
    const result = await depositPartyFunds(party, source, 60, {
      user: user(), transferPort: testCommercePort()
    });
    assert.equal(result.ok, true);
    assert.equal(source.system.currency, 40);
    assert.equal(party.system.currency, 65);
  });

  test("withdrawal preflights source and destination and uses purse-first credit", async () => {
    const partyPurse = item({ id: "party-purse", held: 0, container: null });
    const targetPurse = item({ id: "target-purse", held: 0 });
    const party = actor({
      id: "party", type: "party", currency: 100,
      items: [partyPurse], capacity: { mode: "uncapped" }
    });
    partyPurse.system.purse.held = 200;
    const target = actor({ id: "target", currency: 0, items: [targetPurse] });
    const plan = planPartyWithdraw(party, target, 200, { user: user() });
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.sourcePlan.planned.purses, [{ id: "party-purse", amount: 100 }]);
    assert.deepEqual(plan.destinationPlan.planned.purses, [{ id: "target-purse", amount: 200 }]);
    const result = await withdrawPartyFunds(party, target, 200, {
      user: user(), transferPort: testCommercePort()
    });
    assert.equal(result.ok, true);
    assert.equal(party.system.currency, 0);
    assert.equal(partyPurse.system.purse.held, 100);
    assert.equal(targetPurse.system.purse.held, 200);
  });

  test("an injected Commerce port remains the authoritative transaction boundary", async () => {
    const party = actor({ id: "party", type: "party", capacity: { mode: "uncapped" } });
    const source = actor({ id: "source", currency: 50 });
    const calls = [];
    const transferPort = {
      async deposit(request) { calls.push(request); return { ok: true, receipt: "tx-1" }; }
    };
    const result = await depositPartyFunds(party, source, 20, { user: user(), transferPort });
    assert.equal(result.ok, true);
    assert.equal(result.receipt, "tx-1");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].amount, 20);
    assert.equal(source.updates.length, 0, "the port owns persistence");
  });

  test("without a Commerce port, a valid preflight is refused without writes", async () => {
    const party = actor({ id: "party", type: "party", capacity: { mode: "uncapped" } });
    const source = actor({ id: "source", currency: 50 });
    const result = await depositPartyFunds(party, source, 20, { user: user() });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "commerce-unavailable");
    assert.equal(source.updates.length, 0);
    assert.equal(party.updates.length, 0);
  });

  test("typed fund routes accept Crows only", () => {
    const party = actor({ id: "party", type: "party", capacity: { mode: "uncapped" } });
    const monster = actor({ id: "monster", type: "monster", currency: 50 });
    assert.equal(planPartyDeposit(party, monster, 20, { user: user() }).reason, "unsupported-source");
    assert.equal(planPartyWithdraw(party, monster, 20, { user: user() }).reason, "unsupported-source");
  });

  test("an uncertain Commerce result is surfaced without being rewritten as success", async () => {
    const party = actor({ id: "party", type: "party", capacity: { mode: "uncapped" } });
    const source = actor({ id: "source", currency: 50 });
    const transferPort = {
      async deposit() {
        return { ok: false, reason: "write-failed", state: "unknown", repairRequired: true };
      }
    };
    const result = await depositPartyFunds(party, source, 20, { user: user(), transferPort });
    assert.deepEqual(result, {
      ok: false,
      reason: "write-failed",
      state: "unknown",
      repairRequired: true,
      operation: "deposit",
      plan: result.plan
    });
    assert.equal(source.system.currency, 50);
    assert.equal(party.system.currency, 0);
  });
});

describe("purse transfer", () => {
  test("debit planning is loose-first and then stable purse id", () => {
    const source = actor({
      id: "source", currency: 50,
      items: [
        item({ id: "b", held: 300 }),
        item({ id: "a", held: 300 })
      ]
    });
    const result = planPartyDebit(source, 550);
    assert.equal(result.ok, true);
    assert.deepEqual(result.plan.planned, {
      looseDebit: 50,
      purses: [{ id: "a", amount: 300 }, { id: "b", amount: 200 }]
    });
  });

  test("moving a purse creates a fresh destination Item and deletes the source", async () => {
    const sourceItem = item({ id: "purse", held: 42 });
    const source = actor({ id: "source", items: [sourceItem] });
    const party = actor({ id: "party", type: "party", capacity: { mode: "uncapped" } });
    const plan = planPartyPurseTransfer(party, sourceItem, { user: user() });
    assert.equal(plan.ok, true);
    assert.equal(plan.data._id, undefined);
    assert.equal(plan.data.system.location, undefined);
    const result = await movePartyPurse(party, sourceItem, { user: user() });
    assert.equal(result.ok, true);
    assert.equal(source.items.length, 0);
    assert.equal(party.items.length, 1);
    assert.equal(party.items[0].system.purse.held, 42);
  });

  test("a failed source delete compensates the destination clone", async () => {
    const sourceItem = item({ id: "purse", held: 42 });
    const source = actor({ id: "source", items: [sourceItem], failDelete: true });
    const party = actor({ id: "party", type: "party", capacity: { mode: "uncapped" } });
    const result = await movePartyPurse(party, sourceItem, { user: user() });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "write-failed");
    assert.equal(result.state, "repaired");
    assert.equal(party.items.length, 0);
    assert.equal(source.items.length, 1);
  });

  test("an unconfirmed destination create preserves the source and requires repair", async () => {
    const sourceItem = item({ id: "purse", held: 42 });
    const source = actor({ id: "source", items: [sourceItem] });
    const party = actor({
      id: "party", type: "party", capacity: { mode: "uncapped" }, emptyCreate: true
    });
    const result = await movePartyPurse(party, sourceItem, { user: user() });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "write-failed");
    assert.equal(result.state, "unknown");
    assert.equal(result.repairRequired, true);
    assert.equal(source.items.length, 1);
    assert.equal(party.items.length, 0);
  });
});
