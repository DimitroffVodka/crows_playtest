const { HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

import { CROWS, ALL_EXPERTISES, expertiseCategory } from "../config.mjs";
import { rollTest } from "../helpers/roll.mjs";
import { rollTamingTest, rollPetCommandTest } from "../helpers/pets.mjs";
import { petViewData, petViewReasonKey } from "../helpers/pet-view.mjs";
import { applyBackground } from "../helpers/creation.mjs";
import {
  advancementOptions, nextAdvancementTXP, traitPurchaseInfo, traitPoolState,
  purchaseTrait, gainXP, spendExpertiseBonus, spendCharBonus
} from "../helpers/advancement.mjs";
import {
  takeRest, woundCandidatesFromLayout
} from "../helpers/rest.mjs";
import { endDungeonTurn, rollEncounterCheck } from "../helpers/dungeon-turn.mjs";
import { attackWithWeapon } from "../helpers/attack.mjs";
import {
  layoutFor, packItem, unpackItem, slotsNeeded, coinSummary,
  applyWoundSpeedPenalty, CARRY_CONTAINERS, MAGIC_CONTAINERS
} from "../helpers/slots.mjs";
import {
  getInMiasma, setInMiasma, rollMiasmaResist, clearMiasma, MIASMA_EFFECTS
} from "../helpers/miasma.mjs";
import {
  CRYPT_BOONS, getCryptLevel, listInterments, getCycleId,
  inter, pray, expendBoon, bumpCycle
} from "../helpers/crypt.mjs";
import {
  INSTITUTION_TYPES, getVillage, setVillage,
  foundInstitution, upgradeInstitution, damageInstitution,
  setProsperity, endCycle, rollVillageEvent
} from "../helpers/village.mjs";
import {
  CRAFTING_EXPERTISES, startCraftingProject, cancelProject, makeCraftingRoll,
  completeProject, identifyMagicItem
} from "../helpers/crafting.mjs";
import { openCharacterCreator } from "../helpers/character-creator.mjs";

const PHYSICAL_ITEM_TYPES = new Set([
  "weapon", "armor", "ammunition", "consumable", "gear", "spellbook"
]);
const CONDITION_KEYS = ["blessed", "grabbed", "prone", "vulnerable", "unconscious", "weakened"];
const EXPERTISE_CATEGORIES = ["general", "spellcasting", "weapon"];
const EXPERTISE_ICON = "icons/svg/d10-grey.svg";

function t(key, data = null) {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data ? i18n.format(key, data) : i18n.localize(key);
}

function esc(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

function notify(kind, key, data = null) {
  globalThis.ui?.notifications?.[kind]?.(t(key, data));
}

function itemTypeLabel(type) {
  return t(`TYPES.Item.${type}`);
}

function enumLabel(group, value) {
  if (!value) return "—";
  const key = `CROWS.Sheet.Crow.value.${group}.${value}`;
  const label = t(key);
  return label === key ? String(value) : label;
}

function spellDurationLabel(system) {
  const duration = system.duration ?? {};
  let label = duration.kind === "ud"
    ? t("CROWS.Sheet.Crow.value.duration.ud", { count: duration.count ?? 0 })
    : enumLabel("duration", duration.kind);
  if (duration.note) label = t("CROWS.Sheet.Crow.value.duration.withNote", {
    duration: label, note: duration.note
  });
  return label;
}

/** Compact, localized item information for the printed-card construction. */
function summarizeItem(item) {
  const s = item.system ?? {};
  switch (item.type) {
    case "weapon": {
      const r = s.range ?? {};
      const range = r.melee && r.ranged
        ? t("CROWS.Sheet.Crow.item.rangeBoth", { melee: r.melee, ranged: r.ranged })
        : r.ranged
          ? t("CROWS.Sheet.Crow.item.rangeRanged", { range: r.ranged })
          : t("CROWS.Sheet.Crow.item.rangeMelee", { range: r.melee ?? 1 });
      const attack = s.attackStat === "either"
        ? t("CROWS.Sheet.Crow.item.attackEither")
        : t("CROWS.Sheet.Crow.item.attackOne", {
          characteristic: String(s.attackStat?.[0] ?? "?").toUpperCase()
        });
      const lines = [
        range,
        attack,
        t("CROWS.Sheet.Crow.item.damageBands", {
          tier2: s.damage?.t2 ?? "—",
          tier3: s.damage?.t3 ?? "—"
        })
      ];
      if (s.qualities?.length) lines.push(s.qualities.map(value => enumLabel("quality", value)).join(", "));
      return { lines };
    }
    case "armor":
      return { lines: [
        t("CROWS.Sheet.Crow.item.armor", { type: enumLabel("armor", s.armorType) }),
        t("CROWS.Sheet.Crow.item.ad", { current: s.adCurrent ?? s.ad ?? 0, max: s.ad ?? 0 })
      ] };
    case "ammunition":
      return { lines: [
        t("CROWS.Sheet.Crow.item.ammunitionFor", { weapon: s.ammoFor || "—" }),
        t("CROWS.Sheet.Crow.item.perUnit", { count: s.countPerUnit ?? 0 })
      ] };
    case "consumable": {
      const lines = [t("CROWS.Sheet.Crow.item.activation", {
        action: enumLabel("action", s.useAction)
      })];
      if (s.bands?.t2 || s.bands?.t3) {
        lines.push(t("CROWS.Sheet.Crow.item.damageBands", {
          tier2: s.bands?.t2 || "—", tier3: s.bands?.t3 || "—"
        }));
      }
      if (s.duration) lines.push(t("CROWS.Sheet.Crow.item.duration", { duration: s.duration }));
      return { lines };
    }
    case "spellbook": {
      const target = s.target?.text || "—";
      const lines = [
        t("CROWS.Sheet.Crow.item.spell", {
          discipline: s.discipline ? t(`CROWS.Expertise.${s.discipline}`) : "—",
          rank: s.rank ?? 0
        }),
        t("CROWS.Sheet.Crow.item.spellUse", {
          time: enumLabel("action", s.castingTime), target
        })
      ];
      if (s.duration?.kind) {
        lines.push(t("CROWS.Sheet.Crow.item.duration", { duration: spellDurationLabel(s) }));
      }
      if (s.effectBands?.t2 || s.effectBands?.t3) {
        lines.push(t("CROWS.Sheet.Crow.item.damageBands", {
          tier2: s.effectBands?.t2 || "—", tier3: s.effectBands?.t3 || "—"
        }));
      }
      return { lines };
    }
    case "gear": {
      const lines = [s.subtype ? enumLabel("gear", s.subtype) : itemTypeLabel(item.type)];
      if (s.light?.enabled) {
        lines.push(t("CROWS.Sheet.Crow.item.light", { bright: s.light.bright, dim: s.light.dim }));
      }
      if (s.usageDie?.enabled) {
        lines.push(t("CROWS.Sheet.Crow.item.usageDie", {
          current: s.usageDie.udCurrent,
          max: s.usageDie.udMax,
          expiry: enumLabel("expiry", s.usageDie.expiry)
        }));
      }
      if (s.purse?.isPurse) {
        lines.push(t("CROWS.Sheet.Crow.item.purse", {
          held: s.purse.held ?? 0,
          cap: s.purseBaseCap ?? s.purse.baseCapacity ?? CROWS.purseBaseCapacity
        }));
      }
      return { lines };
    }
    default:
      return { lines: [itemTypeLabel(item.type)] };
  }
}

function slotCard(item) {
  if (!item) return null;
  const s = item.system ?? {};
  return {
    id: item.id,
    name: item.name,
    img: item.img,
    type: item.type,
    typeLabel: itemTypeLabel(item.type),
    stack: s.stackMax > 1 ? `${s.quantity ?? 1}/${s.stackMax}` : null,
    summary: summarizeItem(item),
    cost: s.cost ?? null
  };
}

function slotLabel(container, index) {
  if (MAGIC_CONTAINERS.includes(container)) return t(`CROWS.Sheet.${container}`);
  return t("CROWS.Sheet.Crow.slotNumber", {
    container: t(`CROWS.Sheet.${container}`), number: index + 1
  });
}

function slotView(slot, itemById) {
  const spanItem = slot.spanId ? itemById.get(slot.spanId) : null;
  const spanStart = Number(spanItem?.system?.location?.index ?? slot.index);
  const isContinuation = Boolean(spanItem && slot.index > spanStart);
  const seen = new Set();
  const cards = [];
  if (!isContinuation) {
    for (const entry of slot.items) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      const card = slotCard(itemById.get(entry.id));
      if (card) cards.push(card);
    }
  }
  return {
    container: slot.container,
    index: slot.index,
    number: slot.index + 1,
    label: slotLabel(slot.container, slot.index),
    wound: slot.wound,
    cards,
    filled: slot.items.length > 0,
    isContinuation,
    continuationName: isContinuation ? spanItem.name : null
  };
}

/** Everything the template needs from T1.2's positional layout. */
function inventoryView(actor) {
  const layout = layoutFor(actor);
  const itemById = new Map([...actor.items].map(item => [item.id, item]));
  const slots = layout.slots.map(slot => slotView(slot, itemById));
  const group = (container) => ({
    key: container,
    label: t(`CROWS.Sheet.${container}`),
    capacity: layout.capacities[container] ?? 0,
    slots: slots.filter(slot => slot.container === container)
  });
  return {
    layout,
    hand: group("hand"),
    belt: group("belt"),
    backpack: group("backpack"),
    magic: MAGIC_CONTAINERS.map(group),
    coin: coinSummary(layout),
    unplaced: layout.unplaced.map(entry => {
      const item = itemById.get(entry.id);
      const location = item?.system?.location;
      const storedSlot = location?.container
        ? slotLabel(location.container, Number(location.index) || 0)
        : t("CROWS.Sheet.Crow.inventory.unknownSlot");
      return {
        ...entry,
        card: slotCard(item),
        reasonLabel: t(`CROWS.Dialog.InventoryDrop.${entry.reason}`, {
          item: item?.name ?? t("CROWS.Sheet.Crow.inventory.unknownItem"),
          slot: storedSlot,
          count: item ? slotsNeeded(item) : 0
        })
      };
    }),
    weightless: layout.weightless.map(entry => slotCard(itemById.get(entry.id))).filter(Boolean)
  };
}

function expertiseGroups(system) {
  const groups = Object.fromEntries(EXPERTISE_CATEGORIES.map(category => [category, []]));
  for (const key of ALL_EXPERTISES) {
    const state = system.expertises?.[key] ?? {};
    const value = Math.max(0, Number(state.value) || 0);
    const max = Math.max(0, Number(state.max) || 0);
    const cap = Math.max(0, Number(system.expertiseCap) || 0);
    groups[expertiseCategory(key)].push({
      key,
      label: t(`CROWS.Expertise.${key}`),
      hint: t(`CROWS.Expertise.${key}Hint`),
      icon: EXPERTISE_ICON,
      value,
      max,
      cap,
      canSpend: value > 0,
      overCap: Math.max(0, max - cap),
      overMax: Math.max(0, value - max)
    });
  }
  return EXPERTISE_CATEGORIES.map(category => ({
    key: category,
    label: t(`CROWS.ExpertiseCategory.${category}`),
    hint: t(`CROWS.ExpertiseCategory.${category}Hint`),
    entries: groups[category]
  }));
}

function dropRefusal(item, container) {
  if (!PHYSICAL_ITEM_TYPES.has(item?.type)) return "not-physical";
  if (MAGIC_CONTAINERS.includes(container) && item.system?.equipSlotType !== container) {
    return "magic-slot-mismatch";
  }
  return null;
}

function advancementDisabledReason(view) {
  if (!view.window.open) return t("CROWS.Dialog.Advancement.windowClosed");
  if (view.available.expertise <= 0) return t("CROWS.Dialog.Advancement.noneAvailable");
  return "";
}

function characteristicDisabledReason(view) {
  if (!view.window.open) return t("CROWS.Dialog.Advancement.windowClosed");
  if (view.available.char <= 0) return t("CROWS.Dialog.Advancement.noCharacteristicAvailable");
  return "";
}

function actorDocuments(collection) {
  if (Array.isArray(collection?.contents)) return [...collection.contents];
  if (collection && typeof collection.values === "function") return [...collection.values()];
  if (collection && typeof collection[Symbol.iterator] === "function") return [...collection];
  return [];
}

function findActorByPetKey(key) {
  const value = String(key ?? "").trim();
  if (!value) return null;
  const collection = globalThis.game?.actors;
  return collection?.get?.(value)
    ?? actorDocuments(collection).find(actor => actor?.uuid === value || actor?.id === value)
    ?? null;
}

function petWorldTime() {
  const value = globalThis.game?.time?.worldTime;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function petFailureNotification(result) {
  if (result?.ok !== false) return;
  notify("warn", petViewReasonKey(result.reason));
}

export class CrowSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["crows", "sheet", "crow"],
    position: { width: 980, height: "auto" },
    actions: {
      switchTab: CrowSheet._onTab,
      rollChar: CrowSheet._onRollChar,
      rollPreparedTask: CrowSheet._onRollPreparedTask,
      spendExpertiseUse: CrowSheet._onSpendExpertiseUse,
      toggleWound: CrowSheet._onToggleWound,
      openItem: CrowSheet._onOpenItem,
      takeRest: CrowSheet._onTakeRest,
      endDt: CrowSheet._onEndDT,
      encounterCheck: CrowSheet._onEncounterCheck,
      selectTree: CrowSheet._onSelectTree,
      buyTrait: CrowSheet._onBuyTrait,
      grantXp: CrowSheet._onGrantXp,
      attackWithWeapon: CrowSheet._onAttackWithWeapon,
      spendExpertiseBonus: CrowSheet._onSpendExpertiseBonus,
      spendCharBonus: CrowSheet._onSpendCharBonus,
      toggleMiasma: CrowSheet._onToggleMiasma,
      rollMiasmaResist: CrowSheet._onRollMiasmaResist,
      clearMiasmaSelf: CrowSheet._onClearMiasmaSelf,
      tamePet: CrowSheet._onTamePet,
      commandPet: CrowSheet._onCommandPet,
      testCommandPet: CrowSheet._onTestCommandPet,
      cryptPray: CrowSheet._onCryptPray,
      cryptExpend: CrowSheet._onCryptExpend,
      cryptInter: CrowSheet._onCryptInter,
      cryptBumpCycle: CrowSheet._onCryptBumpCycle,
      openVillage: CrowSheet._onOpenVillage,
      craftStart: CrowSheet._onCraftStart,
      craftRoll: CrowSheet._onCraftRoll,
      craftCancel: CrowSheet._onCraftCancel,
      craftComplete: CrowSheet._onCraftComplete,
      identifyItem: CrowSheet._onIdentifyItem,
      removeItem: CrowSheet._onRemoveItem,
      openCreator: CrowSheet._onOpenCreator
    },
    window: { resizable: true },
    form: { submitOnChange: true }
  };

  static PARTS = { body: { template: "systems/crows/templates/actor/crow/sheet.hbs" } };

  _activeTab = "main";
  _selectedTree = "alchemy";
  _expertiseInFlight = new Set();

  static _treeMap = null;

  static async getTreeMap() {
    if (CrowSheet._treeMap) return CrowSheet._treeMap;
    const pack = game.packs.get("crows.crows-traits");
    if (!pack) return null;
    const docs = await pack.getDocuments();
    const map = {};
    for (const doc of docs) {
      const tree = doc.system?.tree;
      if (!tree) continue;
      (map[tree] ??= []).push(doc);
    }
    CrowSheet._treeMap = map;
    return map;
  }

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    const actor = this.document;
    const system = actor.system;
    const inventory = inventoryView(actor);
    const advancement = advancementOptions(actor);

    ctx.system = system;
    ctx.actor = actor;
    ctx.activeTab = this._activeTab;
    ctx.isGM = Boolean(game.user?.isGM);
    ctx.shift = 1;
    ctx.tabs = ["main", "equipment", "inventory", "pets", "advancement", "downtime", "bio"]
      .map(id => ({ id, label: t(`CROWS.Sheet.Crow.tab.${id}`) }));

    ctx.pets = petViewData(actor, actorDocuments(game.actors), {
      now: petWorldTime(),
      isOwner: actor.isOwner === true,
      localize: (key) => game.i18n?.localize?.(key) ?? key
    });

    ctx.nextAdvancement = nextAdvancementTXP(system.xp?.txp ?? 0);
    ctx.expertiseGroups = expertiseGroups(system);
    ctx.expertiseOverBudget = Number.isFinite(Number(system.expertiseOverBudget))
      && Number(system.expertiseOverBudget) > 0
      ? Number(system.expertiseOverBudget)
      : null;
    ctx.expertiseOverBudgetLabel = ctx.expertiseOverBudget === null ? "" : t(
      "CROWS.Warn.expertiseOverBudget", { over: ctx.expertiseOverBudget }
    );

    ctx.conditions = CONDITION_KEYS.map(key => ({
      key,
      label: t(`CROWS.Condition.${key}`),
      hint: t(`CROWS.Condition.${key}Hint`),
      active: Boolean(system.conditions?.[key])
    }));

    ctx.inventory = inventory;
    ctx.effectiveSpeed = applyWoundSpeedPenalty(system.effectiveSpeed, inventory.layout);
    ctx.speedNote = [system.speedNote, inventory.layout.slots.some(s => s.wound && s.items.length)
      ? t("CROWS.Sheet.Crow.woundSpeedNote") : ""].filter(Boolean).join(" · ");
    ctx.magicOverload = inventory.layout.magicOverload;
    ctx.orphanedWoundCount = system.orphanedWounds?.length ?? 0;
    ctx.orphanedWoundsLabel = ctx.orphanedWoundCount > 0
      ? t("CROWS.Warn.orphanedWounds", { count: ctx.orphanedWoundCount }) : "";

    ctx.perks = [...actor.items].filter(item => item.type === "trait").map(trait => {
      const poolConfigured = Boolean(trait.system?.usePool?.sizedBy)
        || Number(trait.system?.usePool?.fixedMax) > 0;
      return {
        id: trait.id,
        name: trait.name,
        img: trait.img,
        tree: trait.system?.tree ?? "",
        treeLabel: trait.system?.tree
          ? t(`CROWS.Sheet.Crow.tree.${trait.system.tree}`) : "",
        tier: trait.system?.tier ?? 1,
        usePool: poolConfigured ? traitPoolState(trait, actor) : null
      };
    });

    ctx.preparedTask = system.preparedTask?.task ? {
      task: system.preparedTask.task,
      bonus: system.preparedTask.bonus,
      setOn: system.preparedTask.setOn
    } : null;

    try {
      ctx.dtCount = game.crows?.dt?.get?.() ?? 0;
      ctx.dungeonEN = game.crows?.dt?.getDungeonEN?.() ?? 6;
    } catch {
      ctx.dtCount = 0;
      ctx.dungeonEN = 6;
    }

    ctx.craftingProjects = (system.crafting?.projects ?? []).map(project => ({
      ...project,
      expertiseLabel: project.expertise ? t(`CROWS.Expertise.${project.expertise}`) : "—",
      complete: (project.points ?? 0) >= (project.goal ?? 1),
      pct: Math.min(100, Math.round(((project.points ?? 0) / (project.goal || 1)) * 100))
    }));

    try {
      const village = getVillage();
      ctx.village = {
        name: village.name,
        prosperity: village.prosperity,
        cycle: village.cycle,
        hasUpgraded: village.hasUpgradedThisCycle
      };
    } catch {
      ctx.village = null;
    }

    try {
      ctx.cryptLevel = getCryptLevel();
      ctx.cryptCycle = getCycleId();
      ctx.cryptInterments = listInterments();
      const active = system.activeBoon;
      if (active?.boonId && CRYPT_BOONS[active.boonId]) {
        const boon = CRYPT_BOONS[active.boonId];
        ctx.activeBoonCard = {
          id: active.boonId,
          label: boon.label,
          source: active.sourceCrowName,
          usesLeft: active.usesLeft ?? 1,
          summary: boon.summary(ctx.cryptLevel),
          text: boon.text(ctx.cryptLevel)
        };
      } else {
        ctx.activeBoonCard = null;
      }
      ctx.alreadyPrayedThisCycle = (active?.prayedOnCycle ?? -1) === ctx.cryptCycle;
    } catch {
      ctx.cryptLevel = 1;
      ctx.cryptInterments = [];
      ctx.activeBoonCard = null;
      ctx.alreadyPrayedThisCycle = false;
    }

    try {
      ctx.inMiasma = getInMiasma();
      ctx.miasmaEffects = (system.miasma?.effects ?? []).map(bucket => {
        const effect = MIASMA_EFFECTS[Math.max(1, Math.min(12, bucket))];
        return { bucket, label: effect?.label ?? `#${bucket}`, text: effect?.text ?? "" };
      });
      ctx.miasmaPermanentNPC = Boolean(system.miasma?.permanentNPC);
    } catch {
      ctx.inMiasma = false;
      ctx.miasmaEffects = [];
      ctx.miasmaPermanentNPC = false;
    }

    ctx.advancement = {
      ...advancement,
      canSpendExpertise: advancement.window.open && advancement.available.expertise > 0,
      canSpendCharacteristic: advancement.window.open && advancement.available.char > 0,
      expertiseDisabledReason: advancementDisabledReason(advancement),
      characteristicDisabledReason: characteristicDisabledReason(advancement),
      next: ctx.nextAdvancement
    };

    if (this._activeTab === "advancement") {
      try {
        const treeMap = await CrowSheet.getTreeMap();
        ctx.selectedTree = this._selectedTree;
        ctx.treeList = CROWS.traitTrees.map(key => ({
          key,
          label: t(`CROWS.Sheet.Crow.tree.${key}`)
        }));
        if (treeMap?.[this._selectedTree]) {
          const grid = Array.from({ length: 4 }, (_, index) => ({
            tier: index + 1,
            cost: CROWS.traitTierXP[index + 1],
            cells: Array(3).fill(null)
          }));
          for (const trait of treeMap[this._selectedTree]) {
            const info = traitPurchaseInfo(actor, trait);
            const tier = Number(info.tier ?? 1);
            const column = Number(info.column ?? 1);
            if (tier < 1 || tier > 4 || column < 1 || column > 3) continue;
            const enabled = !info.owned && info.buyable && info.affordable && info.window.open;
            const reason = info.owned
              ? t("CROWS.Dialog.Trait.alreadyOwned")
              : !info.window.open
                ? t("CROWS.Dialog.Advancement.windowClosed")
                : !info.buyable
                  ? info.reason
                  : !info.affordable
                    ? t("CROWS.Dialog.Trait.notAffordable", { cost: info.cost, spendable: info.spendable })
                    : "";
            grid[tier - 1].cells[column - 1] = {
              id: trait.id,
              name: trait.name,
              cost: info.cost,
              owned: info.owned,
              enabled,
              reason
            };
          }
          ctx.treeGrid = grid;
        }
      } catch (error) {
        console.error("crows | advancement tab build failed", error);
      }
    }

    return ctx;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const tabs = this.element?.querySelectorAll?.('[role="tab"]');
    if (!tabs?.length) return;
    for (const tab of tabs) {
      tab.addEventListener("keydown", event => {
        const list = [...this.element.querySelectorAll('[role="tab"]')];
        const index = list.indexOf(event.currentTarget);
        let next = null;
        if (event.key === "ArrowRight" || event.key === "ArrowDown") next = list[(index + 1) % list.length];
        else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = list[(index - 1 + list.length) % list.length];
        else if (event.key === "Home") next = list[0];
        else if (event.key === "End") next = list[list.length - 1];
        if (!next) return;
        event.preventDefault();
        next.focus();
        next.click();
      });
    }
  }

  async _onDropItem(event, item) {
    if (item.type === "background") {
      await applyBackground(this.document, item);
      return null;
    }

    const target = event.target?.closest?.("[data-container][data-index]");
    if (!target) {
      if (PHYSICAL_ITEM_TYPES.has(item.type)) {
        notify("warn", "CROWS.Dialog.InventoryDrop.choose-slot");
        return null;
      }
      return super._onDropItem(event, item);
    }

    const container = target.dataset.container;
    const index = Number(target.dataset.index);
    const refused = dropRefusal(item, container);
    if (refused) {
      notify("warn", `CROWS.Dialog.InventoryDrop.${refused}`, {
        item: item.name,
        slot: slotLabel(container, index)
      });
      return null;
    }

    const layout = layoutFor(this.document);
    const isEmbedded = this.document.uuid === item.parent?.uuid;
    if (isEmbedded) unpackItem(layout, item.id);
    const result = packItem(layout, item, container, index);
    if (!result.ok) {
      notify("warn", `CROWS.Dialog.InventoryDrop.${result.reason}`, {
        item: item.name,
        slot: slotLabel(container, index),
        count: slotsNeeded(item)
      });
      return null;
    }

    const location = { container, index, length: slotsNeeded(item) };
    if (isEmbedded) {
      await item.update({ "system.location": location });
      return item;
    }
    const created = await super._onDropItem(event, item);
    if (!created) return null;
    await created.update({ "system.location": location });
    return created;
  }

  static _onTab(event, target) {
    this._activeTab = target.dataset.tab;
    this.render();
  }

  static async _onRollChar(event, target) {
    const characteristic = target.dataset.characteristic;
    await rollTest({
      actor: this.document,
      characteristic,
      flavor: t("CROWS.Sheet.Crow.test.characteristic", {
        characteristic: t(`CROWS.Characteristic.${characteristic}`)
      })
    });
  }

  static async _onRollPreparedTask() {
    const actor = this.document;
    const task = String(actor.system?.preparedTask?.task ?? "").trim();
    if (!task) {
      notify("warn", "CROWS.Dialog.PreparedTask.none");
      return;
    }
    const characteristic = await DialogV2.prompt({
      window: { title: t("CROWS.Dialog.PreparedTask.title", { actor: actor.name }) },
      content: `<div class="crows adv-spend-form"><p>${esc(t("CROWS.Dialog.PreparedTask.choose", { task }))}</p></div>`,
      buttons: Object.keys(CROWS.characteristics).map(key => ({
        action: key,
        label: t(`CROWS.Characteristic.${key}`),
        callback: () => key
      }))
    });
    if (!characteristic) return;
    await rollTest({ actor, characteristic, task, flavor: task });
  }

  static async _onSpendExpertiseUse(event, target) {
    const key = target.dataset.expertise;
    if (!ALL_EXPERTISES.includes(key) || this._expertiseInFlight.has(key)) return;
    const actor = this.document;
    if (actor.isOwner !== true) return;
    this._expertiseInFlight.add(key);
    try {
      const value = Math.max(0, Number(actor.system.expertises?.[key]?.value) || 0);
      if (value < 1) {
        notify("warn", "CROWS.Dialog.Expertise.noneLeft", { expertise: t(`CROWS.Expertise.${key}`) });
        return;
      }
      await actor.update({ [`system.expertises.${key}.value`]: value - 1 });
      await ChatMessage.create({
        content: `<div class="crows adv-spend"><strong>${esc(actor.name)}</strong> ${esc(t(
          "CROWS.Dialog.Expertise.spentMessage", { expertise: t(`CROWS.Expertise.${key}`), remaining: value - 1 }
        ))}</div>`,
        speaker: ChatMessage.getSpeaker({ actor })
      });
    } finally {
      this._expertiseInFlight.delete(key);
    }
  }

  static async _onToggleWound(event, target) {
    const actor = this.document;
    const layout = layoutFor(actor);
    const index = Number(target.dataset.index);
    const capacity = layout.capacities.backpack ?? 0;
    if (!Number.isInteger(index) || index < 0 || index >= capacity) {
      notify("warn", "CROWS.Dialog.Wound.invalidSlot", { slot: index + 1 });
      return;
    }
    const wounds = new Set([...actor.system.woundSlots].map(Number));
    const adding = !wounds.has(index);
    const before = [...wounds].filter(slot => slot >= 0 && slot < capacity).length;
    if (adding) wounds.add(index);
    else wounds.delete(index);
    const after = [...wounds].filter(slot => slot >= 0 && slot < capacity).length;
    const update = { "system.woundSlots": [...wounds].sort((a, b) => a - b) };
    if (adding && capacity > 0 && before < capacity && after >= capacity) {
      update["system.conditions.defeated"] = true;
    }
    await actor.update(update);
  }

  static async _onOpenItem(event, target) {
    this.document.items.get(target.dataset.itemId)?.sheet.render(true);
  }

  static async _onTakeRest(event, target) {
    if (target?.dataset?.town === "true") {
      await takeRest(this.document, { inTown: true });
      this.render();
      return;
    }

    const actor = this.document;
    const layout = layoutFor(actor);
    const itemOptions = [...actor.items]
      .filter(item => PHYSICAL_ITEM_TYPES.has(item.type))
      .map(item => `<option value="${esc(item.id)}">${esc(item.name)} (${esc(itemTypeLabel(item.type))})</option>`)
      .join("");
    const armorOptions = [...actor.items]
      .filter(item => item.type === "armor")
      .map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`)
      .join("");
    const projectOptions = (actor.system.crafting?.projects ?? [])
      .map(project => `<option value="${esc(project.id)}">${esc(project.name)} (${project.points}/${project.goal} ${esc(
        t(`CROWS.Expertise.${project.expertise}`)
      )})</option>`)
      .join("");
    const targetOptions = [...game.actors]
      .filter(other => other.type === "crow" && other.id !== actor.id && Number(other.system?.wounds) >= 2)
      .map(other => `<option value="${esc(other.id)}">${esc(other.name)} (${other.system.wounds})</option>`)
      .join("");
    const woundOptions = woundCandidatesFromLayout(layout)
      .map(index => `<label><input type="checkbox" name="woundChoice" value="${index}"> ${esc(
        t("CROWS.Dialog.Rest.woundSlot", { slot: index + 1 })
      )}</label>`)
      .join("");
    const sizeOptions = CROWS.sizes
      .map(size => `<option value="${esc(size)}">${esc(enumLabel("size", size))}</option>`)
      .join("");
    const prep = actor.system.preparedTask;
    const prepNote = prep?.task
      ? `<div class="rest-prep-note"><em>${esc(t("CROWS.Dialog.Rest.preparedNow", {
        task: prep.task, bonus: prep.bonus, setOn: prep.setOn
      }))}</em></div>`
      : "";

    const content = `<div class="crows rest-form">
      <p>${esc(t("CROWS.Dialog.Rest.intro"))}</p>
      ${prepNote}
      <div class="rest-opt"><label><input type="radio" name="activity" value="none" checked> <strong>${esc(t("CROWS.Dialog.Rest.none"))}</strong></label></div>
      <div class="rest-opt"><label><input type="radio" name="activity" value="tendWounds"> <strong>${esc(t("CROWS.Dialog.Rest.tendWounds"))}</strong></label>
        <div><label>${esc(t("CROWS.Dialog.Rest.target"))}: <select name="targetId">${targetOptions || `<option value="">${esc(t("CROWS.Dialog.Rest.noTargets"))}</option>`}</select></label></div>
      </div>
      <div class="rest-opt"><label><input type="radio" name="activity" value="identifyItem"> <strong>${esc(t("CROWS.Dialog.Rest.identifyItem"))}</strong></label>
        <div><label>${esc(t("CROWS.Dialog.Rest.item"))}: <select name="identifyItem">${itemOptions || `<option value="">${esc(t("CROWS.Dialog.Rest.noItems"))}</option>`}</select></label></div>
      </div>
      <div class="rest-opt"><label><input type="radio" name="activity" value="prepareForTask"> <strong>${esc(t("CROWS.Dialog.Rest.prepareForTask"))}</strong></label>
        <div><label>${esc(t("CROWS.Dialog.Rest.task"))}: <input type="text" name="preparedTask" placeholder="${esc(t("CROWS.Dialog.Rest.taskPlaceholder"))}" style="width:100%"></label></div>
      </div>
      <div class="rest-opt"><label><input type="radio" name="activity" value="craftEquipment"> <strong>${esc(t("CROWS.Dialog.Rest.craftEquipment"))}</strong></label>
        <div><label>${esc(t("CROWS.Dialog.Rest.project"))}: <select name="craftProjectId"><option value="">${esc(t("CROWS.Dialog.Rest.noProject"))}</option>${projectOptions}</select></label></div>
        <div><label>${esc(t("CROWS.Dialog.Rest.adHocProject"))}: <input type="text" name="craftProject" style="width:100%"></label></div>
      </div>
      <div class="rest-opt"><label><input type="radio" name="activity" value="harvest"> <strong>${esc(t("CROWS.Dialog.Rest.harvest"))}</strong></label>
        <div><label>${esc(t("CROWS.Dialog.Rest.target"))}: <input type="text" name="harvestTarget" style="width:100%"></label></div>
        <div><label>${esc(t("CROWS.Dialog.Rest.size"))}: <select name="harvestSize">${sizeOptions}</select></label></div>
      </div>
      <div class="rest-opt"><label><input type="radio" name="activity" value="repairArmor"> <strong>${esc(t("CROWS.Dialog.Rest.repairArmor"))}</strong></label>
        <div><label>${esc(t("CROWS.Dialog.Rest.armor"))}: <select name="repairArmorId">${armorOptions || `<option value="">${esc(t("CROWS.Dialog.Rest.noArmor"))}</option>`}</select></label></div>
      </div>
      <div class="rest-opt"><label><input type="radio" name="activity" value="secludeCamp"> <strong>${esc(t("CROWS.Dialog.Rest.secludeCamp"))}</strong></label></div>
      <hr>
      <div><strong>${esc(t("CROWS.Dialog.Rest.healWound"))}</strong> ${woundOptions || `<em>${esc(t("CROWS.Dialog.Rest.noWounds"))}</em>`}</div>
      <div><label><input type="checkbox" name="inTown"> <strong>${esc(t("CROWS.Dialog.Rest.inTown"))}</strong></label></div>
    </div>`;

    try {
      const choice = await DialogV2.prompt({
        window: { title: t("CROWS.Dialog.Rest.title", { actor: actor.name }) },
        content,
        ok: {
          label: t("CROWS.Dialog.Rest.confirm"),
          callback: (dialogEvent, button, dialog) => {
            const root = dialog.element ?? button?.form;
            const activity = root?.querySelector?.('input[name="activity"]:checked')?.value ?? "none";
            const activityData = {};
            if (activity === "identifyItem") {
              const itemId = root?.querySelector?.('select[name="identifyItem"]')?.value;
              if (itemId) {
                activityData.itemId = itemId;
                activityData.itemName = actor.items.get(itemId)?.name ?? "";
              }
            } else if (activity === "prepareForTask") {
              activityData.task = root?.querySelector?.('input[name="preparedTask"]')?.value ?? "";
            } else if (activity === "craftEquipment") {
              activityData.projectId = root?.querySelector?.('select[name="craftProjectId"]')?.value ?? "";
              activityData.project = root?.querySelector?.('input[name="craftProject"]')?.value ?? "";
            } else if (activity === "harvest") {
              activityData.target = root?.querySelector?.('input[name="harvestTarget"]')?.value ?? "";
              activityData.size = root?.querySelector?.('select[name="harvestSize"]')?.value ?? "";
            } else if (activity === "repairArmor") {
              activityData.itemId = root?.querySelector?.('select[name="repairArmorId"]')?.value ?? "";
            }
            return {
              activity,
              activityData,
              inTown: Boolean(root?.querySelector?.('input[name="inTown"]')?.checked),
              targetId: root?.querySelector?.('select[name="targetId"]')?.value ?? "",
              woundChoices: [...(root?.querySelectorAll?.('input[name="woundChoice"]:checked') ?? [])]
                .map(input => Number(input.value))
            };
          }
        }
      });
      if (!choice) return;
      await takeRest(actor, {
        activity: choice.activity,
        activityData: choice.activityData,
        target: choice.targetId ? game.actors.get(choice.targetId) : null,
        inTown: choice.inTown,
        woundChoices: choice.woundChoices
      });
      this.render();
    } catch { /* dismissed */ }
  }

  static async _onEndDT() {
    if (!game.user.isGM) {
      notify("warn", "CROWS.Sheet.Crow.notice.gmOnly");
      return;
    }
    await endDungeonTurn();
    this.render();
  }

  static async _onEncounterCheck() {
    if (!game.user.isGM) {
      notify("warn", "CROWS.Sheet.Crow.notice.gmOnly");
      return;
    }
    await rollEncounterCheck({ label: t("CROWS.Sheet.Crow.encounterAdHoc") });
  }

  static async _onSelectTree(event, target) {
    this._selectedTree = target.dataset.tree;
    this.render();
  }

  static async _onBuyTrait(event, target) {
    const treeMap = await CrowSheet.getTreeMap();
    if (!treeMap) {
      notify("warn", "CROWS.Dialog.Trait.packUnavailable");
      return;
    }
    const trait = (treeMap[this._selectedTree] ?? []).find(entry => entry.id === target.dataset.traitId);
    if (!trait) {
      notify("warn", "CROWS.Dialog.Trait.notFound");
      return;
    }
    await purchaseTrait(this.document, trait);
    this.render();
  }

  static async _onGrantXp(event, target) {
    if (!game.user.isGM) {
      notify("warn", "CROWS.Sheet.Crow.notice.gmOnly");
      return;
    }
    await gainXP(this.document, Number(target.dataset.amount) || 0);
    this.render();
  }

  static async _onAttackWithWeapon(event, target) {
    event?.stopPropagation?.();
    const weapon = this.document.items.get(target.dataset.itemId);
    if (!weapon) {
      notify("warn", "CROWS.Sheet.Crow.notice.weaponMissing");
      return;
    }
    await attackWithWeapon(this.document, weapon);
  }

  static async _onSpendExpertiseBonus() {
    const actor = this.document;
    const view = advancementOptions(actor);
    if (!view.window.open) {
      notify("warn", "CROWS.Dialog.Advancement.windowClosed");
      return;
    }
    const allocations = view.expertises.filter(entry => entry.room > 0).map(entry => `
      <label>${esc(t(entry.labelKey))}
        <input type="number" data-expertise="${esc(entry.key)}" value="0" min="0" max="${entry.room}" step="1">
        <em>${esc(t("CROWS.Dialog.Advancement.room", { room: entry.room, cap: view.cap }))}</em>
      </label>`).join("");
    const content = `<div class="crows adv-spend-form">
      <p>${esc(t("CROWS.Dialog.Advancement.chooseOption"))}</p>
      <div class="adv-opt"><label><input type="radio" name="option" value="uses" checked> <strong>${esc(t(
        "CROWS.Dialog.Advancement.optionUses", { uses: CROWS.expertiseUsesPerBonus }
      ))}</strong></label></div>
      <div class="adv-opt"><label><input type="radio" name="option" value="stamina"> <strong>${esc(t(
        "CROWS.Dialog.Advancement.optionStamina"
      ))}</strong></label></div>
      <div class="adv-opt"><label><input type="radio" name="option" value="useAndStamina"> <strong>${esc(t(
        "CROWS.Dialog.Advancement.optionSplit"
      ))}</strong></label></div>
      <div class="ci-row">${allocations || `<em>${esc(t("CROWS.Dialog.Advancement.noRoom"))}</em>`}</div>
    </div>`;
    try {
      const choice = await DialogV2.prompt({
        window: { title: t("CROWS.Dialog.Advancement.title", { actor: actor.name }) },
        content,
        ok: {
          label: t("CROWS.Dialog.Advancement.confirm"),
          callback: (event, button, dialog) => {
            const root = dialog.element ?? button?.form;
            const option = root?.querySelector?.('input[name="option"]:checked')?.value;
            const distribution = {};
            for (const input of root?.querySelectorAll?.("input[data-expertise]") ?? []) {
              const amount = Number(input.value);
              if (Number.isInteger(amount) && amount > 0) distribution[input.dataset.expertise] = amount;
            }
            return { option, distribution };
          }
        }
      });
      if (!choice) return;
      await spendExpertiseBonus(actor, choice.option, { distribution: choice.distribution });
      this.render();
    } catch { /* dismissed */ }
  }

  static async _onSpendCharBonus() {
    const actor = this.document;
    const view = advancementOptions(actor);
    if (!view.window.open) {
      notify("warn", "CROWS.Dialog.Advancement.windowClosed");
      return;
    }
    if (view.charAdvancementConverts) {
      await spendCharBonus(actor);
      this.render();
      return;
    }
    const content = `<div class="crows adv-spend-form">
      <p>${esc(t("CROWS.Dialog.Advancement.chooseCharacteristic", { cap: view.charCap }))}</p>
      <div>${view.characteristics.map(entry => esc(t("CROWS.Dialog.Advancement.characteristicValue", {
        characteristic: t(`CROWS.Characteristic.${entry.key}`), value: entry.value
      }))).join(" · ")}</div>
    </div>`;
    try {
      const choice = await DialogV2.prompt({
        window: { title: t("CROWS.Dialog.Advancement.characteristicTitle", { actor: actor.name }) },
        content,
        buttons: view.characteristics.map(entry => ({
          action: entry.key,
          label: t("CROWS.Dialog.Advancement.raiseCharacteristic", {
            characteristic: t(`CROWS.Characteristic.${entry.key}`)
          }),
          callback: () => entry.key,
          disabled: entry.atCap
        }))
      });
      if (!choice) return;
      await spendCharBonus(actor, choice);
      this.render();
    } catch { /* dismissed */ }
  }

  static async _onToggleMiasma() {
    if (!game.user.isGM) {
      notify("warn", "CROWS.Sheet.Crow.notice.gmOnly");
      return;
    }
    const current = getInMiasma();
    await setInMiasma(!current);
    for (const app of Object.values(ui.windows)) {
      if (app?.constructor?.name === "CrowSheet") app.render();
    }
    await ChatMessage.create({
      content: `<div class="crows miasma-toggle"><strong>${esc(t("CROWS.Sheet.Crow.miasma.title"))}:</strong> ${esc(t(
        current ? "CROWS.Sheet.Crow.miasmaCleared" : "CROWS.Sheet.Crow.miasmaEntered"
      ))}</div>`,
      speaker: { alias: t("CROWS.Sheet.Crow.environment") }
    });
  }

  /**
   * Remove a card from the sheet.
   *
   * Confirms first, because Foundry has no undo for an embedded document and a
   * card can be a 10,000gc magic item. The dialog names the item so a misclick
   * on a dense card grid is obvious before it is irreversible.
   */
  static async _onRemoveItem(event, target) {
    const itemId = target?.dataset?.itemId;
    const item = this.document.items.get(itemId);
    if (!item) return;
    if (!this.document.isOwner) {
      notify("warn", "CROWS.Dialog.InventoryDrop.not-owner", { item: item.name });
      return;
    }
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: t("CROWS.Dialog.RemoveItem.title") },
      content: `<p>${t("CROWS.Dialog.RemoveItem.body", { item: item.name })}</p>`,
      rejectClose: false,
      modal: true
    });
    if (!confirmed) return;
    await item.delete();
    this.render();
  }

  static async _onRollMiasmaResist() {
    await rollMiasmaResist(this.document);
    this.render();
  }

  static async _onClearMiasmaSelf() {
    await clearMiasma(this.document);
    this.render();
  }

  static async _onTamePet(event, target) {
    event?.stopPropagation?.();
    if (this.document.isOwner !== true) return;
    const animal = findActorByPetKey(target?.dataset?.petId ?? target?.dataset?.petUuid);
    if (!animal) {
      notify("warn", petViewReasonKey("invalid-animal-uuid"));
      return;
    }

    let confirmed;
    try {
      confirmed = await DialogV2.prompt({
        window: { title: t("CROWS.Sheet.Crow.pets.tameTitle", { animal: animal.name }) },
        content: `<div class="crows pet-tame-form"><p>${esc(t(
          "CROWS.Sheet.Crow.pets.tameAssertion", { animal: animal.name }
        ))}</p></div>`,
        ok: {
          label: t("CROWS.Sheet.Crow.pets.tameConfirm"),
          callback: () => true
        }
      });
    } catch {
      return;
    }
    if (!confirmed) return;

    const result = await rollTamingTest(animal, this.document, {
      friendly: true,
      flavor: t("CROWS.Sheet.Crow.pets.tameFlavor", { animal: animal.name })
    });
    petFailureNotification(result);
    this.render();
  }

  static async _runPetCommand(target, needsTest) {
    if (this.document.isOwner !== true) return;
    const animal = findActorByPetKey(target?.dataset?.petId ?? target?.dataset?.petUuid);
    if (!animal) {
      notify("warn", petViewReasonKey("invalid-animal-uuid"));
      return;
    }
    const result = await rollPetCommandTest(animal, this.document, {
      needsTest,
      flavor: t(needsTest
        ? "CROWS.Sheet.Crow.pets.commandTestFlavor"
        : "CROWS.Sheet.Crow.pets.commandFlavor", { animal: animal.name })
    });
    petFailureNotification(result);
    this.render();
  }

  static async _onCommandPet(event, target) {
    event?.stopPropagation?.();
    await this._runPetCommand(target, false);
  }

  static async _onTestCommandPet(event, target) {
    event?.stopPropagation?.();
    await this._runPetCommand(target, true);
  }

  static async _onCryptPray() {
    const interments = listInterments();
    if (!interments.length) {
      notify("warn", "CROWS.Dialog.Crypt.noInterments");
      return;
    }
    const options = interments.map(entry => `<option value="${esc(entry.crowName)}">${esc(entry.crowName)} — ${esc(entry.boonId)}</option>`).join("");
    try {
      const choice = await DialogV2.prompt({
        window: { title: t("CROWS.Dialog.Crypt.prayTitle", { actor: this.document.name }) },
        content: `<div class="crows crypt-form"><label>${esc(t("CROWS.Dialog.Crypt.grave"))}: <select name="grave">${options}</select></label></div>`,
        ok: {
          label: t("CROWS.Dialog.Crypt.pray"),
          callback: (event, button, dialog) => (dialog.element ?? button?.form)?.querySelector?.('select[name="grave"]')?.value
        }
      });
      if (!choice) return;
      await pray(this.document, choice);
      this.render();
    } catch { /* dismissed */ }
  }

  static async _onCryptExpend() {
    await expendBoon(this.document);
    this.render();
  }

  static async _onCryptInter() {
    if (!game.user.isGM) {
      notify("warn", "CROWS.Sheet.Crow.notice.gmOnly");
      return;
    }
    const options = Object.values(CRYPT_BOONS)
      .map(boon => `<option value="${esc(boon.id)}">${esc(boon.label)}</option>`).join("");
    try {
      const choice = await DialogV2.prompt({
        window: { title: t("CROWS.Dialog.Crypt.interTitle", { actor: this.document.name }) },
        content: `<div class="crows crypt-form"><p>${esc(t("CROWS.Dialog.Crypt.chooseBoon"))}</p><label>${esc(t(
          "CROWS.Dialog.Crypt.boon"
        ))}: <select name="boonId">${options}</select></label></div>`,
        ok: {
          label: t("CROWS.Dialog.Crypt.inter"),
          callback: (event, button, dialog) => (dialog.element ?? button?.form)?.querySelector?.('select[name="boonId"]')?.value
        }
      });
      if (!choice) return;
      await inter({ crowName: this.document.name, boonId: choice, interredBy: game.user.name });
      await this.document.update({ "system.cryptBoon": choice });
      this.render();
    } catch { /* dismissed */ }
  }

  static async _onCryptBumpCycle() {
    if (!game.user.isGM) {
      notify("warn", "CROWS.Sheet.Crow.notice.gmOnly");
      return;
    }
    await bumpCycle();
    for (const app of Object.values(ui.windows)) {
      if (app?.constructor?.name === "CrowSheet") app.render();
    }
  }

  static async _onOpenVillage() {
    const isGM = Boolean(game.user.isGM);
    const village = getVillage();
    const rows = village.institutions.map(institution => `<tr>
      <td>${esc(institution.name)} <em>(${esc(t(`CROWS.Dialog.Village.institutionType.${institution.type}`))})</em></td>
      <td style="text-align:center">${institution.level}</td>
      <td>${institution.steward ? esc(institution.steward) : "—"}</td>
      <td>${isGM ? `<button type="button" data-village-upgrade="${esc(institution.id)}" ${institution.level >= 5 ? "disabled" : ""}>${esc(t(
        "CROWS.Dialog.Village.levelUp"
      ))}</button><button type="button" data-village-damage="${esc(institution.id)}">${esc(t(
        "CROWS.Dialog.Village.levelDown"
      ))}</button>` : ""}</td>
    </tr>`).join("");
    const typeOptions = Object.keys(INSTITUTION_TYPES)
      .map(key => `<option value="${esc(key)}">${esc(t(`CROWS.Dialog.Village.institutionType.${key}`))}</option>`).join("");
    const content = `<div class="crows village-dialog">
      <header><strong>${esc(village.name)}</strong> · ${esc(t("CROWS.Dialog.Village.prosperity"))} <strong>${village.prosperity}</strong> · ${esc(t(
        "CROWS.Dialog.Village.cycle"
      ))} <strong>${village.cycle}</strong></header>
      <table class="village-inst-table"><thead><tr><th>${esc(t("CROWS.Dialog.Village.institution"))}</th><th>${esc(t(
        "CROWS.Dialog.Village.level"
      ))}</th><th>${esc(t("CROWS.Dialog.Village.steward"))}</th><th>${isGM ? esc(t("CROWS.Dialog.Village.gm")) : ""}</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="4"><em>${esc(t("CROWS.Dialog.Village.none"))}</em></td></tr>`}</tbody></table>
      ${isGM ? `<div class="village-found-form"><strong>${esc(t("CROWS.Dialog.Village.found"))}</strong>
        <select name="newType">${typeOptions}</select><input type="text" name="newName" placeholder="${esc(t("CROWS.Dialog.Village.optionalName"))}">
        <input type="text" name="newSteward" placeholder="${esc(t("CROWS.Dialog.Village.steward"))}">
        <button type="button" data-village-found="1">${esc(t("CROWS.Dialog.Village.foundConfirm"))}</button></div>
        <div class="village-prosp-form"><strong>${esc(t("CROWS.Dialog.Village.prosperity"))}</strong><input type="number" name="prosperity" value="${village.prosperity}" min="-10" max="10" step="1"><button type="button" data-village-prosperity="1">${esc(t("CROWS.Dialog.Village.set"))}</button></div>
        <div class="village-name-form"><strong>${esc(t("CROWS.Dialog.Village.name"))}</strong><input type="text" name="villageName" value="${esc(village.name)}"><button type="button" data-village-name="1">${esc(t("CROWS.Dialog.Village.rename"))}</button></div>
        <div class="village-cycle-form"><button type="button" data-village-end-cycle="1">${esc(t("CROWS.Dialog.Village.endCycle"))}</button><button type="button" data-village-event="1">${esc(t("CROWS.Dialog.Village.rollEvent"))}</button></div>` : ""}
    </div>`;
    const dialog = new DialogV2({
      window: { title: t("CROWS.Dialog.Village.title", { village: village.name }), resizable: true },
      content,
      buttons: [{ action: "close", label: t("CROWS.Dialog.close"), default: true, callback: () => null }],
      submit: () => null
    });
    await dialog.render({ force: true });
    const root = dialog.element;
    if (!root) return;
    const reopen = async () => { await dialog.close(); CrowSheet._onOpenVillage.call(this); };
    root.querySelector?.('[data-village-found="1"]')?.addEventListener("click", async () => {
      await foundInstitution({
        type: root.querySelector('select[name="newType"]')?.value,
        name: root.querySelector('input[name="newName"]')?.value?.trim() || null,
        steward: root.querySelector('input[name="newSteward"]')?.value?.trim() || ""
      });
      await reopen();
    });
    root.querySelector?.('[data-village-prosperity="1"]')?.addEventListener("click", async () => {
      await setProsperity(Number(root.querySelector('input[name="prosperity"]')?.value ?? 0));
      await reopen();
    });
    root.querySelector?.('[data-village-name="1"]')?.addEventListener("click", async () => {
      const name = String(root.querySelector('input[name="villageName"]')?.value ?? "").trim();
      if (!name) return;
      await setVillage({ name });
      await reopen();
    });
    root.querySelector?.('[data-village-end-cycle="1"]')?.addEventListener("click", async () => {
      await endCycle();
      await reopen();
    });
    root.querySelector?.('[data-village-event="1"]')?.addEventListener("click", () => rollVillageEvent());
    root.querySelectorAll?.("[data-village-upgrade]").forEach(button => button.addEventListener("click", async event => {
      await upgradeInstitution(event.currentTarget.dataset.villageUpgrade);
      await reopen();
    }));
    root.querySelectorAll?.("[data-village-damage]").forEach(button => button.addEventListener("click", async event => {
      await damageInstitution(event.currentTarget.dataset.villageDamage);
      await reopen();
    }));
  }

  static async _onCraftStart() {
    const actor = this.document;
    const options = CRAFTING_EXPERTISES.map(key => `<option value="${esc(key)}">${esc(t(`CROWS.Expertise.${key}`))} (${actor.system.expertises?.[key]?.max ?? 0})</option>`).join("");
    const content = `<div class="crows craft-start-form">
      <label>${esc(t("CROWS.Dialog.Crafting.itemName"))}: <input type="text" name="name" style="width:100%"></label>
      <label>${esc(t("CROWS.Dialog.Crafting.expertise"))}: <select name="expertise">${options}</select></label>
      <label>${esc(t("CROWS.Dialog.Crafting.requiredUses"))}: <input type="number" name="uses" value="1" min="1" max="4" step="1"></label>
      <label>${esc(t("CROWS.Dialog.Crafting.goal"))}: <input type="number" name="goal" value="100" min="1" step="10"></label>
      <label>${esc(t("CROWS.Dialog.Crafting.materials"))}: <input type="text" name="materials" style="width:100%"></label>
      <label>${esc(t("CROWS.Dialog.Crafting.notes"))}: <input type="text" name="notes" style="width:100%"></label>
    </div>`;
    try {
      const choice = await DialogV2.prompt({
        window: { title: t("CROWS.Dialog.Crafting.startTitle", { actor: actor.name }) },
        content,
        ok: {
          label: t("CROWS.Dialog.Crafting.start"),
          callback: (event, button, dialog) => {
            const root = dialog.element ?? button?.form;
            return {
              name: root?.querySelector?.('input[name="name"]')?.value?.trim(),
              expertise: root?.querySelector?.('select[name="expertise"]')?.value,
              uses: Number(root?.querySelector?.('input[name="uses"]')?.value ?? 1),
              goal: Number(root?.querySelector?.('input[name="goal"]')?.value ?? 100),
              materials: String(root?.querySelector?.('input[name="materials"]')?.value ?? "")
                .split(",").map(value => value.trim()).filter(Boolean),
              notes: root?.querySelector?.('input[name="notes"]')?.value ?? ""
            };
          }
        }
      });
      if (!choice?.name) return;
      await startCraftingProject(actor, choice);
      this.render();
    } catch { /* dismissed */ }
  }

  static async _onCraftRoll(event, target) {
    const projectId = target.dataset.projectId;
    if (!projectId) return;
    const available = ALL_EXPERTISES.filter(key => Number(this.document.system.expertises?.[key]?.value) > 0);
    const content = `<div class="crows craft-start-form"><p>${esc(t("CROWS.Dialog.Crafting.chooseUpToTwo"))}</p>${available.map(key => `
      <label><input type="checkbox" name="expertise" value="${esc(key)}"> ${esc(t(`CROWS.Expertise.${key}`))} (${this.document.system.expertises[key].value})</label>`).join("") || `<em>${esc(t("CROWS.Dialog.Crafting.noneAvailable"))}</em>`}</div>`;
    try {
      const expertises = await DialogV2.prompt({
        window: { title: t("CROWS.Dialog.Crafting.rollTitle") },
        content,
        ok: {
          label: t("CROWS.Dialog.Crafting.roll"),
          callback: (dialogEvent, button, dialog) => [...((dialog.element ?? button?.form)?.querySelectorAll?.('input[name="expertise"]:checked') ?? [])]
            .slice(0, 2).map(input => input.value)
        }
      });
      if (!expertises) return;
      await makeCraftingRoll(this.document, projectId, { expertises });
      this.render();
    } catch { /* dismissed */ }
  }

  static async _onCraftCancel(event, target) {
    if (!target.dataset.projectId) return;
    await cancelProject(this.document, target.dataset.projectId);
    this.render();
  }

  static async _onCraftComplete(event, target) {
    if (!target.dataset.projectId) return;
    await completeProject(this.document, target.dataset.projectId);
    this.render();
  }

  static async _onIdentifyItem(event, target) {
    await identifyMagicItem(this.document, { itemId: target.dataset.itemId });
    this.render();
  }

  static async _onOpenCreator() {
    await openCharacterCreator(this.document);
    this.render();
  }
}
