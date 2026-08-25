# Playtest 2 crows-loot cross-validation report

**Generated:** 2026-08-25
**Primary source:** [`docs/source/IL-cards-pois-dungeons.txt`](../source/IL-cards-pois-dungeons.txt) (`IL:` citations)
**Duplicate-card cross-check:** [`docs/source/IC-inventory-cards.txt`](../source/IC-inventory-cards.txt) (`IC:` citations)
**YAMLs:** `src/packs/crows-loot/*.yaml` (13 documents)

The IL deck is the dungeon-treasure source. Its `pdftotext -layout` extraction is faithful;
the card column, rather than a neighboring column on the same line, is authoritative.
The IL title roster was re-derived and compared with every existing document under
`src/packs`. The result is exactly the seven missing cards named below: no extra item was
found after excluding grid artifacts and the deliberate specialized Lore Book names.

## HIGH severity — seven cards were missing (resolved)

These were unshipped dungeon-treasure documents, so each was a HIGH content omission at the
audit point. All seven now have a fresh 16-character `_id`, a matching `_key`, and remain in
this loot pack because that is where a Ref stocking a dungeon looks.

| Item | Card | Shipped document | Resolution |
|---|---|---|---|
| Death Ring | `IC:120-144`, `IL:182-203` | `death-ring.yaml` (`type: gear`) | Added with Rest/Activate UD, ring slot, RR bands, 1,000 gc. |
| Life Ring | `IL:182-203` | `life-ring.yaml` (`type: gear`) | Added with Rest/Activate UD, ring slot, recovery effect, 500 gc. |
| Hurling Wand | `IC:146-158`, `IL:122-134` | `hurling-wand.yaml` (`type: gear`) | Added with Useless/Activate UD, Strength RR bands, 500 gc. |
| Steel Knife | `IL:15-27` | `steel-knife.yaml` (`type: weapon`) | Added with printed Steel damage, qualities, and 510 gc. |
| Steel Axe | `IL:154-167` | `steel-axe.yaml` (`type: weapon`) | Added with printed Steel damage, qualities, and 512 gc. |
| Exploding Greatsword | `IL:111-119` | `exploding-greatsword.yaml` (`type: weapon`) | Added with `enchantment: Exploding`, printed damage, and 2,015 gc. |
| Vicious Steel Flail | `IL:261-268` | `vicious-steel-flail.yaml` (`type: weapon`) | Added with `enchantment: Vicious`, printed Steel damage, and 1,015 gc. |

The four upgraded/enchanted weapons are intentionally in `crows-loot`, alongside the cards
that print them. They are `type: weapon` documents; no duplicate was added to
`crows-weapons`.

### Grid artifacts excluded from the diff

The following apparent names are cross-column fragments, not cards: `What's the`, `You
throw`, `S`, `Exact gem`, `Apply to a`, `Ring Lore Book`, and `Art Object, Small Gem`.
The bare `Lore Book` title is also not a missing document: the four shipped gear documents
are deliberately specialized by expertise, matching the four card columns at `IL:40-56`.

## MEDIUM severity — material-upgrade axis is absent from the schema (open)

The cards print **Steel** as a weapon-material upgrade. `WeaponData.qualityTier` is the
gear-quality enum `standard|fine|masterwork`; it cannot represent the five metal/wood
upgrade materials or their damage/range mechanics (`C:2002-2043`). The new Steel weapons
therefore leave `qualityTier: standard`, store the printed Steel material in their
descriptions, and store the independent `Exploding`/`Vicious` names in the existing
blank-allowed `enchantment` field. Their card damage is stored in `system.damage`, so no
bonus is inferred from the wrong quality axis. This is a schema-owner follow-up; no
`module/` change was made.

The Flail card's `Vicious` axis is independent of Steel: the enchantment name is supported
by `WeaponData.enchantment` and the table at `C:2076` (`Vicious`, 500 gc, 1 use, 5 undead
parts, goal 25). `Exploding` is likewise supported by that table (`C:2076`, 2,000 gc,
2 uses, 5 blood creature parts, goal 100). The card names and printed stats are preserved;
the full rules remain in the Characters Book rather than being invented in a new field.

## Historical PT1 loot findings — re-verified against PT2

The three recorded fixes still agree with the PT2 cards and remain landed:

| Item | Field | PT2 card | Result |
|---|---|---|---|
| Boom Wand | `usageDie.expiry` | `IC:69-89` (`Useless; Activate`) | `useless` is correct; `refuelWith` remains blank. |
| Minor Telekinesis Ring | `usageDie.expiry` | `IL:40-56` (`Rest; Activate`) | `rest` is correct. |
| Minor Telekinesis Ring | `usageDie.refuelWith` | `IL:40-56` | Blank is correct; Rest is the expiry state, not a refuel item. |

## LOW severity — none open

The old Ring Collector flavor suffix on Blood Concoction was not printed on the PT2 card.
It was removed, and the card's own `Unique Item | XP: 500` text is now self-contained at
`IL:204-225` / `IC:69-89`.

## INFO — identity, schema, and source notes

- The six existing IDs and keys are preserved: `crowsloot0bldcnc`, `crowsloot0boomwd`,
  `crowsloot0magicr`, `crowsloot0magicw`, `crowsloot0telekn`, and `crowsloot0potion`.
- New IDs are `crowsloot0deathr`, `crowsloot0liferg`, `crowsloot0hurlwd`,
  `crowsloot0stlknf`, `crowsloot0stlaxe`, `crowsloot0explgs`, and `crowsloot0vflail`.
- Magic Ring, Magic Wand, and Potion remain mystery items with no printed price at
  `IL:30-35` and `IL:122-127`; their `cost: 0` placeholders are intentional.
- Blood Concoction's `XP: 500` is retained in its description because GearData has no
  structured XP field. Its slug-tail, tier-1-and-3, and compound-eyes results occur only in
  Blood Concoction; a repository search found no bleed into another loot or spellbook
  description.
- No card fact in the seven additions is silently dropped: stack, slots, usage die, RR
  bands, attack statistics, damage bands, qualities, enchantment names, and prices are
  represented in existing fields or description text. The only structured limitation is
  the material-upgrade axis recorded above.

## Summary

**Audit result:** 7 HIGH omissions found and resolved · 0 HIGH open · 1 MEDIUM schema gap
open · 0 LOW open. The pack now contains 13 packable documents, including the four
pre-made weapon treasures.
