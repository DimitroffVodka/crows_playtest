# Crows System — STATUS

Cross-agent work tracker. Read at session start; update on task start/finish/handoff.

## Project
Foundry VTT **system** for **MCDM Crows** (public playtest May–June 2026).
Bespoke coded (DataModel + ApplicationV2). Target: Foundry v13 min / v14 verified.
Phased: **M1 MVP (live playtest)** → M2 automation → M3 depth.
Content: compendiums seeded from playtest PDFs, **personal/playtest only (MCDM IP)**.

## Key paths
- System code: `E:/FoundryVTTv14/Data/systems/crows/`
- Spec: `docs/superpowers/specs/2026-05-25-mcdm-crows-foundry-system-design.md`
- Content source: `F:/MCDM_Crows/MCDM Crows Public Playtest May-June 2026/`
- Extracted data models: `F:/MCDM_Crows/.../crows-characters-datamodel.md` + monster/item agent report
- Live-test: `foundry-mcp-bridge` module

## Now
- [x] Brainstorm + design approved
- [x] Spec written
- [x] M1 implementation plan (writing-plans)
- [x] M1 build — Tasks 0–12 complete + live-verified in Foundry v14.363 (2026-05-25)
  - Task 12: compendium pipeline working; 8 packs declared in system.json; seed YAML in src/packs/; LevelDB built via `fvtt package pack -n <name> --in src/packs/<name> --out packs --yaml` (looped per pack — fvtt-cli ^1.1.0 has no directory mode).
  - **fvtt-cli gotcha:** every source YAML MUST have `_id` (16-char) AND `_key` fields, else the cli SILENTLY skips it (no error). Key format: `!items!<id>` for Items, `!actors!<id>` for Actors, `!journal!<id>` for JournalEntry; embedded journal pages need `!journal.pages!<parentId>.<pageId>`. See `node_modules/@foundryvtt/foundryvtt-cli/lib/package.mjs:322` (`if (!doc._key) continue;`).
  - **Lock workflow:** Foundry holds exclusive LevelDB locks on packs/ while a world using the system is open. To rebuild: Return to Setup → rebuild packs/ → relaunch world. The browser-only `reload_foundry` is NOT enough — newly declared packs[] in system.json require a full world launch.
- [x] M1 live verification — all 12 tasks confirmed in-app: data models, derived AD, 2d10 tier roll + doom/crit, slot grid with wound overlay, usage dice, item sheets ×8, monster sheet with attack→card, crow sheet (5 tabs + skill rolls + edit persistence), 7 status effects, background helper, 8 populated compendiums (11 docs total).
- [x] Content transcription complete (2026-05-26) — **437 documents across 11 packs**, live-verified in Foundry v14.363:
  - 36 backgrounds (full PDF data: chars/skills/equipment/spellbooks/startingTrait)
  - 276 traits (23 trees × 12 traits; tier/column/connectsTo/description; xpCost derives from tier)
  - 19 weapons, 4 armor (shield/light/medium/heavy AD 5/5/10/15), 43 gear (tools/utility/light/treasure)
  - 14 consumables (potions/vials/bombs/food), 2 ammunition (quiver/case-of-bolts)
  - 25 spellbooks (R0 + R1 across all 6 disciplines), 11 monsters (animals/blood/Ring Collector), 6 loot
  - 1 rules journal (16 pages: conditions, tiers, doom/crit, combat, maneuvers, dungeon turn, resting, ranged, line of effect, spellcasting, backlash d100 table (55 rows), chaos count, weather, miasma, overland travel, crafting)
  - 3 new packs added: crows-consumables, crows-ammunition, crows-loot
  - Build: per-pack via `npx fvtt package pack -n <name> --in src/packs/<name> --out packs --yaml`
  - Known small issues for follow-up: gear duplicates removed (Ball Bearings + Caltrops are consumables only), some PDF typos preserved verbatim (Stabathon "one the same turn", Seeing Things "wile"), trait `connectsTo` is column-aligned by default (cross-column connections may need a visual pass against the actual layouts), Minor Healing/Minor Curse spellbook tier values may need spot-verification.

## Notes / gaps
- Monster AD rule absent from playtest docs — default none unless trait grants.
- ~260 trait names/effects live in PDF page images (pages 8–30 of Characters booklet) — transcribe during content entry.
- Full spell/weapon/armor card stats in inventory-card booklets (05/06).
- Duplicate "Mace" weapon entry in cards — verify.
