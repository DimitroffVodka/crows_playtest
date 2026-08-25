# Crows Traits Batch A — PT2 PDF Cross-Validation Report

**Trees:** alchemy, alteration, archery, armor, bashing, benefaction, blacksmithing
**YAMLs checked:** 84 (all present, no missing files)
**Structure source:** `docs/source/C-characters-book.md`
**Verbatim source:** `02 Crows Characters Book for Playtest 2.pdf` (trait pages 8–14)
**Date:** 2026-08-25

This report supersedes the earlier markdown-only snapshot. The pinned markdown controls tree, tier, column, and ordering; the PT2 PDF controls trait names and prose.

---

## HIGH Severity

_No HIGH discrepancies found._

All 84 documents have the expected tree, tier, column, and `isStarting` values. No `xpCost` field is stored; the runtime derives it from tier as agreed.

---

## MEDIUM Severity

These are source deltas that changed mechanics or user-visible behavior in the YAML. The PDF and pinned markdown agree on each corrected value.

| Slug | Field | Previous YAML | PDF / current YAML |
|------|-------|---------------|--------------------|
| `alchemy-t4-c3` | `system.description` | “You gain a third belt slot…” | “You gain an additional belt slot…” |
| `benefaction-t2-c2` | `system.description` | Target gains 1 additional blessed level | You can become blessed; uses equal Mind, refreshed by a rest |
| `benefaction-t4-c3` | `system.description` | Remove all blessed levels; regain 3 Stamina | Remove the blessed condition; regain 1d6 Stamina (or remove 1 wound) per level removed |
| `blacksmithing-t4-c2` | `system.description` | Use Blacksmithing skill bonus in place of Enchantment skill | Use the number of Blacksmithing expertise uses in place of Enchantment |
| `blacksmithing-t4-c3` | `system.description` | Use Blacksmithing skill bonus in place of Enchantment skill | Use the number of Blacksmithing expertise uses in place of Enchantment |

**H1 chaos wording:** `alteration-t2-c1` and `benefaction-t2-c1` retain the PDF’s “don’t add to the chaos count” text. The agreed PT2 reading is that rank 0–1 spells of the relevant discipline do not trigger a chaos roll; no new mechanics wording was added to either description.

---

## LOW Severity

The following PDF/markdown disagreements were checked against the PDF and the YAML follows the PDF verbatim. They are typos, omissions, or grammar-level differences except where noted.

| Slug / source | PDF text | Markdown text | Followed |
|---------------|----------|---------------|----------|
| `alchemy-t2-c2` Big Boom | “cube they **effect** increased” | “cube they **affect** increased” | PDF |
| `alchemy-t4-c1` Two for One | “When you **finishing** crafting” | “When you **finish** crafting” | PDF |
| `alteration-t2-c2` Hooves | “your speed **increase**” | “your speed **increases**” | PDF |
| `archery-t1-c2` Range Finder | “**it’s** range increases” | “**its** range increases” | PDF |
| `archery-t2-c2` Greater Range | “**it’s** range increases” | “**its** range increases” | PDF |
| `archery-t3-c2` Shot in the Dark | “against **target** in darkness” | “against **targets** in darkness” | PDF |
| `armor-t1-c1` Interposing Arm | “apply **your shield**” | “apply **to your shield**” | PDF |
| `armor-t4-c1` Shield Bash | “When **get** a tier 3 result” | “When **you get** a tier 3 result” | PDF |
| `bashing-t3-c3` Bone Breaker | “grappled, prone, **vulenarble**, or weakened” (no “creature”) | “grappled, prone, **vulnerable**, or weakened creature” | PDF; canonical typo/omission already verified and preserved |
| `benefaction-t1-c1` Lasting Benefaction | “cast **an** benefaction spell” | “cast **a** benefaction spell” | PDF |
| `benefaction-t1-c3` First Responder | “range **take** damage” | “range **takes** damage” | PDF |
| `benefaction-t4-c1` Split Benefaction | “cast **an** benefaction spell” | “cast **a** benefaction spell” | PDF |
| `blacksmithing-t2-c1` Smithing Epiphany | “for **an** blacksmithing item” | “for **a** blacksmithing item” | PDF |
| Blacksmithing tree heading | `Blackmsithing` | `Blacksmithing` | PDF; heading only, so the normalized `blacksmithing` tree slug remains unchanged |

No trait name changed in this pass. The two stale `Alchemy Bell` entries in `connectsTo` were updated to the canonical trait name `Alchemy Belt`; `_id` and `_key` were preserved.

---

## INFO

- All 84 YAMLs parse successfully. Every existing `_id` and `_key` is unchanged from `HEAD`.
- `connectsTo` graph edges are not printed in either source document, so the existing column-aligned edges were retained; only the stale `Alchemy Bell` labels were corrected.
- The PDF’s Movement Stone bullet list is represented as one HTML paragraph in the existing schema; the two benefits and their order are preserved.
- Many Blessings’ use limit/reset and Burn Blessings’ choice are represented in prose because traits have no separate uses/effect schema. No source requirement was unrepresentable.
- XP costs are printed in the PDF but intentionally omitted from YAML; `prepareDerivedData` computes them from tier.

---

## Summary

Batch A now covers 84 traits across seven trees. Eleven YAML documents changed for PDF-faithful prose, including two with stale `Alchemy Bell` graph labels corrected, and no trait names changed. The canonical `vulenarble` Bone Breaker typo was verified and left intact. No dangling `connectsTo` edges, schema gaps, missing files, ID/key changes, or HIGH discrepancies were found.
