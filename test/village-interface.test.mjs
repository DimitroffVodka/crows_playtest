import "./shim/foundry.mjs";
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  defaultVillage, getVillage, setVillage, registerVillageSettings,
  institutionServicePolicy, villageInputFingerprint
} from "../module/helpers/village.mjs";
import {
  createVillageProposal, getVillageProposal, reviewVillageProposal,
  commitVillageProposal, getVillageReadModel
} from "../module/helpers/village-interface.mjs";
import { VillageApplication } from "../module/applications/village.mjs";

let store;
let settingConfig;
let settingWrites;
let messages;
let activeGM;

const clone = value => structuredClone(value);

function installWorld(raw = null, { gm = true } = {}) {
  store = clone(raw ?? defaultVillage());
  settingWrites = 0;
  messages = [];
  activeGM = gm ? "gm-a" : null;
  globalThis.Hooks = { callAll: () => {} };
  globalThis.ChatMessage = {
    create: async data => {
      const message = {
        id: `message-${messages.length + 1}`,
        ...clone(data),
        update: async patch => {
          const value = patch["flags.crows.villageProposal"];
          if (value) message.flags.crows.villageProposal = clone(value);
          return message;
        }
      };
      messages.push(message);
      return message;
    }
  };
  globalThis.game = {
    user: { id: gm ? "gm-a" : "player-a", isGM: gm, active: true },
    users: {
      get activeGM() {
        return activeGM ? { id: activeGM, isGM: true, active: true, role: 4 } : null;
      }
    },
    messages: { get: id => messages.find(message => message.id === id) },
    settings: {
      register: (_namespace, _key, data) => { settingConfig = data; },
      get: () => clone(store),
      set: async (_namespace, _key, value) => {
        settingWrites += 1;
        store = clone(value);
        settingConfig?.onChange?.(clone(store), {}, globalThis.game.user.id);
        return clone(value);
      }
    },
    actors: {
      get: uuid => uuid === "Actor.party" ? { uuid, id: "party", isOwner: true } : null,
      contents: []
    }
  };
  registerVillageSettings();
}

beforeEach(() => installWorld());

describe("event-aware institution service policy", () => {
  test("browse composes event levels and keeps closed/boycotted records readable", () => {
    const village = defaultVillage();
    const blacksmith = village.institutions.find(entry => entry.type === "blacksmith");
    village.activeEffects = [
      { kind: "merchantLevel", delta: -1, target: blacksmith.id },
      { kind: "outOfStockChance", percent: 30, target: blacksmith.id },
      { kind: "sellPercentage", delta: 5, target: blacksmith.id },
      { kind: "boycott" }
    ];
    const policy = institutionServicePolicy(village, { action: "browse", institutionId: blacksmith.id });
    assert.equal(policy.ok, true);
    assert.equal(policy.effectiveLevel, 0);
    assert.equal(policy.status, "closed");
    assert.ok(policy.statuses.includes("boycott"));
    assert.equal(policy.availability.outOfStockChance.percent, 30);
    assert.equal(policy.policy.noAutomaticRefund, true);
  });

  test("reopen is the boycott-clearing exception and uses founding semantics", () => {
    const village = defaultVillage();
    const blacksmith = village.institutions.find(entry => entry.type === "blacksmith");
    blacksmith.level = 0;
    blacksmith.destroyed = false;
    village.activeEffects = [{ kind: "boycott" }];
    const policy = institutionServicePolicy(village, { action: "reopen", institutionId: blacksmith.id });
    assert.equal(policy.ok, true);
    assert.equal(policy.recovery, true);
    assert.equal(policy.boycottClearingException, true);
    assert.equal(policy.quote.kind, "found");
    assert.equal(policy.quote.price, 3000);
    assert.equal(policy.quote.foundingSemantics, true);
  });

  test("destroyed records are readable while service and craft are closed", () => {
    const village = defaultVillage();
    const blacksmith = village.institutions.find(entry => entry.type === "blacksmith");
    blacksmith.destroyed = true;
    const browse = institutionServicePolicy(village, { action: "browse", institutionId: blacksmith.id });
    const craft = institutionServicePolicy(village, { action: "craft", institutionId: blacksmith.id, itemPrice: 100 });
    assert.equal(browse.ok, true);
    assert.equal(browse.status, "destroyed");
    assert.equal(craft.ok, false);
    assert.equal(craft.reason, "institution-destroyed");
  });

  test("targeted merchant modifiers do not leak to another institution", () => {
    const village = defaultVillage();
    const blacksmith = village.institutions.find(entry => entry.type === "blacksmith");
    village.activeEffects = [{ kind: "merchantLevel", delta: -1, target: blacksmith.id }];
    const targeted = institutionServicePolicy(village, { action: "browse", institutionId: blacksmith.id });
    const other = institutionServicePolicy(village, { action: "browse", institutionType: "generalStore" });
    assert.equal(targeted.effectiveLevel, 0);
    assert.equal(other.effectiveLevel, 1);
  });

  test("permanent event receipts remain audit evidence rather than a second level delta", () => {
    const village = defaultVillage();
    const blacksmith = village.institutions.find(entry => entry.type === "blacksmith");
    blacksmith.level = 2;
    village.eventReceipts = [{
      resolutionId: "event-level-1",
      cycle: 0,
      normalizedEffects: [{ kind: "institutionLevel", delta: -1, target: blacksmith.id, duration: "permanent" }]
    }];
    village.eventReceipt = village.eventReceipts[0];
    const policy = institutionServicePolicy(village, { action: "browse", institutionId: blacksmith.id });
    assert.equal(policy.effectiveLevel, 2);
    assert.equal(policy.eventReceipt.receipts.length, 1);
  });

  test("cycle-scoped receipt terms expire after their recorded event cycle", () => {
    const village = defaultVillage();
    village.cycle = 2;
    const blacksmith = village.institutions.find(entry => entry.type === "blacksmith");
    village.eventReceipts = [{
      resolutionId: "event-stock-1",
      cycle: 1,
      normalizedEffects: [{ kind: "merchantLevel", delta: -1, target: blacksmith.id, duration: "cycle" }]
    }];
    const policy = institutionServicePolicy(village, { action: "browse", institutionId: blacksmith.id });
    assert.equal(policy.effectiveLevel, 1);
  });

  test("browse exposes only the matching beneficiary's remaining credit", () => {
    const village = defaultVillage();
    const store = village.institutions.find(entry => entry.type === "generalStore");
    village.activeEffects = [{
      kind: "credit", creditId: "credit-1", target: store.id,
      beneficiaryActorUuid: "Actor.pc-a", amountRemaining: 100, expiresOnCycle: village.cycle
    }];
    const mine = institutionServicePolicy(village, {
      action: "browse", institutionId: store.id, actorUuid: "Actor.pc-a"
    });
    const theirs = institutionServicePolicy(village, {
      action: "browse", institutionId: store.id, actorUuid: "Actor.pc-b"
    });
    assert.equal(mine.creditToConsume.amountRemaining, 100);
    assert.equal(theirs.creditToConsume, null);
  });
});

describe("hybrid proposal and commit protocol", () => {
  test("players capture a durable proposal without setting or payment writes", async () => {
    globalThis.game.user = { id: "player-a", isGM: false, active: true };
    const village = getVillage();
    const blacksmith = village.institutions.find(entry => entry.type === "blacksmith");
    const created = await createVillageProposal({
      action: "upgrade", institutionId: blacksmith.id, payerActorUuid: "Actor.party",
      requested: { targetLevel: 2, itemPrice: 1500 }
    });
    assert.equal(created.ok, true);
    assert.equal(settingWrites, 0);
    const proposal = await getVillageProposal(created.proposalId);
    assert.equal(proposal.status, "pending");
    assert.equal(proposal.proposerUserId, "player-a");
    assert.equal(proposal.villageId, village.villageId);
    assert.equal(proposal.expectedVillageRevision, village.revision);
    assert.equal(proposal.payerActorUuid, "Actor.party");
    assert.ok(proposal.quoteFingerprint);
    assert.ok(proposal.inputFingerprint);
  });

  test("a changed revision makes Ref review stale", async () => {
    globalThis.game.user = { id: "player-a", isGM: false, active: true };
    const blacksmith = getVillage().institutions.find(entry => entry.type === "blacksmith");
    const created = await createVillageProposal({
      action: "upgrade", institutionId: blacksmith.id, payerActorUuid: "Actor.party",
      requested: { targetLevel: 2, itemPrice: 1500 }
    });
    await setVillage({ prosperity: 5 }, { operationId: "intervening-change" });
    globalThis.game.user = { id: "gm-a", isGM: true, active: true };
    const reviewed = await reviewVillageProposal(created.proposalId);
    assert.equal(reviewed.ok, false);
    assert.equal(reviewed.stale, true);
    assert.equal(reviewed.reason, "stale-revision");
    assert.equal(messages[0].flags.crows.villageProposal.status, "stale");
  });

  test("Ref commits a Village-only rename and same-token retry replays", async () => {
    const created = await createVillageProposal({ action: "rename", name: "New Home" });
    const committed = await commitVillageProposal(created.proposalId);
    assert.equal(committed.ok, true);
    assert.equal(committed.committed, true);
    assert.equal(getVillage().name, "New Home");
    assert.equal(messages[0].flags.crows.villageProposal.status, "committed");
    const writes = settingWrites;
    const retry = await commitVillageProposal(created.proposalId);
    assert.equal(retry.replayed, true);
    assert.equal(settingWrites, writes);
  });

  test("paid commit refuses before Commerce exists and never claims success", async () => {
    const blacksmith = getVillage().institutions.find(entry => entry.type === "blacksmith");
    const created = await createVillageProposal({
      action: "upgrade", institutionId: blacksmith.id, payerActorUuid: "Actor.party",
      requested: { targetLevel: 2, itemPrice: 1500 }
    });
    const result = await commitVillageProposal(created.proposalId);
    assert.equal(result.ok, false);
    assert.equal(result.error, "payment-handler-pending");
    assert.equal(settingWrites, 0);
    assert.equal(messages[0].flags.crows.villageProposal.phase, "prepared");
  });

  test("a nonterminal Commerce phase never advances Village optimistically", async () => {
    const blacksmith = getVillage().institutions.find(entry => entry.type === "blacksmith");
    const created = await createVillageProposal({
      action: "upgrade", institutionId: blacksmith.id, payerActorUuid: "Actor.party",
      requested: { targetLevel: 2, itemPrice: 1500 }
    });
    const result = await commitVillageProposal(created.proposalId, {
      commerceResult: { ok: true, phase: "commerce-pending", commerceTxId: "commerce-pending-1" }
    });
    assert.equal(result.ok, false);
    assert.equal(result.phase, "commerce-pending");
    assert.equal(settingWrites, 0);
    assert.equal(getVillage().institutions.find(entry => entry.id === blacksmith.id).pendingLevel, null);
  });

  test("a confirmed Commerce receipt is the only paid commit path", async () => {
    const blacksmith = getVillage().institutions.find(entry => entry.type === "blacksmith");
    const created = await createVillageProposal({
      action: "upgrade", institutionId: blacksmith.id, payerActorUuid: "Actor.party",
      requested: { targetLevel: 2, itemPrice: 1500 }
    });
    let settlements = 0;
    const result = await commitVillageProposal(created.proposalId, {
      settle: async request => {
        settlements += 1;
        assert.equal(request.operationId, created.proposal.villageOperationId);
        return { ok: true, phase: "commerce-committed", commerceTxId: "commerce-1", receipt: { id: "r-1" } };
      }
    });
    assert.equal(result.ok, true);
    assert.equal(result.committed, true);
    assert.equal(settlements, 1);
    assert.equal(getVillage().institutions.find(entry => entry.id === blacksmith.id).pendingLevel, 2);
    const operation = getVillage().operationJournal.find(entry => entry.operationId === created.proposal.villageOperationId);
    assert.equal(operation.originCycle, created.proposal.originCycle);
    const retry = await commitVillageProposal(created.proposalId, { settle: async () => { settlements += 1; } });
    assert.equal(retry.replayed, true);
    assert.equal(settlements, 1);
  });

  test("an approved paid operation crossing its origin cycle returns cycle-conflict", async () => {
    const blacksmith = getVillage().institutions.find(entry => entry.type === "blacksmith");
    const created = await createVillageProposal({
      action: "upgrade", institutionId: blacksmith.id, payerActorUuid: "Actor.party",
      requested: { targetLevel: 2, itemPrice: 1500 }
    });
    await setVillage({
      cycle: 1,
      operationJournal: [{
        operationId: created.proposal.villageOperationId,
        action: "upgrade",
        originCycle: 0,
        expectedRevision: created.proposal.expectedVillageRevision,
        inputFingerprint: created.proposal.inputFingerprint,
        phase: "commerce-committed",
        childOperationIds: ["cycle-conflict:pay"],
        commerceResult: { ok: true, phase: "commerce-committed", txId: "cycle-conflict:pay" }
      }]
    }, { operationId: "advance-paid-operation" });
    const result = await commitVillageProposal(created.proposalId, {
      settle: async () => { throw new Error("must not pay again"); }
    });
    assert.equal(result.error, "cycle-conflict");
    assert.equal(result.reason, "origin-cycle-advanced");
    assert.equal(result.proposal.phase, "uncertain");
  });

  test("non-Ref callers cannot bypass commit authority", async () => {
    const created = await createVillageProposal({ action: "rename", name: "Nope" });
    globalThis.game.user = { id: "player-a", isGM: false, active: true };
    const result = await commitVillageProposal(created.proposalId);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "ref-required");
    assert.equal(settingWrites, 0);
  });

  test("a stale or declined proposal cannot be committed as an implicit replan", async () => {
    const created = await createVillageProposal({ action: "rename", name: "Declined Home" });
    const declined = await reviewVillageProposal(created.proposalId, {
      decision: "decline", reason: "not this name"
    });
    assert.equal(declined.status, "declined");
    const result = await commitVillageProposal(created.proposalId);
    assert.equal(result.ok, false);
    assert.equal(result.error, "proposal-terminal");
    assert.equal(getVillage().name, "Unnamed Village");
    assert.equal(settingWrites, 0);
  });

  test("no active GM is an explicit refusal", async () => {
    activeGM = null;
    const created = await createVillageProposal({ action: "rename", name: "No Writer" });
    const result = await commitVillageProposal(created.proposalId);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "no-active-gm");
    assert.equal(settingWrites, 0);
  });
});

describe("Village read model and dispatcher", () => {
  test("surfaces dead economic helpers and refreshes an open app", async () => {
    const model = getVillageReadModel();
    assert.equal(typeof model.economics.salePercentage, "number");
    assert.equal(model.economics.foundVillage.price, 15000);
    assert.ok(model.economics.innMaxBet >= 0);
    assert.ok(model.economics.beacon);
    assert.ok(model.economics.auction);
    const app = new VillageApplication();
    let renders = 0;
    app.render = async () => { renders += 1; return app; };
    await setVillage({ name: "Refresh Home" }, { operationId: "refresh-1" });
    assert.equal(renders, 1);
    assert.equal(app._quoteInvalidated, true);
    await app.close();
    await setVillage({ name: "After Close" }, { operationId: "refresh-2" });
    assert.equal(renders, 1);
  });
});
