import "./shim/foundry.mjs";
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  defaultVillage,
  getVillage,
  setVillage,
  registerVillageSettings,
  endCycle,
  recordSpend
} from "../module/helpers/village.mjs";
import {
  foundInstitutionPaid,
  upgradeInstitutionPaid,
  commissionArtisan,
  rentWorkshop,
  placeInnBet,
  payBeaconFare,
  purchaseMerchantItem,
  sellItem,
  auctionSell,
  auctionBuyback,
  adjudicateVillageOperation
} from "../module/helpers/village-sagas.mjs";

let store;
let settingConfig;
let settingWrites;
let failWrites;
let actors;
let calls;

const clone = value => structuredClone(value);

function makeActor({ id = "payer", type = "crow", currency = 0, items = [] } = {}) {
  const actor = {
    id,
    _id: id,
    uuid: `Actor.${id}`,
    type,
    ownership: { "gm-a": 3 },
    system: { currency, commerce: { revision: 0, receipts: [] } },
    items,
    writes: [],
    embeddedWrites: [],
    async update(changes) {
      this.writes.push(clone(changes));
      for (const [path, value] of Object.entries(changes)) {
        const pieces = path.split(".");
        const last = pieces.pop();
        let cursor = this;
        for (const piece of pieces) cursor = cursor[piece] ??= {};
        cursor[last] = clone(value);
      }
      return this;
    },
    async deleteEmbeddedDocuments(_type, ids) {
      this.embeddedWrites.push(clone(ids));
      this.items = this.items.filter(item => !ids.includes(item.id ?? item._id));
      return ids;
    }
  };
  return actor;
}

function installWorld(raw = null) {
  store = clone(raw ?? defaultVillage());
  settingWrites = 0;
  failWrites = new Set();
  actors = new Map();
  calls = [];
  globalThis.Hooks = { callAll: () => {} };
  globalThis.ChatMessage = { create: async data => data };
  globalThis.game = {
    user: { id: "gm-a", isGM: true, active: true },
    users: {
      get activeGM() {
        return { id: "gm-a", isGM: true, active: true, role: 4 };
      }
    },
    actors: { get: uuid => actors.get(uuid) ?? null },
    settings: {
      register: (_namespace, _key, data) => { settingConfig = data; },
      get: () => clone(store),
      set: async (_namespace, _key, value) => {
        settingWrites += 1;
        if (failWrites.has(settingWrites)) throw new Error("injected Village write failure");
        store = clone(value);
        settingConfig?.onChange?.(clone(store), {}, "gm-a");
        return clone(value);
      }
    }
  };
  registerVillageSettings();
}

function addActor(actor) {
  actors.set(actor.uuid, actor);
  return actor;
}

function committedPay() {
  return async (_actor, _amount, context) => {
    calls.push(["pay", _amount, context.txId]);
    return { ok: true, phase: "commerce-committed", txId: context.txId };
  };
}

function committedReceive() {
  return async (_actor, _amount, context) => {
    calls.push(["receive", _amount, context.txId]);
    return { ok: true, phase: "commerce-committed", txId: context.txId };
  };
}

function item(id = "item-1", value = 1000) {
  return {
    id,
    _id: id,
    uuid: `Item.${id}`,
    name: "Test item",
    type: "gear",
    system: { value, quality: "standard", location: { container: "backpack", index: 0, length: 1 } },
    toObject: () => ({ _id: id, name: "Test item", type: "gear", system: { value, quality: "standard" } })
  };
}

beforeEach(() => installWorld());

describe("paid Village sagas", { concurrency: false }, () => {
  test("a founding interrupted after commerce-committed repairs with the same token", async () => {
    const payer = addActor(makeActor({ id: "founder" }));
    const input = {
      institutionType: "alchemist",
      payerActor: payer,
      originCycle: 0,
      operationId: "found-interrupted"
    };
    let payments = 0;
    const options = {
      pay: async (...args) => { payments += 1; return committedPay()(...args); }
    };
    failWrites.add(4); // prepared, commerce-pending, commerce-committed, final mutation
    const first = await foundInstitutionPaid(input, options);
    assert.equal(first.ok, false);
    assert.equal(first.error, "write-failed");
    assert.equal(getVillage().operationJournal.find(entry => entry.operationId === input.operationId).phase,
      "commerce-committed");
    assert.equal(getVillage().institutions.some(institution => institution.type === "alchemist"), false);

    failWrites.clear();
    const repaired = await foundInstitutionPaid(input, options);
    assert.equal(repaired.ok, true);
    assert.equal(repaired.phase, "committed");
    assert.equal(payments, 1, "same-token repair must replay the confirmed Commerce child");
    assert.equal(getVillage().institutions.find(institution => institution.type === "alchemist").level, 1);
  });

  test("same-token repair crossing the origin cycle returns cycle-conflict", async () => {
    const payer = addActor(makeActor({ id: "founder" }));
    const input = {
      institutionType: "alchemist",
      payerActor: payer,
      originCycle: 0,
      operationId: "found-cycle-conflict"
    };
    let payments = 0;
    failWrites.add(4);
    await foundInstitutionPaid(input, {
      pay: async (...args) => { payments += 1; return committedPay()(...args); }
    });
    await setVillage({ cycle: 1 }, { operationId: "advance-cycle-for-test" });
    failWrites.clear();
    const repaired = await foundInstitutionPaid(input, {
      pay: async (...args) => { payments += 1; return committedPay()(...args); }
    });
    assert.equal(repaired.error, "cycle-conflict");
    assert.equal(payments, 1);
    assert.equal(getVillage().operationJournal.find(entry => entry.operationId === input.operationId).phase,
      "commerce-committed");
  });

  test("paid level-zero reopening reuses the unique record with founding semantics", async () => {
    const payer = addActor(makeActor({ id: "reopener" }));
    const village = getVillage();
    const record = { id: "alchemist-ruin", type: "alchemist", name: "Ruined Alchemist", level: 0,
      destroyed: false, steward: "", operatingFromCycle: 0 };
    await setVillage({
      institutions: [...village.institutions, record],
      activeEffects: [{ kind: "boycott" }]
    }, { operationId: "seed-level-zero" });
    const result = await foundInstitutionPaid({ institutionId: record.id, payerActor: payer,
      operationId: "reopen-1" }, { pay: committedPay() });
    const reopened = getVillage().institutions.find(institution => institution.id === record.id);
    assert.equal(result.ok, true);
    assert.equal(result.action, "reopen");
    assert.equal(result.price, 3000);
    assert.equal(reopened.level, 1);
    assert.equal(reopened.operatingFromCycle, 1);
    assert.equal(getVillage().activeEffects.some(effect => effect.kind === "boycott"), false);
  });

  test("a retryable Commerce conflict stays pending until the same token succeeds", async () => {
    const payer = addActor(makeActor({ id: "conflict-payer" }));
    let payments = 0;
    const pay = async (...args) => {
      payments += 1;
      if (payments === 1) return { ok: false, error: "conflict", reason: "stale-revision" };
      return committedPay()(...args);
    };
    const input = { institutionType: "alchemist", payerActor: payer, operationId: "pay-conflict" };
    const first = await foundInstitutionPaid(input, { pay });
    assert.equal(first.ok, false);
    assert.equal(first.phase, "commerce-pending");
    assert.equal(getVillage().operationJournal[0].phase, "commerce-pending");
    const retry = await foundInstitutionPaid(input, { pay });
    assert.equal(retry.ok, true);
    assert.equal(payments, 2);
  });

  test("an uncertain Commerce write outcome remains repairable", async () => {
    const payer = addActor(makeActor({ id: "handover-payer" }));
    let payments = 0;
    const pay = async (_actor, _amount, context) => {
      payments += 1;
      if (payments === 1) return {
        ok: false,
        error: "write-failed",
        state: "unknown",
        reconciliationRequired: true,
        txId: context.txId
      };
      return { ok: true, phase: "commerce-committed", txId: context.txId };
    };
    const input = {
      institutionType: "alchemist",
      payerActor: payer,
      operationId: "handover-uncertain"
    };
    const first = await foundInstitutionPaid(input, { pay });
    const entry = getVillage().operationJournal.find(candidate => candidate.operationId === input.operationId);
    const terminalPhases = new Set(["committed", "abandoned", "complete", "resolved", "duplicate-detected"]);
    assert.equal(first.phase, "uncertain");
    assert.equal(entry.phase, "uncertain");
    assert.equal(terminalPhases.has(entry.phase), false);

    const repaired = await foundInstitutionPaid(input, { pay });
    assert.equal(repaired.ok, true);
    assert.equal(repaired.phase, "committed");
    assert.equal(payments, 2);
  });

  test("insufficient funds stays repairable under the same stable direct token", async () => {
    const payer = addActor(makeActor({ id: "short-payer", currency: 0 }));
    let payments = 0;
    const pay = async (_actor, _amount, context) => {
      payments += 1;
      if (payments === 1) return { ok: false, error: "insufficient-funds" };
      return { ok: true, phase: "commerce-committed", txId: context.txId };
    };
    const input = { institutionType: "alchemist", payerActor: payer, operationId: "short-funds" };
    const first = await foundInstitutionPaid(input, { pay });
    assert.equal(first.phase, "commerce-pending");
    payer.system.currency = 3000;
    const retry = await foundInstitutionPaid(input, { pay });
    assert.equal(retry.ok, true);
    assert.equal(payments, 2);
  });

  test("endCycle refuses every nonterminal paid phase", async () => {
    for (const phase of ["prepared", "commerce-pending", "commerce-committed", "credit-pending",
      "spend-pending", "partial", "uncertain"]) {
      await setVillage({ operationJournal: [{
        operationId: `blocking-${phase}`,
        action: "found",
        originCycle: getVillage().cycle,
        expectedRevision: getVillage().revision,
        inputFingerprint: `blocking-${phase}`,
        phase
      }] }, { operationId: `seed-${phase}` });
      const result = await endCycle({ skipEvent: true, operationId: `close-${phase}` });
      assert.equal(result.error, phase, phase);
      assert.equal(getVillage().cycle, 0, phase);
      await setVillage({ operationJournal: [] }, { operationId: `clear-${phase}` });
    }
  });

  test("failed merchant grant compensates and never records merchant spend", async () => {
    const payer = addActor(makeActor({ id: "buyer" }));
    const source = item("stock-1", 100);
    let spendCalls = 0;
    const result = await purchaseMerchantItem({
      institutionType: "generalStore",
      payerActor: payer,
      source,
      itemKey: "rations",
      grossPrice: 100,
      requested: { criteria: { quality: "standard" }, itemPrice: 100 },
      operationId: "purchase-compensated"
    }, {
      pay: committedPay(),
      receive: committedReceive(),
      preflightGrant: async () => ({ ok: true }),
      grantItem: async (_actor, _source, context) => {
        calls.push(["grant", context.txId]);
        return { ok: false, error: "no-capacity" };
      },
      recordSpend: async () => { spendCalls += 1; return { ok: true, phase: "committed" }; }
    });
    assert.equal(result.ok, false);
    assert.equal(result.phase, "abandoned");
    assert.equal(spendCalls, 0);
    assert.deepEqual(calls.map(call => call[0]), ["pay", "grant", "receive"]);
    assert.equal(calls[2][2], "purchase-compensated:compensation");
    assert.equal(getVillage().operationJournal[0].phase, "abandoned");
  });

  test("failed merchant compensation remains uncertain and blocks cycle close", async () => {
    const payer = addActor(makeActor({ id: "buyer" }));
    const source = item("stock-2", 100);
    const result = await purchaseMerchantItem({
      institutionType: "generalStore",
      payerActor: payer,
      source,
      itemKey: "rations",
      grossPrice: 100,
      requested: { criteria: { quality: "standard" }, itemPrice: 100 },
      operationId: "purchase-uncertain-compensation"
    }, {
      pay: committedPay(),
      receive: async (_actor, _amount, context) => ({
        ok: false, error: "authority-unavailable", phase: "uncertain", state: "unknown",
        reconciliationRequired: true, txId: context.txId
      }),
      preflightGrant: async () => ({ ok: true }),
      grantItem: async () => ({ ok: false, error: "no-capacity" })
    });
    assert.equal(result.ok, false);
    assert.equal(result.phase, "uncertain");
    assert.equal(getVillage().operationJournal[0].phase, "uncertain");
    assert.equal((await endCycle({ skipEvent: true, operationId: "close-after-uncertain" })).error, "uncertain");
  });

  test("recordSpend runs once only after a committed pay-plus-grant", async () => {
    const payer = addActor(makeActor({ id: "buyer" }));
    const source = item("stock-3", 100);
    let spendCalls = 0;
    const result = await purchaseMerchantItem({
      institutionType: "generalStore",
      payerActor: payer,
      source,
      itemKey: "rations",
      grossPrice: 100,
      requested: { criteria: { quality: "standard" }, itemPrice: 100 },
      operationId: "purchase-success"
    }, {
      pay: committedPay(),
      preflightGrant: async () => ({ ok: true }),
      grantItem: async (_actor, _source, context) => {
        calls.push(["grant", context.txId]);
        return { ok: true, phase: "committed", itemIds: ["granted-1"] };
      },
      recordSpend: async (amount, options) => {
        spendCalls += 1;
        calls.push(["spend", amount, options.operationId]);
        return recordSpend(amount, { ...options, silent: true });
      }
    });
    assert.equal(result.ok, true);
    assert.equal(result.phase, "committed");
    assert.equal(spendCalls, 1);
    assert.deepEqual(calls.map(call => call[0]), ["pay", "grant", "spend"]);
    assert.equal(calls[2][1], 100);
    const retry = await purchaseMerchantItem({
      institutionType: "generalStore",
      payerActor: payer,
      source,
      itemKey: "rations",
      grossPrice: 100,
      requested: { criteria: { quality: "standard" }, itemPrice: 100 },
      operationId: "purchase-success"
    }, { recordSpend: async () => { spendCalls += 1; } });
    assert.equal(retry.replayed, true);
    assert.equal(spendCalls, 1);
  });

  test("merchant journal snapshots do not retain a live cyclic grant graph", async () => {
    const payer = addActor(makeActor({ id: "cyclic-grant-buyer" }));
    const source = item("cyclic-stock", 100);
    const embedded = { id: "cyclic-granted-item", name: "Granted Item", type: "gear" };
    const parent = { items: [embedded] };
    embedded.parent = parent;
    let grantCalls = 0;
    let spendCalls = 0;
    const liveGrant = {
      ok: true,
      phase: "committed",
      txId: "cyclic-grant:grant",
      itemIds: [embedded.id],
      snapshot: { actorUuid: payer.uuid },
      // Production grantItem returns live embedded Items in both fields. Those
      // Documents can retain parent/collection back-references; plain fixture
      // objects do not exercise the journal's persistence boundary.
      items: [embedded],
      created: [embedded]
    };
    const result = await purchaseMerchantItem({
      institutionType: "generalStore",
      payerActor: payer,
      source,
      itemKey: "cyclic-stock",
      grossPrice: 100,
      requested: { criteria: { quality: "standard" }, itemPrice: 100 },
      operationId: "purchase-cyclic-grant"
    }, {
      pay: committedPay(),
      preflightGrant: async () => ({ ok: true }),
      grantItem: async () => { grantCalls += 1; return liveGrant; },
      recordSpend: async (amount, options) => {
        spendCalls += 1;
        return recordSpend(amount, { ...options, silent: true });
      }
    });

    assert.equal(result.ok, true, result.message ?? result.error);
    assert.equal(result.phase, "committed");
    const entry = getVillage().operationJournal.find(candidate =>
      candidate.operationId === "purchase-cyclic-grant");
    assert.equal(entry.phase, "committed");
    assert.equal(entry.grantResult.items, undefined);
    assert.equal(entry.grantResult.created, undefined);
    assert.deepEqual(entry.grantResult.itemIds, [embedded.id]);
    assert.equal(entry.grantResult.snapshot.actorUuid, payer.uuid);
    assert.equal(getVillage().spentThisCycle, 100);
    const retry = await purchaseMerchantItem({
      institutionType: "generalStore",
      payerActor: payer,
      source,
      itemKey: "cyclic-stock",
      grossPrice: 100,
      requested: { criteria: { quality: "standard" }, itemPrice: 100 },
      operationId: "purchase-cyclic-grant"
    });
    assert.equal(retry.replayed, true);
    assert.equal(grantCalls, 1);
    assert.equal(spendCalls, 1);
  });

  test("a legacy full grant result remains readable and compacts on repair", async () => {
    const payer = addActor(makeActor({ id: "legacy-grant-buyer" }));
    const source = item("legacy-stock", 100);
    const input = {
      institutionType: "generalStore",
      payerActor: payer,
      source,
      itemKey: "legacy-stock",
      grossPrice: 100,
      requested: { criteria: { quality: "standard" }, itemPrice: 100 },
      operationId: "purchase-legacy-grant"
    };
    const first = await purchaseMerchantItem(input, {
      pay: committedPay(),
      preflightGrant: async () => ({ ok: true }),
      grantItem: async () => ({ ok: true, phase: "committed", itemIds: ["legacy-item"] }),
      recordSpend: async (amount, options) => recordSpend(amount, { ...options, silent: true })
    });
    assert.equal(first.ok, true);

    // Existing worlds can have a serializable pre-fix receipt with these
    // fields. Readers must accept it; the next repair rewrites only the
    // bounded child snapshot instead of requiring a migration or its layout.
    const legacy = store.operationJournal.find(candidate =>
      candidate.operationId === input.operationId);
    legacy.phase = "spend-pending";
    delete legacy.spendResult;
    legacy.grantResult = {
      ...legacy.grantResult,
      items: [{ id: "legacy-item", parent: { id: "buyer" } }],
      created: [{ id: "legacy-item", parent: { id: "buyer" } }],
      plan: { items: [{ data: { name: "legacy item" } }] },
      receipt: { phase: "committed", createdItemIds: ["legacy-item"] }
    };
    store.spentThisCycle = 0;

    const repaired = await purchaseMerchantItem(input, {
      recordSpend: async (amount, options) => recordSpend(amount, { ...options, silent: true })
    });
    assert.equal(repaired.ok, true, repaired.error);
    assert.equal(getVillage().operationJournal.find(candidate =>
      candidate.operationId === input.operationId).grantResult.items, undefined);
    assert.equal(getVillage().spentThisCycle, 100);
  });

  test("credit-covered goods consume credit but contribute no gc to recordSpend", async () => {
    const payer = addActor(makeActor({ id: "credit-buyer" }));
    const storeInstitution = getVillage().institutions.find(institution => institution.type === "generalStore");
    await setVillage({ activeEffects: [{
      kind: "credit",
      target: storeInstitution.id,
      creditId: "credit-1",
      beneficiaryActorUuid: payer.uuid,
      amountRemaining: 100,
      expiresOnCycle: 0
    }] }, { operationId: "seed-credit" });
    const source = item("credit-stock", 100);
    const spendAmounts = [];
    const result = await purchaseMerchantItem({
      institutionType: "generalStore",
      payerActor: payer,
      source,
      itemKey: "rations",
      grossPrice: 100,
      requested: { criteria: { quality: "standard" }, itemPrice: 100 },
      operationId: "credit-purchase"
    }, {
      pay: committedPay(),
      preflightGrant: async () => ({ ok: true }),
      grantItem: async () => ({ ok: true, phase: "committed", itemIds: ["credit-item"] }),
      recordSpend: async (amount, options) => {
        spendAmounts.push(amount);
        return recordSpend(amount, { ...options, silent: true });
      }
    });
    assert.equal(result.ok, true);
    assert.equal(result.netPrice, 0);
    assert.deepEqual(spendAmounts, [0]);
    assert.equal(getVillage().spentThisCycle, 0);
    assert.equal(getVillage().activeEffects.find(effect => effect.creditId === "credit-1").amountRemaining, 0);
  });

  test("Party-funded upgrade uses Commerce end to end", async () => {
    const party = addActor(makeActor({ id: "party", type: "party", currency: 2000 }));
    const blacksmith = getVillage().institutions.find(institution => institution.type === "blacksmith");
    const result = await upgradeInstitutionPaid({
      institutionId: blacksmith.id,
      payerActor: party,
      targetLevel: 2,
      operationId: "party-upgrade"
    });
    assert.equal(result.ok, true);
    assert.equal(result.phase, "committed");
    assert.equal(party.system.currency, 500);
    assert.equal(getVillage().institutions.find(institution => institution.id === blacksmith.id).pendingLevel, 2);
    assert.equal(getVillage().operationJournal.find(entry => entry.operationId === "party-upgrade").phase, "committed");
  });

  test("service, sale, auction sale, and buyback commands keep owner sequencing", async () => {
    const payer = addActor(makeActor({ id: "service-user" }));
    const blacksmith = getVillage().institutions.find(institution => institution.type === "blacksmith");
    const service = await commissionArtisan({ institutionId: blacksmith.id, payerActor: payer, itemPrice: 100,
      operationId: "commission-1" }, { pay: committedPay(), serviceAdapter: async payload => {
      calls.push(["service", payload.action]);
      return { ok: true, phase: "committed", projectId: "project-1" };
    } });
    assert.equal(service.ok, true);
    const workshop = await rentWorkshop({ institutionId: blacksmith.id, payerActor: payer,
      operationId: "workshop-1" }, { pay: committedPay(), serviceAdapter: async payload => {
      calls.push(["service", payload.action]);
      return { ok: true, phase: "committed" };
    } });
    assert.equal(workshop.ok, true);

    const inn = getVillage().institutions.find(institution => institution.type === "inn");
    const bet = await placeInnBet({ institutionId: inn.id, payerActor: payer, bet: 5,
      operationId: "inn-1" }, { pay: committedPay(), serviceAdapter: async payload => {
      calls.push(["service", payload.action]);
      return { ok: true, phase: "committed" };
    } });
    assert.equal(bet.ok, true);

    const beacon = { id: "beacon-1", type: "beacon", name: "Beacon", level: 1, destroyed: false };
    await setVillage({ institutions: [...getVillage().institutions, beacon] }, { operationId: "seed-beacon" });
    const fare = await payBeaconFare({ institutionId: beacon.id, payerActor: payer, hexes: 1,
      operationId: "beacon-1" }, { pay: committedPay(), serviceAdapter: async payload => {
      calls.push(["service", payload.action]);
      return { ok: true, phase: "committed" };
    } });
    assert.equal(fare.ok, true);

    const seller = addActor(makeActor({ id: "seller", items: [item("sale-item", 1000)] }));
    const sale = await sellItem({ institutionType: "generalStore", sellerActor: seller,
      item: seller.items[0], operationId: "sale-1" }, {
      receive: committedReceive(),
      deleteItem: async (actor, source, context) => {
        calls.push(["delete", context.deleteId]);
        actor.items = actor.items.filter(candidate => candidate !== source);
        return { ok: true, phase: "committed", deleteId: context.deleteId };
      }
    });
    assert.equal(sale.ok, true);
    assert.equal(sale.receiveTxId, "sale-1:receive");
    assert.equal(sale.deleteId, "sale-1:delete");

    const auctionHouse = { id: "auction-house-1", type: "auctionHouse", name: "Auction House", level: 1, destroyed: false };
    await setVillage({ institutions: [...getVillage().institutions, auctionHouse] }, { operationId: "seed-auction" });
    const auctionItem = item("auction-item", 1000);
    const auctionSeller = addActor(makeActor({ id: "auction-seller", items: [auctionItem] }));
    const auction = await auctionSell({ institutionId: auctionHouse.id, sellerActor: auctionSeller,
      item: auctionItem, auctionRoll: 7, auctionId: "auction-lot-1", operationId: "auction-operation-1" }, {
        receive: committedReceive(),
        deleteItem: async (actor, source, context) => {
          calls.push(["delete", context.deleteId]);
          actor.items = actor.items.filter(candidate => candidate !== source);
          return { ok: true, phase: "committed", deleteId: context.deleteId };
        }
    });
    assert.equal(auction.ok, true);
    assert.equal(auction.auctionId, "auction-lot-1");
    assert.equal(auction.receiveTxId, "auction-lot-1:receive");
    assert.equal(getVillage().auctionLots[0].status, "sold");
    const buyer = addActor(makeActor({ id: "auction-buyer" }));
    const buyback = await auctionBuyback({ auctionId: "auction-lot-1", buyerActor: buyer }, {
        pay: committedPay(),
        preflightGrant: async () => ({ ok: true }),
        grantItem: async (_actor, _source, context) => ({ ok: true, phase: "committed", txId: context.txId })
    });
    assert.equal(buyback.ok, true);
    assert.match(buyback.operationId, /^village-auction-buy-auction-lot-1-Actor\.auction-buyer$/);
    assert.equal(getVillage().auctionLots[0].status, "returned");
  });

  test("sale capacity is preflighted and deletion failure uses a distinct compensation", async () => {
    const seller = addActor(makeActor({ id: "sale-edge-seller", items: [item("edge-item", 1000)] }));
    const refused = await sellItem({ institutionType: "generalStore", sellerActor: seller,
      item: seller.items[0], saleId: "sale-capacity-edge" }, {
      preflightReceive: async () => ({ ok: false, error: "no-capacity" }),
      receive: async () => { throw new Error("receive must not run after preflight refusal"); },
      deleteItem: async () => { throw new Error("delete must not run after preflight refusal"); }
    });
    assert.equal(refused.ok, false);
    assert.equal(refused.error, "no-capacity");
    assert.equal(getVillage().operationJournal.some(entry => entry.operationId === "sale-capacity-edge"), false);

    const failedDelete = await sellItem({ institutionType: "generalStore", sellerActor: seller,
      item: seller.items[0], saleId: "sale-delete-edge" }, {
      preflightReceive: async () => ({ ok: true }),
      receive: committedReceive(),
      pay: committedPay(),
      deleteItem: async (_actor, _source, context) => {
        calls.push(["delete", context.deleteId]);
        return { ok: false, error: "delete-blocked" };
      }
    });
    assert.equal(failedDelete.ok, false);
    assert.equal(failedDelete.phase, "abandoned");
    assert.deepEqual(calls.map(call => call[0]), ["receive", "delete", "pay"]);
    assert.equal(calls[2][2], "sale-delete-edge:compensation");
  });

  test("Ref adjudication requires compensation before abandoning a proven debit", async () => {
    const payer = addActor(makeActor({ id: "adjudication-payer" }));
    await setVillage({ operationJournal: [{
      operationId: "adjudicate-1",
      action: "found",
      originCycle: 0,
      expectedRevision: 0,
      inputFingerprint: "adjudicate-fingerprint",
      phase: "commerce-committed",
      price: 3000,
      payerActorUuid: payer.uuid,
      commerceResult: { ok: true, phase: "commerce-committed" }
    }] }, { operationId: "seed-adjudication" });
    const result = await adjudicateVillageOperation({ operationId: "adjudicate-1", options: {
      receive: committedReceive()
    } });
    assert.equal(result.ok, true);
    assert.equal(result.phase, "abandoned");
    assert.equal(result.compensationPayTxId, "adjudicate-1:adjudication-compensation");
    assert.equal(getVillage().operationJournal[0].phase, "abandoned");
  });
});
