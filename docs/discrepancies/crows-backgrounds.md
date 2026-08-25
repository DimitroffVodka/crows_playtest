# Discrepancies: crows-backgrounds

**Generated:** 2026-08-25
**Source:** ~/FoundryVTT-Projects/TTRPG Hub/Crows/MCDM Crows Public Playtest August-Sept 2026/Crows Playtest 2 Markdown/02 Crows Characters Book for Playtest 2.md
**Pack:** src/packs/crows-backgrounds/
**YAML count:** 36
**HIGH:** 0 · **MEDIUM:** 1 · **LOW:** 23 · **INFO:** 3

## Source-reading note

The Hub Characters Book was regenerated during this transcription. The current
file is a clean, strictly alphabetical eight-line record format (C:85 through
C:371), so each record was re-read from its ### <Name> heading rather than
trusting the stale line starts in the execution plan. The older extraction had
column interleave and split Transmuter's repair / take shape; the regenerated
source is unambiguous and the YAML follows it.

## HIGH severity (0)

_None._

All 36 backgrounds have the source characteristic choice, stamina, trait,
expertise grants, and equipment/spellbook split represented. No source
contradiction was found that would require withholding content.

## MEDIUM severity (1)

| Background | Field | Source | YAML | Resolution |
|---|---|---|---|---|
| Keraunomancer | expertise | Blacksmith (current Hub C:274) | blacksmithing | Blacksmith is not an ALL_EXPERTISES key. The YAML uses the only valid config key for the evident truncated Blacksmithing grant; this source/config mismatch remains recorded rather than inventing a new key. |

## LOW severity (23)

The following source equipment phrases have no exact counterpart in
src/packs/crows-gear/ or src/packs/crows-consumables/. They remain the source
item phrases as background strings (apart from lookup-compatible case and
typography normalization); they were not silently renamed to a nearby card.

| Source phrase | Background(s) |
|---|---|
| surgical kit | Acolyte of the Healer |
| smoke bomb | Alchemist, Entertainer, Illusionist, Pyromancer, Thief |
| bear trap | Archer, Blacksmith, Hunter |
| quiver of arrows | Archer, Assassin, Hunter, Soldier (the ammunition pack has Quiver of 20 Arrows) |
| extra knife | Assassin, Thief (the weapons pack has Knife) |
| gluepot | Beggar, Hydromancer |
| lore book (historical lore) | Cartographer, Duelist, Noble (the gear pack has only generic Lore Book) |
| quill and inkpot | Cartographer, Hydromancer |
| hearty ration (2) | Cook (the consumables pack has generic Hearty Ration) |
| 11-foot pole | Entertainer, Farmer (the gear pack has Ten-Foot Pole) |
| musical instrument (lute) | Entertainer (the gear pack has generic Musical Instrument) |
| animal feed (6) | Farmer, Hunter, Knight, Noble (the consumables pack has generic Animal Feed) |
| goat (pet) | Farmer |
| dog (pet) | Hunter |
| net | Keraunomancer, Pugilist |
| riding horse (pet) | Knight, Noble |
| quill and ink pot | Merchant, Sage |
| 50 extra gold coins | Merchant |
| shovel | Miner |
| 50 gold coins | Noble |
| lore book (monster lore) | Pugilist, Sage |
| lore book (nature lore) | Sage |
| soap | Tinkerer |

Weapon, armor, and spellbook entries are retained as strings for their own
packs; their absence from the gear/consumables directories is not itself a
content error.

## INFO

- The regenerated source resolves the old extraction artifact
  "_repair take_" / "_shape_" to the four spellbooks repair and take shape
  (Transmuter, current Hub C:357-363). The YAML uses those valid shipped
  spellbook names.
- Source typography is normalized only where needed for existing lookup
  conventions: lower-case equipment strings and ASCII apostrophes (for example
  "blacksmith's tools"). Item identity and quantities are otherwise retained.
- The source's canonical starting-trait spelling "Sieze the Advantage"
  (Assassin, current Hub C:153) is preserved because that is also the shipped
  trait name. Universal kit items are intentionally absent from every
  background's equipment; startingGold: "3d6" is explicit from C:36.
