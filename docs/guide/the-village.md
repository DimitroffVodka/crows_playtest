# The village

Your crows share a home village. It has **institutions** they can use, a
**Prosperity** score that moves with how much they invest in it, and a
**cycle** of 10 days that the Ref advances between adventures.

The short version: *the village decays unless you spend money in it.*

---

## Opening the village

The Ref opens it from the console or a macro:

```js
game.crows.village.open()
```

Everyone at the table can open and read it. Only the Ref sees the controls that
change shared state.

## What you are looking at

**Header** — the village name, its Prosperity, the current Cycle, and a
revision number. The revision is how the system detects two people acting on
stale information; you can ignore it unless something refuses.

**The four figures** —

| Figure | Meaning |
| --- | --- |
| Merchant sale percentage | What merchants pay for what you sell them, as a share of value |
| Merchant spend this cycle | How much the party has spent with village merchants, against the 10,000 gc that raises Prosperity |
| Spend remaining | How much more spending this cycle would earn that increase |
| Found a village | 15,000 gc, the cost of founding a *new* village |

**The institutions table** — one row per institution, showing its RAW level,
any PENDING change, its EFFECTIVE level, whether it is open, and its terms.
Terms differ by institution: a Blacksmith shows founding and upgrade prices, a
sale percentage, its crafting rate and workshop rental; an Inn also shows its
maximum bet.

RAW and EFFECTIVE differ when a village event has temporarily moved an
institution's level. EFFECTIVE is what you actually get.

**Proposals** — pending player requests awaiting the Ref.

**Current effects** — active event modifiers, or a note that there are none.

---

## Starting out

A new village begins at **Prosperity 0, Cycle 0**, with five institutions at
level 1: a General Store, an Inn and a Temple, plus two the group chooses.

Twelve institution types exist: alchemist, auction house, barracks, beacon,
blacksmith, bookseller, crypt, enchanter, general store, inn, stables, temple.

## Founding an institution

1. Under **Found or reopen an institution**, pick the type. The dropdown shows
   each one's price — an Alchemist is 3,000 gc, a General Store 1,000.
2. Give it a name and a steward. Both are flavour; neither affects the rules.
3. **Submit founding proposal.**
4. The Ref **Approves** it, then **Commits** it.

Founding also covers reopening something destroyed or reduced to level zero.

> **The proposal needs a payer, and the sheet cannot pick one yet.** A proposal
> raised from the standalone village sheet carries no payer and will refuse at
> commit. Until a payer selector exists, nominate one when proposing:
>
> ```js
> await game.crows.village.propose({
>   action: "found", institutionType: "alchemist", name: "The Green Retort",
>   payerActorUuid: game.actors.getName("Party Treasury").uuid
> })
> ```
>
> The sheet inherits a payer automatically when opened from a crow's sheet.

## Upgrading an institution

**Propose upgrade** on its row, then the Ref approves and commits. The price is
the **Next** figure in that row's terms, and it is not the same as the founding
price — a Blacksmith costs 3,000 to found and 1,500 to raise.

---

## Prosperity

Prosperity runs from **-10 to +10**. It sets availability, prices, how much
housing the village has, and which events you are likely to roll.

**It falls by 1 at the end of every cycle unless something raised it during that
cycle.** This is the single most important thing to understand about the
village: standing still is not neutral. A village left alone shrinks.

The main way to raise it is to **spend money there** — 10,000 gc with village
merchants during one cycle raises Prosperity by 1. That is worth two points, not
one: the increase also counts as the cycle's raise, so the usual end-of-cycle
drop does not happen. Buying from your own village rather than elsewhere is the
mechanical point of having one.

A newly founded village gets its **first** end-of-cycle free — it starts already
marked as having been raised, so your opening cycle cannot put you at -1 before
the party has had a chance to spend anything.

---

## Running a cycle

A cycle is **10 days**.

**Ending a cycle also rolls the next one's event.** That is the part to get
straight, because it is not the order you would guess:

1. **Resolve the pending event** left over from the last cycle end. Some events
   need a target chosen; the sheet shows the options.
2. **End cycle** — advances the cycle, applies the Prosperity change, resets the
   merchant spend counter, promotes anything waiting on the cycle to turn over,
   and **rolls the next event**, leaving it pending for the cycle you have just
   entered.

So a cycle normally begins with an event waiting for you and ends by producing
the next one. **Roll event** is the manual roll, for when there is no pending
event — after abandoning one, for instance. It disappears while an event is
outstanding, so you cannot stack two.

A rolled-but-unresolved event blocks the cycle from advancing.

### When End cycle refuses

The cycle will not advance while any operation is unfinished. The sheet tells
you which one:

> Cycle cannot advance: operation "village-merchant-purchase-…" (merchant-purchase)
> is still in the "commerce-committed" phase. Repair or adjudicate it before
> ending the cycle.

That is a purchase that got part-way and stopped — money may have moved. You
have two ways out, and the sheet offers whichever apply:

- **Forward repair** finishes the operation as originally intended. Available
  when the journal still holds enough of the original request to complete it.
- **Abandon** refunds the recorded amount. It does **not** reclaim anything
  already handed over — the sheet names the item so you know what you are
  leaving with the player. Reversing an item someone may already have used is a
  judgement call, so the system leaves it to you rather than guessing.

Retrying is safe. Repair runs under the same token as the original attempt, so
it will not charge twice or deliver twice.

---

## Village events

Events roll on `d10 + Prosperity`, spanning -9 to 20. They move Prosperity,
shift institution levels temporarily, or occasionally destroy something.

Because the roll includes Prosperity, a thriving village and a failing one draw
from genuinely different fates — the table is not the same experience at +8 as
at -8.

Effects that change an institution's level show up as the gap between RAW and
EFFECTIVE in the table. Active modifiers are listed under **Current effects**.

### Resolving an event

Most events ask you to choose what they land on. An event that targets a
merchant offers a list of your institutions; one that targets characters offers
your crows. Pick and resolve.

Events that hand out items — `gratefulRations` gives 6 rations each,
`healingPotions` the equivalent — deliver them to every recipient you choose.

To resolve from a macro or the console instead:

```js
const v = game.crows.village;
await v.resolvePendingEvent({
  resolutionId: v.get().pendingEvent.resolutionId,
  selections: { recipientActorUuids: game.actors.filter(a => a.type === "crow").map(a => a.uuid) }
})
```

Note `selections`, plural. The singular is silently ignored and you will get
`selection-required` back.

**If a grant fails part way** — one crow has no room, say — the event reports
`partial` rather than success and stays pending. Deliveries that succeeded
stand; nothing is clawed back. The sheet shows which recipients got their items
and which refused, with the reason. Make room and hit **Retry**: it uses the
same tokens, so it skips whoever already received theirs and only retries the
rest. Nobody gets a double helping.

---

## The village map

The system can generate a Scene showing the village, with a building for each
institution and cottages that multiply as Prosperity rises:

```js
await game.crows.village.bootstrapScene()
```

It is safe to call more than once — it recognises a Scene it has already made
rather than creating a second one. Tiles it generated carry a flag; anything
you add or move yourself is left alone, so you can decorate freely.

The default backdrop is *Meadow Picnic* by 2 Minute Tabletop, in day and night
variants (see [NOTICE.md](../../NOTICE.md) for attribution). A Ref can swap in
a different map — building placement is deliberately not tied to any feature of
the backdrop.

---

## Who can do what

Players browse the village and submit proposals. The Ref or designated GM
authorises and commits anything that changes shared state or spends party
money, and is the only one who ends cycles or rolls events.

A proposal is not a reservation. Prices and availability are re-checked at the
moment of commit, so an approved proposal can still refuse if the village moved
underneath it. Nothing has happened until a receipt says it has.
