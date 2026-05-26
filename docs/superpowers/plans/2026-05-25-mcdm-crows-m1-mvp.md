# MCDM Crows — M1 (Playable MVP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a playable Foundry VTT system for MCDM Crows — data models, ApplicationV2 sheets, the 2d10 tier roll-to-chat pipeline, slot inventory, usage-die roller, status-effect conditions, a background creation helper, and a compendium pipeline seeded with starter content — usable at the table during the live playtest.

**Architecture:** Bespoke system using native ES modules (no bundler for M1) and plain CSS. Data via `foundry.abstract.TypeDataModel` registered on `CONFIG.Actor/Item.dataModels`; sheets via `ApplicationV2 + HandlebarsApplicationMixin`. A single reusable `rollTest()` evaluates `2d10 + characteristic + skill` and renders a tier-banded chat card. Slot inventory is computed from each embedded item's `system.location`. Compendium content authored as source YAML and packed to LevelDB with `@foundryvtt/foundryvtt-cli`.

**Tech Stack:** Foundry VTT (min v13 / verified v14), JavaScript (native ESM), Handlebars, plain CSS, `@foundryvtt/foundryvtt-cli` (pack build), `foundry-mcp-bridge` (runtime probes).

**Verification model (project convention — overrides generic TDD):**
- `node --check <file>` for syntax on every touched `.mjs`.
- `verify.sh` grep wall (block/warn patterns) + `node --check` batch.
- `dev/probes/*.mjs` — paste-able MCP `evaluate` snippets that return `{ pass: bool, ... }`, run against a live world via the `foundry-mcp-bridge`.
- Live verification = open the world, run the probe, paste the `{pass:true}` result. No claim of "works" without a probe result or grep/`node --check` output.

**Live-test setup:** A dev world with the `crows` system active and `foundry-mcp-bridge` enabled. Close the world before any `packs/` build (Foundry holds LevelDB locks).

---

## File structure (M1)

```
crows/
  system.json                     # manifest: subtypes, packs, compatibility
  package.json                    # pack build scripts + fvtt-cli dep
  template? NONE                  # DataModels replace template.json
  module/
    crows.mjs                     # entry: init/ready hooks, registration
    config.mjs                    # CROWS constants (enums, lists)
    helpers/
      schema.mjs                  # PhysicalItemData + UsageDieData mixin fns
      slots.mjs                   # slot occupancy/placement/wounds logic
      roll.mjs                    # rollTest() + tier/doom/crit + chat card
      usage-die.mjs               # usage-die roller
      creation.mjs                # applyBackground() helper
    data/
      item/
        weapon.mjs armor.mjs ammunition.mjs consumable.mjs
        gear.mjs spellbook.mjs trait.mjs background.mjs
      actor/
        crow.mjs monster.mjs
    sheets/
      item-sheet.mjs              # one ItemSheetV2 subclass, type-driven PARTS
      monster-sheet.mjs
      crow-sheet.mjs
    conditions.mjs                # CONFIG.statusEffects registration
  templates/
    item/*.hbs  actor/crow/*.hbs  actor/monster.hbs  chat/test-card.hbs
    partials/physical-item.hbs  partials/usage-die.hbs  partials/slot-grid.hbs
  css/crows.css
  lang/en.json
  src/packs/<pack>/*.yaml         # source content (personal-only)
  packs/                          # built LevelDB (gitignored)
  dev/probes/*.mjs  dev/fixtures/setup.mjs dev/fixtures/teardown.mjs
  verify.sh
  .planning/STATUS.md
```

---

## Conventions used across tasks

- ESM imports are relative with `.mjs` extensions. The entry module is referenced from `system.json` via `"esmodules": ["module/crows.mjs"]`.
- All enums/lists live in `config.mjs` as the `CROWS` object; never hardcode an enum inline.
- Field factories: `const fields = foundry.data.fields;`
- DataModel base: `const { TypeDataModel } = foundry.abstract;`
- Registration happens in the `init` hook in `crows.mjs`.
- Commit after each task with a `feat:`/`chore:` message. Run `node --check` (and `verify.sh` once it exists) before each commit.

---

### Task 0: Project skeleton & manifest

**Goal:** A loadable, empty `crows` system that Foundry recognizes and activates without console errors.

**Files:**
- Create: `system.json`
- Create: `module/crows.mjs`
- Create: `module/config.mjs`
- Create: `lang/en.json`
- Create: `css/crows.css`

**Acceptance Criteria:**
- [ ] `system.json` is valid JSON and declares Actor subtypes `crow`, `monster` and Item subtypes `weapon, armor, ammunition, consumable, gear, spellbook, trait, background`.
- [ ] `compatibility` = `{ "minimum": "13", "verified": "14" }`.
- [ ] On world load, `game.system.id === "crows"` and no errors in console.

**Verify:** Open dev world → MCP probe `dev/probes/p00-loads.mjs` returns `{pass:true, id:"crows"}`. Also `node --check module/crows.mjs`.

**Steps:**

- [ ] **Step 1: Write `system.json`**

```json
{
  "id": "crows",
  "title": "MCDM Crows",
  "description": "MCDM Crows TTRPG (playtest). Personal use.",
  "version": "0.1.0",
  "compatibility": { "minimum": "13", "verified": "14" },
  "authors": [{ "name": "dimit" }],
  "esmodules": ["module/crows.mjs"],
  "styles": ["css/crows.css"],
  "languages": [{ "lang": "en", "name": "English", "path": "lang/en.json" }],
  "grid": { "distance": 5, "units": "sq" },
  "primaryTokenAttribute": "stamina",
  "documentTypes": {
    "Actor": { "crow": {}, "monster": {} },
    "Item": {
      "weapon": {}, "armor": {}, "ammunition": {}, "consumable": {},
      "gear": {}, "spellbook": {}, "trait": {}, "background": {}
    }
  },
  "packs": [],
  "flags": {}
}
```

- [ ] **Step 2: Write `module/config.mjs` (initial constants)**

```js
export const CROWS = {
  id: "crows",
  characteristics: { agility: "A", mind: "M", strength: "S" },
  tiers: { t1Max: 11, t2Max: 16 },            // ≤11 t1, 12-16 t2, 17+ t3
  doomFaces: [2, 3],                           // natural 2d10 sum
  critFaces: [19, 20],
  containers: {
    hand: 2, belt: 2, waist: 1, neck: 1, gloves: 1, boots: 1,
    ring: 1, head: 1, backpack: 10
  },
  backpackSize: 10
};
```

- [ ] **Step 3: Write `module/crows.mjs` (entry stub)**

```js
import { CROWS } from "./config.mjs";

Hooks.once("init", () => {
  console.log("crows | init");
  CONFIG.CROWS = CROWS;
});

Hooks.once("ready", () => {
  console.log("crows | ready");
});
```

- [ ] **Step 4: Write `lang/en.json` and `css/crows.css` stubs**

`lang/en.json`:
```json
{ "CROWS.SystemTitle": "MCDM Crows" }
```
`css/crows.css`:
```css
/* crows system styles */
.crows.sheet { font-family: var(--font-primary); }
```

- [ ] **Step 5: Syntax check**

Run: `node --check module/crows.mjs && node --check module/config.mjs`
Expected: no output (exit 0).

- [ ] **Step 6: Write probe `dev/probes/p00-loads.mjs`**

```js
// Paste into MCP evaluate against the dev world.
return { pass: game.system.id === "crows", id: game.system.id, version: game.system.version };
```

- [ ] **Step 7: Live verify + commit**

Activate `crows` in a dev world, run the probe via MCP, confirm `{pass:true}`.
```bash
git add system.json module/ lang/ css/
git commit -m "feat: crows system skeleton + manifest"
```

---

### Task 1: Dev tooling (verify.sh + probe/fixture scaffold)

**Goal:** Establish the grep-wall + syntax verifier and the probe/fixture harness so every later task can self-check.

**Files:**
- Create: `verify.sh`
- Create: `dev/fixtures/setup.mjs`
- Create: `dev/fixtures/teardown.mjs`
- Create: `package.json`

**Acceptance Criteria:**
- [ ] `verify.sh` runs `node --check` on all `module/**/*.mjs` and greps for block patterns; exits non-zero on a block hit.
- [ ] `package.json` declares the pack build scripts and `@foundryvtt/foundryvtt-cli` devDependency.

**Verify:** `bash verify.sh` exits 0 on the current (clean) tree.

**Steps:**

- [ ] **Step 1: Write `verify.sh`** (seed from shadowdark-extras patterns; Crows/v14-generic)

```bash
#!/usr/bin/env bash
set -u
fail=0
# Syntax check all module files
while IFS= read -r f; do
  node --check "$f" || { echo "SYNTAX FAIL: $f"; fail=1; }
done < <(find module -name '*.mjs')
# BLOCK patterns (real-bug guards)
block() { if grep -rnP "$1" module 2>/dev/null; then echo "BLOCK: $2"; fail=1; fi; }
block 'this\.senderId' 'socketlib: use this.socketdata?.userId, not senderId'
block 'Math\.(floor|ceil|round|min|max)\([^)]*\bsafeEval' 'safeEval has no Math.* — use bare fn names'
block 'CONST\.ACTIVE_EFFECT_MODES' 'v14: use CONST.ACTIVE_EFFECT_CHANGE_TYPES'
block 'renderChatMessage\b(?!HTML)' 'v14: use renderChatMessageHTML'
block 'new Application\(' 'use ApplicationV2'
# WARN patterns (non-blocking)
warn() { grep -rnP "$1" module 2>/dev/null && echo "WARN: $2"; }
warn 'console\.log' 'stray console.log'
[ "${1:-}" = "--strict" ] && warn() { if grep -rnP "$1" module 2>/dev/null; then echo "STRICT-FAIL: $2"; fail=1; fi; }
exit $fail
```

- [ ] **Step 2: Write `package.json`** (pack scripts)

```json
{
  "name": "crows-system-dev",
  "private": true,
  "type": "module",
  "scripts": {
    "pack": "fvtt package pack --in src/packs --out packs --yaml",
    "unpack": "fvtt package unpack --in packs --out src/packs --yaml"
  },
  "devDependencies": { "@foundryvtt/foundryvtt-cli": "^1.0.0" }
}
```

- [ ] **Step 3: Write `dev/fixtures/setup.mjs` + `teardown.mjs` (idempotent stubs)**

`setup.mjs`:
```js
// Idempotent test data. Run via MCP evaluate. Returns created ids.
const out = {};
const name = "TestCrow";
let a = game.actors.getName(name);
if (!a) a = await Actor.create({ name, type: "crow" });
out.crow = a.id;
return { pass: !!out.crow, ...out };
```
`teardown.mjs`:
```js
for (const n of ["TestCrow", "TestMonster"]) {
  const a = game.actors.getName(n); if (a) await a.delete();
}
return { pass: true };
```

- [ ] **Step 4: Verify + commit**

Run: `bash verify.sh` → expect exit 0 (no BLOCK lines).
```bash
git add verify.sh package.json
git commit -m "chore: verify.sh grep wall + pack scripts + fixtures"
```
(Note: `dev/` and `verify.sh` are local-only via `.git/info/exclude`; commit will be a no-op for those paths — that is expected. `package.json` commits normally unless you also exclude it.)

---

### Task 2: Config enums + schema mixins

**Goal:** Complete the `CROWS` config enums and provide `PhysicalItemData()` / `UsageDieData()` field-factory mixins used by every item DataModel.

**Files:**
- Modify: `module/config.mjs`
- Create: `module/helpers/schema.mjs`

**Acceptance Criteria:**
- [ ] `CROWS` includes: `skills` (full list), `weaponTypes`, `weaponQualities`, `armorTypes`, `disciplines`, `traitTrees`, `creatureTypes`, `sizes`, `castTypes`, `usageExpiry`, `equipSlotTypes`, `qualityTiers`.
- [ ] `physicalItemFields()` returns `{ slots, stackMax, quantity, cost, equipSlotType, weightless }`.
- [ ] `usageDieFields()` returns `{ udMax, udCurrent, expiry, refuelWith }`.

**Verify:** `node --check module/config.mjs module/helpers/schema.mjs`; probe `dev/probes/p02-config.mjs` returns `{pass:true}` confirming key lists are present and non-empty.

**Steps:**

- [ ] **Step 1: Extend `module/config.mjs`** (append to the `CROWS` object)

```js
Object.assign(CROWS, {
  skills: [
    "alchemy","blacksmithing","climb","enchanting","endurance","gymnastics",
    "handleAnimal","hide","historicalLore","jump","lift","magicLore",
    "monsterLore","natureLore","navigate","pickLock","religiousLore","sabotage",
    "search","sleightOfHand","sneak","swim",
    "alteration","benefaction","conjuration","elemental","illusion","necromancy",
    "bashing","bow","chopping","slashing","stabbing","unarmed"
  ],
  weaponTypes: ["bashing","bow","chopping","slashing","stabbing","unarmed"],
  weaponQualities: ["brutal","cumbersome","disengage","dismember","light","parry","pummeling","reload"],
  armorTypes: ["shield","light","medium","heavy"],
  armorBaseAD: { shield: 5, light: 5, medium: 10, heavy: 15 },
  armorSlots: { shield: 1, light: 2, medium: 3, heavy: 4 },
  disciplines: ["alteration","benefaction","conjuration","elemental","illusion","necromancy"],
  traitTrees: [
    "alchemy","alteration","archery","armor","bashing","benefaction","blacksmithing",
    "camping","chopping","conjuration","elemental","enchantment","illusion","knowledge",
    "leverage","necromancy","pets","reputation","slashing","stabbing","thievery",
    "travel","unarmed"
  ],
  traitTierXP: { 1: 500, 2: 1000, 3: 1500, 4: 2000 },
  creatureTypes: ["animal","blood","undead","demon","angel","plant","unique"],
  sizes: ["tiny","small","medium","large","huge","holyShit"],
  castTypes: ["action","maneuver","reaction","attack","outOfCombat"],
  usageExpiry: ["useless","refuel","rest","activate","dt"],
  equipSlotTypes: ["head","neck","waist","arms","finger","feet"],
  qualityTiers: ["standard","fine","masterwork"],
  gearSubtypes: ["tool","utility","light","wand","ring","wornMagic","treasure"],
  conditions: ["blessed","boned","grabbed","prone","unconscious","hidden","invisible"]
});
```

- [ ] **Step 2: Write `module/helpers/schema.mjs`**

```js
const fields = foundry.data.fields;
import { CROWS } from "../config.mjs";

export function physicalItemFields() {
  return {
    slots: new fields.NumberField({ initial: 1, min: 0, integer: true }),
    stackMax: new fields.NumberField({ initial: 1, min: 1, integer: true }),
    quantity: new fields.NumberField({ initial: 1, min: 0, integer: true }),
    cost: new fields.NumberField({ initial: 0, min: 0, integer: true }), // gc
    equipSlotType: new fields.StringField({ required: false, blank: true, choices: CROWS.equipSlotTypes }),
    weightless: new fields.BooleanField({ initial: false }),
    location: new fields.SchemaField({
      container: new fields.StringField({ initial: "backpack", choices: Object.keys(CROWS.containers) }),
      index: new fields.NumberField({ initial: 0, min: 0, integer: true }),
      length: new fields.NumberField({ initial: 1, min: 1, integer: true })
    })
  };
}

export function usageDieFields() {
  return {
    usageDie: new fields.SchemaField({
      enabled: new fields.BooleanField({ initial: false }),
      udMax: new fields.NumberField({ initial: 1, min: 0, integer: true }),
      udCurrent: new fields.NumberField({ initial: 1, min: 0, integer: true }),
      expiry: new fields.StringField({ initial: "dt", choices: CROWS.usageExpiry }),
      refuelWith: new fields.StringField({ required: false, blank: true })
    })
  };
}
```

- [ ] **Step 3: Write probe `dev/probes/p02-config.mjs`**

```js
const c = CONFIG.CROWS;
const ok = c && c.skills.length > 30 && c.weaponTypes.length === 6 &&
           c.disciplines.length === 6 && c.traitTrees.length >= 23;
return { pass: !!ok, skills: c?.skills.length, trees: c?.traitTrees.length };
```

- [ ] **Step 4: Verify + commit**

Run: `node --check module/config.mjs module/helpers/schema.mjs && bash verify.sh`
Live: run `p02-config.mjs` (after the registration in later tasks exposes CONFIG.CROWS; for now verify `node --check` only).
```bash
git add module/config.mjs module/helpers/schema.mjs
git commit -m "feat: config enums + physical-item/usage-die schema mixins"
```

---

### Task 3: Item DataModels (8 types)

**Goal:** Define and register all 8 Item DataModels with concrete schemas.

**Files:**
- Create: `module/data/item/{weapon,armor,ammunition,consumable,gear,spellbook,trait,background}.mjs`
- Modify: `module/crows.mjs` (register on `CONFIG.Item.dataModels`)

**Acceptance Criteria:**
- [ ] Each of the 8 types is registered and creatable with sensible defaults.
- [ ] Weapon has `type, range{melee,ranged}, attackStat, damage{t2,t3}, qualities[], enchantment, qualityTier` + physical fields.
- [ ] Spellbook has `discipline, rank, castType, aoe, range, target, duration, effectBands` + physical + usage-die fields.
- [ ] Trait has `tree, tier, column, connectsTo[], description, isStarting, restActivity`.

**Verify:** Probe `dev/probes/p03-items.mjs` creates one of each type, asserts defaults, returns `{pass:true}`; then deletes them.

**Steps:**

- [ ] **Step 1: `module/data/item/weapon.mjs`**

```js
const { TypeDataModel } = foundry.abstract;
const fields = foundry.data.fields;
import { CROWS } from "../../config.mjs";
import { physicalItemFields } from "../../helpers/schema.mjs";

export class WeaponData extends TypeDataModel {
  static defineSchema() {
    return {
      ...physicalItemFields(),
      description: new fields.HTMLField(),
      type: new fields.StringField({ initial: "slashing", choices: CROWS.weaponTypes }),
      range: new fields.SchemaField({
        melee: new fields.NumberField({ initial: 1, min: 0, integer: true }),
        ranged: new fields.NumberField({ initial: 0, min: 0, integer: true })
      }),
      attackStat: new fields.StringField({ initial: "strength", choices: ["agility","strength","either"] }),
      damage: new fields.SchemaField({
        t2: new fields.StringField({ initial: "1 + S" }),
        t3: new fields.StringField({ initial: "2 + S" })
      }),
      qualities: new fields.ArrayField(new fields.StringField({ choices: CROWS.weaponQualities })),
      parryValue: new fields.NumberField({ initial: 0, min: 0, integer: true }),
      enchantment: new fields.StringField({ required: false, blank: true }),
      qualityTier: new fields.StringField({ initial: "standard", choices: CROWS.qualityTiers })
    };
  }
}
```

- [ ] **Step 2: `module/data/item/armor.mjs`**

```js
const { TypeDataModel } = foundry.abstract;
const fields = foundry.data.fields;
import { CROWS } from "../../config.mjs";
import { physicalItemFields } from "../../helpers/schema.mjs";

export class ArmorData extends TypeDataModel {
  static defineSchema() {
    return {
      ...physicalItemFields(),
      description: new fields.HTMLField(),
      armorType: new fields.StringField({ initial: "light", choices: CROWS.armorTypes }),
      ad: new fields.NumberField({ initial: 5, min: 0, integer: true }),
      worn: new fields.BooleanField({ initial: false }),
      enchantment: new fields.StringField({ required: false, blank: true }),
      qualityTier: new fields.StringField({ initial: "standard", choices: CROWS.qualityTiers })
    };
  }
}
```

- [ ] **Step 3: `module/data/item/ammunition.mjs`**

```js
const { TypeDataModel } = foundry.abstract;
const fields = foundry.data.fields;
import { physicalItemFields } from "../../helpers/schema.mjs";

export class AmmunitionData extends TypeDataModel {
  static defineSchema() {
    return {
      ...physicalItemFields(),
      description: new fields.HTMLField(),
      ammoFor: new fields.StringField({ initial: "" }),
      countPerUnit: new fields.NumberField({ initial: 20, min: 1, integer: true })
    };
  }
}
```

- [ ] **Step 4: `module/data/item/consumable.mjs`**

```js
const { TypeDataModel } = foundry.abstract;
const fields = foundry.data.fields;
import { physicalItemFields, usageDieFields } from "../../helpers/schema.mjs";

export class ConsumableData extends TypeDataModel {
  static defineSchema() {
    return {
      ...physicalItemFields(),
      ...usageDieFields(),
      description: new fields.HTMLField(),
      useAction: new fields.StringField({ initial: "action", choices: ["action","maneuver"] }),
      bands: new fields.SchemaField({
        t1: new fields.StringField({ blank: true }),
        t2: new fields.StringField({ blank: true }),
        t3: new fields.StringField({ blank: true })
      }),
      thrown: new fields.SchemaField({
        isAttack: new fields.BooleanField({ initial: false }),
        range: new fields.NumberField({ initial: 5, min: 0, integer: true })
      }),
      duration: new fields.StringField({ blank: true })
    };
  }
}
```

- [ ] **Step 5: `module/data/item/gear.mjs`**

```js
const { TypeDataModel } = foundry.abstract;
const fields = foundry.data.fields;
import { CROWS } from "../../config.mjs";
import { physicalItemFields, usageDieFields } from "../../helpers/schema.mjs";

export class GearData extends TypeDataModel {
  static defineSchema() {
    return {
      ...physicalItemFields(),
      ...usageDieFields(),
      description: new fields.HTMLField(),
      subtype: new fields.StringField({ initial: "utility", choices: CROWS.gearSubtypes }),
      light: new fields.SchemaField({
        enabled: new fields.BooleanField({ initial: false }),
        bright: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        dim: new fields.NumberField({ initial: 0, min: 0, integer: true })
      }),
      isMagic: new fields.BooleanField({ initial: false }),
      mystery: new fields.BooleanField({ initial: false }),
      identified: new fields.BooleanField({ initial: true }),
      treasure: new fields.SchemaField({
        size: new fields.StringField({ blank: true, choices: ["tiny","small","medium","large"] }),
        value: new fields.NumberField({ initial: 0, min: 0, integer: true })
      })
    };
  }
}
```

- [ ] **Step 6: `module/data/item/spellbook.mjs`**

```js
const { TypeDataModel } = foundry.abstract;
const fields = foundry.data.fields;
import { CROWS } from "../../config.mjs";
import { physicalItemFields, usageDieFields } from "../../helpers/schema.mjs";

export class SpellbookData extends TypeDataModel {
  static defineSchema() {
    return {
      ...physicalItemFields(),
      ...usageDieFields(),
      description: new fields.HTMLField(),
      discipline: new fields.StringField({ initial: "elemental", choices: CROWS.disciplines }),
      rank: new fields.NumberField({ initial: 0, min: 0, max: 5, integer: true }),
      castType: new fields.StringField({ initial: "action", choices: CROWS.castTypes }),
      range: new fields.SchemaField({
        kind: new fields.StringField({ initial: "ranged", choices: ["self","melee","ranged"] }),
        value: new fields.NumberField({ initial: 5, min: 0, integer: true })
      }),
      target: new fields.StringField({ initial: "1 creature" }),
      aoe: new fields.SchemaField({
        shape: new fields.StringField({ blank: true, choices: ["aura","cube","line"] }),
        size: new fields.StringField({ blank: true })
      }),
      duration: new fields.StringField({ initial: "instant" }),
      effectBands: new fields.SchemaField({
        t1: new fields.StringField({ blank: true }),
        t2: new fields.StringField({ blank: true }),
        t3: new fields.StringField({ blank: true })
      })
    };
  }
}
```

- [ ] **Step 7: `module/data/item/trait.mjs`**

```js
const { TypeDataModel } = foundry.abstract;
const fields = foundry.data.fields;
import { CROWS } from "../../config.mjs";

export class TraitData extends TypeDataModel {
  static defineSchema() {
    return {
      description: new fields.HTMLField(),
      tree: new fields.StringField({ initial: "armor", choices: CROWS.traitTrees }),
      tier: new fields.NumberField({ initial: 1, min: 1, max: 4, integer: true }),
      column: new fields.NumberField({ initial: 1, min: 1, max: 3, integer: true }),
      connectsTo: new fields.ArrayField(new fields.StringField()),
      isStarting: new fields.BooleanField({ initial: false }),
      restActivity: new fields.BooleanField({ initial: false }),
      get xpCost() { return CROWS.traitTierXP[this.tier] ?? 0; }
    };
  }
}
```
> Note: a getter on the schema return won't persist; compute `xpCost` in `prepareDerivedData` instead. Add:
```js
  prepareDerivedData() {
    this.xpCost = CROWS.traitTierXP[this.tier] ?? 0;
  }
```
(Remove the getter line from `defineSchema`.)

- [ ] **Step 8: `module/data/item/background.mjs`**

```js
const { TypeDataModel } = foundry.abstract;
const fields = foundry.data.fields;
import { CROWS } from "../../config.mjs";

export class BackgroundData extends TypeDataModel {
  static defineSchema() {
    return {
      description: new fields.HTMLField(),
      flavor: new fields.StringField({ blank: true }),
      characteristicBonus: new fields.StringField({ initial: "any" }), // "agility"|"mind"|"strength"|"any"|"mind or strength"
      stamina: new fields.NumberField({ initial: 5, min: 1, integer: true }),
      startingTrait: new fields.StringField({ blank: true }), // "Tree: TraitName"
      skills: new fields.ArrayField(new fields.StringField({ choices: CROWS.skills })),
      equipment: new fields.ArrayField(new fields.StringField()),
      spellbooks: new fields.ArrayField(new fields.StringField())
    };
  }
}
```

- [ ] **Step 9: Register in `module/crows.mjs`**

```js
import { WeaponData } from "./data/item/weapon.mjs";
import { ArmorData } from "./data/item/armor.mjs";
import { AmmunitionData } from "./data/item/ammunition.mjs";
import { ConsumableData } from "./data/item/consumable.mjs";
import { GearData } from "./data/item/gear.mjs";
import { SpellbookData } from "./data/item/spellbook.mjs";
import { TraitData } from "./data/item/trait.mjs";
import { BackgroundData } from "./data/item/background.mjs";

Hooks.once("init", () => {
  CONFIG.CROWS = CROWS;
  Object.assign(CONFIG.Item.dataModels, {
    weapon: WeaponData, armor: ArmorData, ammunition: AmmunitionData,
    consumable: ConsumableData, gear: GearData, spellbook: SpellbookData,
    trait: TraitData, background: BackgroundData
  });
});
```

- [ ] **Step 10: Probe `dev/probes/p03-items.mjs`**

```js
const types = ["weapon","armor","ammunition","consumable","gear","spellbook","trait","background"];
const made = [];
for (const t of types) made.push(await Item.create({ name: "T_"+t, type: t }));
const wp = made.find(i => i.type === "weapon");
const sb = made.find(i => i.type === "spellbook");
const ok = made.every(i => i.system) &&
           wp.system.range.melee === 1 && sb.system.rank === 0 &&
           Array.isArray(wp.system.qualities);
for (const i of made) await i.delete();
return { pass: ok, created: made.length };
```

- [ ] **Step 11: Verify + commit**

Run: `node --check module/data/item/*.mjs module/crows.mjs && bash verify.sh`
Live: run `p03-items.mjs` → `{pass:true, created:8}`.
```bash
git add module/data/item/ module/crows.mjs
git commit -m "feat: 8 item DataModels registered"
```

---

### Task 4: Actor DataModels (crow + monster)

**Goal:** Define and register `crow` and `monster` DataModels with derived AD and encumbrance.

**Files:**
- Create: `module/data/actor/crow.mjs`, `module/data/actor/monster.mjs`
- Modify: `module/crows.mjs`

**Acceptance Criteria:**
- [ ] Crow has characteristics{agility,mind,strength}, skills record, stamina{value,max}, wounds, speed, xp{txp,spendable}, currency, conditions{blessed,boned}, details{feature}, background ref.
- [ ] Crow `prepareDerivedData` computes `system.ad` = sum of worn armor/shield AD from embedded items.
- [ ] Monster has power, size, creatureType, stamina, speed{value,modes}, characteristics, attacks[], traits[], slots.

**Verify:** Probe `dev/probes/p04-actors.mjs` creates a crow + monster, equips an armor item, asserts derived `system.ad`, returns `{pass:true}`.

**Steps:**

- [ ] **Step 1: `module/data/actor/crow.mjs`**

```js
const { TypeDataModel } = foundry.abstract;
const fields = foundry.data.fields;
import { CROWS } from "../../config.mjs";

const charField = () => new fields.SchemaField({
  value: new fields.NumberField({ initial: 0, min: -1, max: 3, integer: true })
});

export class CrowData extends TypeDataModel {
  static defineSchema() {
    const skills = {};
    for (const s of CROWS.skills) skills[s] = new fields.SchemaField({
      bonus: new fields.NumberField({ initial: 0, min: 0, max: 2, integer: true })
    });
    return {
      characteristics: new fields.SchemaField({
        agility: charField(), mind: charField(), strength: charField()
      }),
      skills: new fields.SchemaField(skills),
      stamina: new fields.SchemaField({
        value: new fields.NumberField({ initial: 5, min: 0, integer: true }),
        max: new fields.NumberField({ initial: 5, min: 0, integer: true })
      }),
      wounds: new fields.NumberField({ initial: 0, min: 0, max: CROWS.backpackSize, integer: true }),
      speed: new fields.NumberField({ initial: 5, min: 0, integer: true }),
      xp: new fields.SchemaField({
        txp: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        spendable: new fields.NumberField({ initial: 0, min: 0, integer: true })
      }),
      currency: new fields.NumberField({ initial: 0, min: 0, integer: true }),
      conditions: new fields.SchemaField({
        blessed: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        boned: new fields.NumberField({ initial: 0, min: 0, integer: true })
      }),
      background: new fields.StringField({ blank: true }),
      cryptBoon: new fields.StringField({ blank: true }),
      details: new fields.SchemaField({ feature: new fields.HTMLField() })
    };
  }

  prepareDerivedData() {
    let ad = 0;
    for (const i of this.parent.items) {
      if (i.type === "armor" && i.system.worn) ad += i.system.ad ?? 0;
    }
    this.ad = ad;
    // net blessed/boned (cancel 1:1)
    const net = (this.conditions.blessed ?? 0) - (this.conditions.boned ?? 0);
    this.conditionNet = net;
  }
}
```

- [ ] **Step 2: `module/data/actor/monster.mjs`**

```js
const { TypeDataModel } = foundry.abstract;
const fields = foundry.data.fields;
import { CROWS } from "../../config.mjs";

export class MonsterData extends TypeDataModel {
  static defineSchema() {
    return {
      power: new fields.NumberField({ initial: 1, min: 0, max: 50, integer: true }),
      size: new fields.StringField({ initial: "medium", choices: CROWS.sizes }),
      creatureType: new fields.StringField({ initial: "animal", choices: CROWS.creatureTypes }),
      stamina: new fields.SchemaField({
        value: new fields.NumberField({ initial: 5, min: 0, integer: true }),
        max: new fields.NumberField({ initial: 5, min: 0, integer: true })
      }),
      speed: new fields.SchemaField({
        value: new fields.NumberField({ initial: 6, min: 0, integer: true }),
        modes: new fields.ArrayField(new fields.SchemaField({
          name: new fields.StringField(),
          value: new fields.NumberField({ initial: 0, min: 0, integer: true })
        }))
      }),
      characteristics: new fields.SchemaField({
        agility: new fields.NumberField({ initial: 0, integer: true }),
        mind: new fields.NumberField({ initial: 0, integer: true }),
        strength: new fields.NumberField({ initial: 0, integer: true })
      }),
      ad: new fields.NumberField({ initial: 0, min: 0, integer: true }),
      slots: new fields.NumberField({ initial: 0, min: 0, integer: true }),
      attacks: new fields.ArrayField(new fields.SchemaField({
        name: new fields.StringField({ initial: "Attack" }),
        toHit: new fields.NumberField({ initial: 0, integer: true }),
        range: new fields.StringField({ initial: "Melee 1" }),
        targets: new fields.NumberField({ initial: 1, min: 1, integer: true }),
        dmgT2: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        dmgT3: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        riderRef: new fields.StringField({ blank: true })
      })),
      traits: new fields.ArrayField(new fields.SchemaField({
        name: new fields.StringField(),
        effect: new fields.HTMLField(),
        uses: new fields.StringField({ blank: true }),
        linkedAttack: new fields.StringField({ blank: true })
      })),
      colloquialNames: new fields.ArrayField(new fields.StringField())
    };
  }
}
```

- [ ] **Step 3: Register in `module/crows.mjs`** (inside the init hook)

```js
import { CrowData } from "./data/actor/crow.mjs";
import { MonsterData } from "./data/actor/monster.mjs";
// ...within init:
Object.assign(CONFIG.Actor.dataModels, { crow: CrowData, monster: MonsterData });
```

- [ ] **Step 4: Probe `dev/probes/p04-actors.mjs`**

```js
const crow = await Actor.create({ name: "TestCrow", type: "crow" });
const mon = await Actor.create({ name: "TestMonster", type: "monster" });
await crow.createEmbeddedDocuments("Item", [{
  name: "Test Plate", type: "armor", system: { armorType: "heavy", ad: 15, worn: true }
}]);
crow.prepareDerivedData();
const ok = crow.system.ad === 15 && mon.system.power >= 0 &&
           crow.system.skills.climb?.bonus === 0;
await crow.delete(); await mon.delete();
return { pass: ok, ad: crow.system.ad };
```

- [ ] **Step 5: Verify + commit**

Run: `node --check module/data/actor/*.mjs module/crows.mjs && bash verify.sh`
Live: run `p04-actors.mjs` → `{pass:true, ad:15}`.
```bash
git add module/data/actor/ module/crows.mjs
git commit -m "feat: crow + monster DataModels with derived AD"
```

---

### Task 5: Roll pipeline (2d10 tier engine + chat card)

**Goal:** A reusable `rollTest()` that builds `2d10 + char + skill + mods`, classifies tier/doom/crit, and renders a chat card; pure tier logic split out for unit-probing.

**Files:**
- Create: `module/helpers/roll.mjs`
- Create: `templates/chat/test-card.hbs`
- Modify: `module/crows.mjs` (preload templates, expose `game.crows.rollTest`)

**Acceptance Criteria:**
- [ ] `classifyTier(total)` → 1 for ≤11, 2 for 12–16, 3 for ≥17.
- [ ] `classifyDoomCrit(rawSum)` → `{doom: rawSum∈{2,3}, crit: rawSum∈{19,20}}` (rawSum = the two d10 faces only, before modifiers).
- [ ] `rollTest()` posts a chat message whose flavor shows the tier band; for attacks, shows t2/t3 damage with an Apply button (button is a no-op stub in M1 beyond printing the value).

**Verify:** Probe `dev/probes/p05-roll.mjs` calls the pure functions across boundary totals (11,12,16,17) and raw sums (2,3,4,18,19,20) and asserts the classifications; returns `{pass:true}`.

**Steps:**

- [ ] **Step 1: `module/helpers/roll.mjs`**

```js
import { CROWS } from "../config.mjs";

export function classifyTier(total) {
  if (total <= CROWS.tiers.t1Max) return 1;
  if (total <= CROWS.tiers.t2Max) return 2;
  return 3;
}

export function classifyDoomCrit(rawSum) {
  return {
    doom: CROWS.doomFaces.includes(rawSum),
    crit: CROWS.critFaces.includes(rawSum)
  };
}

export async function rollTest({ actor, characteristic = null, skill = null, mods = [], flavor = "Test", attack = null, casting = null } = {}) {
  const charVal = characteristic ? (actor?.system.characteristics?.[characteristic]?.value ?? actor?.system.characteristics?.[characteristic] ?? 0) : 0;
  const skillBonus = skill ? (actor?.system.skills?.[skill]?.bonus ?? 0) : 0;
  const flat = mods.reduce((a, m) => a + (m.value ?? 0), 0);
  const formula = `2d10 + ${charVal} + ${skillBonus} + ${flat}`;
  const roll = await new Roll(formula).evaluate();
  const d10s = roll.dice.find(d => d.faces === 10);
  const rawSum = d10s ? d10s.results.reduce((a, r) => a + r.result, 0) : roll.total;
  const tier = classifyTier(roll.total);
  const { doom, crit } = classifyDoomCrit(rawSum);

  const data = {
    flavor, tier, doom, crit, total: roll.total, rawSum,
    char: characteristic, charVal, skill, skillBonus,
    attack, casting,
    bandLabel: tier === 1 ? "≤11 (Tier 1)" : tier === 2 ? "12–16 (Tier 2)" : "17+ (Tier 3)"
  };
  const content = await foundry.applications.handlebars.renderTemplate("systems/crows/templates/chat/test-card.hbs", data);
  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor, content }, { rollMode: game.settings.get("core", "rollMode") });
  return { roll, tier, doom, crit };
}
```
> Note: in v13/v14 `renderTemplate` is `foundry.applications.handlebars.renderTemplate`. If running pure v13, the global `renderTemplate` alias still exists; prefer the namespaced form.

- [ ] **Step 2: `templates/chat/test-card.hbs`**

```hbs
<div class="crows test-card tier-{{tier}}">
  <header class="band {{#if doom}}doom{{/if}} {{#if crit}}crit{{/if}}">
    <span class="band-label">{{bandLabel}}</span>
    {{#if doom}}<span class="badge doom">DOOM</span>{{/if}}
    {{#if crit}}<span class="badge crit">CRIT</span>{{/if}}
  </header>
  {{#if attack}}
    <div class="damage">
      <button type="button" data-action="applyDamage" data-amount="{{attack.t2}}">Apply T2: {{attack.t2}}</button>
      <button type="button" data-action="applyDamage" data-amount="{{attack.t3}}">Apply T3: {{attack.t3}}</button>
    </div>
  {{/if}}
  {{#if casting}}<div class="casting-note">Casting: rank {{casting.rank}} {{casting.discipline}}</div>{{/if}}
</div>
```

- [ ] **Step 3: Expose API + preload template in `module/crows.mjs`**

```js
import { rollTest, classifyTier, classifyDoomCrit } from "./helpers/roll.mjs";
// within init:
game.crows = Object.assign(game.crows ?? {}, { rollTest, classifyTier, classifyDoomCrit });
// within ready (or init): preload
foundry.applications.handlebars.loadTemplates([
  "systems/crows/templates/chat/test-card.hbs"
]);
```

- [ ] **Step 4: Probe `dev/probes/p05-roll.mjs`**

```js
const { classifyTier, classifyDoomCrit } = game.crows;
const tierOK = classifyTier(11)===1 && classifyTier(12)===2 && classifyTier(16)===2 && classifyTier(17)===3;
const dc = classifyDoomCrit;
const dcOK = dc(2).doom && dc(3).doom && !dc(4).doom && dc(19).crit && dc(20).crit && !dc(18).crit;
return { pass: tierOK && dcOK };
```

- [ ] **Step 5: Verify + commit**

Run: `node --check module/helpers/roll.mjs module/crows.mjs && bash verify.sh`
Live: run `p05-roll.mjs` → `{pass:true}`; also manually call `await game.crows.rollTest({actor: game.actors.contents[0], characteristic:"strength", skill:"climb", flavor:"Climb"})` and confirm a chat card with the right band.
```bash
git add module/helpers/roll.mjs templates/chat/test-card.hbs module/crows.mjs
git commit -m "feat: 2d10 tier roll pipeline + chat card"
```

---

### Task 6: Slot inventory logic

**Goal:** Pure helpers for slot occupancy, placement validity, stacking, and wound-slot accounting, plus a usage-die roller.

**Files:**
- Create: `module/helpers/slots.mjs`
- Create: `module/helpers/usage-die.mjs`

**Acceptance Criteria:**
- [ ] `containerOccupancy(actor, container)` returns `{used, capacity}` summing item `slots`×`ceil(qty/stackMax)`-aware placement.
- [ ] `backpackFree(actor)` accounts for wounds occupying backpack slots from the bottom: `capacity = backpackSize - wounds`.
- [ ] `canPlace(actor, item, container, index)` returns false on overflow or wrong stack.
- [ ] `rollUsageDie(item)` rolls 1d6, removes a die on 1–2, returns `{removed, udCurrent, depleted}`.

**Verify:** Probe `dev/probes/p06-slots.mjs` builds a crow with items + wounds and asserts occupancy/free/canPlace; asserts `rollUsageDie` decrements correctly (seeded by forcing the result). Returns `{pass:true}`.

**Steps:**

- [ ] **Step 1: `module/helpers/slots.mjs`**

```js
import { CROWS } from "../config.mjs";

export function backpackCapacity(actor) {
  const wounds = actor.system.wounds ?? 0;
  return Math.max(0, CROWS.backpackSize - wounds);
}

export function containerCapacity(actor, container) {
  if (container === "backpack") return backpackCapacity(actor);
  return CROWS.containers[container] ?? 0;
}

export function containerUsed(actor, container) {
  let used = 0;
  for (const i of actor.items) {
    const loc = i.system?.location;
    if (!loc || loc.container !== container) continue;
    if (i.system.weightless) continue;
    used += loc.length ?? (i.system.slots ?? 1);
  }
  return used;
}

export function containerOccupancy(actor, container) {
  return { used: containerUsed(actor, container), capacity: containerCapacity(actor, container) };
}

export function canPlace(actor, item, container, index) {
  const cap = containerCapacity(actor, container);
  const need = item.system?.slots ?? 1;
  const used = containerUsed(actor, container);
  if (container === "hand" && (item.system?.slots ?? 1) > 2) return false;
  return (used + need) <= cap && index >= 0 && (index + need) <= cap;
}
```

- [ ] **Step 2: `module/helpers/usage-die.mjs`**

```js
export async function rollUsageDie(item, { forced = null } = {}) {
  const ud = item.system?.usageDie;
  if (!ud?.enabled || ud.udCurrent <= 0) return { removed: false, udCurrent: ud?.udCurrent ?? 0, depleted: (ud?.udCurrent ?? 0) <= 0 };
  const r = forced ?? (await new Roll("1d6").evaluate()).total;
  const removed = r <= 2;
  const next = removed ? Math.max(0, ud.udCurrent - 1) : ud.udCurrent;
  if (removed) await item.update({ "system.usageDie.udCurrent": next });
  return { removed, roll: r, udCurrent: next, depleted: next <= 0 };
}
```

- [ ] **Step 3: Probe `dev/probes/p06-slots.mjs`**

```js
const { containerOccupancy, canPlace, backpackCapacity } = await import("/systems/crows/module/helpers/slots.mjs");
const { rollUsageDie } = await import("/systems/crows/module/helpers/usage-die.mjs");
const crow = await Actor.create({ name: "TestCrow", type: "crow", system: { wounds: 2 } });
await crow.createEmbeddedDocuments("Item", [
  { name: "Maul", type: "weapon", system: { slots: 2, location: { container: "backpack", index: 0, length: 2 } } },
  { name: "Torch", type: "gear", system: { slots: 1, usageDie: { enabled: true, udMax: 1, udCurrent: 1, expiry: "dt" }, location: { container: "backpack", index: 2, length: 1 } } }
]);
const occ = containerOccupancy(crow, "backpack");          // used 3, capacity 8 (10-2)
const cap = backpackCapacity(crow);                         // 8
const torch = crow.items.getName("Torch");
const ud = await rollUsageDie(torch, { forced: 1 });        // removes -> depleted
const ok = occ.used === 3 && cap === 8 && ud.removed && ud.depleted;
await crow.delete();
return { pass: ok, occ, cap, ud };
```

- [ ] **Step 4: Verify + commit**

Run: `node --check module/helpers/slots.mjs module/helpers/usage-die.mjs && bash verify.sh`
Live: run `p06-slots.mjs` → `{pass:true}`.
```bash
git add module/helpers/slots.mjs module/helpers/usage-die.mjs
git commit -m "feat: slot occupancy + usage-die roller"
```

---

### Task 7: Item sheets (ApplicationV2)

**Goal:** A single type-driven `CrowsItemSheet` rendering each item type with shared partials for physical + usage-die fields.

**Files:**
- Create: `module/sheets/item-sheet.mjs`
- Create: `templates/item/{weapon,armor,ammunition,consumable,gear,spellbook,trait,background}.hbs`
- Create: `templates/partials/physical-item.hbs`, `templates/partials/usage-die.hbs`
- Modify: `module/crows.mjs` (register sheet + preload partials)

**Acceptance Criteria:**
- [ ] Each item type opens a sheet without console error and edits persist.
- [ ] Weapon sheet exposes type, range, attackStat, damage t2/t3, qualities; spellbook exposes discipline/rank/castType/range/effect bands + usage-die partial.

**Verify:** Probe `dev/probes/p07-item-sheets.mjs` opens (renders) one sheet of each type headless via `sheet.render(true)` then closes; asserts no throw. Manual: edit a field, reopen, confirm persisted.

**Steps:**

- [ ] **Step 1: `module/sheets/item-sheet.mjs`**

```js
const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;
import { CROWS } from "../config.mjs";

export class CrowsItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["crows", "sheet", "item"],
    position: { width: 480, height: "auto" },
    form: { submitOnChange: true },
    window: { resizable: true }
  };

  static PARTS = {
    body: { template: null } // set per-render via _configureRenderParts
  };

  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    parts.body = { template: `systems/crows/templates/item/${this.document.type}.hbs` };
    return parts;
  }

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    ctx.system = this.document.system;
    ctx.item = this.document;
    ctx.CROWS = CROWS;
    ctx.fields = this.document.system.schema.fields;
    return ctx;
  }
}
```
> If `_configureRenderParts` is unavailable on the installed core version, instead override `static PARTS` getter or set `this.constructor.PARTS.body.template` in `_preparePartContext`. Verify against the running build during execution.

- [ ] **Step 2: `templates/partials/physical-item.hbs`**

```hbs
<div class="physical">
  <label>Slots <input type="number" name="system.slots" value="{{system.slots}}"></label>
  <label>Stack max <input type="number" name="system.stackMax" value="{{system.stackMax}}"></label>
  <label>Qty <input type="number" name="system.quantity" value="{{system.quantity}}"></label>
  <label>Cost (gc) <input type="number" name="system.cost" value="{{system.cost}}"></label>
</div>
```

- [ ] **Step 3: `templates/partials/usage-die.hbs`**

```hbs
<div class="usage-die">
  <label><input type="checkbox" name="system.usageDie.enabled" {{checked system.usageDie.enabled}}> Usage Die</label>
  <label>Max <input type="number" name="system.usageDie.udMax" value="{{system.usageDie.udMax}}"></label>
  <label>Current <input type="number" name="system.usageDie.udCurrent" value="{{system.usageDie.udCurrent}}"></label>
  <label>Expiry
    <select name="system.usageDie.expiry">
      {{#each CROWS.usageExpiry as |e|}}<option value="{{e}}" {{#if (eq e ../system.usageDie.expiry)}}selected{{/if}}>{{e}}</option>{{/each}}
    </select>
  </label>
</div>
```

- [ ] **Step 4: `templates/item/weapon.hbs`** (representative; others follow the same shape with their fields)

```hbs
<form class="crows-item weapon">
  <input type="text" name="name" value="{{item.name}}" class="title">
  <label>Type
    <select name="system.type">
      {{#each CROWS.weaponTypes as |t|}}<option value="{{t}}" {{#if (eq t ../system.type)}}selected{{/if}}>{{t}}</option>{{/each}}
    </select>
  </label>
  <label>Melee <input type="number" name="system.range.melee" value="{{system.range.melee}}"></label>
  <label>Ranged <input type="number" name="system.range.ranged" value="{{system.range.ranged}}"></label>
  <label>Attack stat
    <select name="system.attackStat">
      <option value="strength" {{#if (eq system.attackStat "strength")}}selected{{/if}}>S</option>
      <option value="agility" {{#if (eq system.attackStat "agility")}}selected{{/if}}>A</option>
      <option value="either" {{#if (eq system.attackStat "either")}}selected{{/if}}>A or S</option>
    </select>
  </label>
  <label>Dmg T2 <input type="text" name="system.damage.t2" value="{{system.damage.t2}}"></label>
  <label>Dmg T3 <input type="text" name="system.damage.t3" value="{{system.damage.t3}}"></label>
  {{> "systems/crows/templates/partials/physical-item.hbs"}}
  <div class="desc">{{editor (lookup item.system 'description') target="system.description" engine="prosemirror"}}</div>
</form>
```
> The remaining type templates (`armor.hbs`, `ammunition.hbs`, `consumable.hbs`, `gear.hbs`, `spellbook.hbs`, `trait.hbs`, `background.hbs`) each render their own fields from the matching DataModel schema in Task 3, and include `physical-item.hbs` (all except trait/background) and `usage-die.hbs` (consumable, gear, spellbook). Field names map 1:1 to `system.*` paths. spellbook.hbs must expose: discipline (select CROWS.disciplines), rank (number), castType (select CROWS.castTypes), range.kind/value, target, duration, effectBands.t1/t2/t3, plus the usage-die partial.

- [ ] **Step 5: Register a Handlebars `eq` helper + sheet in `module/crows.mjs`**

```js
import { CrowsItemSheet } from "./sheets/item-sheet.mjs";
// within init:
Handlebars.registerHelper("eq", (a, b) => a === b);
foundry.documents.collections.Items.registerSheet("crows", CrowsItemSheet, { makeDefault: true, label: "Crows Item Sheet" });
foundry.applications.handlebars.loadTemplates([
  "systems/crows/templates/partials/physical-item.hbs",
  "systems/crows/templates/partials/usage-die.hbs"
]);
```

- [ ] **Step 6: Probe `dev/probes/p07-item-sheets.mjs`**

```js
const types = ["weapon","armor","ammunition","consumable","gear","spellbook","trait","background"];
let pass = true; const errs = [];
for (const t of types) {
  const it = await Item.create({ name: "S_"+t, type: t });
  try { await it.sheet.render(true); await it.sheet.close(); }
  catch (e) { pass = false; errs.push(`${t}: ${e.message}`); }
  await it.delete();
}
return { pass, errs };
```

- [ ] **Step 7: Verify + commit**

Run: `node --check module/sheets/item-sheet.mjs module/crows.mjs && bash verify.sh`
Live: run `p07-item-sheets.mjs` → `{pass:true, errs:[]}`.
```bash
git add module/sheets/item-sheet.mjs templates/item/ templates/partials/ module/crows.mjs
git commit -m "feat: ApplicationV2 item sheets for all 8 types"
```

---

### Task 8: Monster sheet

**Goal:** A compact monster sheet with clickable attacks that fire `rollTest` and post a damage card.

**Files:**
- Create: `module/sheets/monster-sheet.mjs`
- Create: `templates/actor/monster.hbs`
- Modify: `module/crows.mjs`

**Acceptance Criteria:**
- [ ] Monster sheet renders power/size/type/stamina/speed/characteristics, attacks list, traits.
- [ ] Clicking an attack posts a chat card (uses `rollTest` with `attack:{t2,t3}` from the attack entry, characteristic from the attack's stat or none + flat toHit mod).

**Verify:** Probe `dev/probes/p08-monster.mjs` creates a monster with one attack, renders the sheet, simulates the attack action, asserts a ChatMessage was created. Returns `{pass:true}`.

**Steps:**

- [ ] **Step 1: `module/sheets/monster-sheet.mjs`**

```js
const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
import { CROWS } from "../config.mjs";
import { rollTest } from "../helpers/roll.mjs";

export class MonsterSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["crows", "sheet", "monster"],
    position: { width: 520, height: 600 },
    actions: { rollAttack: MonsterSheet._onRollAttack },
    window: { resizable: true }
  };
  static PARTS = { body: { template: "systems/crows/templates/actor/monster.hbs" } };

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    ctx.system = this.document.system; ctx.actor = this.document; ctx.CROWS = CROWS;
    return ctx;
  }

  static async _onRollAttack(event, target) {
    const idx = Number(target.dataset.index);
    const atk = this.document.system.attacks[idx];
    await rollTest({
      actor: this.document, mods: [{ value: atk.toHit }],
      flavor: `${this.document.name}: ${atk.name}`,
      attack: { t2: atk.dmgT2, t3: atk.dmgT3 }
    });
  }
}
```

- [ ] **Step 2: `templates/actor/monster.hbs`**

```hbs
<form class="crows-monster">
  <header>
    <input type="text" name="name" value="{{actor.name}}" class="title">
    <span>Power {{system.power}} · {{system.size}} · {{system.creatureType}}</span>
  </header>
  <div class="stats">
    <label>Stamina <input type="number" name="system.stamina.value" value="{{system.stamina.value}}">/<input type="number" name="system.stamina.max" value="{{system.stamina.max}}"></label>
    <label>Speed <input type="number" name="system.speed.value" value="{{system.speed.value}}"></label>
    <span>A {{system.characteristics.agility}} · M {{system.characteristics.mind}} · S {{system.characteristics.strength}}</span>
  </div>
  <section class="attacks">
    <h3>Attacks</h3>
    {{#each system.attacks as |atk i|}}
      <div class="attack">
        <button type="button" data-action="rollAttack" data-index="{{i}}">{{atk.name}} ({{atk.toHit}})</button>
        <span>{{atk.range}} · {{atk.dmgT2}}/{{atk.dmgT3}}</span>
      </div>
    {{/each}}
  </section>
  <section class="traits">
    <h3>Traits</h3>
    {{#each system.traits as |t|}}<div class="trait"><b>{{t.name}}</b> {{{t.effect}}}</div>{{/each}}
  </section>
</form>
```

- [ ] **Step 3: Register in `module/crows.mjs`**

```js
import { MonsterSheet } from "./sheets/monster-sheet.mjs";
// within init:
foundry.documents.collections.Actors.registerSheet("crows", MonsterSheet, { types: ["monster"], makeDefault: true, label: "Crows Monster Sheet" });
foundry.applications.handlebars.loadTemplates(["systems/crows/templates/actor/monster.hbs"]);
```

- [ ] **Step 4: Probe `dev/probes/p08-monster.mjs`**

```js
const mon = await Actor.create({ name: "TestMonster", type: "monster", system: {
  attacks: [{ name: "Bite", toHit: 2, range: "Melee 1", targets: 1, dmgT2: 3, dmgT3: 4 }]
}});
const before = game.messages.size;
await mon.sheet.render(true);
await mon.sheet.constructor._onRollAttack.call(mon.sheet, new Event("click"), { dataset: { index: "0" } });
const after = game.messages.size;
await mon.sheet.close(); await mon.delete();
return { pass: after > before, before, after };
```

- [ ] **Step 5: Verify + commit**

Run: `node --check module/sheets/monster-sheet.mjs module/crows.mjs && bash verify.sh`
Live: run `p08-monster.mjs` → `{pass:true}`.
```bash
git add module/sheets/monster-sheet.mjs templates/actor/monster.hbs module/crows.mjs
git commit -m "feat: monster sheet with clickable attacks"
```

---

### Task 9: Crow (PC) sheet

**Goal:** The main PC sheet: header stats, tabbed body (Play/Inventory/Traits/Advancement/Bio), skill roll buttons, slot-grid inventory render, condition counters.

**Files:**
- Create: `module/sheets/crow-sheet.mjs`
- Create: `templates/actor/crow/{header,play,inventory,traits,advancement,bio}.hbs`
- Create: `templates/partials/slot-grid.hbs`
- Modify: `module/crows.mjs`, `css/crows.css`

**Acceptance Criteria:**
- [ ] Crow sheet renders header (A/M/S, Stamina cur/max, wounds, speed, derived AD, blessed/boned) and 5 tabs.
- [ ] Each skill row has a roll button that calls `rollTest` with a chosen characteristic (default: a `data-characteristic` on the button; M1 may default weapon skills→strength, spell skills→mind, else agility) and the skill bonus.
- [ ] Inventory tab renders the slot grid: hand×2, belt×2, single equip slots, backpack×10 with wound overlay on the bottom `wounds` cells.
- [ ] Conditions show blessed/boned counters with +/- buttons.

**Verify:** Probe `dev/probes/p09-crow.mjs` creates a crow with items + 2 wounds, renders the sheet, simulates a skill roll action (asserts a ChatMessage), and asserts the slot-grid context marks 2 backpack cells as wounds. Returns `{pass:true}`.

**Steps:**

- [ ] **Step 1: `module/sheets/crow-sheet.mjs`**

```js
const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
import { CROWS } from "../config.mjs";
import { rollTest } from "../helpers/roll.mjs";
import { containerCapacity } from "../helpers/slots.mjs";

const SPELL_SKILLS = new Set(["alteration","benefaction","conjuration","elemental","illusion","necromancy"]);
const WEAPON_SKILLS = new Set(["bashing","bow","chopping","slashing","stabbing","unarmed"]);

export class CrowSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["crows", "sheet", "crow"],
    position: { width: 720, height: 760 },
    actions: { rollSkill: CrowSheet._onRollSkill, adjBlessed: CrowSheet._onAdjBlessed, adjBoned: CrowSheet._onAdjBoned },
    window: { resizable: true },
    form: { submitOnChange: true }
  };

  static PARTS = {
    header: { template: "systems/crows/templates/actor/crow/header.hbs" },
    tabs:   { template: "templates/generic/tab-navigation.hbs" },
    play:   { template: "systems/crows/templates/actor/crow/play.hbs" },
    inventory: { template: "systems/crows/templates/actor/crow/inventory.hbs" },
    traits: { template: "systems/crows/templates/actor/crow/traits.hbs" },
    advancement: { template: "systems/crows/templates/actor/crow/advancement.hbs" },
    bio: { template: "systems/crows/templates/actor/crow/bio.hbs" }
  };

  static TABS = { primary: { tabs: [
    { id: "play" }, { id: "inventory" }, { id: "traits" }, { id: "advancement" }, { id: "bio" }
  ], initial: "play" } };

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    const sys = this.document.system;
    ctx.system = sys; ctx.actor = this.document; ctx.CROWS = CROWS;
    ctx.skills = Object.entries(sys.skills).map(([k, v]) => ({
      key: k, bonus: v.bonus,
      char: WEAPON_SKILLS.has(k) ? "strength" : SPELL_SKILLS.has(k) ? "mind" : "agility"
    }));
    ctx.grid = this._buildGrid();
    ctx.items = this.document.items.contents;
    return ctx;
  }

  _buildGrid() {
    const sys = this.document.system;
    const byContainer = (c) => this.document.items.filter(i => i.system?.location?.container === c);
    const backpackCap = CROWS.backpackSize;
    const wounds = sys.wounds ?? 0;
    const backpack = [];
    for (let i = 0; i < backpackCap; i++) {
      const isWound = i >= (backpackCap - wounds); // wounds fill from the bottom
      const item = byContainer("backpack").find(it => it.system.location.index === i);
      backpack.push({ index: i, isWound, item });
    }
    return {
      hand: byContainer("hand"), belt: byContainer("belt"),
      single: ["waist","neck","gloves","boots","ring","head"].map(c => ({ c, item: byContainer(c)[0] ?? null })),
      backpack
    };
  }

  static async _onRollSkill(event, target) {
    const skill = target.dataset.skill;
    const characteristic = target.dataset.characteristic;
    await rollTest({ actor: this.document, characteristic, skill, flavor: `${skill} test` });
  }
  static async _onAdjBlessed(event, target) {
    const d = Number(target.dataset.delta);
    await this.document.update({ "system.conditions.blessed": Math.max(0, (this.document.system.conditions.blessed ?? 0) + d) });
  }
  static async _onAdjBoned(event, target) {
    const d = Number(target.dataset.delta);
    await this.document.update({ "system.conditions.boned": Math.max(0, (this.document.system.conditions.boned ?? 0) + d) });
  }
}
```
> Note: the `tabs` PART template path (`templates/generic/tab-navigation.hbs`) is core-provided in v13/v14. If the running build differs, render tabs in `header.hbs` manually. Verify during execution.

- [ ] **Step 2: `templates/actor/crow/header.hbs`**

```hbs
<header class="crows-crow-header">
  <input type="text" name="name" value="{{actor.name}}" class="title">
  <div class="chars">
    <label>A <input type="number" name="system.characteristics.agility.value" value="{{system.characteristics.agility.value}}"></label>
    <label>M <input type="number" name="system.characteristics.mind.value" value="{{system.characteristics.mind.value}}"></label>
    <label>S <input type="number" name="system.characteristics.strength.value" value="{{system.characteristics.strength.value}}"></label>
  </div>
  <div class="vitals">
    <label>Stamina <input type="number" name="system.stamina.value" value="{{system.stamina.value}}">/<input type="number" name="system.stamina.max" value="{{system.stamina.max}}"></label>
    <span>Wounds {{system.wounds}}</span>
    <span>Speed {{system.speed}}</span>
    <span>AD {{system.ad}}</span>
  </div>
  <div class="conditions">
    <span>Blessed {{system.conditions.blessed}}
      <button type="button" data-action="adjBlessed" data-delta="1">+</button>
      <button type="button" data-action="adjBlessed" data-delta="-1">−</button></span>
    <span>Boned {{system.conditions.boned}}
      <button type="button" data-action="adjBoned" data-delta="1">+</button>
      <button type="button" data-action="adjBoned" data-delta="-1">−</button></span>
  </div>
</header>
```

- [ ] **Step 3: `templates/actor/crow/play.hbs`**

```hbs
<section class="tab play" data-tab="play">
  <h3>Skills</h3>
  <div class="skill-list">
    {{#each skills as |s|}}
      <div class="skill-row">
        <button type="button" data-action="rollSkill" data-skill="{{s.key}}" data-characteristic="{{s.char}}">{{s.key}} (+{{s.bonus}})</button>
      </div>
    {{/each}}
  </div>
</section>
```

- [ ] **Step 4: `templates/partials/slot-grid.hbs` + `templates/actor/crow/inventory.hbs`**

`slot-grid.hbs`:
```hbs
<div class="slot-grid">
  <div class="row hands">{{#each grid.hand as |it|}}<div class="slot">{{it.name}}</div>{{/each}}</div>
  <div class="row belt">{{#each grid.belt as |it|}}<div class="slot">{{it.name}}</div>{{/each}}</div>
  <div class="row single">{{#each grid.single as |s|}}<div class="slot single" data-slot="{{s.c}}">{{s.c}}: {{#if s.item}}{{s.item.name}}{{/if}}</div>{{/each}}</div>
  <div class="row backpack">
    {{#each grid.backpack as |cell|}}
      <div class="slot backpack {{#if cell.isWound}}wound{{/if}}" data-index="{{cell.index}}">
        {{#if cell.isWound}}✚ wound{{else}}{{#if cell.item}}{{cell.item.name}}{{/if}}{{/if}}
      </div>
    {{/each}}
  </div>
</div>
```
`inventory.hbs`:
```hbs
<section class="tab inventory" data-tab="inventory">
  {{> "systems/crows/templates/partials/slot-grid.hbs"}}
</section>
```

- [ ] **Step 5: `traits.hbs`, `advancement.hbs`, `bio.hbs` (M1 minimal)**

`traits.hbs`:
```hbs
<section class="tab traits" data-tab="traits">
  {{#each items as |i|}}{{#if (eq i.type "trait")}}<div class="trait"><b>{{i.name}}</b> — {{i.system.tree}} t{{i.system.tier}}</div>{{/if}}{{/each}}
</section>
```
`advancement.hbs`:
```hbs
<section class="tab advancement" data-tab="advancement">
  <div>TXP {{system.xp.txp}} · Spendable XP {{system.xp.spendable}}</div>
  <p>Advancement spend UI lands in M3.</p>
</section>
```
`bio.hbs`:
```hbs
<section class="tab bio" data-tab="bio">
  <div>Background: {{system.background}}</div>
  <div class="feature">{{{system.details.feature}}}</div>
</section>
```

- [ ] **Step 6: Register sheet + minimal grid CSS**

In `module/crows.mjs` init:
```js
import { CrowSheet } from "./sheets/crow-sheet.mjs";
foundry.documents.collections.Actors.registerSheet("crows", CrowSheet, { types: ["crow"], makeDefault: true, label: "Crow Sheet" });
foundry.applications.handlebars.loadTemplates([
  "systems/crows/templates/actor/crow/header.hbs",
  "systems/crows/templates/actor/crow/play.hbs",
  "systems/crows/templates/actor/crow/inventory.hbs",
  "systems/crows/templates/actor/crow/traits.hbs",
  "systems/crows/templates/actor/crow/advancement.hbs",
  "systems/crows/templates/actor/crow/bio.hbs",
  "systems/crows/templates/partials/slot-grid.hbs"
]);
```
Append to `css/crows.css`:
```css
.slot-grid .row { display: flex; gap: 4px; margin-bottom: 4px; }
.slot-grid .slot { border: 1px solid #888; min-width: 90px; min-height: 28px; padding: 2px 4px; }
.slot-grid .slot.backpack.wound { background: #5c1a1a; color: #fff; }
.slot-grid .row.backpack { flex-wrap: wrap; }
```

- [ ] **Step 7: Probe `dev/probes/p09-crow.mjs`**

```js
const crow = await Actor.create({ name: "TestCrow", type: "crow", system: { wounds: 2 } });
await crow.createEmbeddedDocuments("Item", [
  { name: "Knife", type: "weapon", system: { location: { container: "hand", index: 0, length: 1 } } }
]);
await crow.sheet.render(true);
const before = game.messages.size;
await crow.sheet.constructor._onRollSkill.call(crow.sheet, new Event("click"), { dataset: { skill: "climb", characteristic: "strength" } });
const after = game.messages.size;
// inspect grid context
const ctx = await crow.sheet._prepareContext({});
const woundCells = ctx.grid.backpack.filter(c => c.isWound).length;
await crow.sheet.close(); await crow.delete();
return { pass: after > before && woundCells === 2, woundCells };
```

- [ ] **Step 8: Verify + commit**

Run: `node --check module/sheets/crow-sheet.mjs module/crows.mjs && bash verify.sh`
Live: run `p09-crow.mjs` → `{pass:true, woundCells:2}`. Manually open a crow, roll a skill, switch tabs, confirm the slot grid + wound overlay.
```bash
git add module/sheets/crow-sheet.mjs templates/actor/crow/ templates/partials/slot-grid.hbs module/crows.mjs css/crows.css
git commit -m "feat: crow PC sheet (header, tabs, skill rolls, slot grid)"
```

---

### Task 10: Conditions / status effects

**Goal:** Register Crows status effects so GMs can toggle them on tokens (visual only in M1).

**Files:**
- Create: `module/conditions.mjs`
- Modify: `module/crows.mjs`

**Acceptance Criteria:**
- [ ] `CONFIG.statusEffects` includes blessed, boned, grabbed, prone, unconscious, hidden, invisible (with ids + labels; icons fall back to core if no art).
- [ ] Toggling a status on a token via MCP adds the effect.

**Verify:** Probe `dev/probes/p10-status.mjs` confirms the 7 status ids are present in `CONFIG.statusEffects`. Returns `{pass:true}`.

**Steps:**

- [ ] **Step 1: `module/conditions.mjs`**

```js
export const CROWS_STATUS = [
  { id: "blessed", name: "Blessed", img: "icons/svg/angel.svg" },
  { id: "boned", name: "Boned", img: "icons/svg/skull.svg" },
  { id: "grabbed", name: "Grabbed", img: "icons/svg/net.svg" },
  { id: "prone", name: "Prone", img: "icons/svg/falling.svg" },
  { id: "unconscious", name: "Unconscious", img: "icons/svg/unconscious.svg" },
  { id: "hidden", name: "Hidden", img: "icons/svg/invisible.svg" },
  { id: "invisible", name: "Invisible", img: "icons/svg/invisible.svg" }
];

export function registerConditions() {
  CONFIG.statusEffects = CROWS_STATUS.map(s => ({ ...s }));
}
```

- [ ] **Step 2: Call from `module/crows.mjs` init**

```js
import { registerConditions } from "./conditions.mjs";
// within init:
registerConditions();
```

- [ ] **Step 3: Probe `dev/probes/p10-status.mjs`**

```js
const ids = new Set(CONFIG.statusEffects.map(s => s.id));
const need = ["blessed","boned","grabbed","prone","unconscious","hidden","invisible"];
return { pass: need.every(n => ids.has(n)), have: [...ids] };
```

- [ ] **Step 4: Verify + commit**

Run: `node --check module/conditions.mjs module/crows.mjs && bash verify.sh`
Live: run `p10-status.mjs` → `{pass:true}`.
```bash
git add module/conditions.mjs module/crows.mjs
git commit -m "feat: register Crows status effects"
```

---

### Task 11: Background creation helper

**Goal:** `applyBackground(actor, backgroundItem)` that stamps a background's skills, stamina, starting trait, equipment, and spellbooks onto a crow.

**Files:**
- Create: `module/helpers/creation.mjs`
- Modify: `module/crows.mjs` (expose on `game.crows`), `module/sheets/crow-sheet.mjs` (drop a background item → apply)

**Acceptance Criteria:**
- [ ] `applyBackground` sets `system.stamina.max/value`, increments listed `skills[].bonus` (cap +2), sets `system.background`, and creates equipment/spellbook items if name→compendium lookup resolves (else creates named stubs).
- [ ] Dropping a `background` item on the crow sheet triggers `applyBackground` and does not keep a duplicate background embedded.

**Verify:** Probe `dev/probes/p11-creation.mjs` builds a background item + crow, calls `applyBackground`, asserts stamina + skill bonuses + background name set. Returns `{pass:true}`.

**Steps:**

- [ ] **Step 1: `module/helpers/creation.mjs`**

```js
export async function applyBackground(actor, bg) {
  const sys = bg.system;
  const updates = {
    "system.background": bg.name,
    "system.stamina.max": sys.stamina,
    "system.stamina.value": sys.stamina
  };
  for (const s of sys.skills ?? []) {
    const cur = actor.system.skills?.[s]?.bonus ?? 0;
    updates[`system.skills.${s}.bonus`] = Math.min(2, cur + 1);
  }
  await actor.update(updates);

  const toCreate = [];
  for (const name of sys.equipment ?? []) toCreate.push({ name, type: "gear", system: { location: { container: "backpack", index: 0, length: 1 } } });
  for (const name of sys.spellbooks ?? []) toCreate.push({ name, type: "spellbook" });
  if (toCreate.length) await actor.createEmbeddedDocuments("Item", toCreate);
  return { ok: true, applied: bg.name };
}
```

- [ ] **Step 2: Expose + wire drop in `module/crows.mjs` and `crow-sheet.mjs`**

In `crows.mjs` init:
```js
import { applyBackground } from "./helpers/creation.mjs";
game.crows = Object.assign(game.crows ?? {}, { applyBackground });
```
In `crow-sheet.mjs`, add a drop handler:
```js
  async _onDropItem(event, item) {
    if (item.type === "background") {
      const { applyBackground } = await import("../helpers/creation.mjs");
      await applyBackground(this.document, item);
      return false; // don't embed the background itself
    }
    return super._onDropItem(event, item);
  }
```

- [ ] **Step 3: Probe `dev/probes/p11-creation.mjs`**

```js
const { applyBackground } = game.crows;
const bg = await Item.create({ name: "Archer", type: "background", system: {
  characteristicBonus: "agility", stamina: 7, skills: ["bow","search","sneak"],
  equipment: ["torch"], spellbooks: []
}});
const crow = await Actor.create({ name: "TestCrow", type: "crow" });
await applyBackground(crow, bg);
const ok = crow.system.stamina.max === 7 && crow.system.skills.bow.bonus === 1 &&
           crow.system.background === "Archer" && crow.items.getName("torch");
await bg.delete(); await crow.delete();
return { pass: !!ok };
```

- [ ] **Step 4: Verify + commit**

Run: `node --check module/helpers/creation.mjs module/sheets/crow-sheet.mjs module/crows.mjs && bash verify.sh`
Live: run `p11-creation.mjs` → `{pass:true}`.
```bash
git add module/helpers/creation.mjs module/sheets/crow-sheet.mjs module/crows.mjs
git commit -m "feat: background creation helper + sheet drop"
```

---

### Task 12: Compendium pipeline + starter seed content

**Goal:** Wire the YAML→LevelDB pack build and seed a representative slice of content so the packs render in-world; declare packs in `system.json`. (Full content transcription is a separate follow-on effort — see note.)

**Files:**
- Create: `src/packs/crows-weapons/*.yaml` (≈4 weapons), `src/packs/crows-armor/*.yaml` (4 armors), `src/packs/crows-spellbooks/*.yaml` (≈3 spells), `src/packs/crows-monsters/*.yaml` (≈3 monsters), `src/packs/crows-backgrounds/*.yaml` (≈2 backgrounds), `src/packs/crows-traits/*.yaml` (≈3 traits), `src/packs/crows-rules/*.yaml` (1 journal)
- Modify: `system.json` (packs[] + packFolders)
- Modify: `.planning/STATUS.md`

**Acceptance Criteria:**
- [ ] `npm run pack` builds `packs/` from `src/packs/` without error.
- [ ] `system.json` declares the 7 packs (correct `type`, `system: "crows"`).
- [ ] After reload, each compendium opens and shows its seeded entries; a seeded weapon/spellbook/monster opens its sheet without error.

**Verify:** Build (`npm run pack` with world closed), reload, probe `dev/probes/p12-packs.mjs` asserts each pack exists and has ≥1 entry; returns `{pass:true}`.

**Steps:**

- [ ] **Step 1: Author seed YAML** (one example shown; replicate the structure for the rest, drawing real values from the playtest cards in `F:/MCDM_Crows/...`)

`src/packs/crows-weapons/sword.yaml`:
```yaml
name: Sword
type: weapon
img: icons/weapons/swords/sword-broad-steel.webp
system:
  description: "<p>A versatile blade.</p>"
  type: slashing
  range: { melee: 1, ranged: 0 }
  attackStat: either
  damage: { t2: "3 + A or S", t3: "6 + A or S" }
  qualities: []
  slots: 1
  stackMax: 1
  cost: 30
```
`src/packs/crows-armor/heavy-armor.yaml`:
```yaml
name: Heavy Armor
type: armor
system: { armorType: heavy, ad: 15, slots: 4, cost: 400 }
```
`src/packs/crows-spellbooks/fire-lance.yaml`:
```yaml
name: Fire Lance Book
type: spellbook
system:
  discipline: elemental
  rank: 0
  castType: attack
  range: { kind: ranged, value: 10 }
  target: "1 creature"
  duration: instant
  effectBands: { t2: "3 + M", t3: "6 + M" }
  usageDie: { enabled: true, udMax: 1, udCurrent: 1, expiry: rest }
  slots: 1
  cost: 250
```
`src/packs/crows-monsters/wolf.yaml`:
```yaml
name: Wolf
type: monster
system:
  power: 3
  size: medium
  creatureType: animal
  stamina: { value: 15, max: 15 }
  speed: { value: 7, modes: [] }
  characteristics: { agility: 2, mind: -3, strength: 0 }
  attacks:
    - { name: Bite, toHit: 2, range: "Melee 1", targets: 1, dmgT2: 3, dmgT3: 4, riderRef: "" }
  traits: []
```
`src/packs/crows-backgrounds/archer.yaml`:
```yaml
name: Archer
type: background
system:
  characteristicBonus: agility
  stamina: 7
  startingTrait: "Archery: <starting trait>"
  skills: [bow, search, sneak]
  equipment: [shortbow, "quiver of 20 arrows"]
  spellbooks: []
```
`src/packs/crows-traits/armor-tough.yaml`:
```yaml
name: Tough
type: trait
system: { tree: armor, tier: 1, column: 1, connectsTo: [], isStarting: true, description: "<p>+2 Stamina max.</p>" }
```
`src/packs/crows-rules/conditions.yaml`:
```yaml
name: Crows Rules Reference
_id: crowsrules000001
pages:
  - name: Conditions
    type: text
    text: { content: "<h2>Conditions</h2><p>Blessed, Boned, Grabbed, Prone, Unconscious…</p>" }
  - name: Test Results
    type: text
    text: { content: "<p>≤11 Tier 1 · 12–16 Tier 2 · 17+ Tier 3 · nat 2–3 doom · nat 19–20 crit.</p>" }
```

- [ ] **Step 2: Declare packs in `system.json`** (replace the empty `packs: []`)

```json
"packFolders": [
  { "name": "MCDM Crows", "sorting": "m", "packs": [
    "crows-backgrounds","crows-traits","crows-weapons","crows-armor",
    "crows-spellbooks","crows-monsters","crows-rules" ] }
],
"packs": [
  { "name": "crows-backgrounds", "label": "Backgrounds", "path": "packs/crows-backgrounds", "type": "Item", "system": "crows" },
  { "name": "crows-traits", "label": "Traits", "path": "packs/crows-traits", "type": "Item", "system": "crows" },
  { "name": "crows-weapons", "label": "Weapons", "path": "packs/crows-weapons", "type": "Item", "system": "crows" },
  { "name": "crows-armor", "label": "Armor", "path": "packs/crows-armor", "type": "Item", "system": "crows" },
  { "name": "crows-spellbooks", "label": "Spellbooks", "path": "packs/crows-spellbooks", "type": "Item", "system": "crows" },
  { "name": "crows-monsters", "label": "Monsters", "path": "packs/crows-monsters", "type": "Actor", "system": "crows" },
  { "name": "crows-rules", "label": "Rules Reference", "path": "packs/crows-rules", "type": "JournalEntry", "system": "crows" }
]
```

- [ ] **Step 3: Install cli + build** (world closed)

```bash
npm install
npm run pack
```
Expected: `packs/crows-*` LevelDB dirs created, no errors.

- [ ] **Step 4: Probe `dev/probes/p12-packs.mjs`**

```js
const names = ["crows-backgrounds","crows-traits","crows-weapons","crows-armor","crows-spellbooks","crows-monsters","crows-rules"];
const res = {};
for (const n of names) { const p = game.packs.get(`crows.${n}`); res[n] = p ? p.index.size : -1; }
const pass = names.every(n => res[n] >= 1);
return { pass, res };
```

- [ ] **Step 5: Update STATUS + commit**

Update `.planning/STATUS.md` (M1 build progress). Then:
```bash
git add system.json src/packs/
git commit -m "feat: compendium pipeline + starter seed content"
```
> **Follow-on (not in M1 code scope):** full transcription of all 36 backgrounds, ~260 traits, every weapon/armor/consumable/spellbook/monster from the playtest PDFs. This is bulk data-entry, parallelizable via agents, and should be its own plan (`docs/superpowers/plans/<date>-crows-content-entry.md`). The pipeline proven here is the target format.

---

## Definition of Done (M1)

- [ ] System loads on v14 (and v13) with no console errors.
- [ ] A GM can: create a crow, drop a background to stamp it, roll skills (tier-banded chat cards with doom/crit), equip armor (AD derives), manage the slot grid with wound overlay, roll usage dice, toggle conditions.
- [ ] A GM can: create/open a monster, click an attack to post a damage card.
- [ ] All 8 item sheets open and persist edits.
- [ ] Seeded compendiums render and their entries open.
- [ ] `bash verify.sh` exits 0; every `pNN` probe returns `{pass:true}` against a live world.

## Self-review notes (author)

- Spec coverage: data models (T3/T4), roll pipeline (T5), slots+usage (T6), sheets (T7/T8/T9), conditions (T10), creation helper (T11), compendiums (T12), dev tooling (T1) — all M1 spec sections mapped. Chaos Count + damage auto-application correctly deferred to M2 (spec says manual in M1); a GM Chaos counter UI is light enough to add in T9's header if desired but is explicitly M2 — left out of M1 DoD.
- API risk flags (resolve at execution against the running build): ApplicationV2 `_configureRenderParts` availability (T7), core `tab-navigation.hbs` part path (T9), `foundry.documents.collections` sheet-registration namespace (T7–T9), `renderTemplate` namespacing (T5). Each has an inline fallback note.
- Type consistency: `system.location.{container,index,length}` used identically in schema (T2), slots (T6), and grid build (T9); `usageDie.udCurrent` consistent in schema (T2) and roller (T6); `attack:{t2,t3}` shape consistent between roll card (T5), monster attack (T8).
