# MCDM Crows — Foundry VTT System

A community-built Foundry VTT system for the **MCDM Crows TTRPG public playtest** (May–June 2026).

> **Disclaimer.** This is a fan-made implementation. *Crows* is © MCDM Productions. This system exists to make the playtest playable at the virtual table — playtests need to be played for MCDM to get feedback. If MCDM requests changes or removal, that will be honored.

## The playtest packet

The rulebooks, character sheet, and other reference documents are **not** distributed here. Grab them directly from MCDM:

> **[Crows May/June 2026 Playtest Packet (Patreon)](https://www.patreon.com/posts/crows-may-2026-158948625)**

This system implements those rules. You need the packet to read what the game *is*; this repo gives you the table to play it on.

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

### Bundled play assets

`playtest-packet/` ships a few play-time assets so you don't have to bring your own:

- **`Art/`** — monster portraits (Blood Creatures, Ring Collector) and scene art (Blood Library Entrance) — drop straight onto tokens or scenes.
- **`Maps/`** — Blood Library starter-dungeon battlemaps (both labeled and unlabeled, including the 8k versions).
- **`Crows Character & Inventory Sheets.xlsx`** — the official paper character sheet, for groups that want a hard copy alongside the digital sheet.

The rulebooks, monster cards, loot cards, and cheat sheet are **not** bundled — grab them from the Patreon link above. (These are images/maps for the table; the rules text lives with MCDM.)

These assets are repo-only — they aren't included in the Foundry install zip.

---

## GM Quickstart

A 5-minute setup for new GMs:

1. **Install the system** via the manifest URL above; create a new world using "MCDM Crows (Playtest)".
2. **Configure world settings** (Game Settings → Configure Settings → System Settings):
   - **Default Dungeon EN** — the 1d6 threshold for encounter checks (default 6 = lenient, lower = more encounters).
   - **Party is in the Miasma** — toggle ON when the party is overland in Cornath; OFF when they're indoors / in town.
   - **Crypt Level** — fallback when no Village institution yet; once the Village is set up, Crypt level is read from there.
3. **Create the village** — open any crow's character sheet → Downtime tab → click **Manage…** on the Village strip. Set name, prosperity, found/upgrade institutions, advance cycles, roll events.
4. **Make a player character** — drag-create a new Actor (type: crow), open the sheet → Bio tab → **Open Character Creator** → roll 2d6 or pick a background, assign characteristics, name + feature. Background applies skills/stamina/equipment/starting trait automatically + adds universal starter items.
5. **Run combat** — drag a monster from `Crows Monsters` compendium onto the scene. Target a token with `T`. Click an attack on the monster sheet or use a PC's weapon. The chat card shows Apply T2 / Apply T3 buttons; selecting a target token + clicking applies damage through the AD → Stamina → Wounds pipeline.
6. **End-of-DT** — the GM **End DT** button on any Crow sheet's Time strip rolls all DT-expiry usage dice, resets blessed/boned, and rolls an encounter check.
7. **Rest** — the **Rest…** button opens a dialog: pick the rest activity (None / Tend Wounds / Identify Item / Prepare for Task / Craft Equipment / Harvest), tick **Town rest** to skip encounter checks. Outdoor non-town rests auto-roll a Miasma resist if the world flag is on.
8. **End Village Cycle** — Downtime tab → Manage → End Cycle. Docks Prosperity by 1 if no institution was founded/upgraded, then rolls a d10+Prosperity Village Event.

The `game.crows.*` API is exposed for macros: `game.crows.dt.end()`, `game.crows.chaos.show()`, `game.crows.village.found(...)`, `game.crows.creator.open(actor)`, etc. See `module/crows.mjs` for the full surface.

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
