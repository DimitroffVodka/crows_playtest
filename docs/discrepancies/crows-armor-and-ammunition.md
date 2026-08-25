# Playtest 2 Armor & Ammunition Cross-Validation Report

**Date:** 2026-08-25
**Canonical structure and numeric source:** `docs/source/C-characters-book.md`, C:1797–1940 and C:1976–2000
**Name and prose source:** `02 Crows Characters Book for Playtest 2.pdf`, pp. 32–36 and 38, read with `pdftotext -layout`
**YAMLs checked:** `src/packs/crows-armor/*.yaml` and `src/packs/crows-ammunition/*.yaml`

## Summary

| Section | HIGH | MEDIUM | LOW | INFO | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Armor | 0 | 1 | 0 | 5 | 6 |
| Ammunition | 0 | 0 | 0 | 0 | 0 |
| **Combined** | **0** | **1** | **0** | **5** | **6** |

All six shipped documents match the PT2 base-item values. No armor or
ammunition document was added, removed, or re-keyed.

## Counts and base values derived from the source

### Armor Prices (C:1814–1817; PDF p. 33)

| Item | File | Price | Slots | AD |
| --- | --- | ---: | ---: | ---: |
| Light Armor | `light-armor.yaml` | 50 gc | 2 | 5 |
| Medium Armor | `medium-armor.yaml` | 150 gc | 3 | 10 |
| Heavy Armor | `heavy-armor.yaml` | 400 gc | 4 | 15 |
| Shield | `shield.yaml` | 15 gc | 1 | 5 |

### Ammunition (C:1999–2000; PDF p. 38)

| Item | File | Price | Slots | Use |
| --- | --- | ---: | ---: | --- |
| Quiver of 20 Arrows | `quiver-of-20-arrows.yaml` | 5 gc | 1 | Shortbows and longbows |
| Case of 20 Bolts | `case-of-20-bolts.yaml` | 5 gc | 1 | Crossbows |

## Discrepancies

### MEDIUM — the Silent register entry is stale, and the current consequence code does not read the field

The handoff/register statement that `ArmorData` has no `qualities` field and
therefore has nowhere to store Silent is incorrect. `ArmorData` already defines
`system.enchantment` as an optional, blank-allowed `StringField` with no choices;
`"Silent"` fits it directly. The schema can hold the enchantment, so the
register entry should be corrected. No `module/` file was edited.

The related consequence helper in `module/helpers/combat.mjs` still checks only
`system.qualities` and then the item name. It does **not** inspect
`system.enchantment`, so a correctly transcribed Silent enchantment stored in
that field is not currently visible to `wearsSilentArmor` unless the item name
also contains “Silent”. This is reported only, as requested; it is outside
this ticket’s ownership.

### INFO — armor upgrade name corrected by the pinned markdown

The PDF’s Crafting Upgraded Armor table (p. 33) prints **Bloedehide**. The
markdown at C:1867 prints **Bloodhide**. The markdown spelling is used for the
reliable table structure/numeric cross-check, while the PDF spelling is
recorded here as the source name. Neither spelling is stored in the four base
armor YAMLs.

### INFO — armor prose typos repaired by the markdown

The PDF and markdown differ in three armor-enchantment prose spots:

| PDF location | PDF text | Markdown text | Followed |
| --- | --- | --- | --- |
| Slick, p. 35 | “an non-flammable oil” | “a non-flammable oil” | Markdown meaning |
| Spell-Storing, p. 35 | “While wear or wield the armor” | “While you wear or wield the armor” | Markdown meaning |
| Spell-Storing, p. 35 | “and old spells are gone” | “any old spells are gone” | Markdown meaning |
| Waterwalking, p. 36 | “a -2 penalty on a tests made to swim” | “a -2 penalty on tests made to swim” | Markdown meaning |

The Armor Enchantments names/table values (including **Silent**, 1,000 gc,
1 use, Suit, 5 undead parts, goal 50 at C:1933) agree. Base armor and
ammunition item names, prices, slots, and AD/usage values also agree.

## Schema notes

Nothing in these packs exceeds the schema. `ArmorData.enchantment` can hold
Silent; the limitation is the consumer in `combat.mjs`, not the data model.
Armor does not need a `qualities` field for this enchantment. Ammunition uses
the existing `cost` and `slots` fields and has no missing source value.
