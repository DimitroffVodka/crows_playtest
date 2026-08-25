# Playtest 2 Weapons Cross-Validation Report

**Date:** 2026-08-25
**Canonical structure and numeric source:** `docs/source/C-characters-book.md`, C:1944–2043
**Name and prose source:** `02 Crows Characters Book for Playtest 2.pdf`, pp. 37–40, read with `pdftotext -layout`
**YAMLs checked:** `src/packs/crows-weapons/*.yaml`

## Summary

| Severity | Count |
| --- | ---: |
| HIGH | 0 |
| MEDIUM | 1 |
| LOW | 0 |
| INFO | 10 |
| **Total** | **11** |

The 19 shipped weapon documents now match the PT2 Weapon Prices table on name,
type, range, qualities, cost, and slots. The 2H entry is a rename in place:
PT2 calls it **Flail**, not “Mace (Polearm)”. Its `_id` and `_key` remain
`crowsweap0mace02` / `!items!crowsweap0mace02` so existing world links keep
pointing at the same document.

## Counts derived from the source

- **19 weapons:** C:1980–1998, including Flail.
- **2 ammunition rows:** C:1999–2000. These are covered by the ammunition report.
- **8 weapon qualities:** Brutal, Cumbersome, Disengage, Dismember, Light,
  Parry X, Pummeling, Reload (C:1956–1963).

Every `system.qualities` value in this pack is one of those eight normalized
names. `parryValue` carries the X for Parry 2/4/6; the quality itself is
stored as `parry`.

## Verified roster

| Item | File | Cost | Slots | Qualities |
| --- | --- | ---: | ---: | --- |
| Hammer | `hammer.yaml` | 10 | 1 | Light, Pummeling |
| Mace | `mace-1h.yaml` | 12 | 1 | Pummeling |
| Flail | `flail.yaml` | 15 | 2 | Pummeling |
| Maul | `maul.yaml` | 15 | 2 | Pummeling |
| Handaxe | `handaxe.yaml` | 10 | 1 | Dismember, Light |
| Axe | `axe.yaml` | 12 | 1 | Dismember |
| Halberd | `halberd.yaml` | 15 | 2 | Dismember |
| Greataxe | `greataxe.yaml` | 15 | 2 | Dismember |
| Knife | `knife.yaml` | 10 | 1 | Disengage, Light, Parry 2 |
| Sword | `sword.yaml` | 12 | 1 | Disengage, Parry 4 |
| Glaive | `glaive.yaml` | 15 | 2 | Disengage, Parry 6 |
| Greatsword | `greatsword.yaml` | 15 | 2 | Disengage, Parry 6 |
| Stiletto | `stiletto.yaml` | 10 | 1 | Brutal, Light |
| Spear | `spear.yaml` | 12 | 1 | Brutal |
| Pike | `pike.yaml` | 15 | 2 | Brutal |
| Warpick | `warpick.yaml` | 15 | 2 | Brutal |
| Shortbow | `shortbow.yaml` | 10 | 1 | Cumbersome |
| Longbow | `longbow.yaml` | 12 | 2 | — |
| Crossbow | `crossbow.yaml` | 15 | 2 | Reload |

## Discrepancies

### MEDIUM — PT2 rename: Mace (Polearm) → Flail

The old `mace-2h.yaml` document had byte-identical PT2 stats but the PT1 name.
It was repurposed in place as `flail.yaml`; `_id` and `_key` were preserved.
The description was also changed so it no longer calls the item a mace. No new
document was created and no document was deleted from the compendium identity.

`rg -n -F 'Mace (Polearm)' src/packs` found only the old weapon document itself;
there were no inbound references in any other pack. After the rename, the old
string has no `src/packs/` matches. The background equipment resolver therefore
has no stale name to repair; the only weapon grant containing “mace” is the
one-handed `Mace`.

### INFO — PDF names corrected by the pinned markdown

The PDF prints **Bloedehide** in the Crafting Upgraded Armor table (p. 33),
while C:1867 says **Bloodhide**. The PDF prints **Necormancer Deathtree** in
both the Wood Weapons Upgraded table (p. 39) and Crafting Upgraded Weapons
table (p. 39), while C:2024 and C:2039 say **Necromancer Deathtree**. These
are source-only upgrade names; no upgrade documents exist in this pack.
Per the fidelity rule, the PDF spelling is recorded here as the shipped name,
while the markdown supplies the reliable table structure and numeric values.

### INFO — PDF prose typos repaired by the markdown

The following are differences in the weapon chapter. None changes a shipped
weapon field, and the YAMLs do not attempt to store the full quality prose.
The PDF spelling is the authority for quoted names/prose; markdown is followed
for readable cross-validation and for all numbers/structure.

| PDF location | PDF text | Markdown text | Followed |
| --- | --- | --- | --- |
| Weapon Types, p. 37 | “can a be bashing” | “can be a bashing” | Markdown meaning |
| Brutal, p. 37 | “as your normally would” | “as you normally would” | Markdown meaning |
| Gashing, p. 40 | “If target recieves magic healing” | “If the target receives magic healing” | Markdown meaning |
| Gashing, p. 40 | “When get a doom” | “When you get a doom” | Markdown meaning |
| Returning, p. 40 | “the weapon return to your hand slot(s)” | “the weapon returns to your hand slot(s)” | Markdown meaning |
| Weapon Enchantments intro, p. 39 | “all of an weapon’s enchantments” | “all of a weapon’s enchantments” | Markdown meaning |

The PDF’s `1-2`/`3-4` Dismember ranges and `x` multiplier are layout
punctuation equivalents of the markdown’s `1–2`/`3–4` and `×`; no value
discrepancy was found. All Weapon Prices rows, quality names, upgraded-weapon
prices, and weapon-enchantment table values agree.

## Schema and code notes

No weapon schema limitation was found. `WeaponData` already has `qualities`,
`parryValue`, and an optional string `enchantment`; no module change was made.
