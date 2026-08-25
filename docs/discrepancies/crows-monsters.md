# Crows Monsters Cross-Validation Report

**Source:** pinned `docs/source/F-ref-book.md` (see [`docs/source/README.md`](../source/README.md))
**YAMLs:** `src/packs/crows-monsters/*.yaml` (71 files)
**Validated:** 2026-08-25 PT2 rebuild

The Creature Stats preamble at `F:653–682` was read before transcription. It defines
slots (`F:659–663`), power (`F:665–667`), reactions (`F:669–671`), X/Rest
(`F:673–677`), and attacks that grab (`F:679–681`).

## Coverage

| Section | Pinned source | Blocks | YAMLs |
|---|---:|---:|---:|
| Animals | `F:707–1046` | 32 | 32 |
| Humans | `F:1067–1400` | 27 | 27 |
| Blood Creatures, Ring Collector, Undead A–H | `F:1487–1727` | 12 | 12 |
| **Total** |  | **71** | **71** |

All YAMLs parse. Every `_id` is unique and 16 characters, every `_key` is present and
matches its `_id`, every document has Foundry `type: monster` plus a schema-backed
`system.creatureType`, and every expertise key resolves in `ALL_EXPERTISES`.

## Preserved identities

The 11 shipped IDs were updated in place, never duplicated or orphaned:

| Printed PT2 entry | Preserved `_id` |
|---|---|
| Bear | `crowsmon0bear001` |
| Cat | `crowsmon0cat0001` |
| Dog | `crowsmon0dog0001` |
| Goat | `crowsmon0goat001` |
| Horse, Riding | `crowsmon0horse01` |
| Rat | `crowsmonster0rat` |
| Wolf | `crowsmonsterwolf` |
| Blood Creature A | `crowsmonbloodaa1` |
| Blood Creature B | `crowsmonbloodbb1` |
| Blood Creature C | `crowsmonbloodcc1` |
| Ring Collector (Namlin) | `crowsmonringcol1` |

## Discrepancies

### MEDIUM — source slot rule contradicts six printed animal values

`F:691` says all animals have slots, but the bestiary prints `Slots: 0` for Chicken
(`F:785–791`), Crow (`F:806–812`), Hawk (`F:876–882`), Rat (`F:944–950`), Snake,
Venomous (`F:977–984`), and Spider (`F:999–1005`). These six zeros are transcribed
verbatim; no value was inferred from size or power. `MonsterData.suspectMissingSlots`
will therefore report six false positives. The guard correctly caught incomplete
transcriptions such as the old Bear and Wolf values, but the useful signal now needs to
be “the Slots line was missing,” not “the printed value is zero.” This is a schema-owner
decision; no allowlist or schema change was made here.

### MEDIUM — human Equipment has no structured schema field

Twenty-six of the 27 human blocks print Equipment (for example Cultist `F:1152–1160`);
Commoner is the one exception. The printed lines are retained verbatim in `system.notes`
as HTML, because `MonsterData` has no `equipment` field. This preserves Ref-facing
content, but item and spellbook contents cannot be queried at runtime. Adding a schema
field is outside this content ticket.

### MEDIUM — `(U)` speed capability has no schema field

The rules define `(U)` as the ability to climb upside down without a test (`R:841`). The
marker appears on Scorpion, Giant (`F:954–960`), Spider (`F:999–1005`), Spider, Giant
(`F:1009–1015`), Blood Creature B (`F:1501–1512`), and Undead C (`F:1614–1628`).
`MonsterData.speed.modes` can store only a mode name and value, so the values are
transcribed but the unimpeded capability is not representable. No fake mode name was
invented.

### MEDIUM — `/Day` features do not fit `xRest`

`MonsterData.xRest` models the `X/Rest` rule from `F:673–677`. Undead D–H instead print
daily features: Fire Beam (`F:1643–1646`), Bite Frenzy (`F:1663`), Exploding Mote and
Glorp Through (`F:1678–1682`), Insect Breath (`F:1701–1704`), Whirlwind and Damned
Shriek (`F:1723–1727`). Their `(X/Day...)` markers remain in the trait names and their
`xRest` arrays remain empty; encoding them as rest resources would change their refresh
mechanics. A separate daily-resource field or an explicit source adjudication is needed.

### Resolved HIGH transcription errors

The previous 11-file corpus had real data errors, now corrected against the pinned
source: Bear’s stamina/mind/slots and missing climb mode (`F:717–725`), Wolf’s
stamina/slots (`F:1024–1033`), Cat’s power/characteristics/attack (`F:751–757`),
Horse’s mapping and Riding Horse values (`F:896–902`), Rat’s Strength (`F:944–950`),
and Blood Creature C’s power and speed (`F:1516–1527`). Rat’s printed zero remains
canonical; it was not changed to silence the guard.

## Naming decisions

- The four old `(Pet)` suffixes were removed: PT2 prints plain Cat, Dog, Goat, and
  Horse, Riding. The existing IDs remain stable, while the separate background/equipment
  work can resolve `goat (pet)`, `dog (pet)`, and `riding horse (pet)` labels to Actors.
- The old Horse ID maps to **Horse, Riding** (power 5), and Draft/War horses were added
  as separate documents. Cat, Big and Wildcat, Bear, Cave and Wolf, Dire likewise have
  distinct documents.
- Ring Collector is named exactly **Ring Collector (Namlin)**, as printed at `F:1531`.

## Verification

`test/monster-corpus.test.mjs` loads the real YAML corpus and asserts the 71-document
count, parseability, unique 16-character IDs, `_key` integrity, creature type, expertise
catalogue, slot counts (including the six canonical slotless animals), and Ring Collector
X/Rest shape. Mutation testing changed Bear’s slots from 10 to 0: the corpus test failed
on the slot invariant; the source was restored and the test passed again.

**Finding counts:** unresolved HIGH 0; MEDIUM 4; LOW 0.
