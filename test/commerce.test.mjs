import "./shim/foundry.mjs";
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { CROWS } from "../module/config.mjs";
import {
  BURSTING_PURSE_ID,
  layoutFor,
  looseCoinReservation
} from "../module/helpers/slots.mjs";
import {
  COMMERCE_ERRORS,
  COMMERCE_SOCKET_EVENT,
  getActiveCommerceGM,
  getCommerceReceipt,
  isCommerceAuthorized,
  pay,
  planPay,
  planReceive,
  registerCommerceSocket,
  receive,
  commerceSnapshot
} from "../module/helpers/commerce.mjs";

const gm = { id: "gm", isGM: true, active: true, role: 4 };
const owner = { id: "owner", isGM: false, active: true, role: 1 };
const stranger = { id: "stranger", isGM: false, active: true, role: 1 };

const clone = value => structuredClone(value);

function setPath(target, path, value) {
  const pieces = path.split(".");
  const last = pieces.pop();
  let cursor = target;
  for (const piece of pieces) cursor = cursor[piece] ??= {};
  cursor[last] = clone(value);
}

function item({
  id, container = "backpack", index = 0, slots = 1, held = 0,
  baseCapacity = CROWS.purseBaseCapacity, purse = false, type = "gear",
  trait = false
} = {}) {
  if (trait) return { id, _id: id, type: "trait", name: "Bursting Purse", system: {} };
  const system = {
    subtype: "utility", stackMax: 1, quantity: 1, slots,
    location: { container, index, length: slots }
  };
  if (purse) system.purse = { isPurse: true, held, baseCapacity };
  return { id, _id: id, type, system };
}

function purse(id, held = 0, baseCapacity = 500, index = 0) {
  return item({ id, held, baseCapacity, index, purse: true });
}

function actor({
  id = "actor", type = "crow", currency = 0, items = [], woundSlots = [],
  ownerIds = [owner.id, gm.id], failEmbedded = false, failFinal = false,
  flipGMOnFinal = false
} = {}) {
  const state = {
    id, uuid: `Actor.${id}`, _id: id, type,
    ownership: Object.fromEntries(ownerIds.map(userId => [userId, 3])),
    items,
    system: { currency, woundSlots, commerce: { revision: 0, receipts: [] } },
    writes: [], embeddedWrites: [],
    failEmbedded, failFinal, flipGMOnFinal
  };
  state.update = async changes => {
    state.writes.push(clone(changes));
    if (state.failFinal && Object.hasOwn(changes, "system.currency")) {
      throw new Error("injected actor write failure");
    }
    for (const [path, value] of Object.entries(changes)) setPath(state, path, value);
    if (state.flipGMOnFinal && Object.hasOwn(changes, "system.currency")) {
      globalThis.game.users.activeGM = { id: "gm-b", isGM: true, active: true, role: 4 };
    }
    return state;
  };
  state.updateEmbeddedDocuments = async (_type, updates) => {
    state.embeddedWrites.push(clone(updates));
    if (state.failEmbedded) throw new Error("injected Item write failure");
    for (const update of updates) {
      const embedded = state.items.find(candidate => candidate.id === update._id);
      if (!embedded) throw new Error(`missing Item ${update._id}`);
      setPath(embedded, "system.purse.held", update["system.purse.held"]);
    }
    return updates;
  };
  return state;
}

function installWorld(user = gm, designated = gm) {
  globalThis.game = {
    user,
    users: { activeGM: designated },
    actors: { get: id => worldActors.get(id) ?? null }
  };
  worldActors.clear();
}

const worldActors = new Map();

function shopping(txId, expectedRevision, user = gm, extra = {}) {
  return { kind: "shopping", txId, expectedRevision, user, ...extra };
}

async function asUser(user, task) {
  const previous = globalThis.game.user;
  globalThis.game.user = user;
  try { return await task(); }
  finally { globalThis.game.user = previous; }
}

beforeEach(() => installWorld());

describe("commerce plans", () => {
  test("pay consumes loose coin first, then stable purse Item ids", () => {
    const source = actor({
      currency: 75,
      items: [purse("zzz", 100), purse("aaa", 200)]
    });
    const planned = planPay(source, 300);
    assert.equal(planned.ok, true);
    assert.deepEqual(planned.plan.sources.map(source => [source.kind, source.itemId, source.amount]), [
      ["loose", undefined, 75], ["purse", "aaa", 200], ["purse", "zzz", 25]
    ]);
    assert.deepEqual(planned.plan.post, {
      loose: 0,
      purses: [
        { id: "aaa", held: 0, cap: 500 },
        { id: "zzz", held: 75, cap: 500 }
      ]
    });
  });

  test("split funds below price refuse before any write", async () => {
    const source = actor({ currency: 75, items: [purse("p1", 100)] });
    worldActors.set(source.id, source);
    const result = await pay(source, 200, shopping("short", 0));
    assert.equal(result.error, "insufficient-funds");
    assert.equal(source.writes.length, 0);
    assert.equal(source.embeddedWrites.length, 0);
    assert.equal(source.system.currency, 75);
    assert.equal(source.items[0].system.purse.held, 100);
  });

  test("receive fills sorted purses, then reserves the loose remainder", async () => {
    const first = purse("bbb", 450);
    const second = purse("aaa", 0);
    const recipient = actor({ currency: 240, items: [first, second] });
    const planned = planReceive(recipient, 500);
    assert.equal(planned.ok, true);
    assert.deepEqual(planned.plan.destinations.map(destination => [destination.kind, destination.itemId, destination.amount]), [
      ["purse", "aaa", 500], ["purse", "bbb", 0]
    ]);
    assert.equal(planned.plan.loose.amount, 0);

    worldActors.set(recipient.id, recipient);
    const result = await receive(recipient, 500, shopping("receive-1", 0));
    assert.equal(result.ok, true);
    assert.equal(recipient.system.currency, 240);
    assert.equal(first.system.purse.held, 450);
    assert.equal(second.system.purse.held, 500);
    assert.equal(recipient.system.commerce.revision, 1);
  });

  test("receive puts only the remainder into loose coin and exposes ceil reservation", async () => {
    const recipient = actor({ currency: 0, items: [purse("p1", 450)] });
    const planned = planReceive(recipient, 600);
    assert.equal(planned.ok, true);
    assert.equal(planned.plan.loose.amount, 550);
    assert.equal(planned.plan.reservation.requiredSlots, 3);
    assert.equal(planned.plan.reservation.additionalSlots, 3);

    worldActors.set(recipient.id, recipient);
    const result = await receive(recipient, 600, shopping("receive-2", 0));
    assert.equal(result.ok, true);
    assert.equal(recipient.system.currency, 550);
    assert.equal(recipient.items[0].system.purse.held, 500);
    assert.equal(result.plan.reservation.requiredSlots, 3);
  });

  test("full carry capacity refuses with excess and no write", async () => {
    const items = [];
    for (let index = 0; index < 16; index += 1) {
      const container = index < 2 ? "hand" : index < 6 ? "belt" : "backpack";
      const slot = container === "hand" ? index : container === "belt" ? index - 2 : index - 6;
      items.push(item({ id: `item-${index}`, container, index }));
      items.at(-1).system.location = { container, index: slot, length: 1 };
    }
    const recipient = actor({ items });
    worldActors.set(recipient.id, recipient);
    const result = await receive(recipient, 251, shopping("no-room", 0));
    assert.equal(result.error, "no-capacity");
    assert.equal(result.excess, 251);
    assert.equal(recipient.writes.length, 0);
    assert.equal(recipient.embeddedWrites.length, 0);
  });

  test("wound-only slots stay eligible for the reservation", async () => {
    const items = [];
    for (let index = 0; index < 15; index += 1) {
      const container = index < 2 ? "hand" : index < 6 ? "belt" : "backpack";
      const slot = container === "hand" ? index : container === "belt" ? index - 2 : index - 6;
      items.push(item({ id: `item-${index}`, container, index: slot }));
    }
    const recipient = actor({ items, woundSlots: [9] });
    const query = looseCoinReservation(layoutFor(recipient), 250);
    assert.equal(query.ok, true);
    assert.equal(query.free, 1);
    worldActors.set(recipient.id, recipient);
    assert.equal((await receive(recipient, 250, shopping("wound-room", 0))).ok, true);
  });

  test("Bursting Purse bonus is applied to the deterministic target", async () => {
    const target = purse("aaa", 0);
    const other = purse("zzz", 0);
    const recipient = actor({
      items: [other, item({ id: BURSTING_PURSE_ID, trait: true }), target]
    });
    const snapshot = commerceSnapshot(recipient);
    assert.equal(snapshot.purses.find(purse => purse.id === "aaa").cap, 1000);
    const planned = planReceive(recipient, 1000);
    assert.equal(planned.ok, true);
    assert.equal(planned.plan.loose.amount, 0);
    worldActors.set(recipient.id, recipient);
    assert.equal((await receive(recipient, 1000, shopping("bursting", 0))).ok, true);
    assert.equal(target.system.purse.held, 1000);
    assert.equal(other.system.purse.held, 0);
  });
});

describe("commerce authority, receipts, and failures", () => {
  test("invalid context, missing metadata, and non-owner refuse before writes", async () => {
    const source = actor({ currency: 100 });
    worldActors.set(source.id, source);
    assert.equal((await pay(source, 1, { kind: "unknown", txId: "bad", expectedRevision: 0 })).error, "unauthorized");
    assert.equal((await pay(source, 1, { kind: "shopping", expectedRevision: 0 })).error, "invalid-request");
    assert.equal((await asUser(stranger, () => pay(source, 1,
      shopping("stranger", 0, stranger)))).error, "unauthorized");
    assert.equal((await asUser(owner, () => pay(source, 1,
      shopping("forged-writer", 0, owner, { writer: gm })))).error, "authority-unavailable");
    assert.equal(source.writes.length, 0);
  });

  test("treasury requires GM while an owner may authorize shopping", () => {
    const source = actor();
    assert.equal(isCommerceAuthorized(source, { kind: "village-treasury" }, owner), false);
    assert.equal(isCommerceAuthorized(source, { kind: "village-treasury" }, gm), true);
    assert.equal(isCommerceAuthorized(source, { kind: "shopping" }, owner), true);
  });

  test("a Party-shaped Actor uses the generic stash path and transfer permissions", async () => {
    const stash = actor({ id: "party", type: "party", currency: 100 });
    assert.equal(isCommerceAuthorized(stash, { kind: "party-deposit" }, owner), true);
    assert.equal(isCommerceAuthorized(stash, { kind: "party-withdraw" }, owner), true);
    assert.equal(isCommerceAuthorized(stash, { kind: "party-withdraw" }, stranger), false);
    assert.equal(isCommerceAuthorized(stash, { kind: "party-withdraw" }, gm), true);

    worldActors.set(stash.id, stash);
    const withdrawn = await pay(stash, 40, {
      kind: "party-withdraw", txId: "party-withdraw", expectedRevision: 0, user: gm
    });
    assert.equal(withdrawn.ok, true);
    const deposited = await receive(stash, 15, {
      kind: "party-deposit", txId: "party-deposit", expectedRevision: 1, user: gm
    });
    assert.equal(deposited.ok, true);
    assert.equal(stash.system.currency, 75);
  });

  test("same txId replays the durable receipt without a second debit", async () => {
    const source = actor({ currency: 100 });
    worldActors.set(source.id, source);
    const request = shopping("same-token", 0);
    const first = await pay(source, 60, request);
    const writes = source.writes.length;
    const retry = await pay(source, 60, request);
    assert.equal(first.ok, true);
    assert.equal(retry.ok, true);
    assert.equal(retry.replayed, true);
    assert.equal(source.system.currency, 40);
    assert.equal(source.writes.length, writes);
    assert.equal(getCommerceReceipt(source, "same-token").phase, "committed");
  });

  test("stale revision conflicts without a source write", async () => {
    const source = actor({ currency: 100 });
    worldActors.set(source.id, source);
    const result = await pay(source, 1, shopping("stale", 1));
    assert.equal(result.error, "conflict");
    assert.equal(source.writes.length, 0);
    assert.equal(source.embeddedWrites.length, 0);
  });

  test("no active GM refuses even when requester is otherwise authorized", async () => {
    const source = actor({ currency: 100 });
    worldActors.set(source.id, source);
    globalThis.game.users.activeGM = null;
    assert.equal(getActiveCommerceGM(), null);
    const result = await pay(source, 1, shopping("no-gm", 0));
    assert.equal(result.error, "authority-unavailable");
    assert.equal(source.writes.length, 0);
  });

  test("owner request can route to the active GM without a client-side write", async () => {
    const source = actor({ currency: 100 });
    worldActors.set(source.id, source);
    let routed = false;
    const result = await asUser(owner, () => pay(source, 25, shopping("routed", 0, owner, {
      routeToGM: async ({ actor: routedActor, amount, context }) => {
        routed = true;
        return pay(routedActor, amount, { ...context, user: gm, requester: gm });
      }
    })));
    assert.equal(routed, true);
    assert.equal(result.ok, true);
    assert.equal(source.system.currency, 75);
  });

  test("owner request routes over the namespaced Foundry socket", async () => {
    const source = actor({ currency: 100 });
    worldActors.set(source.id, source);
    let handler;
    const socket = {
      on(event, callback) {
        assert.equal(event, COMMERCE_SOCKET_EVENT);
        handler = callback;
      },
      emit(event, payload, reply) {
        assert.equal(event, "system.crows");
        const requester = globalThis.game.user;
        globalThis.game.user = gm;
        Promise.resolve(handler(payload, reply)).finally(() => {
          globalThis.game.user = requester;
        });
      }
    };
    globalThis.game.socket = socket;
    globalThis.game.users.get = id => [gm, owner].find(user => user.id === id) ?? null;
    assert.equal(registerCommerceSocket(socket), true);
    const result = await asUser(owner, () => pay(source, 25,
      shopping("socket-route", 0, owner, { routeTimeoutMs: 100 })));
    registerCommerceSocket(null);
    assert.equal(result.ok, true);
    assert.equal(source.system.currency, 75);
  });

  test("embedded write failure is journaled and never posts a chat hook", async () => {
    const source = actor({ currency: 10, items: [purse("p1", 100)], failEmbedded: true });
    worldActors.set(source.id, source);
    let chatCalls = 0;
    const result = await pay(source, 20, shopping("item-fail", 0, gm, {
      onCommitted: () => { chatCalls += 1; }
    }));
    assert.equal(result.error, "write-failed");
    assert.equal(chatCalls, 0);
    assert.equal(source.system.currency, 10);
    assert.equal(source.items[0].system.purse.held, 100);
    assert.equal(getCommerceReceipt(source, "item-fail").phase, "uncertain");
  });

  test("a failed Actor write compensates purse changes and can retry the token", async () => {
    const source = actor({ currency: 10, items: [purse("p1", 100)], failFinal: true });
    worldActors.set(source.id, source);
    const first = await pay(source, 20, shopping("actor-fail", 0));
    assert.equal(first.error, "write-failed");
    assert.equal(first.state, "known");
    assert.equal(source.system.currency, 10);
    assert.equal(source.items[0].system.purse.held, 100);
    source.failFinal = false;
    const retry = await pay(source, 20, shopping("actor-fail", 0));
    assert.equal(retry.ok, true);
    assert.equal(source.system.currency, 0);
    assert.equal(source.items[0].system.purse.held, 90);
  });

  test("a compensated failure can retry the same prepared token", async () => {
    const source = actor({ currency: 10, items: [purse("p1", 100)], failEmbedded: true });
    worldActors.set(source.id, source);
    const first = await pay(source, 20, shopping("retry-token", 0));
    assert.equal(first.error, "write-failed");
    assert.equal(first.state, "known");
    source.failEmbedded = false;
    const retry = await pay(source, 20, shopping("retry-token", 0));
    assert.equal(retry.ok, true);
    assert.equal(source.items[0].system.purse.held, 90);
    assert.equal(source.system.currency, 0);
  });

  test("GM transition after a confirmed write returns unknown and suppresses chat", async () => {
    const source = actor({ currency: 100, flipGMOnFinal: true });
    worldActors.set(source.id, source);
    let chatCalls = 0;
    const result = await pay(source, 20, shopping("handover", 0, gm, {
      onCommitted: () => { chatCalls += 1; }
    }));
    assert.equal(result.error, "write-failed");
    assert.equal(result.state, "unknown");
    assert.equal(chatCalls, 0);
    assert.equal(source.system.currency, 80);
    assert.equal(getCommerceReceipt(source, "handover").phase, "committed");
  });

  test("error vocabulary stays explicit", () => {
    assert.ok(COMMERCE_ERRORS.includes("insufficient-funds"));
    assert.ok(COMMERCE_ERRORS.includes("no-capacity"));
    assert.ok(COMMERCE_ERRORS.includes("conflict"));
  });
});
