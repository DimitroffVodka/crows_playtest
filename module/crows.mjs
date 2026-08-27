import { CROWS } from "./config.mjs";
import { CrowsItemSheet } from "./sheets/item-sheet.mjs";
import { CrowData } from "./data/actor/crow.mjs";
import { PartyData } from "./data/actor/party.mjs";
import { MonsterData } from "./data/actor/monster.mjs";
import { WeaponData } from "./data/item/weapon.mjs";
import { ArmorData } from "./data/item/armor.mjs";
import { EnchantmentData } from "./data/item/enchantment.mjs";
import { AmmunitionData } from "./data/item/ammunition.mjs";
import { ConsumableData } from "./data/item/consumable.mjs";
import { GearData } from "./data/item/gear.mjs";
import { SpellbookData } from "./data/item/spellbook.mjs";
import { TraitData } from "./data/item/trait.mjs";
import { BackgroundData } from "./data/item/background.mjs";
import { ROLL_API } from "./helpers/roll.mjs";
import { bindTestCardActions } from "./helpers/expertise.mjs";
import { applyBackground } from "./helpers/creation.mjs";
import { applyDamage, applyHealing, repairArmor } from "./helpers/damage.mjs";
import { rollBacklash, lookupBacklash } from "./helpers/backlash.mjs";
import { castSpell, registerSpellcastingHooks } from "./helpers/spellcasting.mjs";
import {
  registerDungeonTurnSettings, endDungeonTurn, rollEncounterCheck,
  getDT, setDT, bumpDT, getDungeonEN, getDTLength, resolvePendingEncounter
} from "./helpers/dungeon-turn.mjs";
import {
  takeRest, takeTownActivity, beginRestSession, endRestSession,
  restoreSpellbookUds, consumePreparedTask
} from "./helpers/rest.mjs";
import { enterDungeon, leaveDungeon, applyGreedBonus } from "./helpers/greed.mjs";
import { registerSlotSettings } from "./helpers/slots.mjs";
import { pay, receive, registerCommerceSocket } from "./helpers/commerce.mjs";
import {
  registerMiasmaSettings, registerMiasmaHooks, getInMiasma, setInMiasma,
  rollMiasmaResist, rollMiasmaEffect, clearMiasma, onCrueltyCleared, MIASMA_EFFECTS
} from "./helpers/miasma.mjs";
import {
  registerCryptSettings, CRYPT_BOONS, BOON_IDS,
  getCryptLevel, setCryptLevel, listInterments, inter, pray,
  expendBoon, getCycleId, bumpCycle,
  consumeBoonOnDamage, consumeBoonOnHeal, consumeBoonOnSwiftness,
  clearPerDtBoonFlags
} from "./helpers/crypt.mjs";
import {
  registerVillageSettings, INSTITUTION_TYPES, STARTING_INSTITUTIONS,
  getVillage, setVillage,
  damageInstitution,
  setProsperity, sellPercentage, itemAvailability, foundingPrice, upgradePrice,
  foundVillageQuote, villageCraftingQuote, workshopRental, innMaxBet,
  beaconRadius, beaconTransportCost, capstoneActive,
  auctionSalePercentage, auctionPriceMultiplier, auctionBuybackPrice,
  endCycle, rollVillageEvent, getInstitutionLevel, getInstitution,
  isLiveInstitution, liveInstitutionRecords, findLiveInstitution, institutionRecordById,
  migrateVillageState, saveVillage, normalizeVillage,
  getActiveVillageGM, isVillageDesignatedWriter,
  enqueueVillageOperation, getVillageOperation,
  registerVillageChangeListener, setVillageSceneReconciliationEnqueuer,
  institutionServicePolicy, resolveVillageStockChance, resolvePendingEvent,
  abandonPendingEvent, cancelPendingEvent, villageEventResolutionOptions,
  getVillageEventReceipt, getPendingVillageEvent, villageEventTargetMode,
  resolveVillageEvent, resolveEvent
} from "./helpers/village.mjs";
import {
  VILLAGE_PROPOSAL_FLAG, VILLAGE_PROPOSAL_PHASES, VILLAGE_PROPOSAL_STATUSES,
  createVillageProposal, proposeVillageAction, submitVillageProposal,
  getVillageProposal, reviewVillageProposal, authorizeVillageProposal,
  commitVillageProposal, getVillageProposalOperation, getVillageReadModel,
  listVillageProposals, villageEconomics, villagePolicyFingerprint,
  villageCommitAuthority
} from "./helpers/village-interface.mjs";
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
  commitVillagePaidAction,
  adjudicateVillageOperation
} from "./helpers/village-sagas.mjs";
import {
  startCraftingProject, cancelProject, makeCraftingRoll, completeProject,
  identifyMagicItem, reconcileCraftingProjects, craftingMaterialSetsFor,
  recoverCraftingTransaction
} from "./helpers/crafting.mjs";
import { planCraftingMaterials } from "./helpers/materials.mjs";
import { grantItem, grantItemBatch } from "./helpers/item-grants.mjs";
import {
  openCharacterCreator, createCharacter, applyCharacteristics,
  applyUniversalStarterItems, rollBackground, rollStartingGold
} from "./helpers/character-creator.mjs";
import {
  gainXP, bonusesEarned, nextBonusTXP, isTraitBuyable, purchaseTrait,
  bonusesAvailable, spendExpertiseBonus, spendCharBonus, advancementOptions,
  spendingWindow, openSpendingWindow, closeSpendingWindow
} from "./helpers/advancement.mjs";
import { attackWithWeapon } from "./helpers/attack.mjs";
import { registerPetHooks } from "./helpers/pets.mjs";
import { registerConditions } from "./conditions.mjs";
import {
  STATUS_TO_CONDITION, expireDungeonTurnConditions, handleStatusToggleIntent,
  isMirroring, mirrorConditions, registerCombatHooks, setCondition
} from "./helpers/combat.mjs";
import {
  RECONCILED_FLAG, buildBackgroundIndex, buildMigrationReport, migrateActorDocument
} from "./helpers/migration.mjs";
import { MonsterSheet } from "./sheets/monster-sheet.mjs";
import { CrowSheet } from "./sheets/crow-sheet.mjs";
import { PartySheet } from "./sheets/party-sheet.mjs";
import {
  partyCapacityPolicy, partyViewData, authorizePartyTransfer,
  planPartyDeposit, planPartyWithdraw, depositPartyFunds, withdrawPartyFunds,
  planPartyPurseTransfer, movePartyPurse, depositDropToParty,
  canUserMoveMember
} from "./helpers/party.mjs";
import { CrowsCombat } from "./documents/combat.mjs";
import { CrowsCombatant } from "./documents/combatant.mjs";
import { CrowsCombatTracker } from "./applications/combat-tracker.mjs";
import { VillageCreator } from "./applications/village-creator.mjs";
import {
  VILLAGE_MAP_GENERATOR_VERSION,
  assetForInstitution,
  bootstrapVillageScene,
  buildVillageProjection,
  configureVillageBackgroundSet,
  configureVillageArtSet,
  getVillageMap,
  getVillageBackgroundSet,
  housingCountForProsperity,
  openVillageCreator,
  reconcileVillageScene,
  resolveVillageBackground,
  registerVillageMapHooks,
  registerVillageMapListener,
  villageSceneData
} from "./helpers/village-map.mjs";
import { VillageApplication, openVillageApplication } from "./applications/village.mjs";

// Bumped with the Village setting schema.  Keep this in the existing world
// migration gate: a second ready-time migration track would race the actor
// migration and would never repair worlds already stamped at 0.2.0/0.2.1.
// PartyData is a new native document type with no legacy persisted instances;
// its defaults require no normalization pass. Existing worlds therefore keep
// the shared 0.2.2 gate and do not receive synthetic Party actors.
const MIGRATION_TARGET_VERSION = "0.2.2";
const MIGRATION_VERSION_SETTING = "systemMigrationVersion";
const MIGRATION_BUDGET_SETTING = "migrationExpertiseBudget";

function registerMigrationSettings() {
  game.settings.register("crows", MIGRATION_VERSION_SETTING, {
    scope: "world",
    config: false,
    type: String,
    default: "0.0.0"
  });
  game.settings.register("crows", MIGRATION_BUDGET_SETTING, {
    name: "Playtest 2 expertise migration",
    hint: "Report-only preserves existing expertise uses. Enforce applies the deterministic Playtest 2 budget trim.",
    scope: "world",
    config: true,
    type: String,
    choices: {
      "report-only": "Report only (recommended)",
      enforce: "Enforce the Playtest 2 budget"
    },
    default: "report-only",
    restricted: true
  });
}

function versionPrecedesMigration(version) {
  const current = String(version ?? "").trim();
  if (!current) return true;
  return foundry.utils.isNewerVersion(MIGRATION_TARGET_VERSION, current);
}

async function backgroundIndex() {
  const pack = game.packs?.get("crows.crows-backgrounds");
  const docs = pack ? await pack.getDocuments() : [];
  return buildBackgroundIndex(docs);
}

async function migrateOneActor(actor, { backgrounds, mode, reportTitle } = {}) {
  const result = migrateActorDocument(actor, { backgrounds, mode });
  if (Object.keys(result.updates).length) await actor.update(result.updates);
  if (reportTitle) {
    await JournalEntry.create(buildMigrationReport([result], { mode, title: reportTitle }));
  }
  return result;
}

/** Layer (b): one GM-run world pass, gated by the stored world system version. */
async function runWorldMigration() {
  if (!game.user?.isGM) return { ran: false, reason: "not-gm" };
  const stored = game.settings.get("crows", MIGRATION_VERSION_SETTING);
  if (!versionPrecedesMigration(stored)) return { ran: false, reason: "current", stored };

  // Village identity/receipt migration is part of this one world pass.  Do
  // not stamp the global version if the designated writer is unavailable: a
  // later ready/retry must still be able to repair a legacy setting.
  const villageMigration = await migrateVillageState();
  if (!villageMigration.ok) return { ran: false, reason: "village-migration-pending", villageMigration };

  const mode = game.settings.get("crows", MIGRATION_BUDGET_SETTING) || "report-only";
  const backgrounds = await backgroundIndex();
  const results = [];
  for (const actor of game.actors ?? []) {
    results.push(await migrateOneActor(actor, { backgrounds, mode }));
  }

  if (results.length) {
    await JournalEntry.create(buildMigrationReport(results, { mode }));
  }
  // A development build can carry a system version below the migration target
  // (as the 0.2.0 boot probe does).  Stamping that lower version would make
  // every ready pass rerun the same migration forever; retain the higher of
  // the package version and the schema target.
  const systemVersion = game.system?.version;
  const stampVersion = systemVersion && !versionPrecedesMigration(systemVersion)
    ? systemVersion : MIGRATION_TARGET_VERSION;
  await game.settings.set("crows", MIGRATION_VERSION_SETTING, stampVersion);
  return { ran: true, mode, actors: results.length, results, villageMigration };
}

Hooks.once("init", () => {
  console.log("crows | init");
  CONFIG.CROWS = CROWS;
  // Handlebars helpers used by the crow sheet (re-register safely; built-in eq/lt/gt are overwritten with same behavior)
  Handlebars.registerHelper("gte", (a, b) => Number(a) >= Number(b));
  Handlebars.registerHelper("add", (a, b) => Number(a) + Number(b));
  registerConditions();

  // Register one subtype at a time. Other systems/modules may have already
  // extended these registries; replacing either object erases their models.
  CONFIG.Item.dataModels.weapon = WeaponData;
  CONFIG.Item.dataModels.armor = ArmorData;
  CONFIG.Item.dataModels.enchantment = EnchantmentData;
  CONFIG.Item.dataModels.ammunition = AmmunitionData;
  CONFIG.Item.dataModels.consumable = ConsumableData;
  CONFIG.Item.dataModels.gear = GearData;
  CONFIG.Item.dataModels.spellbook = SpellbookData;
  CONFIG.Item.dataModels.trait = TraitData;
  CONFIG.Item.dataModels.background = BackgroundData;
  CONFIG.Actor.dataModels.crow = CrowData;
  CONFIG.Actor.dataModels.party = PartyData;
  CONFIG.Actor.dataModels.monster = MonsterData;
  CONFIG.Combat ??= {};
  CONFIG.Combatant ??= {};
  CONFIG.ui ??= {};
  CONFIG.Combat.documentClass = CrowsCombat;
  CONFIG.Combatant.documentClass = CrowsCombatant;
  CONFIG.ui.combat = CrowsCombatTracker;

  registerMigrationSettings();
  registerSlotSettings();
  registerCommerceSocket();
  registerDungeonTurnSettings();
  registerMiasmaSettings();
  registerCryptSettings();
  registerVillageSettings();
  registerVillageMapHooks();
  game.crows = Object.assign(game.crows ?? {}, {
    applyBackground,
    applyDamage, applyHealing, repairArmor,
    castSpell, rollBacklash, lookupBacklash,
    runWorldMigration,
    takeRest, takeTownActivity, beginRestSession, endRestSession,
    restoreSpellbookUds, consumePreparedTask,
    enterDungeon, leaveDungeon, applyGreedBonus,
    resolvePendingEncounter, getDTLength,
    setCondition, mirrorConditions, expireDungeonTurnConditions,
    gainXP, bonusesEarned, nextBonusTXP, isTraitBuyable, purchaseTrait,
    bonusesAvailable, spendExpertiseBonus, spendCharBonus, advancementOptions,
    grantItem, grantItems: grantItemBatch,
    advancementWindow: {
      get: spendingWindow,
      open: openSpendingWindow,
      close: closeSpendingWindow
    },
    attackWithWeapon,
    pay,
    receive,
    commerce: { pay, receive },
    dt: { get: getDT, set: setDT, bump: bumpDT, end: endDungeonTurn, encounterCheck: rollEncounterCheck, getDungeonEN },
    miasma: { get: getInMiasma, set: setInMiasma, resist: rollMiasmaResist, effect: rollMiasmaEffect, clear: clearMiasma, onCrueltyCleared, EFFECTS: MIASMA_EFFECTS },
    crypt: {
      BOONS: CRYPT_BOONS, BOON_IDS,
      getLevel: getCryptLevel, setLevel: setCryptLevel,
      list: listInterments, inter, pray, expendBoon,
      getCycle: getCycleId, bumpCycle,
      consumeBoonOnDamage, consumeBoonOnHeal, consumeBoonOnSwiftness,
      clearPerDtBoonFlags
    },
    village: {
      TYPES: INSTITUTION_TYPES, STARTING: STARTING_INSTITUTIONS,
      get: getVillage, set: setVillage,
      found: foundInstitutionPaid, upgrade: upgradeInstitutionPaid, damage: damageInstitution,
      setProsperity, sellPercentage, availability: itemAvailability,
      foundingPrice, upgradePrice, itemAvailability,
      foundVillageQuote, villageCraftingQuote, workshopRental, innMaxBet,
      beaconRadius, beaconTransportCost, capstoneActive,
      auctionSalePercentage, auctionPriceMultiplier, auctionBuybackPrice,
      institutionServicePolicy, policy: institutionServicePolicy,
      readModel: getVillageReadModel, getReadModel: getVillageReadModel, read: getVillageReadModel,
      policyFingerprint: villagePolicyFingerprint, quoteFingerprint: villagePolicyFingerprint,
      economics: villageEconomics,
      stockChance: resolveVillageStockChance, resolveStockChance: resolveVillageStockChance,
      endCycle, rollEvent: rollVillageEvent,
      institutionLevel: getInstitutionLevel, institution: getInstitution,
      isLiveInstitution, liveInstitutions: liveInstitutionRecords,
      findLiveInstitution, institutionRecord: institutionRecordById,
      normalize: normalizeVillage, save: saveVillage,
      activeGM: getActiveVillageGM, isDesignatedWriter: isVillageDesignatedWriter,
      enqueue: enqueueVillageOperation,
      operation: getVillageOperation, getOperation: getVillageOperation,
      resolvePendingEvent, abandonPendingEvent, cancelPendingEvent,
      resolveVillageEvent, resolveEvent,
      resolutionOptions: villageEventResolutionOptions,
      receipt: getVillageEventReceipt, pendingEvent: getPendingVillageEvent,
      targetMode: villageEventTargetMode,
      onChange: registerVillageChangeListener,
      setSceneReconciliationEnqueuer: setVillageSceneReconciliationEnqueuer,
      map: getVillageMap,
      mapProjection: buildVillageProjection,
      mapListener: registerVillageMapListener,
      reconcileScene: reconcileVillageScene,
      reconcile: reconcileVillageScene,
      bootstrapScene: bootstrapVillageScene,
      bootstrap: bootstrapVillageScene,
      createScene: bootstrapVillageScene,
      create: bootstrapVillageScene,
      creator: openVillageCreator,
      openCreator: openVillageCreator,
      creatorApplication: VillageCreator,
      sceneData: villageSceneData,
      assetForInstitution,
      housingCount: housingCountForProsperity,
      configureArtSet: configureVillageArtSet,
      background: resolveVillageBackground,
      resolveBackground: resolveVillageBackground,
      configureBackgroundSet: configureVillageBackgroundSet,
      getBackgroundSet: getVillageBackgroundSet,
      mapGeneratorVersion: VILLAGE_MAP_GENERATOR_VERSION,
      proposalFlag: VILLAGE_PROPOSAL_FLAG,
      proposalPhases: VILLAGE_PROPOSAL_PHASES,
      proposalStatuses: VILLAGE_PROPOSAL_STATUSES,
      propose: createVillageProposal,
      proposeVillageAction, submitVillageProposal,
      createProposal: createVillageProposal,
      submitProposal: createVillageProposal,
      proposal: getVillageProposal,
      readProposal: getVillageProposal,
      getProposal: getVillageProposal,
      proposals: listVillageProposals,
      listProposals: listVillageProposals,
      reviewProposal: reviewVillageProposal,
      review: reviewVillageProposal,
      authorizeVillageProposal,
      authorizeProposal: reviewVillageProposal,
      approveProposal: reviewVillageProposal,
      commitProposal: commitVillageProposal,
      commitVillageProposal,
      commitAction: commitVillageProposal,
      commit: commitVillageProposal,
      commitVillagePaidAction,
      adjudicateVillageOperation,
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
      proposalOperation: getVillageProposalOperation,
      getProposalOperation: getVillageProposalOperation,
      commitAuthority: villageCommitAuthority,
      open: openVillageApplication,
      Application: VillageApplication,
    },
    crafting: {
      startProject: startCraftingProject, cancel: cancelProject,
      roll: makeCraftingRoll, complete: completeProject,
      identify: identifyMagicItem, reconcile: reconcileCraftingProjects,
      recover: recoverCraftingTransaction,
      // `planMaterials` is pure and data-only. `materialSetsFor` is the
      // lifecycle adapter; it reads the planner's availableSets while keeping
      // old direct callers compatible.
      planMaterials: planCraftingMaterials,
      materialSetsFor: craftingMaterialSetsFor
    },
    creator: {
      open: openCharacterCreator,
      create: createCharacter,
      applyCharacteristics, applyUniversalStarterItems,
      rollBackground, rollStartingGold
    },
    party: {
      isParty: (actor) => actor?.type === "party",
      capacity: partyCapacityPolicy,
      view: partyViewData,
      authorize: authorizePartyTransfer,
      canUserMoveMember,
      planDeposit: planPartyDeposit,
      planWithdraw: planPartyWithdraw,
      deposit: depositPartyFunds,
      withdraw: withdrawPartyFunds,
      planPurseTransfer: planPartyPurseTransfer,
      movePurse: movePartyPurse,
      depositDrop: depositDropToParty
    }
  });
  Object.assign(game.crows, ROLL_API);
  const SheetConfig = foundry.applications.apps.DocumentSheetConfig;
  SheetConfig.registerSheet(Item, "crows", CrowsItemSheet, { makeDefault: true, label: "Crows Item Sheet" });
  SheetConfig.registerSheet(Actor, "crows", MonsterSheet, { types: ["monster"], makeDefault: true, label: "Crows Monster Sheet" });
  SheetConfig.registerSheet(Actor, "crows", CrowSheet, { types: ["crow"], makeDefault: true, label: "Crow Sheet" });
  SheetConfig.registerSheet(Actor, "crows", PartySheet, { types: ["party"], makeDefault: true, label: "Party Treasury Sheet" });
  foundry.applications.handlebars.loadTemplates(["systems/crows/templates/actor/crow/sheet.hbs"]);
  foundry.applications.handlebars.loadTemplates(["systems/crows/templates/actor/village.hbs", "systems/crows/templates/actor/party.hbs"]);
  foundry.applications.handlebars.loadTemplates(["systems/crows/templates/chat/test-card.hbs"]);
  foundry.applications.handlebars.loadTemplates([
    "systems/crows/templates/partials/physical-item.hbs",
    "systems/crows/templates/partials/usage-die.hbs",
    "systems/crows/templates/partials/item-header.hbs",
    "systems/crows/templates/partials/card-head.hbs"
  ]);
  foundry.applications.handlebars.loadTemplates(["systems/crows/templates/apps/village-creator.hbs"]);
  foundry.applications.handlebars.loadTemplates(["systems/crows/templates/actor/monster.hbs"]);
});

Hooks.once("ready", async () => {
  console.log("crows | ready");
  registerSpellcastingHooks();
  registerCombatHooks({ autoApply: false });
  registerMiasmaHooks();
  registerPetHooks();
  await runWorldMigration();
});

/**
 * Foundry's pre-document hooks are synchronous, including on v14.367: an
 * async callback returns a truthy Promise and core proceeds before it settles.
 * Therefore both gates happen here, synchronously. Only a recognized Token HUD
 * intent is cancelled; our mirror's own create/delete is explicitly allowed.
 */
function interceptStatusToggle(effect, active) {
  const actor = effect?.parent;
  const statuses = [...(effect?.statuses ?? [])];
  if (!actor?.system?.conditions || statuses.length !== 1) return;
  const statusId = statuses[0];
  if (!STATUS_TO_CONDITION[statusId] || isMirroring(actor)) return;

  handleStatusToggleIntent(actor, statusId, active).catch((error) => {
    console.error(`crows | failed to translate status toggle "${statusId}" into actor state`, error);
  });
  return false;
}

Hooks.on("preCreateActiveEffect", (effect) => interceptStatusToggle(effect, true));
Hooks.on("preDeleteActiveEffect", (effect) => interceptStatusToggle(effect, false));

// Keep direct boolean writes (sheet actions, damage and DT expiry) mirrored too.
// Defer one turn so helpers such as setCondition() can perform their own mirror
// first; the follow-up is then either skipped while mirroring or a pure no-op.
const _conditionMirrorTimers = new Map();
Hooks.on("updateActor", (actor, changes) => {
  const conditionChanged = !!changes?.system?.conditions
    || Object.keys(changes ?? {}).some((key) => key.startsWith("system.conditions."));
  if (!conditionChanged) return;
  const id = actor.uuid ?? actor.id;
  clearTimeout(_conditionMirrorTimers.get(id));
  _conditionMirrorTimers.set(id, setTimeout(() => {
    _conditionMirrorTimers.delete(id);
    if (isMirroring(actor)) return;
    mirrorConditions(actor).catch((error) => console.error("crows | condition mirror failed", error));
  }, 0));
});

// An imported PT1 actor arrives after the one-time world gate. Its document
// _stats retain the old system version even though layer (a) has shaped its
// data, so reconcile layer (b) here and stamp it exactly once.
Hooks.on("createActor", (actor) => {
  if (!game.user?.isGM || actor.flags?.crows?.[RECONCILED_FLAG]) return;
  if (!versionPrecedesMigration(actor?._stats?.systemVersion)) return;
  (async () => {
    const mode = game.settings.get("crows", MIGRATION_BUDGET_SETTING) || "report-only";
    const backgrounds = await backgroundIndex();
    await migrateOneActor(actor, {
      backgrounds,
      mode,
      reportTitle: `CROWS — Playtest 2 Migration — ${actor.name}`
    });
  })().catch((error) => console.error(`crows | imported actor migration failed for ${actor.name}`, error));
});

/**
 * Material Item changes are the other input to a crafting state transition.
 * The material planner remains the owner of matching; this hook deliberately
 * calls the lifecycle seam without inventing a wildcard match. Once the
 * planner supplies an explicit set count, the same seam promotes blocked
 * projects to `pending` and persists that fact for the sheet.
 */
function reconcileCraftingOwner(item, changes = {}) {
  const actor = item?.parent;
  if (actor?.type !== "crow") return;
  const subtypeWasMaterial = changes?.system?.subtype === "material"
    || changes?.["system.subtype"] === "material";
  if (item?.type !== "gear" || (item?.system?.subtype !== "material" && !subtypeWasMaterial)) return;
  const crafting = globalThis.game?.crows?.crafting;
  const materialPlanner = crafting?.materialSetsFor ?? crafting?.planMaterials;
  const options = typeof materialPlanner === "function"
    ? { materialSetsFor: materialPlanner } : { materialSetsFor: craftingMaterialSetsFor };
  reconcileCraftingProjects(actor, options).catch((error) => {
    console.error(`crows | crafting reconciliation failed for ${actor.name}`, error);
  });
}

Hooks.on("createItem", reconcileCraftingOwner);
Hooks.on("updateItem", reconcileCraftingOwner);
Hooks.on("deleteItem", reconcileCraftingOwner);

/**
 * Wire chat-card actions (e.g. "Apply T2/T3" damage buttons).
 * v14 uses renderChatMessageHTML (per CLAUDE.md). We delegate clicks on
 * [data-action="applyDamage"] to game.crows.applyDamage against the
 * currently-controlled token(s); fall back to the user's character if no
 * token is selected.
 */
Hooks.on("renderChatMessageHTML", (message, html /*, context */) => {
  bindTestCardActions(message, html);
  const villageEventButtons = html.querySelectorAll?.('[data-action="resolveVillageEvent"]') ?? [];
  for (const btn of villageEventButtons) {
    if (btn.dataset.wired === "1") continue;
    btn.dataset.wired = "1";
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      if (!game.user?.isGM) {
        globalThis.ui?.notifications?.warn("Only the Ref can resolve a Village event.");
        return;
      }
      const resolutionId = ev.currentTarget.dataset.resolutionId;
      const result = await game.crows?.village?.resolvePendingEvent?.({
        resolutionId, selections: {}, context: { user: game.user }
      });
      if (result?.picker) {
        const label = result.picker.kind === "recipients" ? "recipient Actors"
          : result.picker.kind === "item" ? "an Actor and mundane Item"
            : "event targets";
        globalThis.ui?.notifications?.info(`Choose ${label}; the pending event remains unresolved until the Ref confirms.`);
      } else if (result?.ok === false) {
        globalThis.ui?.notifications?.warn(result.error ?? "Village event resolution refused.");
      }
    });
  }
  const buttons = html.querySelectorAll('[data-action="applyDamage"]');
  for (const btn of buttons) {
    // Guard against listener stacking — chat log re-renders this html
    // when scrolling history, and adding the listener twice fires apply
    // twice. dataset.wired = "1" makes the bind idempotent.
    if (btn.dataset.wired === "1") continue;
    btn.dataset.wired = "1";
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const amount = Number(ev.currentTarget.dataset.amount) || 0;
      const piercing = ev.currentTarget.dataset.piercing === "true";
      const actors = [];
      if (canvas.tokens?.controlled?.length) {
        for (const t of canvas.tokens.controlled) if (t.actor) actors.push(t.actor);
      } else if (game.user.character) {
        actors.push(game.user.character);
      }
      if (!actors.length) {
        ui.notifications?.warn("Select a token to apply damage to.");
        return;
      }
      const results = [];
      for (const a of actors) results.push(await applyDamage(a, amount, { piercing }));
      // Brief summary in chat (whisper to GM if rollMode is whisper; otherwise public)
      const lines = results.filter(r => r?.ok).map(r => {
        if (r.actorType === "monster") return `<li><b>${r.actorName}</b>: ${r.total} → Stamina ${r.stamina.before}→${r.stamina.after}${r.defeated ? " <em>(defeated)</em>" : ""}</li>`;
        const parts = [];
        if (r.absorbed.armor) parts.push(`armor ${r.absorbed.armor}`);
        if (r.absorbed.stamina) parts.push(`stamina ${r.absorbed.stamina}`);
        if (r.absorbed.wounds) parts.push(`wounds ${r.absorbed.wounds}`);
        const broken = r.armorBroken?.length ? ` <em>broken: ${r.armorBroken.join(", ")}</em>` : "";
        const bonedNote = r.bonedBonus ? ` <em>+${r.bonedBonus} boned</em>` : "";
        const dead = r.dead ? " <strong>(dead)</strong>" : "";
        return `<li><b>${r.actorName}</b>: ${r.total}${bonedNote} → ${parts.join(" · ") || "no effect"}${broken}${dead}</li>`;
      });
      const summary = `<div class="crows damage-applied"><strong>Damage applied:</strong><ul>${lines.join("")}</ul></div>`;
      await ChatMessage.create({ content: summary, speaker: { alias: "Damage" } });
    });
  }
});
