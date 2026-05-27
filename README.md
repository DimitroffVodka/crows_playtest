# MCDM Crows — Foundry VTT System

A community-built Foundry VTT system for the **MCDM Crows TTRPG public playtest** (May–June 2026).

> **Disclaimer.** This is a fan-made implementation. *Crows* is © MCDM Productions. This system bundles the public playtest packet (rules, monsters, content, art, maps) to make the playtest playable at the virtual table — playtests need to be played for MCDM to get feedback. If MCDM requests changes or removal, that will be honored.

---

## Install (Foundry VTT)

In Foundry → Game Systems → Install System → paste this manifest URL:

```
https://github.com/DimitroffVodka/crows_playtest/releases/latest/download/system.json
```

Or download a release zip directly from the [Releases page](https://github.com/DimitroffVodka/crows_playtest/releases).

**Compatibility:** Foundry v13 minimum, verified on v14.

---

## What's in the box

### Rules pipeline
- **2d10 tier-roll engine** — Tier 1 ≤11, Tier 2 12–16, Tier 3 17+. Auto doom/crit on raw faces. Mod-chain chat cards.
- **Slot inventory** — hand/head/neck/waist/belt/arms/finger/feet equipped + 10-slot backpack. Wounds occupy backpack slots from the bottom.
- **Conditions** — Blessed/Boned (leveled, auto-applied to test rolls), Grabbed, Prone, Unconscious (auto-doom on Agi/Str, target auto-tier-3, +1/-1 melee/ranged mods, etc.) — bidirectionally synced with Active Effects.
- **Damage application** — Armor Dice → Stamina → Wounds, with multi-armor priority dialog (shield → light → medium → heavy) and Piercing (bypasses AD).
- **Spellcasting** — full pipeline with Usage-Die-on-cast, Chaos Count (GM-secret world counter, threshold-triggered Backlash from d100+rank table), doom-on-cast = immediate backlash.
- **Dungeon Turn** — counter, end-of-DT pipeline (UD rolls, blessed/boned reset, encounter check), GM-callable.
- **Rest** — 6-hour rest with auto-restore, encounter checks every 2h (skipped in town), rest activities: Tend Wounds / Identify Item / Prepare for Task / Craft Equipment / Harvest.

### Downtime systems (Rules p.1115+)
- **Miasma** — outdoor 24h resist test (2d10 + M + Endurance), Effects table dispatch with effect-id dedup, catastrophic 13+ → permanent NPC.
- **Crypt boons** — 10-boon institution with internment registry, once-per-cycle prayer, mechanical hooks for Vitality / Fury / Swiftness boons; chat-card scaffolds for the rest.
- **Village** — Prosperity tracker (-10..+10), 10-day cycles, institution registry, end-of-cycle event roll (d10 + Prosperity → 20-bucket table), GM management dialog.
- **Crafting** — projects with prereqs/materials/goal, special-Mind crafting roll (doom=0, crit=re-roll, min 1), Identify Item 2d10+M tiered test.
- **Advancement** — TXP threshold table for skill/stam and characteristic bonuses, trait-tree purchase UI (4×3 grid per tree, connectsTo gating), XP-grant macros.

### Character creator
- 2d6 background roll or pick from all 36, with live preview of stats/trait/description.
- Characteristic spread (+1 primary, optional secondary +1 with -1 dump on the third).
- Auto-applies background skills/stamina/equipment/starting-trait + universal starter items (bedroll, coin purse, knife, rope, 6 rations).

### Sheets
- **Crow PC sheet** — laid out to match the official paper character sheet, with tabs: Main / Equipment / Inventory / Advancement / Downtime / Bio.
- **Monster sheet** — rulebook stat-block format with inline GM edits, attack roll buttons, condition toggles, apply-damage dialog.

### Compendium content
- 11 packs: backgrounds (36), traits (~276 across 23 trees), weapons, armor, gear, consumables, ammunition, spellbooks, monsters, loot, rules-reference journal.
- All content transcribed from the playtest packet; cross-validated against the consolidated rulebook markdown.

### Playtest packet (reference material)
- **`playtest-packet/`** holds the full MCDM playtest packet for reference:
  - All 10 playtest PDFs (Welcome / Rules / Characters / Monsters / Blood Dungeon / Inventory Cards / Loot Cards / Annotated Inventory / Cheat Sheet / Inventory Sheet).
  - **`Art/`** — monster + scene art (useful as token/scene images).
  - **`Maps/`** — battlemaps for the Blood Library starter dungeon.
  - **`Markdown/`** — consolidated rulebook markdown + per-booklet extracts.
  - **`Crows Character & Inventory Sheets.xlsx`** — the official paper character sheet.

This is **not** shipped in the Foundry install zip (Foundry users get just the system + compendiums). It lives in the repo as a reference resource for GMs, players, and contributors.

---

## Contributing

Issues and PRs welcome. Source content lives under `src/packs/` as YAML; built LevelDB packs are in `packs/` (committed). To rebuild after editing YAML:

```bash
npm install
npm run pack       # build all packs
npm run unpack     # extract LevelDB → YAML (rare, for round-tripping)
```

You'll need a copy of [`@foundryvtt/foundryvtt-cli`](https://github.com/foundryvtt/foundryvtt-cli), installed via `npm install`.

---

## Credits

- *Crows* TTRPG by **MCDM Productions** — see [mcdmproductions.com](https://mcdmproductions.com/).
- Foundry VTT system implementation by **dimit** (with significant pair-programming assistance from Claude / Anthropic).
- Built and tested on Foundry v14.361+.

## License

System code is MIT-licensed (see `LICENSE`). Playtest rules content remains the property of MCDM Productions and is bundled here under playtest goodwill. If you fork, please respect MCDM's IP and remove the content packs before any commercial use.
