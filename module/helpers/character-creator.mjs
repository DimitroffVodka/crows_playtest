/**
 * Character creator wizard (Rules pp.1491–1539).
 *
 * Flow (single-dialog wizard with all sections visible):
 *   1. Background — Roll 2d6 on table or pick directly. Description preview.
 *   2. Characteristics — +1 to one (filtered by bg), with optional dual-stat
 *      spread (+1 to a second at the cost of -1 on the third).
 *   3. Name + distinguishing feature — free text inputs.
 *   4. Apply — calls applyBackground (skills/stamina/equipment/trait),
 *      applyCharacteristics, and applyUniversalStarterItems.
 *
 * "Fresh actor" guard: warns (but allows override) if TXP > 0 or items > 0.
 */

import { applyBackground } from "./creation.mjs";

/** 2d6 → background name (Rules p.1542 table). */
const BACKGROUND_2D6_TABLE = {
  "1,1": "Acolyte of the Gardner",
  "1,2": "Acolyte of the Healer",
  "1,3": "Acolyte of the Smith",
  "1,4": "Acolyte of the Three",
  "1,5": "Acolyte of the Warrior",
  "1,6": "Alchemist",
  "2,1": "Apprentice Mage",
  "2,2": "Archer",
  "2,3": "Assassin",
  "2,4": "Blacksmith",
  "2,5": "Bodyguard",
  "2,6": "Beggar",
  "3,1": "Cartographer",
  "3,2": "Conjurer",
  "3,3": "Cook",
  "3,4": "Duelist",
  "3,5": "Entertainer",
  "3,6": "Executioner",
  "4,1": "Farmer",
  "4,2": "Gladiator",
  "4,3": "Hunter",
  "4,4": "Hydromancer",
  "4,5": "Illusionist",
  "4,6": "Keraunomancer",
  "5,1": "Knight",
  "5,2": "Merchant",
  "5,3": "Miner",
  "5,4": "Noble",
  "5,5": "Pugilist",
  "5,6": "Pyromancer",
  "6,1": "Sage",
  "6,2": "Soldier",
  "6,3": "Thief",
  "6,4": "Tinkerer",
  "6,5": "Transmuter",
  "6,6": "Village Watch"
};

/** Roll 2d6 and look up a background name. */
export async function rollBackground() {
  const a = await new Roll("1d6").evaluate();
  const b = await new Roll("1d6").evaluate();
  const key = `${a.total},${b.total}`;
  const name = BACKGROUND_2D6_TABLE[key] ?? null;
  return { rollA: a.total, rollB: b.total, key, name };
}

/** Fetch all backgrounds from the compendium, lazily cached on the function. */
let _bgCache = null;
async function _allBackgrounds() {
  if (_bgCache) return _bgCache;
  const pack = game.packs?.get("crows.crows-backgrounds");
  if (!pack) return null;
  _bgCache = await pack.getDocuments();
  return _bgCache;
}

/**
 * Apply a characteristic spread.
 *   primary   — characteristic to set +1.
 *   secondary — optional second to also set +1.
 *   dump      — required when secondary is set; the third stat goes to -1.
 * All three stats are clamped to [-1, 3] by the schema.
 */
export async function applyCharacteristics(actor, { primary, secondary = null, dump = null }) {
  if (!actor || actor.type !== "crow") return { ok: false, error: "not a crow" };
  const all = ["agility", "mind", "strength"];
  if (!all.includes(primary)) return { ok: false, error: "primary invalid" };
  if (secondary && (!all.includes(secondary) || secondary === primary)) {
    return { ok: false, error: "secondary invalid" };
  }
  if (secondary && (!all.includes(dump) || dump === primary || dump === secondary)) {
    return { ok: false, error: "need a distinct dump stat when secondary is set" };
  }
  // Reset all to 0 first to give the creator a known baseline.
  const updates = {
    "system.characteristics.agility.value":  0,
    "system.characteristics.mind.value":     0,
    "system.characteristics.strength.value": 0
  };
  updates[`system.characteristics.${primary}.value`] = 1;
  if (secondary) {
    updates[`system.characteristics.${secondary}.value`] = 1;
    updates[`system.characteristics.${dump}.value`] = -1;
  }
  await actor.update(updates);
  return { ok: true, primary, secondary, dump };
}

/**
 * Universal starting items (Rules p.1533): bedroll, empty coin purse, knife,
 * rope, six rations. Looks up real compendium docs so the slot grid renders.
 * Skips duplicates if the actor already owns one (by name match).
 */
export async function applyUniversalStarterItems(actor) {
  if (!actor || actor.type !== "crow") return { ok: false, error: "not a crow" };
  const ownedNames = new Set(actor.items.map(i => i.name));
  const wanted = [
    { name: "Bedroll",    pack: "crows.crows-gear",        fallbackType: "gear" },
    { name: "Coin Purse", pack: "crows.crows-gear",        fallbackType: "gear" },
    { name: "Knife",      pack: "crows.crows-weapons",     fallbackType: "weapon" },
    { name: "Rope",       pack: "crows.crows-gear",        fallbackType: "gear" }
  ];
  const toCreate = [];
  for (const w of wanted) {
    if (ownedNames.has(w.name)) continue;
    const pack = game.packs?.get(w.pack);
    if (!pack) continue;
    const idx = pack.index?.contents?.find(c => c.name === w.name);
    if (!idx) continue;
    const doc = await pack.getDocument(idx._id);
    const data = doc.toObject();
    delete data._id; delete data._key;
    data.system = { ...(data.system ?? {}), location: { container: "backpack", index: 0, length: data.system?.slots ?? 1 } };
    toCreate.push(data);
  }
  // Six rations — single stack if possible.
  const ratPack = game.packs?.get("crows.crows-consumables");
  if (ratPack) {
    const idx = ratPack.index?.contents?.find(c => c.name === "Ration");
    if (idx) {
      const ration = await ratPack.getDocument(idx._id);
      const data = ration.toObject();
      delete data._id; delete data._key;
      data.system = { ...(data.system ?? {}), quantity: 6, location: { container: "backpack", index: 0, length: data.system?.slots ?? 1 } };
      toCreate.push(data);
    }
  }
  if (toCreate.length) await actor.createEmbeddedDocuments("Item", toCreate);
  return { ok: true, added: toCreate.length };
}

/**
 * Orchestrate full character creation.
 * `opts` = { backgroundId, primary, secondary?, dump?, name?, feature? }.
 * Returns { ok, errors[], bg, characteristics, universal }.
 */
export async function createCharacter(actor, opts) {
  if (!actor || actor.type !== "crow") return { ok: false, error: "not a crow" };
  const bgs = await _allBackgrounds();
  if (!bgs) return { ok: false, error: "background compendium not loaded" };
  const bg = bgs.find(b => b.id === opts.backgroundId);
  if (!bg) return { ok: false, error: "background not found" };

  const errors = [];

  // 1) Rename + feature.
  const renameUpdates = {};
  if (opts.name && opts.name !== actor.name) renameUpdates.name = opts.name;
  if (opts.feature) renameUpdates["system.details.feature"] = opts.feature;
  if (Object.keys(renameUpdates).length) await actor.update(renameUpdates);

  // 2) Characteristics. Validate against bg's characteristicBonus rule.
  const cb = (bg.system?.characteristicBonus ?? "any").toLowerCase();
  const allowed = _allowedPrimary(cb);
  if (!allowed.includes(opts.primary)) {
    errors.push(`background allows ${allowed.join("/")} as primary; got ${opts.primary}`);
  } else {
    await applyCharacteristics(actor, { primary: opts.primary, secondary: opts.secondary, dump: opts.dump });
  }

  // 3) Apply background (skills, stamina, equipment, trait).
  const bgRes = await applyBackground(actor, bg);
  if (!bgRes.ok) errors.push(`applyBackground: ${bgRes.error}`);

  // 4) Universal starter items.
  const uni = await applyUniversalStarterItems(actor);

  // 5) Summary chat card.
  await ChatMessage.create({
    content: `<div class="crows char-create">
      <header><strong>${actor.name}</strong> — character created!</header>
      <ul>
        <li>Background: <strong>${bg.name}</strong></li>
        <li>Characteristics: +1 ${opts.primary}${opts.secondary ? `, +1 ${opts.secondary}, -1 ${opts.dump}` : ""}</li>
        <li>Stamina: <strong>${bg.system?.stamina ?? 5}</strong></li>
        ${bgRes.startingTraitEmbedded ? `<li>Starting trait: <strong>${bgRes.startingTrait}</strong></li>` : ""}
        <li>Equipment + spellbooks: <strong>${bgRes.itemsCreated}</strong> item(s)</li>
        <li>Universal starter items added: <strong>${uni.added}</strong></li>
      </ul>
      ${opts.feature ? `<div><em>"${opts.feature}"</em></div>` : ""}
    </div>`,
    speaker: ChatMessage.getSpeaker({ actor })
  });
  return { ok: errors.length === 0, errors, bg: bg.name, characteristics: { primary: opts.primary, secondary: opts.secondary, dump: opts.dump }, universal: uni.added };
}

/** Translate a background's characteristicBonus string to the allowed list. */
function _allowedPrimary(cb) {
  if (cb === "any") return ["agility", "mind", "strength"];
  if (cb.includes(" or ")) return cb.split(" or ").map(s => s.trim().toLowerCase());
  return [cb];
}

/**
 * Open the wizard dialog. Returns when the dialog resolves.
 */
export async function openCharacterCreator(actor) {
  if (!actor || actor.type !== "crow") {
    ui.notifications?.warn("Character creator is for crow actors only.");
    return;
  }
  const DialogV2 = foundry.applications.api.DialogV2;
  const bgs = await _allBackgrounds();
  if (!bgs?.length) {
    ui.notifications?.warn("Background compendium is not loaded.");
    return;
  }

  // Fresh-actor warning.
  const txp = actor.system?.xp?.txp ?? 0;
  const itemCount = actor.items.size;
  if (txp > 0 || itemCount > 0) {
    const conf = await DialogV2.confirm({
      window: { title: "Overwrite existing character?" },
      content: `<p>${actor.name} already has ${itemCount} item(s) and ${txp} TXP. Continuing will apply a background on top (skills increment, items stack). Continue?</p>`
    });
    if (!conf) return;
  }

  // Build the form.
  const bgOpts = [...bgs].sort((a, b) => a.name.localeCompare(b.name))
    .map(b => `<option value="${b.id}" data-cb="${b.system?.characteristicBonus ?? "any"}" data-stam="${b.system?.stamina ?? 5}" data-trait="${(b.system?.startingTrait ?? "").replace(/"/g, "&quot;")}">${b.name}</option>`)
    .join("");

  const content = `<div class="crows char-creator">
    <section class="cc-creator-bg">
      <header><strong>1. Background</strong></header>
      <div class="row">
        <button type="button" data-cc-roll="1">Roll 2d6</button>
        <label>or pick: <select name="backgroundId">${bgOpts}</select></label>
      </div>
      <div class="bg-preview" data-cc-preview>
        <div class="bp-row"><strong>Characteristic:</strong> <span data-cc-cb>—</span> · <strong>Stamina:</strong> <span data-cc-stam>—</span></div>
        <div class="bp-row"><strong>Starting trait:</strong> <span data-cc-trait>—</span></div>
        <div class="bp-row bp-desc" data-cc-desc></div>
      </div>
    </section>

    <section class="cc-creator-stats">
      <header><strong>2. Characteristics</strong></header>
      <p>All characteristics start at 0. Background sets your primary to +1. Optionally, raise a second to +1 — but you must drop the third to -1.</p>
      <div class="row">
        <label>Primary +1: <select name="primary"></select></label>
      </div>
      <div class="row">
        <label><input type="checkbox" name="useSecondary"> Take a secondary +1 (with -1 dump)</label>
      </div>
      <div class="row cc-sec-row" hidden>
        <label>Secondary +1: <select name="secondary"></select></label>
        <label>Dump -1: <select name="dump"></select></label>
      </div>
    </section>

    <section class="cc-creator-bio">
      <header><strong>3. Name & feature</strong></header>
      <div class="row"><label>Name: <input type="text" name="charname" value="${actor.name === "Crow" || actor.name === "New Actor" ? "" : actor.name}" placeholder="Character name"></label></div>
      <div class="row"><label>Distinguishing feature: <input type="text" name="feature" placeholder="e.g. 'scar across left eye'" style="width:100%"></label></div>
    </section>
  </div>`;

  const dlg = new DialogV2({
    window: { title: `${actor.name} — Character Creator`, resizable: true, width: 560 },
    content,
    buttons: [
      { action: "cancel", label: "Cancel", callback: () => null },
      {
        action: "create",
        label: "Create",
        default: true,
        callback: (event, button, dialog) => {
          const root = dialog.element ?? button?.form;
          const backgroundId = root?.querySelector?.('select[name="backgroundId"]')?.value;
          const primary = root?.querySelector?.('select[name="primary"]')?.value;
          const useSec = !!root?.querySelector?.('input[name="useSecondary"]')?.checked;
          const secondary = useSec ? root?.querySelector?.('select[name="secondary"]')?.value : null;
          const dump = useSec ? root?.querySelector?.('select[name="dump"]')?.value : null;
          const name = root?.querySelector?.('input[name="charname"]')?.value?.trim() || null;
          const feature = root?.querySelector?.('input[name="feature"]')?.value?.trim() || null;
          return { backgroundId, primary, secondary, dump, name, feature };
        }
      }
    ]
  });
  await dlg.render({ force: true });

  // After-render wiring.
  const root = dlg.element;
  if (!root) return;
  const sel = root.querySelector('select[name="backgroundId"]');
  const primarySel = root.querySelector('select[name="primary"]');
  const secRow = root.querySelector('.cc-sec-row');
  const useSec = root.querySelector('input[name="useSecondary"]');
  const secondarySel = root.querySelector('select[name="secondary"]');
  const dumpSel = root.querySelector('select[name="dump"]');

  function _refreshFromBg() {
    const opt = sel.selectedOptions[0];
    if (!opt) return;
    const cb = opt.dataset.cb;
    const stam = opt.dataset.stam;
    const trait = opt.dataset.trait;
    root.querySelector("[data-cc-cb]").textContent = cb;
    root.querySelector("[data-cc-stam]").textContent = stam;
    root.querySelector("[data-cc-trait]").textContent = trait || "—";
    // Lazy-load description from full document.
    const bg = bgs.find(b => b.id === opt.value);
    root.querySelector("[data-cc-desc]").innerHTML = bg?.system?.description ?? "";

    // Refresh primary options.
    const allowed = _allowedPrimary(cb ?? "any");
    primarySel.innerHTML = allowed.map(a => `<option value="${a}">${a}</option>`).join("");
    _refreshSecondary();
  }

  function _refreshSecondary() {
    secRow.hidden = !useSec.checked;
    const all = ["agility", "mind", "strength"];
    const primary = primarySel.value;
    const others = all.filter(a => a !== primary);
    secondarySel.innerHTML = others.map(a => `<option value="${a}">${a}</option>`).join("");
    _refreshDump();
  }

  function _refreshDump() {
    const all = ["agility", "mind", "strength"];
    const primary = primarySel.value;
    const secondary = secondarySel.value;
    const others = all.filter(a => a !== primary && a !== secondary);
    dumpSel.innerHTML = others.map(a => `<option value="${a}">${a}</option>`).join("");
  }

  sel.addEventListener("change", _refreshFromBg);
  primarySel.addEventListener("change", _refreshSecondary);
  useSec.addEventListener("change", _refreshSecondary);
  secondarySel.addEventListener("change", _refreshDump);

  // Roll 2d6 button.
  root.querySelector('[data-cc-roll="1"]')?.addEventListener("click", async () => {
    const r = await rollBackground();
    const found = bgs.find(b => b.name === r.name);
    if (found) {
      sel.value = found.id;
      _refreshFromBg();
      ui.notifications?.info(`Rolled ${r.rollA},${r.rollB} → ${r.name}.`);
    } else {
      ui.notifications?.warn(`Rolled ${r.rollA},${r.rollB} → ${r.name} (not found in compendium).`);
    }
  });

  // Initial population.
  _refreshFromBg();

  // Wait for dialog resolution. DialogV2 promise resolves with the chosen
  // button's callback return value. We poll its internal promise:
  return new Promise(resolve => {
    const origClose = dlg.close.bind(dlg);
    dlg.close = async (opts) => {
      const r = await origClose(opts);
      resolve(r);
      return r;
    };
    // Hook into the "create" button manually since DialogV2.prompt-style
    // wrapping isn't usable here. We rely on the button callback to fire
    // and call createCharacter.
    root.querySelector('button[data-action="create"]')?.addEventListener("click", async () => {
      // Delay one tick to let DialogV2 capture form state via its own callback.
      // Then read directly:
      const backgroundId = sel.value;
      const primary = primarySel.value;
      const useS = !!useSec.checked;
      const secondary = useS ? secondarySel.value : null;
      const dump = useS ? dumpSel.value : null;
      const name = root.querySelector('input[name="charname"]')?.value?.trim() || null;
      const feature = root.querySelector('input[name="feature"]')?.value?.trim() || null;
      const result = await createCharacter(actor, { backgroundId, primary, secondary, dump, name, feature });
      if (!result.ok && result.errors?.length) {
        ui.notifications?.warn("Character creation had issues: " + result.errors.join("; "));
      } else if (result.ok) {
        ui.notifications?.info(`${actor.name} created!`);
      }
      dlg.close();
    });
  });
}
