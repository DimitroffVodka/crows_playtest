/**
 * Playtest 2 character creator (C:14-42).
 *
 * Backgrounds grant expertise uses and set one allowed characteristic to 2.
 * The other two are assigned either {1, 0} or {2, -1}. Every crow also gets
 * the universal kit, 3d6 gc, speed 5 and an NPC connection.
 */

import { applyBackground } from "./creation.mjs";

export const CHARACTERISTICS = Object.freeze(["agility", "mind", "strength"]);
export const CREATION_SPREADS = Object.freeze({
  "1-0": Object.freeze([1, 0]),
  "2--1": Object.freeze([2, -1])
});

/** 2d6 -> background name (C:18). */
const BACKGROUND_2D6_TABLE = Object.freeze({
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
});

const esc = (value) => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const label = (key) => key ? `${key[0].toUpperCase()}${key.slice(1)}` : "";

/** Roll 2d6 and look up a background name. */
export async function rollBackground() {
  const roll = await new Roll("2d6").evaluate();
  const dice = roll.dice?.[0]?.results?.map((result) => Number(result.result)) ?? [];
  // A Roll stub or module may not expose individual dice. Preserve the table's
  // ordered-pair shape by falling back to two independent rolls in that case.
  let rollA = dice[0];
  let rollB = dice[1];
  if (!Number.isFinite(rollA) || !Number.isFinite(rollB)) {
    const a = await new Roll("1d6").evaluate();
    const b = await new Roll("1d6").evaluate();
    rollA = Number(a.total);
    rollB = Number(b.total);
  }
  const key = `${rollA},${rollB}`;
  return { rollA, rollB, key, name: BACKGROUND_2D6_TABLE[key] ?? null, roll };
}

/** Roll the background's starting-gold formula (C:36, normally 3d6). */
export async function rollStartingGold(formula = "3d6") {
  const safeFormula = String(formula || "3d6");
  const roll = await new Roll(safeFormula).evaluate();
  return { formula: safeFormula, total: Math.max(0, Math.floor(Number(roll.total) || 0)), roll };
}

let _bgCache = null;
async function allBackgrounds() {
  if (_bgCache) return _bgCache;
  const pack = game.packs?.get("crows.crows-backgrounds");
  if (!pack) return null;
  _bgCache = await pack.getDocuments();
  return _bgCache;
}

function backgroundCharacteristicOptions(background) {
  const options = [...(background?.system?.characteristicOptionsAt2 ?? [])];
  return options.filter((key, index) => CHARACTERISTICS.includes(key) && options.indexOf(key) === index);
}

/**
 * Resolve the complete Playtest 2 characteristic assignment without writing.
 * `remainingHigh` receives the first value in the selected spread; the other
 * non-background characteristic receives the second.
 */
export function characteristicSpread({ backgroundCharacteristic, remainingHigh, spread = "1-0" } = {}) {
  if (!CHARACTERISTICS.includes(backgroundCharacteristic)) {
    return { ok: false, error: "background characteristic invalid" };
  }
  const remaining = CHARACTERISTICS.filter((key) => key !== backgroundCharacteristic);
  if (!remaining.includes(remainingHigh)) {
    return { ok: false, error: "remaining characteristic invalid" };
  }
  const values = CREATION_SPREADS[spread];
  if (!values) return { ok: false, error: "characteristic spread invalid" };
  const remainingLow = remaining.find((key) => key !== remainingHigh);
  return {
    ok: true,
    spread,
    backgroundCharacteristic,
    remainingHigh,
    remainingLow,
    values: {
      [backgroundCharacteristic]: 2,
      [remainingHigh]: values[0],
      [remainingLow]: values[1]
    }
  };
}

/** Apply a validated Playtest 2 characteristic spread. */
export async function applyCharacteristics(actor, options = {}) {
  if (!actor || actor.type !== "crow") return { ok: false, error: "not a crow" };
  const plan = characteristicSpread(options);
  if (!plan.ok) return plan;
  await actor.update(Object.fromEntries(
    Object.entries(plan.values).map(([key, value]) => [`system.characteristics.${key}.value`, value])
  ));
  return plan;
}

async function compendiumItem(packKey, name) {
  const pack = game.packs?.get(packKey);
  if (!pack) return null;
  if (!pack.index?.contents?.length) await pack.getIndex?.();
  const entry = pack.index?.contents?.find((candidate) => candidate.name === name)
    ?? pack.index?.contents?.find((candidate) => candidate.name?.toLowerCase() === name.toLowerCase());
  return entry ? pack.getDocument(entry._id) : null;
}

function cloneEmbeddedItem(document, index) {
  const data = document.toObject();
  delete data._id;
  delete data._key;
  data.system = {
    ...(data.system ?? {}),
    location: {
      container: "backpack",
      index,
      length: Math.max(1, Number(data.system?.slots) || 1)
    }
  };
  return data;
}

/**
 * Universal kit (C:36): empty coin purse, knife, rope and six rations.
 * Bedroll was part of the PT1 creator and is deliberately not granted here.
 */
export async function applyUniversalStarterItems(actor) {
  if (!actor || actor.type !== "crow") return { ok: false, error: "not a crow" };
  const owned = [...(actor.items ?? [])];
  const ownedNames = new Set(owned.map((item) => item.name?.toLowerCase()));
  const wanted = [
    { name: "Coin Purse", pack: "crows.crows-gear" },
    { name: "Knife", pack: "crows.crows-weapons" },
    { name: "Rope", pack: "crows.crows-gear" },
    { name: "Ration", pack: "crows.crows-consumables", quantity: 6 }
  ];
  const toCreate = [];
  const missing = [];

  for (const wantedItem of wanted) {
    if (ownedNames.has(wantedItem.name.toLowerCase())) continue;
    const document = await compendiumItem(wantedItem.pack, wantedItem.name);
    if (!document) {
      missing.push(wantedItem.name);
      continue;
    }
    const data = cloneEmbeddedItem(document, toCreate.length);
    if (wantedItem.quantity) data.system.quantity = wantedItem.quantity;
    // NO purse special-case here. The shipped Coin Purse now carries
    // `purse.isPurse: true` in the compendium itself, so the starting kit gets
    // a working purse by cloning the item like everything else.
    //
    // What was here before name-matched "Coin Purse" and stamped the field at
    // creation, because the YAML had no `purse:` block. That made a
    // wizard-made purse work while a purse dragged in from the compendium
    // silently held no coins — and probe p11 passed BECAUSE of the workaround,
    // which is what hid it. Do not reintroduce a name match; if a second purse
    // item ever ships, stamp its YAML.
    toCreate.push(data);
  }

  const created = toCreate.length
    ? await actor.createEmbeddedDocuments("Item", toCreate)
    : [];
  return {
    ok: missing.length === 0,
    added: created.length,
    items: created.map((item) => item.name),
    missing
  };
}

/** Orchestrate the complete PT2 creation flow after validating every choice. */
export async function createCharacter(actor, opts = {}) {
  if (!actor || actor.type !== "crow") return { ok: false, error: "not a crow" };
  const backgrounds = await allBackgrounds();
  if (!backgrounds) return { ok: false, error: "background compendium not loaded" };
  const background = backgrounds.find((candidate) => candidate.id === opts.backgroundId);
  if (!background) return { ok: false, error: "background not found" };

  const allowed = backgroundCharacteristicOptions(background);
  if (!allowed.includes(opts.backgroundCharacteristic)) {
    return { ok: false, error: `background allows ${allowed.join("/") || "no configured characteristic"} at 2` };
  }
  const characteristics = characteristicSpread(opts);
  if (!characteristics.ok) return characteristics;

  const identity = {
    "system.speed": 5,
    "system.npcConnection.name": String(opts.connectionName ?? "").trim(),
    "system.npcConnection.relationship": String(opts.connectionRelationship ?? "").trim(),
    "system.npcConnection.notes": String(opts.connectionNotes ?? "").trim()
  };
  if (opts.name && opts.name !== actor.name) identity.name = String(opts.name).trim();
  if (opts.feature) identity["system.details.feature"] = String(opts.feature).trim();
  await actor.update(identity);

  const characteristicResult = await applyCharacteristics(actor, opts);
  const backgroundResult = await applyBackground(actor, background);
  if (!backgroundResult.ok) return backgroundResult;

  const universal = await applyUniversalStarterItems(actor);
  const gold = await rollStartingGold(background.system?.startingGold ?? "3d6");
  // Some backgrounds grant coins on TOP of the universal 3d6 — the Noble's
  // "50 gold coins" (C:36 is the universal roll; the extra is the background's).
  // applyBackground reports these as `bonusGold` rather than creating an item,
  // because coins are not equipment. Before this was added the grant was
  // silently dropped and a Noble started 50 gc poor.
  const bonusGold = backgroundResult.bonusGold ?? 0;
  await actor.update({ "system.currency": gold.total + bonusGold });

  const errors = universal.missing.map((name) => `starter item not found: ${name}`);
  await ChatMessage.create({
    content: `<div class="crows char-create">
      <header><strong>${esc(actor.name)}</strong> — character created</header>
      <ul>
        <li>Background: <strong>${esc(background.name)}</strong></li>
        <li>Characteristics: ${Object.entries(characteristics.values).map(([key, value]) => `${esc(label(key))} ${value}`).join(", ")}</li>
        <li>Expertise uses granted: <strong>${Object.values(backgroundResult.expertiseUses).reduce((sum, uses) => sum + uses, 0)}</strong></li>
        <li>Starting gold: <strong>${gold.total + bonusGold} gc</strong> (${esc(gold.formula)}${bonusGold ? ` + ${bonusGold} from background` : ""})</li>
        <li>Universal kit items added: <strong>${universal.added}</strong></li>
        <li>NPC connection: <strong>${esc(identity["system.npcConnection.name"] || "Not named")}</strong></li>
      </ul>
    </div>`,
    speaker: ChatMessage.getSpeaker({ actor })
  });

  return {
    ok: errors.length === 0,
    errors,
    background: background.name,
    characteristics: characteristicResult,
    expertises: backgroundResult.expertiseUses,
    gold: { formula: gold.formula, total: gold.total },
    universal,
    connection: {
      name: identity["system.npcConnection.name"],
      relationship: identity["system.npcConnection.relationship"],
      notes: identity["system.npcConnection.notes"]
    }
  };
}

/** Open the single-dialog creator and apply its choices exactly once. */
export async function openCharacterCreator(actor) {
  if (!actor || actor.type !== "crow") {
    ui.notifications?.warn("Character creator is for crow actors only.");
    return;
  }
  const DialogV2 = foundry.applications.api.DialogV2;
  const backgrounds = await allBackgrounds();
  if (!backgrounds?.length) {
    ui.notifications?.warn("Background compendium is not loaded.");
    return;
  }

  const txp = actor.system?.xp?.txp ?? 0;
  const itemCount = actor.items?.size ?? actor.items?.length ?? 0;
  if (txp > 0 || itemCount > 0) {
    const confirmed = await DialogV2.confirm({
      window: { title: "Apply creation to an existing crow?" },
      content: `<p>${esc(actor.name)} already has ${itemCount} item(s) and ${txp} TXP. Continuing adds the background's expertise uses and items to the existing actor.</p>`
    });
    if (!confirmed) return;
  }

  const backgroundOptions = [...backgrounds]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((background) => `<option value="${esc(background.id)}">${esc(background.name)}</option>`)
    .join("");
  const currentName = actor.name === "Crow" || actor.name === "New Actor" ? "" : actor.name;
  const content = `<div class="crows char-creator">
    <section class="cc-creator-bg">
      <header><strong>1. Background</strong></header>
      <div class="row"><button type="button" data-cc-roll>Roll 2d6</button>
        <label>or pick: <select name="backgroundId">${backgroundOptions}</select></label></div>
      <div class="bg-preview">
        <div><strong>Sets to 2:</strong> <span data-cc-options>—</span> · <strong>Stamina:</strong> <span data-cc-stamina>—</span></div>
        <div><strong>Starting trait:</strong> <span data-cc-trait>—</span></div>
        <div data-cc-description></div>
      </div>
    </section>
    <section class="cc-creator-stats">
      <header><strong>2. Characteristics</strong></header>
      <label>Background characteristic (set to 2): <select name="backgroundCharacteristic"></select></label>
      <label>Remaining spread: <select name="spread"><option value="1-0">1 and 0</option><option value="2--1">2 and -1</option></select></label>
      <label><span data-cc-high-label>Characteristic receiving 1</span>: <select name="remainingHigh"></select></label>
      <div>The other remaining characteristic receives <strong data-cc-low>0</strong>.</div>
    </section>
    <section class="cc-creator-bio">
      <header><strong>3. Name & distinguishing feature</strong></header>
      <label>Name: <input type="text" name="charname" value="${esc(currentName)}"></label>
      <label>Feature: <input type="text" name="feature"></label>
    </section>
    <section class="cc-creator-connection">
      <header><strong>4. NPC connection</strong></header>
      <label>Name: <input type="text" name="connectionName"></label>
      <label>Relationship: <input type="text" name="connectionRelationship"></label>
      <label>Notes: <textarea name="connectionNotes"></textarea></label>
    </section>
  </div>`;

  let root = null;
  const choicePromise = DialogV2.wait({
    window: { title: `${actor.name} — Character Creator`, resizable: true, width: 640 },
    content,
    buttons: [
      { action: "cancel", label: "Cancel", callback: () => null },
      {
        action: "create",
        label: "Create",
        default: true,
        callback: (event, button, dialog) => {
          const form = dialog.element ?? button?.form;
          const value = (name) => form?.querySelector?.(`[name="${name}"]`)?.value?.trim() ?? "";
          return {
            backgroundId: value("backgroundId"),
            backgroundCharacteristic: value("backgroundCharacteristic"),
            remainingHigh: value("remainingHigh"),
            spread: value("spread"),
            name: value("charname") || null,
            feature: value("feature") || null,
            connectionName: value("connectionName"),
            connectionRelationship: value("connectionRelationship"),
            connectionNotes: value("connectionNotes")
          };
        }
      }
    ],
    render: (event, dialog) => { root = dialog.element; }
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  if (!root) {
    root = [...document.querySelectorAll(".application")]
      .find((element) => element.querySelector(".crows.char-creator"));
  }
  if (!root) return;

  const backgroundSelect = root.querySelector('[name="backgroundId"]');
  const backgroundCharacteristicSelect = root.querySelector('[name="backgroundCharacteristic"]');
  const remainingHighSelect = root.querySelector('[name="remainingHigh"]');
  const spreadSelect = root.querySelector('[name="spread"]');

  function refreshRemaining() {
    const remaining = CHARACTERISTICS.filter((key) => key !== backgroundCharacteristicSelect.value);
    remainingHighSelect.innerHTML = remaining.map((key) => `<option value="${key}">${label(key)}</option>`).join("");
    const [high, low] = CREATION_SPREADS[spreadSelect.value];
    root.querySelector("[data-cc-high-label]").textContent = `Characteristic receiving ${high}`;
    root.querySelector("[data-cc-low]").textContent = String(low);
  }

  function refreshBackground() {
    const background = backgrounds.find((candidate) => candidate.id === backgroundSelect.value);
    if (!background) return;
    const options = backgroundCharacteristicOptions(background);
    backgroundCharacteristicSelect.innerHTML = options
      .map((key) => `<option value="${key}">${label(key)}</option>`).join("");
    root.querySelector("[data-cc-options]").textContent = options.map(label).join(" or ") || "Not configured";
    root.querySelector("[data-cc-stamina]").textContent = String(background.system?.stamina ?? 5);
    root.querySelector("[data-cc-trait]").textContent = background.system?.startingTrait || "—";
    root.querySelector("[data-cc-description]").innerHTML = background.system?.description ?? "";
    refreshRemaining();
  }

  backgroundSelect.addEventListener("change", refreshBackground);
  backgroundCharacteristicSelect.addEventListener("change", refreshRemaining);
  spreadSelect.addEventListener("change", refreshRemaining);
  root.querySelector("[data-cc-roll]")?.addEventListener("click", async () => {
    const result = await rollBackground();
    const background = backgrounds.find((candidate) => candidate.name === result.name);
    if (!background) {
      ui.notifications?.warn(`Rolled ${result.rollA},${result.rollB} -> ${result.name} (not found in compendium).`);
      return;
    }
    backgroundSelect.value = background.id;
    refreshBackground();
    ui.notifications?.info(`Rolled ${result.rollA},${result.rollB} -> ${result.name}.`);
  });
  refreshBackground();

  const choice = await choicePromise;
  if (!choice) return;
  const result = await createCharacter(actor, choice);
  if (!result.ok) ui.notifications?.warn(result.error ?? result.errors?.join("; ") ?? "Character creation failed.");
  else ui.notifications?.info(`${actor.name} created!`);
  return result;
}
