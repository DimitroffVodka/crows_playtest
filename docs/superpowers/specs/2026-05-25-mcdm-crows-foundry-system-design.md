# MCDM Crows — Foundry VTT System Design

**Date:** 2026-05-25
**Status:** Approved (design); M1 = implementation target
**System id:** `crows`
**Location:** `E:/FoundryVTTv14/Data/systems/crows/`
**Content source:** `F:/MCDM_Crows/MCDM Crows Public Playtest May-June 2026/` (PDFs + extracted data-model notes)

---

## Decisions (locked)

| Decision | Choice |
|---|---|
| Build approach | Bespoke coded system. asacolips boilerplate used as project *skeleton* only; Crows data models + sheets written fresh. |
| Automation depth | Phased. M1 = playable MVP for the **live playtest (May–June 2026)**; M2 automation; M3 depth systems. |
| Foundry target | `compatibility.minimum = "13"`, `compatibility.verified = "14"`. ApplicationV2 + DataModels. |
| Content / IP | Bundle full compendiums seeded from playtest PDFs. **Personal/playtest use only — MCDM IP, not for public redistribution.** System code kept IP-clean so content could be split into a separate module later. |
| Live-test | Via `foundry-mcp-bridge` module (MCP `evaluate` probes). |

---

## Game model (ground truth from playtest docs)

- **Resolution:** `2d10 + Characteristic + one Skill (+ mods)`. Tiers: **≤11 = tier 1**, **12–16 = tier 2**, **17+ = tier 3**. **Doom** = natural 2–3 on raw 2d10. **Crit** = natural 19–20.
- **Characteristics (3):** Agility (A), Mind (M), Strength (S). PC range −1…+3 (cap +3 without magic).
- **Skills:** named `{name, bonus}`, bonus 0…+2. **Not** tied to a fixed characteristic — the skill bonus is added to whichever characteristic the Ref calls (weapon skills → A/S attacks; spell skills → M castings; general → Ref's pick).
- **Health stack:** **AD** (from worn armor) → **Stamina** → **Wounds**. Wounds fill backpack slots; all 10 full = dead. Piercing damage ignores AD.
- **No classes, no ancestries.** Identity = rolled **Background** (36) + purchased **Traits** in 4×3 **Trait Trees** (graph-connected edges), advanced by **XP-spend** (TXP lifetime + spendable XP), no levels.
- **Spellcasting:** item-driven. Each **spellbook = one spell** (rank 0–5, discipline, usage die, range, target, AoE, duration, tiered effect). Cast = `2d10 + M + spell-skill`. Spellbooks recharge usage dice on rest.
- **Usage dice (d6):** on consumables/light/wands/rings/spellbooks; roll on use or DT end, remove a die on 1–2, item stops at 0.
- **Slot inventory:** 2 hand, 2 belt, 1 waist, 1 neck, 1 gloves, 1 boots, 1 ring, 1 head + **10 backpack**. Stacking (like items, up to stack-max), multi-slot items occupy contiguous same-container slots.
- **Conditions:** Blessed (level), Boned (level), Grabbed, Prone, Unconscious. Blessed/Boned cancel 1:1; only one of the others at a time.
- **Time:** Dungeon Turn (30 min) + encounter check (1d6 vs EN). Resting (6h, regain Stamina, −1 wound, rest activities). Overland travel + weather + Miasma.
- **Magic chaos:** Ref-secret **Chaos Count**; tier-1 non-doom casting adds 1d6+rank; at ≥13 the triggering spell backlashes (d100+rank table), CC resets to 0. Doom on cast = immediate backlash.

(Full extracted schemas: `F:/MCDM_Crows/.../crows-characters-datamodel.md` + monster/item agent report.)

---

## Architecture

- **Data:** `foundry.abstract.TypeDataModel` subclasses registered on `CONFIG.Actor.dataModels` / `CONFIG.Item.dataModels`. No `template.json`.
- **Sheets:** `ApplicationV2 + HandlebarsApplicationMixin`. Registered via the v13 namespaced collections API.
- **Active Effects:** use `CONST.ACTIVE_EFFECT_CHANGE_TYPES` (string `change.type`).
- **Shared schema mixins** (composition helpers, not item types):
  - `PhysicalItemData`: `slots`, `stackMax`, `quantity`, `cost` (gc), `equipSlotType`, `weightless`.
  - `UsageDieData`: `udMax`, `udCurrent`, `expiry` ∈ {Useless, Refuel, Rest, Activate, DT}, `refuelWith`.
- **Build:** rollup (JS bundle) + a CSS pipeline; lang `en.json`. Source packs in `src/packs/*.yaml` → LevelDB `packs/` via `@foundryvtt/foundryvtt-cli`.
- **Project layout:**
  ```
  crows/
    system.json  template? (no)  rollup.config.mjs  package.json
    src/  (module/, styles/, templates/, packs/, lang/)
    packs/        (built LevelDB; gitignored or skip-worktree)
    docs/superpowers/specs/
    .planning/STATUS.md
    dev/probes/  dev/fixtures/  verify.sh
  ```

---

## Actor types

### `crow` (PC)
`system`:
- `characteristics`: `{ agility, mind, strength }` each `{ value }` (−1…+3).
- `skills`: record keyed by skill id → `{ bonus }` (0…+2). Skill list seeded from compendium/config.
- `stamina`: `{ value, max }` (flat; from background + advancement).
- `wounds`: `value` (int; occupies backpack slots from the bottom).
- `speed`: `{ value }` (start 5).
- `ad`: **derived** (sum of worn armor/shield AD; not stored).
- `conditions`: `{ blessed, boned }` (levels) + status-effect flags grabbed/prone/unconscious.
- `xp`: `{ txp, spendable }`.
- `background`: id/ref + free-text.
- `currency`: `gc` (int).
- `cryptBoon`: enum/null.
- `details`: `{ name, feature }` (feature = free text).
- Inventory & traits live as embedded Items with `system.location` (see slots).

### `monster` (NPC / creature; also pets)
`system`:
- `power` (0–50), `size` (Tiny…Holy Shit), `creatureType` (Animal/Blood/Undead/Demon/Angel/Plant/Unique).
- `stamina`: `{ value, max }`.
- `speed`: `{ value, modes: [{name, value}] }` (e.g. climb).
- `characteristics`: `{ agility, mind, strength }`.
- `attacks`: `[{ name, toHit, range, targets, dmgT2, dmgT3, riderRef }]` (flat damage, no +stat).
- `traits`: `[{ name, effect, uses?, linkedAttack? }]` (or embedded trait Items — see open questions).
- `slots`: int (pets only; counts as backpack slots).
- `ad`: optional (playtest docs omit monster AD — default 0/none unless a trait grants).

### `village` — **deferred to M3** (prosperity, institutions, cycle).

---

## Item types (M1)

`weapon`, `armor`, `ammunition`, `consumable`, `gear`, `spellbook`, `trait`, `background`.

- **weapon** — `type` (Bashing/Bow/Chopping/Slashing/Stabbing/Unarmed), `range` (`{melee, ranged}` squares; versatile = both), `attackStat` (A/S/`A or S`), `damage` `{ t2, t3 }` each `"N + stat"`, `qualities[]` (Brutal/Cumbersome/Disengage/Dismember/Light/`Parry N`/Pummeling/Reload), `enchantment`, `qualityTier` (std/fine/masterwork). + PhysicalItemData.
- **armor** — `armorType` (Shield/Light/Medium/Heavy), `ad` (flat), `enchantment`, `qualityTier`. + PhysicalItemData (slots 1/2/3/4).
- **ammunition** — `ammoFor`, `countPerUnit`. + PhysicalItemData.
- **consumable** — `useAction` (action/maneuver), `effect` text, optional `bands` `{t1,t2,t3}`, optional thrown `attack` (`Ranged N` + Agility), `duration`. + PhysicalItemData + optional UsageDieData.
- **gear** — covers tools/utility/light/wands/rings/worn-magic/treasure. Flags: optional `usageDie` (UsageDieData), optional `light` `{bright, dim}`, `equipSlotType` (head/neck/waist/arms/finger/feet for magic slots), `isMagic`, `mystery`/`identified`, `subtype` (tool/utility/light/wand/ring/treasure), treasure `{ size, value }`. + PhysicalItemData.
- **spellbook** (= one spell) — `discipline` (6), `rank` (0–5), `castType` (action/maneuver/reaction/attack/out-of-combat), `usageDie` (UsageDieData), `range`, `target`, `aoe` (`{shape: aura/cube/line, size}`), `duration` (Instant/DT/UD), `effectBands` `{t1?,t2,t3}` (scale off Mind). + PhysicalItemData.
- **trait** — `tree` (enum, ~23 trees), `row`/`tier` (1–4 → xpCost 500/1000/1500/2000), `column`, `connectsTo[]` (graph edges), `description`, `isStarting`, `restActivity` (bool).
- **background** — `characteristicBonus` (stat or "any"/choice), `stamina`, `startingTrait` (`Tree: TraitName`), `skills[]`, `equipment[]`, `spellbooks[]`. Drives creation helper.

---

## Roll pipeline (signature mechanic)

`rollTest({ actor, characteristic, skill, mods=[], flavor, attack=null, casting=null })`:
1. Compose `2d10 + char + skillBonus + Σmods`. Evaluate.
2. `tier`: total ≤11 → 1, 12–16 → 2, 17+ → 3. `doom` = raw 2d10 ∈ {2,3}. `crit` = raw 2d10 ∈ {19,20}.
3. Render chat card: highlighted tier band, doom/crit badges; for `attack`/`casting`, show weapon/spell `t2`/`t3` outputs with an **Apply Damage** button.
4. Same path serves: tests, weapon attacks, spell castings, resistance rolls, and the special tests (Grab/Knockback/Escape Grab — fixed band outcomes).

M1: chat card + manual Apply button. **Auto-application (AD→Stamina→Wounds) = M2.**

---

## Slot inventory

- Each embedded item: `system.location = { container, index, length }`, container ∈ {hand, belt, waist, neck, gloves, boots, ring, head, backpack}. Capacities: hand 2, belt 2, backpack 10, others 1.
- **Wounds** (`actor.system.wounds.value`) occupy backpack slots from the bottom; `occupiedBackpack + wounds > 10` ⇒ over capacity; `wounds ≥ 10` ⇒ dead (flag).
- Stacking: like items (same name/type) share one backpack slot up to `stackMax`. Multi-slot items occupy contiguous same-container slots.
- Derived: `encumbrance` (occupied/total per container). Block adds that overflow.
- Sheet renders the grid: hand row, equip+belt row, 10-cell backpack with wound overlay.
- M1: manual move/drag between slots. **Draw-from-pack 1d10 automation = M2.**

---

## Sheets (ApplicationV2)

- **Crow sheet** — header (A/M/S, Stamina cur/max, wounds, speed, derived AD, blessed/boned). Tabs: **Play** (skills + roll buttons, equipped weapons, prepared spellbooks, condition toggles), **Inventory** (slot grid), **Traits** (owned traits grouped by tree), **Advancement** (TXP/XP — read-only display in M1), **Bio**.
- **Monster sheet** — stat header, clickable attacks, traits, compact.
- **Item sheets** — one per type; shared Handlebars partials for PhysicalItemData and UsageDieData.

---

## Compendiums & content (M1)

Source YAML in `src/packs/`, built to LevelDB. Packs:
`crows-backgrounds`, `crows-traits`, `crows-monsters`, `crows-weapons`, `crows-armor`, `crows-gear`, `crows-consumables`, `crows-spellbooks`, `crows-treasure`, `crows-rules` (Journal: conditions, backlash d100 table, weather/Miasma tables, cheat sheet).

Content transcribed from the playtest PDFs (bulk data-entry, agent-assisted & parallelizable). Bundled but personal-only.

**Known content gaps to resolve during entry:** monster AD rule (absent in docs), full per-trait names/effects (~260, in PDF page images), full spell card stats (booklets 05/06), duplicate "Mace" weapon entry.

---

## Conditions / status effects (M1)

Register status effects: Blessed (leveled), Boned (leveled), Grabbed, Prone, Unconscious, Hidden/Invisible, plus light states. M1 = selectable status icons + tooltips; **mechanical automation of their effects = M2.**

---

## Dev tooling (local-only; `.git/info/exclude`)

`verify.sh` (grep wall + `node --check`, seeded from shadowdark-extras), `dev/probes/*.mjs` (MCP `evaluate` snippets → `{pass, …}`), `dev/fixtures/setup.mjs`+`teardown.mjs`, `.planning/STATUS.md`, packs build scripts.

---

## Milestones

### M1 — Playable MVP (this spec's implementation target)
System skeleton (system.json, build, lang) · DataModels (crow, monster + 8 item types + mixins) · ApplicationV2 sheets · tier roll-to-chat pipeline · slot inventory (slots/wounds/stacking, manual moves) · usage-die roller · seeded compendiums · conditions as status effects · background creation helper. Damage application + Chaos Count are manual (Chaos = a simple GM counter UI).

### M2 — Automation
Damage pipeline (AD→Stamina→Wounds) · Blessed/Boned/Grabbed/Prone/Unconscious as Active Effects with mechanical impact · Chaos Count tracker + auto-backlash roll · dungeon-turn + encounter tracker · draw-from-pack 1d10 · flanking/light/cover test penalties · counters & reactions prompts · initiative (1d10 ≥6 PCs-first per round).

### M3 — Depth
XP/TXP advancement + trait-tree purchase UI · village + institutions + prosperity · pets/companions + barding + riding · crafting (rolls/materials/recipes) · overland travel + weather + Miasma · rest activities · retirement/crypt boons · hirelings/vehicles (when published).

---

## Open questions (resolve in planning, non-blocking)

1. Monster traits: embedded `trait` Items vs inline `attacks/traits` arrays on the monster DataModel? (Lean inline for monsters; trait Items for PCs.)
2. Treasure: `gear` subtype (chosen) vs its own type — revisit if treasure UX needs diverge.
3. Light source integration with Foundry token lighting (auto-set token light from equipped light source) — M1 nice-to-have or M2?
4. Background as an Item type vs world config data — chosen Item type for compendium browsability; confirm creation-helper UX.
