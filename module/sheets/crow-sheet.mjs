const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
import { CROWS } from "../config.mjs";
import { rollTest } from "../helpers/roll.mjs";

const SPELL_SKILLS = new Set(["alteration","benefaction","conjuration","elemental","illusion","necromancy"]);
const WEAPON_SKILLS = new Set(["bashing","bow","chopping","slashing","stabbing","unarmed"]);

const SKILL_LABELS = {
  alchemy: "Alchemy", blacksmithing: "Blacksmithing", climb: "Climb", enchanting: "Enchanting",
  endurance: "Endurance", gymnastics: "Gymnastics", handleAnimal: "Handle Animals", hide: "Hide",
  historicalLore: "Historical Lore", jump: "Jump", lift: "Lift", magicLore: "Magic Lore",
  monsterLore: "Monster Lore", natureLore: "Nature Lore", navigate: "Navigate", pickLock: "Pick Lock",
  religiousLore: "Religious Lore", sabotage: "Sabotage", search: "Search", sleightOfHand: "Sleight of Hand",
  sneak: "Sneak", swim: "Swim",
  alteration: "Alteration", benefaction: "Benefaction", conjuration: "Conjuration",
  elemental: "Elemental", illusion: "Illusion", necromancy: "Necromancy",
  bashing: "Bashing", bow: "Bow", chopping: "Chopping", slashing: "Slashing",
  stabbing: "Stabbing", unarmed: "Unarmed"
};

const NAMED_SLOTS = [
  { id: "leftHand", label: "Left Hand", container: "hand", index: 0, hint: "equipped" },
  { id: "rightHand", label: "Right Hand", container: "hand", index: 1, hint: "equipped" },
  { id: "head", label: "Head", container: "head", index: 0, hint: "circlets, crowns, & hats" },
  { id: "neck", label: "Neck", container: "neck", index: 0, hint: "amulets, cloaks, & necklaces" },
  { id: "waist", label: "Waist", container: "waist", index: 0, hint: "belts & girdles" },
  { id: "beltLeft", label: "Belt Left", container: "belt", index: 0, hint: "belt slot" },
  { id: "beltRight", label: "Belt Right", container: "belt", index: 1, hint: "belt slot" },
  { id: "arms", label: "Arms", container: "arms", index: 0, hint: "bracers & gloves" },
  { id: "finger", label: "Finger", container: "finger", index: 0, hint: "rings" },
  { id: "feet", label: "Feet", container: "feet", index: 0, hint: "boots & shoes" }
];

function skillChar(key) {
  if (WEAPON_SKILLS.has(key)) return "strength";
  if (SPELL_SKILLS.has(key)) return "mind";
  return "agility";
}

/** Compact one-line summary of an item for slot-card rendering. */
function summarizeItem(it) {
  const s = it.system ?? {};
  switch (it.type) {
    case "weapon": {
      const r = s.range ?? {};
      const range = r.melee && r.ranged ? `Melee ${r.melee} / Ranged ${r.ranged}`
        : r.ranged ? `Ranged ${r.ranged}` : `Melee ${r.melee ?? 1}`;
      const dmg = `${s.damage?.t2 ?? "?"} / ${s.damage?.t3 ?? "?"}`;
      const qual = (s.qualities ?? []).join(", ");
      return { lines: [range, `2d10 + ${s.attackStat === "either" ? "A or S" : s.attackStat?.[0]?.toUpperCase() ?? "?"}`, `12-16: ${s.damage?.t2 ?? ""} · 17+: ${s.damage?.t3 ?? ""}`, qual].filter(Boolean) };
    }
    case "armor":
      return { lines: [`Armor (${s.armorType})`, `AD ${s.ad}`] };
    case "ammunition":
      return { lines: [`Ammo for ${s.ammoFor || "weapons"}`, `${s.countPerUnit ?? 0}/unit`] };
    case "consumable": {
      const lines = [`${s.useAction ?? "action"}`];
      if (s.bands?.t2 || s.bands?.t3) lines.push(`12-16: ${s.bands?.t2 || "-"} · 17+: ${s.bands?.t3 || "-"}`);
      if (s.duration) lines.push(`Duration: ${s.duration}`);
      return { lines };
    }
    case "spellbook": {
      const r = s.range ?? {};
      const range = r.kind === "self" ? "Self" : r.kind === "melee" ? `Melee ${r.value}` : `Ranged ${r.value}`;
      const lines = [`${s.discipline} R${s.rank}`, `${s.castType} · ${range}`];
      if (s.effectBands?.t2 || s.effectBands?.t3) lines.push(`12-16: ${s.effectBands?.t2 || "-"} · 17+: ${s.effectBands?.t3 || "-"}`);
      return { lines };
    }
    case "gear": {
      const lines = [s.subtype || "gear"];
      if (s.light?.enabled) lines.push(`Light ${s.light.bright}/${s.light.dim}`);
      if (s.usageDie?.enabled) lines.push(`UD ${s.usageDie.udCurrent}/${s.usageDie.udMax} (${s.usageDie.expiry})`);
      return { lines };
    }
    default:
      return { lines: [it.type] };
  }
}

function slotCard(it) {
  if (!it) return null;
  const s = it.system ?? {};
  return {
    id: it.id,
    name: it.name,
    type: it.type,
    stack: s.stackMax > 1 ? `${s.quantity ?? 1}/${s.stackMax}` : null,
    summary: summarizeItem(it),
    cost: s.cost ?? null,
    description: s.description ?? ""
  };
}

export class CrowSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["crows","sheet","crow"],
    position: { width: 980, height: 820 },
    actions: {
      switchTab: CrowSheet._onTab,
      rollSkill: CrowSheet._onRollSkill,
      rollChar: CrowSheet._onRollChar,
      adjBlessed: CrowSheet._onAdjBlessed,
      adjBoned: CrowSheet._onAdjBoned,
      adjWounds: CrowSheet._onAdjWounds,
      toggleSkillBonus: CrowSheet._onToggleSkillBonus,
      openItem: CrowSheet._onOpenItem,
      takeRest: CrowSheet._onTakeRest,
      endDt: CrowSheet._onEndDT,
      encounterCheck: CrowSheet._onEncounterCheck,
      selectTree: CrowSheet._onSelectTree,
      buyTrait: CrowSheet._onBuyTrait,
      grantXp: CrowSheet._onGrantXp,
      attackWithWeapon: CrowSheet._onAttackWithWeapon,
      spendSkillBonus: CrowSheet._onSpendSkillBonus,
      spendCharBonus: CrowSheet._onSpendCharBonus
    },
    window: { resizable: true },
    form: { submitOnChange: true }
  };

  static PARTS = { body: { template: "systems/crows/templates/actor/crow/sheet.hbs" } };

  _activeTab = "main";
  _selectedTree = "alchemy";

  /**
   * Compendium-backed trait tree map cache. Loaded once per session by the
   * first sheet that opens the Advancement tab; keyed by class so all
   * crow sheets share it.
   */
  static _treeMap = null;
  static async getTreeMap() {
    if (CrowSheet._treeMap) return CrowSheet._treeMap;
    const pack = game.packs.get("crows.crows-traits");
    if (!pack) return null;
    const docs = await pack.getDocuments();
    const map = {};
    for (const d of docs) {
      const tree = d.system?.tree;
      if (!tree) continue;
      (map[tree] ??= []).push(d);
    }
    CrowSheet._treeMap = map;
    return map;
  }

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    const sys = this.document.system;
    ctx.system = sys; ctx.actor = this.document; ctx.CROWS = CROWS;
    ctx.activeTab = this._activeTab;
    ctx.tabs = [
      { id: "main", label: "Main" },
      { id: "equipment", label: "Equipment" },
      { id: "inventory", label: "Inventory" },
      { id: "advancement", label: "Advancement" },
      { id: "bio", label: "Bio" }
    ];

    // Skills grouped into General / Spellcasting / Weapon. Each row carries the
    // current bonus value (0/1/2) so the template can render two checkboxes
    // (+1 / +2) bound by data-action="toggleSkillBonus".
    ctx.skillGroups = {
      general: [], spellcasting: [], weapon: []
    };
    for (const key of CROWS.skills) {
      const bonus = sys.skills?.[key]?.bonus ?? 0;
      const row = { key, label: SKILL_LABELS[key] ?? key, bonus, char: skillChar(key) };
      if (WEAPON_SKILLS.has(key)) ctx.skillGroups.weapon.push(row);
      else if (SPELL_SKILLS.has(key)) ctx.skillGroups.spellcasting.push(row);
      else ctx.skillGroups.general.push(row);
    }

    // Conditions: net (blessed - boned), plus the binary condition flags.
    const cn = sys.conditions ?? {};
    ctx.condNet = (cn.blessed ?? 0) - (cn.boned ?? 0);
    ctx.condFlags = {
      grabbed: !!cn.grabbed,
      prone: !!cn.prone,
      unconscious: !!cn.unconscious
    };

    // Next-advancement TXP threshold (M3 will add the proper table; placeholder).
    const txp = sys.xp?.txp ?? 0;
    ctx.nextAdvancement = txp < 100 ? 100 : txp < 500 ? 500 : txp < 1250 ? 1250
      : txp < 2250 ? 2250 : txp < 3500 ? 3500 : txp < 5000 ? 5000
      : (Math.ceil(txp / 5000) * 5000) + 5000;

    // Equipment grid (10 named slots with item-card render).
    ctx.equipSlots = NAMED_SLOTS.map(slot => {
      const it = this.document.items.find(i =>
        i.system?.location?.container === slot.container &&
        (i.system?.location?.index ?? 0) === slot.index
      );
      return { ...slot, card: slotCard(it) };
    });

    // Backpack grid (10 slots). Wounds occupy slots from the bottom.
    const cap = CROWS.backpackSize;
    const wounds = sys.wounds ?? 0;
    const backpackItems = this.document.items.filter(i => i.system?.location?.container === "backpack");
    ctx.backpack = [];
    for (let i = 0; i < cap; i++) {
      const isWound = i >= (cap - wounds);
      const it = backpackItems.find(b => (b.system.location?.index ?? 0) === i);
      ctx.backpack.push({ index: i, isWound, card: slotCard(it) });
    }

    // Perks = owned trait items.
    ctx.perks = this.document.items.filter(i => i.type === "trait").map(t => ({
      id: t.id,
      name: t.name,
      tree: t.system?.tree ?? "",
      tier: t.system?.tier ?? 1,
      column: t.system?.column ?? 1,
      description: t.system?.description ?? ""
    }));

    // Derived shift (M1: always 1; M3 will let traits modify).
    ctx.shift = 1;

    // Time / DT counter + GM-only flag for the Time panel.
    try {
      ctx.dtCount = game.crows?.dt?.get?.() ?? 0;
      ctx.dungeonEN = game.crows?.dt?.getDungeonEN?.() ?? 6;
    } catch { ctx.dtCount = 0; ctx.dungeonEN = 6; }
    ctx.isGM = !!game.user?.isGM;

    // Advancement tab data — only build when that tab is active to keep
    // the trait-pack load cost off the critical path.
    if (this._activeTab === "advancement") {
      try {
        const { bonusesEarned, nextBonusTXP, isTraitBuyable, bonusesAvailable } = await import("../helpers/advancement.mjs");
        const txp = sys.xp?.txp ?? 0;
        ctx.bonusesEarned = bonusesEarned(txp);
        ctx.nextBonusAt = nextBonusTXP(txp);
        ctx.bonusesAvailable = bonusesAvailable(this.document);

        const treeMap = await CrowSheet.getTreeMap();
        ctx.selectedTree = this._selectedTree;
        ctx.treeList = CROWS.traitTrees;
        if (treeMap && treeMap[this._selectedTree]) {
          // Build a 4x3 grid keyed by tier/column. Each cell carries
          // owned/buyable status + cost.
          const grid = Array.from({ length: 4 }, (_, tIdx) => ({
            tier: tIdx + 1,
            cost: CROWS.traitTierXP[tIdx + 1],
            cells: Array(3).fill(null)
          }));
          for (const trait of treeMap[this._selectedTree]) {
            const tier = trait.system?.tier ?? 1;
            const col = trait.system?.column ?? 1;
            if (tier < 1 || tier > 4 || col < 1 || col > 3) continue;
            const owned = this.document.items.some(i => i.type === "trait" && i.name === trait.name && i.system?.tree === trait.system.tree);
            const buyCheck = owned ? null : isTraitBuyable(this.document, trait);
            grid[tier - 1].cells[col - 1] = {
              id: trait.id,
              uuid: trait.uuid,
              name: trait.name,
              isStarting: !!trait.system.isStarting,
              cost: CROWS.traitTierXP[tier],
              owned,
              buyable: !!buyCheck?.ok,
              reason: buyCheck?.reason ?? (owned ? "owned" : "")
            };
          }
          ctx.treeGrid = grid;
        }
      } catch (e) {
        console.error("crows | advancement tab build failed", e);
      }
    }

    return ctx;
  }

  async _onDropItem(event, item) {
    if (item.type === "background") {
      const { applyBackground } = await import("../helpers/creation.mjs");
      await applyBackground(this.document, item);
      return false;
    }
    return super._onDropItem(event, item);
  }

  static _onTab(event, target) { this._activeTab = target.dataset.tab; this.render(); }

  static async _onRollSkill(event, target) {
    await rollTest({
      actor: this.document,
      characteristic: target.dataset.characteristic,
      skill: target.dataset.skill,
      flavor: `${SKILL_LABELS[target.dataset.skill] ?? target.dataset.skill} test`
    });
  }

  static async _onRollChar(event, target) {
    await rollTest({
      actor: this.document,
      characteristic: target.dataset.characteristic,
      flavor: `${target.dataset.characteristic} test`
    });
  }

  static async _onToggleSkillBonus(event, target) {
    const skill = target.dataset.skill;
    const level = Number(target.dataset.level); // 1 or 2
    const cur = this.document.system.skills?.[skill]?.bonus ?? 0;
    // Two-checkbox semantics: clicking +1 sets bonus=1 (or back to 0 if already 1);
    // clicking +2 sets bonus=2 (or back to 1 if already 2).
    let next;
    if (level === 1) next = cur === 1 ? 0 : 1;
    else next = cur === 2 ? 1 : 2;
    await this.document.update({ [`system.skills.${skill}.bonus`]: next });
  }

  static async _onAdjBlessed(event, target) {
    const d = Number(target.dataset.delta);
    await this.document.update({ "system.conditions.blessed": Math.max(0, (this.document.system.conditions.blessed ?? 0) + d) });
  }
  static async _onAdjBoned(event, target) {
    const d = Number(target.dataset.delta);
    await this.document.update({ "system.conditions.boned": Math.max(0, (this.document.system.conditions.boned ?? 0) + d) });
  }
  static async _onAdjWounds(event, target) {
    const d = Number(target.dataset.delta);
    const cap = CROWS.backpackSize;
    await this.document.update({ "system.wounds": Math.max(0, Math.min(cap, (this.document.system.wounds ?? 0) + d)) });
  }

  static async _onOpenItem(event, target) {
    const id = target.dataset.itemId;
    const it = this.document.items.get(id);
    if (it) it.sheet.render(true);
  }

  static async _onTakeRest(event, target) {
    const tendedBy = target?.dataset?.tend === "true";
    const inTown   = target?.dataset?.town === "true";
    const { takeRest } = await import("../helpers/rest.mjs");
    await takeRest(this.document, { tendedBy, inTown });
    this.render();
  }

  static async _onEndDT() {
    if (!game.user.isGM) { ui.notifications?.warn("End DT is GM-only."); return; }
    const { endDungeonTurn } = await import("../helpers/dungeon-turn.mjs");
    await endDungeonTurn();
    this.render();
  }

  static async _onEncounterCheck() {
    if (!game.user.isGM) { ui.notifications?.warn("Encounter check is GM-only."); return; }
    const { rollEncounterCheck } = await import("../helpers/dungeon-turn.mjs");
    await rollEncounterCheck({ label: "Ad-hoc" });
  }

  static async _onSelectTree(event, target) {
    this._selectedTree = target.dataset.tree;
    this.render();
  }

  static async _onBuyTrait(event, target) {
    const treeMap = await CrowSheet.getTreeMap();
    if (!treeMap) { ui.notifications?.warn("Traits compendium not available."); return; }
    const id = target.dataset.traitId;
    const trait = (treeMap[this._selectedTree] ?? []).find(t => t.id === id);
    if (!trait) { ui.notifications?.warn("Trait not found in compendium."); return; }
    const { purchaseTrait } = await import("../helpers/advancement.mjs");
    await purchaseTrait(this.document, trait);
    this.render();
  }

  static async _onGrantXp(event, target) {
    if (!game.user.isGM) { ui.notifications?.warn("Grant XP is GM-only."); return; }
    const amount = Number(target.dataset.amount) || 0;
    const { gainXP } = await import("../helpers/advancement.mjs");
    await gainXP(this.document, amount);
    this.render();
  }

  static async _onAttackWithWeapon(event, target) {
    event?.stopPropagation?.();
    const id = target.dataset.itemId;
    const wp = this.document.items.get(id);
    if (!wp) { ui.notifications?.warn("Weapon not found."); return; }
    const { attackWithWeapon } = await import("../helpers/attack.mjs");
    await attackWithWeapon(this.document, wp);
  }

  static async _onSpendSkillBonus() {
    const { spendSkillBonus } = await import("../helpers/advancement.mjs");
    const DialogV2 = foundry.applications.api.DialogV2;
    const actor = this.document;
    // Build skill <option> lists (skills not yet at +2)
    const eligible = (CROWS.skills ?? []).filter(k => (actor.system.skills?.[k]?.bonus ?? 0) < 2);
    const opts = eligible.map(k => `<option value="${k}">${k} (current +${actor.system.skills?.[k]?.bonus ?? 0})</option>`).join("");
    const content = `<div class="crows adv-spend-form">
      <p>Choose ONE of the three advancement options:</p>
      <div class="adv-opt"><label><input type="radio" name="opt" value="twoSkills" checked> <strong>Two skills +1</strong> (each capped at +2)</label>
        <div class="adv-skill-pair">
          <label>Skill A: <select name="skillA">${opts}</select></label>
          <label>Skill B: <select name="skillB">${opts}</select></label>
        </div>
      </div>
      <div class="adv-opt"><label><input type="radio" name="opt" value="stamina4"> <strong>Stamina max +4</strong></label></div>
      <div class="adv-opt"><label><input type="radio" name="opt" value="skillStam"> <strong>One skill +1 and Stamina max +2</strong></label>
        <div><label>Skill: <select name="skillC">${opts}</select></label></div>
      </div>
    </div>`;
    try {
      const choice = await DialogV2.prompt({
        window: { title: `${actor.name} — Spend Skill/Stamina Advancement` },
        content,
        ok: {
          label: "Spend",
          callback: (event, button, dialog) => {
            const root = dialog.element ?? button?.form;
            const opt = root?.querySelector?.('input[name="opt"]:checked')?.value;
            const skillA = root?.querySelector?.('select[name="skillA"]')?.value;
            const skillB = root?.querySelector?.('select[name="skillB"]')?.value;
            const skill  = root?.querySelector?.('select[name="skillC"]')?.value;
            return { opt, skillA, skillB, skill };
          }
        }
      });
      if (!choice) return;
      await spendSkillBonus(actor, choice.opt, { skillA: choice.skillA, skillB: choice.skillB, skill: choice.skill });
      this.render();
    } catch { /* dialog dismissed */ }
  }

  static async _onSpendCharBonus() {
    const { spendCharBonus } = await import("../helpers/advancement.mjs");
    const DialogV2 = foundry.applications.api.DialogV2;
    const actor = this.document;
    const c = actor.system.characteristics ?? {};
    const allMax = (c.agility?.value ?? 0) >= 3 && (c.mind?.value ?? 0) >= 3 && (c.strength?.value ?? 0) >= 3;
    if (allMax) {
      await spendCharBonus(actor);   // auto-converts to +4 stamina
      this.render();
      return;
    }
    const content = `<div class="crows adv-spend-form">
      <p>Choose a characteristic to raise by +1 (each capped at +3):</p>
      <div>Agility ${c.agility?.value ?? 0}, Mind ${c.mind?.value ?? 0}, Strength ${c.strength?.value ?? 0}</div>
    </div>`;
    try {
      const choice = await DialogV2.prompt({
        window: { title: `${actor.name} — Characteristic Advancement` },
        content,
        buttons: [
          { action: "agility",  label: "+1 Agility",  callback: () => "agility",  disabled: (c.agility?.value ?? 0) >= 3 },
          { action: "mind",     label: "+1 Mind",     callback: () => "mind",     disabled: (c.mind?.value ?? 0) >= 3 },
          { action: "strength", label: "+1 Strength", callback: () => "strength", disabled: (c.strength?.value ?? 0) >= 3 },
          { action: "cancel",   label: "Cancel",      callback: () => null, default: true }
        ]
      });
      if (!choice) return;
      await spendCharBonus(actor, choice);
      this.render();
    } catch { /* dialog dismissed */ }
  }
}
