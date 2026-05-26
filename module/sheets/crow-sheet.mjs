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
      openItem: CrowSheet._onOpenItem
    },
    window: { resizable: true },
    form: { submitOnChange: true }
  };

  static PARTS = { body: { template: "systems/crows/templates/actor/crow/sheet.hbs" } };

  _activeTab = "main";

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
}
