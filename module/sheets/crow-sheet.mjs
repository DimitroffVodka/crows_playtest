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
      spendCharBonus: CrowSheet._onSpendCharBonus,
      toggleMiasma: CrowSheet._onToggleMiasma,
      rollMiasmaResist: CrowSheet._onRollMiasmaResist,
      clearMiasmaSelf: CrowSheet._onClearMiasmaSelf,
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
      openCreator: CrowSheet._onOpenCreator
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
      { id: "downtime", label: "Downtime" },
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

    // Crafting projects (Cluster 12).
    ctx.craftingProjects = (sys.crafting?.projects ?? []).map(p => ({
      ...p, complete: (p.points ?? 0) >= (p.goal ?? 1), pct: Math.min(100, Math.round(((p.points ?? 0) / (p.goal || 1)) * 100))
    }));

    // Village shell (name/prosperity/cycle) for the Crypt panel header.
    try {
      const { getVillage } = await import("../helpers/village.mjs");
      const vil = getVillage();
      ctx.village = { name: vil.name, prosperity: vil.prosperity, cycle: vil.cycle, hasUpgraded: vil.hasUpgradedThisCycle };
    } catch { ctx.village = null; }

    // Crypt — active boon + crypt level + count of interments for UI gating.
    try {
      const { CRYPT_BOONS, getCryptLevel, listInterments, getCycleId } = await import("../helpers/crypt.mjs");
      ctx.cryptLevel = getCryptLevel();
      ctx.cryptCycle = getCycleId();
      ctx.cryptInterments = listInterments();
      const ab = sys.activeBoon;
      if (ab?.boonId && CRYPT_BOONS[ab.boonId]) {
        const b = CRYPT_BOONS[ab.boonId];
        ctx.activeBoonCard = {
          id: ab.boonId,
          label: b.label,
          source: ab.sourceCrowName,
          usesLeft: ab.usesLeft ?? 1,
          summary: b.summary(ctx.cryptLevel),
          text: b.text(ctx.cryptLevel)
        };
      } else {
        ctx.activeBoonCard = null;
      }
      ctx.alreadyPrayedThisCycle = (sys.activeBoon?.prayedOnCycle ?? -1) === ctx.cryptCycle;
    } catch {
      ctx.cryptLevel = 1; ctx.cryptInterments = []; ctx.activeBoonCard = null; ctx.alreadyPrayedThisCycle = false;
    }

    // Miasma — environment flag + active effects with humane labels.
    try {
      const { getInMiasma, MIASMA_EFFECTS } = await import("../helpers/miasma.mjs");
      ctx.inMiasma = getInMiasma();
      const eff = sys.miasma?.effects ?? [];
      ctx.miasmaEffects = eff.map(v => {
        const e = MIASMA_EFFECTS[Math.max(1, Math.min(12, v))];
        return { bucket: v, label: e?.label ?? `#${v}`, text: e?.text ?? "" };
      });
      ctx.miasmaPermanentNPC = !!sys.miasma?.permanentNPC;
    } catch { ctx.inMiasma = false; ctx.miasmaEffects = []; ctx.miasmaPermanentNPC = false; }

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
    // Rules p.1117: while in the Miasma, boned cannot decrease.
    if (d < 0) {
      const { getInMiasma } = await import("../helpers/miasma.mjs");
      if (getInMiasma() && !this.document.system?.miasma?.permanentNPC) {
        ui.notifications?.warn("Can't lose boned levels while in the Miasma.");
        return;
      }
    }
    const before = this.document.system.conditions.boned ?? 0;
    const after = Math.max(0, before + d);
    await this.document.update({ "system.conditions.boned": after });
    // If boned reached 0, wipe any violence-bucket Miasma effects.
    if (before > 0 && after === 0) {
      const { onBonedCleared } = await import("../helpers/miasma.mjs");
      await onBonedCleared(this.document);
    }
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
    // Legacy dataset path: direct "rest" calls (e.g. macros) can still bypass the dialog.
    if (target?.dataset?.tend === "true" || target?.dataset?.town === "true") {
      const tendedBy = target?.dataset?.tend === "true";
      const inTown   = target?.dataset?.town === "true";
      const { takeRest } = await import("../helpers/rest.mjs");
      await takeRest(this.document, { tendedBy, inTown });
      this.render();
      return;
    }

    // Dialog flow: pick activity (and any detail) + town toggle.
    const DialogV2 = foundry.applications.api.DialogV2;
    const actor = this.document;

    // Build skill options for Prepare for Task (all skills, current bonus shown).
    const skillOpts = (CROWS.skills ?? [])
      .map(k => `<option value="${k}">${(SKILL_LABELS[k] ?? k)} (current +${actor.system.skills?.[k]?.bonus ?? 0})</option>`)
      .join("");

    // Build item options for Identify Item (any inventory item — gear/consumable/weapon/armor/spellbook).
    const idOpts = actor.items
      .filter(i => ["gear","consumable","weapon","armor","spellbook","ammunition"].includes(i.type))
      .map(i => `<option value="${i.id}">${i.name} (${i.type})</option>`)
      .join("");

    const prep = actor.system?.preparedTask;
    const prepNote = (prep?.skill)
      ? `<div class="rest-prep-note"><em>Currently prepared: <strong>${prep.skill}</strong>${prep.detail ? ` — ${prep.detail}` : ""} (will be overwritten if you pick Prepare for Task again).</em></div>`
      : "";

    const content = `<div class="crows rest-form">
      <p>Pick one rest activity (or none) for this 6-hour rest.</p>
      ${prepNote}
      <div class="rest-opt"><label><input type="radio" name="act" value="none" checked> <strong>No activity</strong> — recover Stamina/wound only.</label></div>
      <div class="rest-opt"><label><input type="radio" name="act" value="tendWounds"> <strong>Tend Wounds</strong> — remove 2 wounds instead of 1.</label></div>
      <div class="rest-opt"><label><input type="radio" name="act" value="identifyItem"> <strong>Identify Item</strong></label>
        <div><label>Item: <select name="identifyItem">${idOpts || '<option value="">(no inventory items)</option>'}</select></label></div>
      </div>
      <div class="rest-opt"><label><input type="radio" name="act" value="prepareForTask"> <strong>Prepare for Task</strong> — +1 to next test of the chosen skill.</label>
        <div><label>Skill: <select name="prepSkill">${skillOpts}</select></label></div>
        <div><label>Task: <input type="text" name="prepDetail" placeholder="e.g. 'pick the vault lock'" style="width:100%"></label></div>
      </div>
      <div class="rest-opt"><label><input type="radio" name="act" value="craftEquipment"> <strong>Craft Equipment</strong></label>
        ${(actor.system?.crafting?.projects ?? []).length ? `
          <div><label>Active project: <select name="craftProjectId">
            <option value="">— (none / ad-hoc) —</option>
            ${(actor.system.crafting.projects ?? []).map(p => `<option value="${p.id}">${p.name} (${p.points}/${p.goal} ${p.skill})</option>`).join("")}
          </select></label></div>
        ` : `<div><em>No active projects. Start one on the Advancement tab to make this activity roll for crafting points.</em></div>`}
        <div><label>Or ad-hoc project name: <input type="text" name="craftProject" placeholder="e.g. 'spear haft'" style="width:100%"></label></div>
      </div>
      <div class="rest-opt"><label><input type="radio" name="act" value="harvest"> <strong>Harvest</strong></label>
        <div><label>Target: <input type="text" name="harvestTarget" placeholder="e.g. 'wolf hides'" style="width:100%"></label></div>
      </div>
      <hr>
      <div><label><input type="checkbox" name="inTown"> <strong>Town rest</strong> — skip encounter checks.</label></div>
    </div>`;

    try {
      const choice = await DialogV2.prompt({
        window: { title: `${actor.name} — Take Rest` },
        content,
        ok: {
          label: "Rest",
          callback: (event, button, dialog) => {
            const root = dialog.element ?? button?.form;
            const activity = root?.querySelector?.('input[name="act"]:checked')?.value ?? "none";
            const inTown   = !!root?.querySelector?.('input[name="inTown"]')?.checked;
            const activityData = {};
            if (activity === "identifyItem") {
              const id = root?.querySelector?.('select[name="identifyItem"]')?.value;
              if (id) {
                activityData.itemId = id;
                const it = actor.items.get(id);
                if (it) activityData.itemName = it.name;
              }
            } else if (activity === "prepareForTask") {
              activityData.skill  = root?.querySelector?.('select[name="prepSkill"]')?.value ?? "";
              activityData.detail = root?.querySelector?.('input[name="prepDetail"]')?.value ?? "";
            } else if (activity === "craftEquipment") {
              activityData.projectId = root?.querySelector?.('select[name="craftProjectId"]')?.value ?? "";
              activityData.project = root?.querySelector?.('input[name="craftProject"]')?.value ?? "";
            } else if (activity === "harvest") {
              activityData.target = root?.querySelector?.('input[name="harvestTarget"]')?.value ?? "";
            }
            return { activity, inTown, activityData };
          }
        }
      });
      if (!choice) return;
      const { takeRest } = await import("../helpers/rest.mjs");
      await takeRest(this.document, { activity: choice.activity, inTown: choice.inTown, activityData: choice.activityData });
      this.render();
    } catch { /* dialog dismissed */ }
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

  static async _onToggleMiasma() {
    if (!game.user.isGM) { ui.notifications?.warn("Miasma toggle is GM-only."); return; }
    const { getInMiasma, setInMiasma } = await import("../helpers/miasma.mjs");
    const cur = getInMiasma();
    await setInMiasma(!cur);
    // Re-render all open crow sheets so badges update everywhere.
    for (const app of Object.values(ui.windows)) {
      if (app?.constructor?.name === "CrowSheet") app.render();
    }
    ChatMessage.create({
      content: `<div class="crows miasma-toggle"><strong>Miasma:</strong> ${cur ? "cleared" : "ENTERED"}</div>`,
      speaker: { alias: "Environment" }
    });
  }

  static async _onRollMiasmaResist() {
    const { rollMiasmaResist } = await import("../helpers/miasma.mjs");
    await rollMiasmaResist(this.document);
    this.render();
  }

  static async _onClearMiasmaSelf() {
    const { clearMiasma } = await import("../helpers/miasma.mjs");
    await clearMiasma(this.document);
    this.render();
  }

  static async _onCryptPray() {
    const { listInterments, pray } = await import("../helpers/crypt.mjs");
    const interments = listInterments();
    if (!interments.length) {
      ui.notifications?.warn("No crows are interred in the Crypt.");
      return;
    }
    const DialogV2 = foundry.applications.api.DialogV2;
    const opts = interments.map(e => `<option value="${e.crowName}">${e.crowName} — ${e.boonId}</option>`).join("");
    try {
      const choice = await DialogV2.prompt({
        window: { title: `${this.document.name} — Pray at a grave` },
        content: `<div class="crows crypt-form"><label>Grave: <select name="grave">${opts}</select></label></div>`,
        ok: { label: "Pray", callback: (event, button, dialog) => (dialog.element ?? button?.form)?.querySelector?.('select[name="grave"]')?.value }
      });
      if (!choice) return;
      await pray(this.document, choice);
      this.render();
    } catch { /* dismissed */ }
  }

  static async _onCryptExpend() {
    const { expendBoon } = await import("../helpers/crypt.mjs");
    await expendBoon(this.document);
    this.render();
  }

  static async _onCryptInter() {
    if (!game.user.isGM) { ui.notifications?.warn("Internment is GM-only."); return; }
    const { CRYPT_BOONS, inter } = await import("../helpers/crypt.mjs");
    const DialogV2 = foundry.applications.api.DialogV2;
    const opts = Object.values(CRYPT_BOONS).map(b => `<option value="${b.id}">${b.label}</option>`).join("");
    try {
      const choice = await DialogV2.prompt({
        window: { title: `Inter ${this.document.name} in the Crypt` },
        content: `<div class="crows crypt-form">
          <p>Pick the boon this dead crow grants:</p>
          <label>Boon: <select name="boonId">${opts}</select></label>
        </div>`,
        ok: { label: "Inter", callback: (event, button, dialog) => (dialog.element ?? button?.form)?.querySelector?.('select[name="boonId"]')?.value }
      });
      if (!choice) return;
      await inter({ crowName: this.document.name, boonId: choice, interredBy: game.user.name });
      // Also stamp the actor's cryptBoon field for sheet display.
      await this.document.update({ "system.cryptBoon": choice });
      this.render();
    } catch { /* dismissed */ }
  }

  static async _onCryptBumpCycle() {
    if (!game.user.isGM) { ui.notifications?.warn("Bumping cycle is GM-only."); return; }
    const { bumpCycle } = await import("../helpers/crypt.mjs");
    await bumpCycle();
    // Re-render all crow sheets so prayed-this-cycle gating updates.
    for (const app of Object.values(ui.windows)) {
      if (app?.constructor?.name === "CrowSheet") app.render();
    }
  }

  static async _onOpenVillage() {
    const { getVillage, INSTITUTION_TYPES, foundInstitution, upgradeInstitution, damageInstitution, setProsperity, endCycle, rollVillageEvent, setVillage } = await import("../helpers/village.mjs");
    const DialogV2 = foundry.applications.api.DialogV2;
    const isGM = !!game.user.isGM;
    const v = getVillage();
    const instRows = v.institutions.map(i => `<tr>
      <td>${i.name} <em>(${INSTITUTION_TYPES[i.type] ?? i.type})</em></td>
      <td style="text-align:center">${i.level}</td>
      <td>${i.steward || "<em>—</em>"}</td>
      <td>
        ${isGM ? `<button type="button" data-vil-upgrade="${i.id}" ${i.level >= 5 ? "disabled" : ""}>+L</button>
                  <button type="button" data-vil-damage="${i.id}">-L</button>` : ""}
      </td>
    </tr>`).join("");
    const typeOpts = Object.entries(INSTITUTION_TYPES).map(([k, v2]) => `<option value="${k}">${v2}</option>`).join("");
    const content = `<div class="crows village-dialog">
      <header><strong>${v.name}</strong> · Prosperity <strong>${v.prosperity}</strong> · Cycle <strong>${v.cycle}</strong>${v.hasUpgradedThisCycle ? " <em>(upgraded this cycle)</em>" : " <em>(no upgrade yet)</em>"}</header>
      <table class="village-inst-table">
        <thead><tr><th>Institution</th><th>Lvl</th><th>Steward</th><th>${isGM ? "GM" : ""}</th></tr></thead>
        <tbody>${instRows || `<tr><td colspan="4"><em>No institutions yet.</em></td></tr>`}</tbody>
      </table>
      ${isGM ? `
        <div class="village-found-form">
          <strong>Found new:</strong>
          <select name="newType">${typeOpts}</select>
          <input type="text" name="newName" placeholder="Optional name" />
          <input type="text" name="newSteward" placeholder="Steward" />
          <button type="button" data-vil-found="1">Found (+1 Prosperity)</button>
        </div>
        <div class="village-prosp-form">
          <strong>Prosperity:</strong>
          <input type="number" name="prosp" value="${v.prosperity}" min="-10" max="10" step="1" />
          <button type="button" data-vil-setprosp="1">Set</button>
        </div>
        <div class="village-name-form">
          <strong>Name:</strong>
          <input type="text" name="vname" value="${v.name}" />
          <button type="button" data-vil-setname="1">Rename</button>
        </div>
        <div class="village-cycle-form">
          <button type="button" data-vil-endcycle="1">End Cycle</button>
          <button type="button" data-vil-rollevent="1">Roll Event</button>
        </div>
      ` : ""}
    </div>`;

    const dlg = new DialogV2({
      window: { title: `Village — ${v.name}`, resizable: true },
      content,
      buttons: [{ action: "close", label: "Close", default: true, callback: () => null }],
      submit: () => null
    });
    await dlg.render({ force: true });

    // Wire button actions inside the dialog content.
    const root = dlg.element;
    if (!root) return;
    root.querySelector?.('[data-vil-found="1"]')?.addEventListener("click", async () => {
      const type = root.querySelector('select[name="newType"]')?.value;
      const name = root.querySelector('input[name="newName"]')?.value?.trim() || null;
      const steward = root.querySelector('input[name="newSteward"]')?.value?.trim() || "";
      await foundInstitution({ type, name, steward });
      dlg.close();
      CrowSheet._onOpenVillage.call(this);
    });
    root.querySelector?.('[data-vil-setprosp="1"]')?.addEventListener("click", async () => {
      const val = Number(root.querySelector('input[name="prosp"]')?.value ?? 0);
      await setProsperity(val);
      dlg.close();
      CrowSheet._onOpenVillage.call(this);
    });
    root.querySelector?.('[data-vil-setname="1"]')?.addEventListener("click", async () => {
      const val = String(root.querySelector('input[name="vname"]')?.value ?? "").trim();
      if (!val) return;
      await setVillage({ name: val });
      dlg.close();
      CrowSheet._onOpenVillage.call(this);
    });
    root.querySelector?.('[data-vil-endcycle="1"]')?.addEventListener("click", async () => {
      await endCycle();
      dlg.close();
      CrowSheet._onOpenVillage.call(this);
    });
    root.querySelector?.('[data-vil-rollevent="1"]')?.addEventListener("click", async () => {
      await rollVillageEvent();
    });
    root.querySelectorAll?.("[data-vil-upgrade]").forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        await upgradeInstitution(ev.currentTarget.dataset.vilUpgrade);
        dlg.close();
        CrowSheet._onOpenVillage.call(this);
      });
    });
    root.querySelectorAll?.("[data-vil-damage]").forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        await damageInstitution(ev.currentTarget.dataset.vilDamage);
        dlg.close();
        CrowSheet._onOpenVillage.call(this);
      });
    });
  }

  static async _onCraftStart() {
    const { startCraftingProject } = await import("../helpers/crafting.mjs");
    const DialogV2 = foundry.applications.api.DialogV2;
    const actor = this.document;
    // Skill <option>s with current bonuses.
    const opts = (CROWS.skills ?? [])
      .map(k => `<option value="${k}">${SKILL_LABELS[k] ?? k} (current +${actor.system.skills?.[k]?.bonus ?? 0})</option>`).join("");
    const content = `<div class="crows craft-start-form">
      <label>Item name: <input type="text" name="name" placeholder="e.g. 'Healing Potion'" style="width:100%"></label>
      <label>Skill: <select name="skill">${opts}</select></label>
      <label>Prereq bonus (0-2): <input type="number" name="prereq" value="0" min="0" max="2" step="1"></label>
      <label>Crafting goal (points): <input type="number" name="goal" value="100" min="1" step="10"></label>
      <label>Materials (comma-sep): <input type="text" name="materials" placeholder="herbs, vial" style="width:100%"></label>
      <label><input type="checkbox" name="hasRecipe"> Has recipe (or skill > prereq)</label>
      <label>Notes: <input type="text" name="notes" style="width:100%"></label>
    </div>`;
    try {
      const choice = await DialogV2.prompt({
        window: { title: `${actor.name} — Start crafting project` },
        content,
        ok: {
          label: "Start",
          callback: (event, button, dialog) => {
            const root = dialog.element ?? button?.form;
            return {
              name: root?.querySelector?.('input[name="name"]')?.value?.trim(),
              skill: root?.querySelector?.('select[name="skill"]')?.value,
              prereqBonus: Number(root?.querySelector?.('input[name="prereq"]')?.value ?? 0),
              goal: Number(root?.querySelector?.('input[name="goal"]')?.value ?? 100),
              materials: (root?.querySelector?.('input[name="materials"]')?.value ?? "").split(",").map(s => s.trim()).filter(Boolean),
              hasRecipe: !!root?.querySelector?.('input[name="hasRecipe"]')?.checked,
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
    const id = target.dataset.projectId;
    if (!id) return;
    const { makeCraftingRoll } = await import("../helpers/crafting.mjs");
    await makeCraftingRoll(this.document, id);
    this.render();
  }

  static async _onCraftCancel(event, target) {
    const id = target.dataset.projectId;
    if (!id) return;
    const { cancelProject } = await import("../helpers/crafting.mjs");
    await cancelProject(this.document, id);
    this.render();
  }

  static async _onCraftComplete(event, target) {
    const id = target.dataset.projectId;
    if (!id) return;
    const { completeProject } = await import("../helpers/crafting.mjs");
    await completeProject(this.document, id);
    this.render();
  }

  static async _onIdentifyItem(event, target) {
    const itemId = target.dataset.itemId;
    const { identifyMagicItem } = await import("../helpers/crafting.mjs");
    await identifyMagicItem(this.document, { itemId });
    this.render();
  }

  static async _onOpenCreator() {
    const { openCharacterCreator } = await import("../helpers/character-creator.mjs");
    await openCharacterCreator(this.document);
    this.render();
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
