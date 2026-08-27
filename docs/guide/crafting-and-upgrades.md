# Crafting and upgrades

Crafting in *Crows* has three different kinds of names. A material identity says
what an inventory card is. An equipment upgrade says what a finished weapon or
piece of armor becomes. An enchantment recipe has its own printed material
words. Keep those vocabularies separate; a name that sounds right is not
necessarily a material the system can consume.

This guide is for players and Refs using the current Playtest 2 system. The
[Characters book](../source/C-characters-book.md) is still the rules reference;
this page describes what the system shows, records, and leaves for the Ref.

## The one-minute version

- **Get a material card:** harvest a corpse, find a card on an adventure, or buy
  one of the listed materials from a Blacksmith. A Ref identifies a generic card
  before it can satisfy a recipe.
- **Start a project:** on the Crow sheet, choose the expertise, required uses,
  goal, and the recipe's printed material phrases. Starting does not consume
  anything.
- **Work:** choose **Craft Equipment** during a rest. The project makes a
  special Mind roll, and up to two expertises can add +4 each.
- **Finish:** when a completed copy is waiting, the Ref finalizes it. The system
  consumes the exact identified material quantities and records an output claim;
  the Ref grants or updates the finished Item.
- **Upgrade or enchant:** use the tables below for the price, effect, uses,
  materials, and goal. Material upgrades are not the Item's `standard`, `fine`,
  or `masterwork` quality field.

## Three vocabularies

### Material identities: what the inventory card is

The material identity enum has these 16 named entries. The words in parentheses
are the ordinary recipe labels that resolve to them:

| Material identity | Printed form | Material identity | Printed form |
| --- | --- | --- | --- |
| `bloodCreature` | blood creature parts | `undead` | undead parts |
| `demon` | demon parts | `angel` | angel parts |
| `elemental` | elemental parts | `plant` | plant parts |
| `iron` | iron bars | `treatedIron` | treated iron bars |
| `archmageObsidian` | archmage obsidian bars | `necromancerSilver` | necromancer silver bars |
| `starDiamond` | star diamond bars | `hickory` | hickory logs |
| `yew` | yew logs | `archmageWillow` | archmage willow logs |
| `necromancerDeathtree` | necromancer deathtree logs | `starwood` | starwood logs |

These are consumed identities, not a list of every name that can appear in a
crafting table. For example, **Steel** is an equipment output, while its input
identity is `treatedIron` (treated iron bars). **Bloodhide** is an equipment
output, while its input identity is `bloodCreature` (blood creature parts).

### Equipment upgrades: what the finished item becomes

The separate 13-output upgrade set is:

`bloodhide`, `undeadBone`, `demonHide`, `angelHide`, `elementalEssence`,
`steel`, `archmageObsidian`, `necromancerSilver`, `starDiamond`, `yew`,
`archmageWillow`, `necromancerDeathtree`, and `starwood`.

The printed **Crafting Upgraded Armor** table maps those outputs to inputs. The
same input mapping is used by the weapon table, with the wood rows applying to
bows:

| Upgrade output | Consumed material identity and form |
| --- | --- |
| Bloodhide | `bloodCreature` — blood creature parts |
| Undead Bone | `undead` — undead parts |
| Demon Hide | `demon` — demon parts |
| Angel Hide | `angel` — angel parts |
| Elemental Essence | `elemental` — elemental parts |
| Steel | `treatedIron` — treated iron bars |
| Archmage Obsidian | `archmageObsidian` — archmage obsidian bars |
| Necromancer Silver | `necromancerSilver` — necromancer silver bars |
| Star Diamond | `starDiamond` — star diamond bars |
| Yew | `yew` — yew logs |
| Archmage Willow | `archmageWillow` — archmage willow logs |
| Necromancer Deathtree | `necromancerDeathtree` — necromancer deathtree logs |
| Starwood | `starwood` — starwood logs |

### Enchantment recipe materials: what an enchantment project consumes

The enchantment cards use a third vocabulary: **angel parts**, **blood creature
parts**, **demon parts**, **plant parts**, **undead parts**, and **elemental
parts**, plus **parts of the enchantment's creature type** for Slaying. The 40
shipped enchantment cards currently use the first five and Slaying; no shipped
card currently prints elemental parts, but the material identity is available
for custom or future recipes.

For a project, enter the printed recipe phrase, such as `5 angel parts`. The
planner resolves that phrase to an identified card whose identity is `angel` and
whose form is `part`; it does not turn `angelHide` into a matching card. For
Slaying, the printed phrase is a placeholder. The Ref must choose the creature
type and make it concrete, for example `5 demon creature-type parts`, or fill a
structured requirement with `creatureType: demon`. The current creature-type
choices are animal, blood, undead, demon, angel, plant, unique, and human.

## Material cards and getting materials

### The generic cards

The four shipped **Crafting Material** cards (`crafting-material-tiny`,
`crafting-material-small`, `crafting-material-medium`, and
`crafting-material-large`) are the book's generic-card design. They are ordinary
Gear with subtype `material`; they are not 16 different catalogue cards. Each
card starts with a blank material identity and form, while its size is physical
inventory information:

| Card | Carry slots | Stack maximum |
| --- | ---: | ---: |
| Crafting Material, Tiny | 1 | 5 |
| Crafting Material, Small | 1 | 1 |
| Crafting Material, Medium | 2 | 1 |
| Crafting Material, Large | 4 | 1 |

The card's description says that the exact material is determined by the Ref.
The Ref must identify it before finalization by setting the material identity
and form (`part`, `bar`, or `log`). A blank identity is not a wildcard. A card
marked unidentified, or a card that is not Gear with subtype `material`, also
does not satisfy a project. The card can remain named “Crafting Material,
Small”; the durable material fields, not the display name, are what matching
uses.

The ordinary gear sheet does not expose the `material.*` fields in its visible
controls. If a generic card refuses to match, have the Ref identify those fields
in the Item data or with a Ref macro. For Slaying, set the special
`creatureTypeParts` identity, form `part`, and the chosen creature type on the
same card.

### Harvesting and loot

The **Harvest** rest activity destroys a corpse and rolls generic monster parts
by corpse size:

| Corpse size | Roll |
| --- | --- |
| Tiny, Small, or Medium | `1d6` |
| Large | `2d6` |
| Huge | `3d6` |
| Holy Shit | `4d6` |

The current activity posts the rolled number of parts and the corpse-destroyed
message, but it does not create an Item card. The Ref therefore grants the
appropriate generic card(s), chooses their physical size, and identifies their
material when the adventure establishes it. Loot cards can likewise be granted
and identified by the Ref.

### Buying materials

The Blacksmith is the village merchant that sells the materials in this table.
The Temple can craft, but does not sell crafting materials. Prices below are
for the listed material card:

| Material | Card size | Price |
| --- | --- | ---: |
| Archmage obsidian bar | Small | 600 gc |
| Archmage willow log | Medium | 1,800 gc |
| Iron bar | Small | 5 gc |
| Hickory log | Medium | 5 gc |
| Necromancer deathtree log | Medium | 3,675 gc |
| Necromancer silver bar | Small | 1,225 gc |
| Star diamond bar | Small | 2,475 gc |
| Starwood log | Medium | 7,425 gc |
| Treated iron bar | Small | 100 gc |
| Yew log | Medium | 300 gc |

Use the payer and receipt process in [Money and shopping](money-and-shopping.md)
for a purchase. A paid purchase is not proof that the material has been
identified or delivered until its receipt says so.

## Start and work a crafting project

### Start the project

On the Crow sheet's **Crafting** panel, choose **Start** and provide:

1. A project name.
2. The expertise. The dialog offers **alchemy**, **blacksmithing**, and
   **enchanting**.
3. The required number of expertise uses from the recipe.
4. The crafting goal from the recipe.
5. The material phrases, separated by commas, exactly as printed on the recipe
   card. Notes can name the target item for an upgrade or enchantment.

The start check reads the expertise's **owned maximum** (`max`), not the
remaining uses (`value`). A crow who spent today's uses can still start a
project they are qualified to make. The matching tool is also required:
Alchemist's Tools, Blacksmith's Tools, or Enchanter's Tools. Tool quality does
not change this name check.

Starting a project records zero points and does not reserve or consume a card.
You can see its point bar and material labels on the sheet. If the material
labels are unknown prose, the system preserves that prose as unresolved rather
than silently guessing.

### Make the rolls

Choose **Craft Equipment** as the Crow's rest activity and select the project.
The roll is a special `2d10 + Mind` test with no tiered outcome:

- The total becomes crafting points. A non-doom result contributes at least 1
  point, even if penalties make the total lower.
- A doom contributes 0 points.
- A crit allows another roll for the same project during the same rest. The rest
  activity handles that extra roll; a direct sheet roll only reports the crit.
- Apply up to two expertises to the roll. Each applied expertise is a flat +4
  and spends one remaining use. A third requested expertise is ignored.
- A double edge is +4 and a double bane is −4. A village, workshop, or other
  institution bonus is an ordinary addend.

Another creature resting with you can assist if the Ref confirms the same tool
and expertise prerequisites. The current rest dialog has no helper picker, so
the Ref must direct the helper's roll at the same project. Their points accrue
to that project.

When the points reach the goal, the system records one completed copy as
pending. Surplus points start another copy only when another complete material
set is available. If the surplus would make a copy but no material set is
available, the points stay banked and the project becomes **blocked**; it does
not mint a free item. Adding or identifying a matching card lets the system
reconcile that blocked goal.

### Finish and hand off

When the sheet shows a completed copy, the Ref should use **Complete** after
checking the target and recipe. Finalization:

1. Rechecks every requirement against live inventory. Matching requires the
   canonical identity, the required form, and enough quantity across identified
   material cards.
2. Writes the exact post-consumption quantities, then deletes cards reduced to
   zero. Multiple cards can supply one set; the planner consumes deterministically
   by Item id.
3. Records a durable output claim and posts a chat card telling the Ref to grant
   the finished item.

The system does **not** create the finished Item, modify an existing weapon or
armor, or attach an enchantment key automatically. For an upgrade, the Ref
applies the table's changed stat to the target Item. For an enchantment, the Ref
adds the catalogue key to the target weapon or armor and uses the catalogue
card's description for its effect. This is also where the Ref records the
target if the project was started from the Crow-sheet dialog, which has no
target selector.

Canceling a project does not consume its materials. It removes the project and
leaves inventory alone.

### When crafting refuses

| Result or sheet state | Meaning | What to do |
| --- | --- | --- |
| `needs name, expertise, goal` | A required start field is missing. | Fill all three fields and retry. |
| `needs N ... use(s)` | The crow does not own enough of the selected expertise. | Check the recipe and the expertise's **max** uses; choose the right expertise or have the Ref resolve the character's prerequisites. |
| `needs ... tools` | The matching tool is not in the inventory by name. | Add or carry the appropriate tools and retry. |
| Roll button disabled / project `blocked` | The goal has been reached in points, but no authorized material set is available. | Have the Ref identify or grant matching cards. The Item change will reconcile the project; do not create a finished item by hand. |
| `incomplete` | No completed copy is pending. | Keep rolling until the goal is reached. |
| `unresolved-material` | A recipe phrase was unknown, blank, or still contains Slaying's creature-type placeholder. | Replace it with a supported printed phrase and choose the Slaying creature type explicitly. |
| `insufficient-material` | The cards do not have the required identity, form, or quantity for all pending copies. | Inspect the cards' `material.*` fields and the number of pending copies. Do not pay or remove cards manually. |
| `recovery-required`, `write-failed`, or an uncertain receipt | A quantity update, deletion, or final claim was not fully acknowledged. | Keep the same crafting transaction id and let the Ref recover it. Do not decrement again, restore a card, or grant a second output with a new id. |

## Upgrading armor

An armor material upgrade increases AD. The price in the effect tables is the
price for buying that finished upgrade; the crafting tables give the expertise
uses, material quantity, and goal for making it. The current Item `qualityTier`
field is separate: a material-upgraded loot weapon can still have
`qualityTier: standard` while its damage and description say Steel.

### Upgrade effects and purchase prices

| Armor | Upgrade | AD bonus | Price |
| --- | --- | ---: | ---: |
| Light | Bloodhide | +4 | 500 gc |
| Light | Undead Bone | +8 | 2,500 gc |
| Light | Demon Hide | +12 | 5,000 gc |
| Light | Angel Hide | +16 | 10,000 gc |
| Light | Elemental Essence | +20 | 15,000 gc |
| Medium | Steel | +4 | 625 gc |
| Medium | Archmage Obsidian | +8 | 3,125 gc |
| Medium | Necromancer Silver | +12 | 6,250 gc |
| Medium | Star Diamond | +16 | 12,500 gc |
| Medium | Elemental Essence | +20 | 18,750 gc |
| Heavy | Steel | +4 | 750 gc |
| Heavy | Archmage Obsidian | +8 | 3,750 gc |
| Heavy | Necromancer Silver | +12 | 7,500 gc |
| Heavy | Star Diamond | +16 | 15,000 gc |
| Heavy | Elemental Essence | +20 | 22,500 gc |
| Shield | Steel | +2 | 375 gc |
| Shield | Archmage Obsidian | +4 | 1,875 gc |
| Shield | Necromancer Silver | +6 | 3,750 gc |
| Shield | Star Diamond | +8 | 7,500 gc |
| Shield | Elemental Essence | +10 | 11,250 gc |

### Crafting upgraded armor

Each row is one armor item. The material words are the printed recipe words;
the identity in parentheses is the inventory identity the planner matches.

| Upgrade | Armor | Uses | Materials | Goal |
| --- | --- | ---: | --- | ---: |
| Bloodhide | Light | 1 | 10 blood creature parts (`bloodCreature`) | 25 |
| Undead Bone | Light | 2 | 10 undead parts (`undead`) | 125 |
| Demon Hide | Light | 3 | 10 demon parts (`demon`) | 250 |
| Angel Hide | Light | 4 | 10 angel parts (`angel`) | 500 |
| Elemental Essence | Light | 4 | 10 elemental parts (`elemental`) | 750 |
| Steel | Medium | 1 | 5 treated iron bars (`treatedIron`) | 30 |
| Archmage Obsidian | Medium | 2 | 5 archmage obsidian bars (`archmageObsidian`) | 155 |
| Necromancer Silver | Medium | 3 | 5 necromancer silver bars (`necromancerSilver`) | 310 |
| Star Diamond | Medium | 4 | 5 star diamond bars (`starDiamond`) | 625 |
| Elemental Essence | Medium | 4 | 10 elemental parts (`elemental`) | 935 |
| Steel | Heavy | 1 | 10 treated iron bars (`treatedIron`) | 35 |
| Archmage Obsidian | Heavy | 2 | 10 archmage obsidian bars (`archmageObsidian`) | 185 |
| Necromancer Silver | Heavy | 3 | 10 necromancer silver bars (`necromancerSilver`) | 375 |
| Star Diamond | Heavy | 4 | 10 star diamond bars (`starDiamond`) | 750 |
| Elemental Essence | Heavy | 4 | 10 elemental parts (`elemental`) | 1,125 |
| Steel | Shield | 1 | 3 treated iron bars (`treatedIron`) | 15 |
| Archmage Obsidian | Shield | 2 | 3 archmage obsidian bars (`archmageObsidian`) | 95 |
| Necromancer Silver | Shield | 3 | 3 necromancer silver bars (`necromancerSilver`) | 185 |
| Star Diamond | Shield | 4 | 3 star diamond bars (`starDiamond`) | 375 |
| Elemental Essence | Shield | 4 | 5 elemental parts (`elemental`) | 560 |

## Upgrading weapons and ammunition

Metal upgrades increase weapon damage. Wood upgrades increase a bow's range.
Metal weapon prices are for one weapon or five sets of ammunition. The crafting
goals in the metal rows use that same unit; a wood row is for one bow. The rules
allow metal upgrades for ammunition and for weapons that are not bows or
unarmed, while bows use the wood table.

### Metal weapons and ammunition

| Upgrade | Tier 2 damage | Tier 3 damage | Price |
| --- | ---: | ---: | ---: |
| Steel | +1 | +1 | 500 gc |
| Archmage Obsidian | +1 | +2 | 2,500 gc |
| Necromancer Silver | +1 | +3 | 5,000 gc |
| Star Diamond | +1 | +4 | 10,000 gc |
| Elemental Essence | +2 | +5 | 15,000 gc |

### Wood bows

| Upgrade | Range bonus | Price |
| --- | ---: | ---: |
| Yew | +1 | 375 gc |
| Archmage Willow | +2 | 1,875 gc |
| Necromancer Deathtree | +3 | 3,750 gc |
| Starwood | +4 | 7,500 gc |
| Elemental Essence | +5 | 11,250 gc |

### Crafting upgraded weapons

| Upgrade | Uses | Materials | Goal |
| --- | ---: | --- | ---: |
| Steel | 1 | 3 treated iron bars (`treatedIron`) | 30 |
| Archmage Obsidian | 2 | 3 archmage obsidian bars (`archmageObsidian`) | 155 |
| Necromancer Silver | 3 | 3 necromancer silver bars (`necromancerSilver`) | 310 |
| Star Diamond | 4 | 3 star diamond bars (`starDiamond`) | 625 |
| Elemental Essence | 4 | 5 elemental parts (`elemental`) | 935 |
| Yew | 1 | 1 yew log (`yew`) | 15 |
| Archmage Willow | 2 | 1 archmage willow log (`archmageWillow`) | 95 |
| Necromancer Deathtree | 3 | 1 necromancer deathtree log (`necromancerDeathtree`) | 185 |
| Starwood | 4 | 1 starwood log (`starwood`) | 375 |
| Elemental Tree | 4 | 5 elemental parts (`elemental`) | 560 |

**Elemental Tree** is the printed name in the wood crafting table. The system
normalizes that output to the `elementalEssence` upgrade key. It is still made
from elemental parts; it is not a material identity called `elementalTree`.

## Enchantments

The compendium contains 40 read-only catalogue cards: 20 armor enchantments and
20 weapon enchantments. An equipment Item stores the catalogue key in its
`system.enchantments` array. Armor and weapon **Dancing** are two different
catalogue entries and use `armor-dancing` and `weapon-dancing` respectively.

### Applying one

1. Open the catalogue card and confirm that its kind and restriction fit the
   target. Armor cards say **Both**, **Suit**, or **Shield**. Weapon cards leave
   this column blank and the card description supplies restrictions.
2. Record the target weapon or armor in the project notes for the Ref. The
   Crow-sheet start dialog has no target picker.
3. Start a project with the card's Enchanting uses, goal, and exact printed
   materials. The project needs Enchanter's Tools and the required owned
   Enchanting uses. Enter a concrete creature type for Slaying.
4. Roll during rests and complete the project. On successful finalization, the
   system consumes the matching cards and posts an output claim.
5. The Ref checks the card's full description, then adds its stable key to the
   target equipment and adjudicates its ongoing effect. The catalogue Item is a
   reference card; completion does not attach it automatically.

Unarmed weapons cannot be enchanted. The catalogue descriptions also carry
special restrictions: Hewing and Returning are non-bow only, Infinity is bow
only, and a weapon can have only one Slaying enchantment. A suit or shield can
have multiple enchantments, subject to the total-use rule below.

### Armor enchantment recipes

`Both` means a suit or shield; `Suit` and `Shield` are restricted accordingly.

| Enchantment | Price | Uses | Applies | Materials | Goal |
| --- | ---: | ---: | --- | --- | ---: |
| Banishing | 5,000 gc | 3 | Both | 10 undead parts | 250 |
| Climbing | 7,500 gc | 4 | Suit | 20 plant parts | 375 |
| Dancing | 5,000 gc | 3 | Shield | 10 angel parts | 250 |
| Deep | 3,000 gc | 2 | Suit | 10 blood creature parts | 150 |
| Demon's Head | 1,000 gc | 1 | Shield | 5 demon parts | 50 |
| Feather | 1,000 gc | 1 | Suit | 5 plant parts | 50 |
| Flying | 7,500 gc | 4 | Shield | 20 angel parts | 375 |
| Glow | 1,000 gc | 1 | Both | 5 undead parts | 50 |
| Heavy | 500 gc | 1 | Suit | 5 undead parts | 25 |
| Luring | 1,000 gc | 1 | Both | 5 angel parts | 50 |
| Passthrough | 7,500 gc | 4 | Suit | 20 blood creature parts | 375 |
| Revenge | 10,000 gc | 4 | Suit | 20 demon parts | 500 |
| Silent | 1,000 gc | 1 | Suit | 5 undead parts | 50 |
| Slick | 1,000 gc | 1 | Suit | 5 blood creature parts | 50 |
| Speedy | 5,000 gc | 3 | Suit | 10 angel parts | 250 |
| Spell-Storing | 1,000 gc | 1 | Both | 5 plant parts | 50 |
| Sustaining | 5,000 gc | 3 | Suit | 10 plant parts | 250 |
| Telepathic Node | 2,000 gc | 2 | Suit | 5 angel parts | 100 |
| Victory | 5,000 gc | 3 | Suit | 10 demon parts | 250 |
| Waterwalking | 500 gc | 1 | Suit | 5 blood creature parts | 25 |

### Weapon enchantment recipes

| Enchantment | Price | Uses | Materials | Goal |
| --- | ---: | ---: | --- | ---: |
| Absorbing | 500 gc | 1 | 5 plant parts | 25 |
| Dancing | 5,000 gc | 3 | 10 angel parts | 250 |
| Defending | 1,000 gc | 1 | 10 undead parts | 50 |
| Exploding | 2,000 gc | 2 | 5 blood creature parts | 100 |
| Flaming | 5,000 gc | 3 | 10 demon parts | 250 |
| Frosty | 4,000 gc | 2 | 10 demon parts | 200 |
| Gashing | 10,000 gc | 4 | 20 demon parts | 500 |
| Hewing | 7,500 gc | 4 | 20 angel parts | 375 |
| Hungry | 5,000 gc | 3 | 10 undead parts | 250 |
| Impact | 1,000 gc | 1 | 5 undead parts | 50 |
| Infinity | 5,000 gc | 3 | 10 angel parts | 250 |
| Lightning | 2,000 gc | 2 | 5 angel parts | 100 |
| Poisoning | 2,000 gc | 2 | 5 blood creature parts | 100 |
| Raging | 1,000 gc | 1 | 5 demon parts | 50 |
| Returning | 7,500 gc | 4 | 20 plant parts | 375 |
| Slaying | 1,000 gc | 1 | 5 parts of the enchantment's creature type | 50 |
| Sworn Foe | 2,000 gc | 2 | 5 undead parts | 100 |
| Teleporting | 10,000 gc | 4 | 20 angel parts | 500 |
| Vicious | 500 gc | 1 | 5 undead parts | 25 |
| Weakening | 7,500 gc | 4 | 20 plant parts | 375 |

The catalogue card contains the full effect text. Use that text for the Ref's
adjudication, including usage dice, durations, triggers, and any backlash. If
you buy an already enchanted item, add the listed enchantment price to the
item's base price and use the payment/receipt flow in [Money and shopping](money-and-shopping.md).

## Where crafting happens in the village

Use [The village](the-village.md) for founding, reopening, upgrading, and
effective institution levels. Use [Money and shopping](money-and-shopping.md)
for choosing a payer and committing a paid action.

The village sheet's institution row shows two different kinds of terms:

- **Crafting:** a gc figure for the commission and a `rolls/day` figure. The
  commission requires the materials plus the item's full price up front. The
  normal rate is one crafting roll per day, with a bonus equal to the artisan's
  effective level. A rush job costs twice the price and makes two rolls per day.
  The displayed gc figure is the commission amount, not a daily rent.
- **Workshop:** 5 gc/day. Renting gives a bonus equal to the effective
  institution level for that institution's expertise. Alchemist, Blacksmith,
  and Enchanter workshops exist; the Temple is an artisan but has no rentable
  workshop.

The Blacksmith's workshop applies to blacksmithing rolls, the Enchanter's to
enchanting rolls, and the Alchemist's to alchemy rolls. The Temple can
commission all three kinds of crafting but does not sell the material table.
When a village event changes an institution, use the row's **effective** level
and current status rather than its raw level.

The paid commission and workshop commands charge through the Village/Commerce
boundary and then expect a service confirmation. They do not run daily artisan
rolls or create a finished Item on their own. If payment is confirmed but the
service result is missing, treat it as an in-flight operation and use its same
receipt for recovery; do not pay again.

## Current gaps to adjudicate at the table

These are current software behaviors, not claims that the printed rules changed.

- **Four-enchantment cap:** the rules cap an item at four total Enchanting uses
  across its enchantments. The system stores an array and derives a use total,
  but does not refuse a fifth or otherwise enforce the cap. The Ref must count
  the recipe uses before attaching a key.
- **Silent's +1:** the card says Silent gives +1 to hide and sneak tests. The
  current committed-test path does not add that bonus. It can still apply the
  card's Weakened consequence after a tagged hide/sneak tier-1 result. Add the
  +1 manually and let the Ref adjudicate the consequence if the roll was not
  tagged.
- **Ammunition does not deplete:** weapon attacks do not find or decrement an
  ammunition Item. A quiver or case's quantity therefore does not fall when an
  attack is made. The Ref must track loading and expenditure for now.
- **`ammoFor` is prose:** the ammunition card's `ammoFor` field is a free text
  string. No checked reference connects it to a weapon, so “shortbows and
  longbows” and “crossbows” are guidance for the Ref, not an enforced relation.
- **Shortbow and Cumbersome:** the Shortbow card has `slots: 1` and the
  `cumbersome` quality. The sheet derives its displayed grip from the one-slot
  value, and slot/wield checks do not enforce Cumbersome's two-hand requirement.
  Treat it as a one-slot carry item but adjudicate the two hand slots manually.
