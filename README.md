# MCDM Crows — Foundry VTT System

A community-built Foundry VTT system for the **MCDM Crows TTRPG public playtest**, tracking the
**second playtest packet (August–September 2026)**.

> **Disclaimer.** This is a fan-made implementation. *Crows* is © MCDM Productions. This system exists to make the playtest playable at the virtual table — playtests need to be played for MCDM to get feedback. If MCDM requests changes or removal, that will be honored.

## The playtest packet

The rulebooks, character sheet, and other reference documents are **not** distributed here. Grab them directly from MCDM:

> **[MCDM Productions on Patreon](https://www.patreon.com/c/MCDM)** — look for the **Crows August/September 2026 playtest packet**.

This system implements those rules. You need the packet to read what the game *is*; this repo gives you the table to play it on.

> **Playtest 1 → 2 is not a patch.** Conditions were rebuilt, the chaos count was replaced,
> initiative changed shape entirely, and every compendium pack was re-transcribed from the new
> books. A world built on the Playtest 1 version of this system migrates, but expect to re-check
> characters against the new rules.

---

## See the village map

**[Live demo →](https://dimitroffvodka.github.io/crows_playtest/)** — no install, no Foundry.

[![Balhaunis in daylight, choked by the Miasma, and at night](demo/preview.png)](https://dimitroffvodka.github.io/crows_playtest/)

Balhaunis is authored, not generated — the roads, the ground and every plot are fixed. Found an
institution and it appears on the plot that was being held for it; move Prosperity and the homes,
fields and woodland fill in behind it, always in the same order, so a village that falls on hard
times and recovers gets the identical village back.

Hover a building to name it, click it to see the room inside and what its next level costs, and
raise it to watch it grow on its plot — levels have no art of their own, so size is what an upgrade
looks like. Name the village and it is written across the map. Roll in the **Miasma** and it chokes
everything the ruin does not enclose (C:2218), which is the whole point of living inside one.

The page calls the system's own `buildVillageProjection()` for every frame rather than a copy of it.
See [`demo/`](demo/) for how that is wired, how to run it locally, and for the separate procedural
layout engine that plans a settlement from a seed.

---

## Install (Foundry VTT)

In Foundry → Game Systems → Install System → paste this manifest URL:

```
https://github.com/DimitroffVodka/crows_playtest/releases/latest/download/system.json
```

Or download a release zip directly from the [Releases page](https://github.com/DimitroffVodka/crows_playtest/releases).

**Compatibility:** Foundry **v14 minimum, verified on v14**.

---

## What's in the box

### Rules pipeline
- **2d10 tier-roll engine** — Tier 1 ≤11, Tier 2 12–16, Tier 3 17+. Auto doom/crit on raw faces. Mod-chain chat cards with an explicit commit point, so an expertise can be spent *after* the roll and before anything downstream fires.
- **Slot inventory** — 2 hand, 4 belt, 10 backpack, plus six worn magic slots (head/neck/waist/arms/finger/feet). Multi-slot items must be contiguous; wounds fill backpack slots. Cards drag between slots, swap when you drop one onto another, and can be added or removed in place.
- **Conditions** — six, and **none of them have levels**: `blessed`, `grabbed`, `prone`, `unconscious`, `vulnerable`, `weakened`. Bidirectionally synced with Active Effects and token statuses. (Playtest 1's `boned` is gone — it split into `weakened` and `vulnerable`.)
- **Damage application** — Armor Dice → Stamina → Wounds, with multi-armor priority dialog (shield → light → medium → heavy) and Piercing (bypasses AD).
- **Spellcasting** — full pipeline with Usage-Die-on-cast, the **per-cast chaos roll** (1d6 on a non-doom tier 1; a 1 triggers a backlash), doom-on-cast = immediate backlash, and a d100+rank backlash table.
- **Combat and initiative** — **side-based, per the rules**: one 1d10 at the start of every round decides whether the crows or their enemies act first, re-rolled each round, with order *within* a side chosen rather than rolled. Ships a replacement combat tracker with the side roll, per-side grouping, manual reordering, and **Surprised** (skipped in round 1, +1 to attacks against them).
- **Dungeon Turn** — counter, end-of-DT pipeline (UD rolls, expiry of `blessed`/`vulnerable`/`weakened`, encounter check), GM-callable.
- **Rest** — 6-hour rest with auto-restore, encounter checks every 2h (skipped in town), rest activities: Tend Wounds / Identify Item / Prepare for Task / Craft Equipment / Harvest.

### Downtime systems
- **Miasma** — outdoor 24h resist test (2d10 + M + Endurance), Effects table dispatch with effect-id dedup, cruelty accumulation, catastrophic result → permanent NPC.
- **Crypt boons** — 10-boon institution with internment registry, once-per-cycle prayer, mechanical hooks for Vitality / Fury / Swiftness boons; chat-card scaffolds for the rest.
- **Village** — Prosperity tracker (−10..+10), 10-day cycles, institution registry, end-of-cycle event roll (d10 + Prosperity), GM management dialog, and an authored village map projected onto a Scene as Tiles, filling in with Prosperity ([see it in the browser](https://dimitroffvodka.github.io/crows_playtest/)).
- **Crafting** — projects with prereqs/materials/goal, special-Mind crafting roll (doom=0, crit=re-roll, min 1), Identify Item 2d10+M tiered test.
- **Advancement** — TXP threshold table for expertise/stamina and characteristic bonuses, trait-tree purchase UI (4×3 grid per tree, `connectsTo` gating), XP-grant macros.
- **Pets** — taming, bonding, ownership transfer, and combat commands, with the command test the rules require.

### Character creator
- Roll 2d6 for a background or pick from all 36.
- **Characteristics are set, not incremented.** Your background makes one characteristic a **2**; some fix which one, some offer a choice. You then pick a spread for the other two: **1 / 0** or **2 / −1**.
- Applies the background's expertise **uses**, stamina, equipment, spellbooks and starting trait, plus the universal kit — **coin purse, knife, rope, six rations, and 3d6 gc** (some backgrounds add coins on top).
- The four backgrounds that grant an animal spawn it as an Actor, bonded to the crow.

### Sheets
- **Crow PC sheet** — tabs: **Main / Equipment / Inventory / Pets / Advancement / Downtime / Bio**. The Bio tab records what your background granted.
- **Monster sheet** — rulebook stat-block format with inline GM edits, attack roll buttons, condition toggles, apply-damage dialog.
- **Item cards** — printed-card layouts per item type.

### Compendium content
- **13 packs**: backgrounds (36), traits (276 across 23 trees), weapons, armor, **enchantments (40)**, gear, consumables, ammunition, spellbooks, monsters (71), loot, the rules-reference journal, and **31 rollable tables** (backlashes, miasma effects, encounters, weather, interesting things, dungeon hooks and more).
- All content transcribed from the Playtest 2 packet and cross-checked against the books. Where a card and a rulebook disagree, the card wins and the divergence is recorded in `docs/discrepancies/`.

### Bundled play assets

`playtest-packet/` ships a few play-time assets so you don't have to bring your own:

- **`Art/`** — monster portraits and scene art — drop straight onto tokens or scenes.
- **`Maps/`** — Blood Library starter-dungeon battlemaps (labeled and unlabeled, including 8k).
- **`Crows Character & Inventory Sheets.xlsx`** — the official paper character sheet.

The rulebooks, monster cards, loot cards, and cheat sheet are **not** bundled — grab them from MCDM. These assets are repo-only; they aren't in the Foundry install zip.

---

## GM Quickstart

1. **Install the system** via the manifest URL above; create a new world using "MCDM Crows (Playtest)".
2. **Configure world settings** (Game Settings → Configure Settings → System Settings):
   - **Default Dungeon EN** — the 1d6 threshold for encounter checks (default 6 = lenient, lower = more encounters).
   - **Party is in the Miasma** — ON when the party is overland in Cornath; OFF indoors or in town.
   - **Crypt Level** — fallback when there is no Village yet; once the Village exists, Crypt level is read from there.
3. **Create the village** — any crow's sheet → Downtime tab → **Manage…** on the Village strip.
4. **Make a player character** — create an Actor (type: crow) → Bio tab → **Open Character Creator**. Roll or pick a background, set the characteristic it grants and choose your spread, name the crow and its NPC connection.
5. **Run combat** — drag a monster onto the scene and add both sides to the tracker. Click **Roll for the round**: a 6+ puts the crows first, 5 or lower the enemies. Walk the turns; the next round re-rolls. Mark anyone caught unaware as **Surprised** — they are skipped in round 1 and attacks against them gain +1.
6. **Attack** — put a weapon in a **hand** slot (only a wielded weapon can attack; the sheet says so on any weapon that isn't). Target a token with `T`, or just click Attack and pick from the prompt. The chat card's Apply T2 / Apply T3 buttons run damage through AD → Stamina → Wounds.
7. **End-of-DT** — the GM **End DT** button on any crow's Time strip rolls DT-expiry usage dice, clears `blessed`/`vulnerable`/`weakened`, and rolls an encounter check.
8. **Rest** — the **Rest…** dialog picks the activity and offers **Town rest** to skip encounter checks. Outdoor non-town rests auto-roll a Miasma resist when the world flag is on.
9. **End Village Cycle** — Downtime → Manage → End Cycle. Docks Prosperity if nothing was founded or upgraded, then rolls the event.

The `game.crows.*` API is exposed for macros — `game.crows.dt.end()`, `game.crows.creator.open(actor)`, `game.crows.village.found(...)`, `game.crows.miasma.resist(...)`, `game.crows.crypt.pray(...)`, `game.crows.rollTest(...)`. See `module/crows.mjs` for the full surface.

---

## Contributing

Issues and PRs welcome. Source content lives under `src/packs/` as YAML; built LevelDB packs are in `packs/` (committed). To rebuild after editing YAML:

```bash
npm install
npm run pack       # build every pack from src/packs
npm run unpack     # extract LevelDB -> YAML (rare, for round-tripping)
npm test           # the suite
./verify.sh --strict
npm run release    # gated build of dist/crows.zip
```

**Foundry holds an exclusive lock on the LevelDB packs while a world is open**, so return to Setup before rebuilding or packing will fail.

You'll need [`@foundryvtt/foundryvtt-cli`](https://github.com/foundryvtt/foundryvtt-cli), installed via `npm install`.

---

## Credits

- *Crows* TTRPG by **MCDM Productions** — see [mcdmproductions.com](https://mcdmproductions.com/).
- Foundry VTT system implementation by **dimit** (with significant pair-programming assistance from Claude / Anthropic).
- Background icons from [game-icons.net](https://game-icons.net), CC BY 3.0 — see [`NOTICE.md`](NOTICE.md).
- Built and tested on Foundry **v14.367**.

## License

System code is MIT-licensed (see `LICENSE`). Playtest rules content remains the property of MCDM Productions and is bundled here under playtest goodwill. If you fork, please respect MCDM's IP and remove the content packs before any commercial use.
