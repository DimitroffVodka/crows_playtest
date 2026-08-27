# Money and shopping

Money in *Crows* is carried in two physical places: loose coin on the Actor
and Coin Purse Items in that Actor's inventory. A purchase, sale, refund, or
auction is therefore a small inventory operation, not a change to one abstract
treasury number.

This guide is for players and Refs using the current Playtest 2 system.

## The one-minute version

- **Buy:** choose one Crow or Party payer, submit the current Village action,
  and wait for the Ref to commit it. Commerce pays loose coin first, then
  purses. A successful merchant purchase delivers the Item before it records
  merchant spending.
- **Receive:** Commerce fills purse room first, then puts the remainder into
  loose coin. A carried Crow must have room for the computed loose-coin block;
  a Party's default stash is uncapped for money.
- **Sell:** `sellItem` pays the current merchant percentage, then removes the
  source Item. If removing the Item fails, the operation enters recovery rather
  than pretending the sale finished.
- **Auction:** `auctionSell` records a durable lot and immutable Item snapshot,
  pays the sale proceeds, then removes the source Item. `auctionBuyback` pays
  the buyback price, restores the stored snapshot, and marks the lot returned.
- **Refusal:** a preflight refusal does not partially debit or credit money.
  Use the existing operation/transaction token when retrying; never repeat a
  payment by hand. A writer timeout is the important exception: it is an
  unknown acknowledgement, not proof that no write happened.

## How a Crow carries money

### Loose coin

`system.currency` is loose coin only. It is not the balance of every purse
combined. For a carried Crow, loose coin reserves a computed block of inventory
capacity:

```text
loose-coin slots = ceil(loose coin / 250)
```

For example, 501 loose gc reserves 3 slots. A wound-only backpack slot is
still eligible for this reservation; an Item occupying the slot is not.
Reserved coin is not a visible positional Item and is never silently placed by
repacking your inventory.

### Coin Purse Items

A Coin Purse is an ordinary embedded Gear Item with its own `held` balance and
capacity. A base purse holds up to 500 gc and occupies one Item slot. Its held
coin does not also reserve loose-coin slots.

The Bursting Purse trait increases exactly one purse's effective capacity. When
there is more than one purse, the system chooses the purse with the greatest
base capacity, breaking a tie by the lowest Item id. The bonus is not split
between purses.

### Receiving an amount

Receiving is purse-first. Suppose a Crow has an empty 500-gc purse and 0 loose
gc:

1. Receive 600 gc.
2. The purse becomes 500 gc.
3. The remaining 100 gc becomes loose coin.
4. The loose remainder is checked as one computed reservation.

This is why watching only the Actor's loose-currency field can make money look
like it disappeared: it may have moved into a purse.

### Paying an amount

Paying is loose-first. Suppose a Crow has 114 loose gc and 500 gc in a purse:

1. Pay 250 gc.
2. Commerce takes 114 loose gc.
3. It takes the remaining 136 gc from the purse.
4. The resulting state is 0 loose gc and 364 gc in the purse.

If more than one purse is needed, the remaining debit follows stable Item-id
order. If all sources together are short, the whole payment is refused; an
available partial amount is never taken.

## Choose a payer before shopping

Every paid action has one payer Actor. It may be:

- the Crow who is shopping or using the service; or
- the native Party Actor for shared funds.

The Village sheet currently has no payer selector. A caller, macro, or
integration must nominate the payer programmatically (for example, by setting
the proposal's `payerActorUuid` or supplying the Actor to a direct Village
command). The Ref sees and revalidates that payer before committing the action.

Players can browse and submit a proposal, but the Ref/GM authorizes and commits
the shared-state action. A proposal is not a payment and does not reserve a
price.

## Buy an item or service

### Player steps

1. Open the Village application and inspect the current institution status,
   effective level, stock/availability, price, and any credit shown for the
   nominated payer.
2. Choose the exact item or service and one payer Actor. Include the item
   criteria and price from the current view; do not rely on an old chat card.
3. Submit the proposal. The proposal should be described as submitted or
   awaiting the Ref, not as paid.
4. Wait for the Ref to approve and commit it. The commit rechecks the Village
   policy, quote, availability, payer, and destination against live state.
5. When the result is `committed`, verify that the Item or service result is
   present and that the payer's physical money changed as planned.

### What happens during a merchant purchase

The committed merchant sequence is:

1. The current item price is read from the institution policy. A stock chance,
   when the institution uses one, is resolved once from the purchase id.
2. Any matching Village credit is reserved. The physical amount is
   `netPrice = grossPrice − creditApplied`.
3. Commerce pays `netPrice` from the payer's loose coin and purses.
4. Commerce grants the Item to the payer using the shared Item-grant path.
5. The credit is finalized, if present.
6. Village records only the `netPrice` actually paid toward the 10,000-gc
   merchant-spend threshold for the cycle.

Credit-covered value does not count as gc spent. If the grant fails after
payment, the system compensates the payment and does not record merchant spend.
If the Item was delivered but a later Village accounting step is uncertain, the
Item stays delivered and the Ref repairs the accounting forward; do not buy it
again or remove it manually.

The same boundary is used for paid founding/reopening, upgrades, artisan
commissions, workshop rental, inn bets, and beacon fares. Those actions are
confirmed only after their Commerce child and owning Village/service result are
confirmed.

## Sell an Item

Use the public Village command **`sellItem`** (the Village UI may expose it as
an action rather than showing the function name).

1. Choose a live Item owned by the seller Actor and the merchant institution.
2. The Ref rechecks the Item's current value, ownership, institution policy,
   and the recipient's capacity.
3. The sale proceeds are credited with Commerce.
4. Only after proceeds are confirmed does the operation delete the source Item.
5. The result is a sale only when both the receive and delete children are
   committed.

The ordinary merchant sale percentage depends on Village Prosperity:

| Prosperity | Seller receives |
| ---: | ---: |
| −10 | 30% of Item value |
| −9 to −6 | 40% |
| −5 to −2 | 45% |
| −1 to 1 | 50% |
| 2 to 5 | 55% |
| 6 to 9 | 60% |
| 10 | 70% |

If the recipient cannot hold the proceeds, the sale is refused before the
receive or delete write. If the receive succeeds but Item deletion fails, the
system uses a distinct compensation payment and leaves a visible recovery
operation. Do not delete the Item or pay yourself to "fix" the card.

## Auction sale and buyback

### `auctionSell`

1. Choose an owned live Item and the Auction House.
2. Supply the committed auction roll (1–10). The auction sale percentage is
   `d10 × (10 + Prosperity)%`.
3. The system captures an immutable snapshot of the Item and creates a durable
   auction lot.
4. Commerce receives the calculated proceeds.
5. The source Item is deleted only after the receive is confirmed.
6. The lot becomes **sold** only when the receive, deletion, and lot update are
   all confirmed.

The snapshot is what makes a later buyback possible after the original embedded
Item has been deleted. A failed deletion or compensation leaves the lot and its
operation visible for Ref repair.

### `auctionBuyback`

1. Choose the sold auction lot and the buyer Actor.
2. The buyback price is the recorded sale price plus 10% of the original Item
   value (rounded by the system).
3. Commerce pays that price from the buyer's money.
4. The shared grant path restores the stored Item snapshot to the buyer.
5. The lot becomes **returned** only after payment, grant, and lot update are
   confirmed.

If the lot is not sold, the buyer or price is stale, or the destination cannot
hold the restored Item, the operation refuses before claiming a buyback. A
failed grant is compensated with a distinct child transaction; do not create a
replacement Item by hand.

## Refusals and safe next steps

The following are normal, safe refusal results. A refusal is not a partial
payment: for preflight failures, no money is moved and no source Item is
deleted. Keep the operation/transaction token and use it for a retry; the
receipt makes a committed retry idempotent and prevents a second debit.

| Result | What it means | What the player or Ref should do |
| --- | --- | --- |
| `insufficient-funds` | The nominated payer's loose coin plus all purse balances are below the required amount. | Check the quoted price and payer. Deposit or receive more funds, then retry the same recorded operation rather than paying a second time. |
| `no-capacity` | A receive or Item grant cannot fit. For a Crow, purse room was used first and the loose remainder would exceed the computed carry capacity; for a Party, this means an explicit configured restriction or Item policy refused it. | Read the reported excess, free or reorganize legal Crow capacity, empty a purse, or choose a valid destination. Do not accept a silent spill. Retry the same operation after the destination is legal. |
| `authority-unavailable` | There is no active GM, the request is on the wrong designated writer, or a writer-route acknowledgement timed out. | If there is no writer, wait for the GM. If a route timed out, do **not** assume the payment failed: retry the same token and let the receipt replay or reconcile it. Never redo the purchase manually. |
| `conflict` | The expected Village/Commerce revision, quote, or input fingerprint no longer matches live state. | Stop and refresh the Village view. The Ref must revalidate the current terms; an in-flight operation is retried with its original token, never a second payment token. |
| `unauthorized` | The requester does not own the nominated Actor, the context is not allowed, or a treasury action needs GM/Ref authority. | Choose an Actor you are allowed to use or ask the Ref to commit the action. Changing a chat message does not grant permission. |
| `duplicate-detected` | The same operation identity was used with different input, or an existing operation already owns the token. | Do not create another payment. Give the Ref the recorded operation id so it can be inspected or replayed. |
| `overflow` | The target already contains a purse over its effective capacity. | Stop receiving into it and ask the Ref to inspect the existing inventory. The system reports the excess; it does not silently spill or repair it during a capacity check. |
| `write-failed` / `uncertain` | A document write or acknowledgement could not be confirmed. The physical result may or may not have landed. | Treat it as unknown. Do not retry with a new id, remove a delivered Item, or manually refund. The Ref reconciles the durable receipt and uses the same token. |

The Village cycle is blocked while a paid operation is in a nonterminal phase
such as `prepared`, `commerce-pending`, `commerce-committed`, `credit-pending`,
`spend-pending`, `partial`, or `uncertain`. That block is intentional: repair
or explicitly adjudicate the operation before advancing the cycle.

## Party funds

A Party is a shared stash, not a creature carried by someone:

- Its default money capacity is an uncapped strongbox. It does not borrow a
  Crow's backpack slots, speed penalty, or wound model.
- Its loose coin still lives on the Party Actor, and Coin Purses are still
  ordinary Items with their own balances.
- A GM may deposit or withdraw. Players may do so when they own the Party
  Actor.
- Village shared investment passes this one Party Actor to Commerce; it does
  not combine several Crows into one payment.
- The current Village sheet has no payer picker, so the Party must be selected
  by the caller/integration before the proposal or paid command is committed.

If a Party transfer has no Commerce port available, it returns
`commerce-unavailable` and makes no local writes. That is a missing transaction
boundary, not permission to edit the Party's currency directly.

## Prosperity and receipts

Merchant spending accumulates per Village cycle. Once confirmed merchant goods
payments reach 10,000 gc of **actual net payment**, Prosperity rises by 1 once
for that cycle. A credit-covered purchase can still deliver an Item, but its
credit-covered amount contributes no gc to that threshold.

Every paid action has a durable operation identity and child transaction ids.
The exact trade commands use these identities:

- `sellItem`: `saleId`, `receiveTxId`, `deleteId`, and
  `compensationPayTxId`.
- `auctionSell`: `auctionId` plus the same receive/delete/compensation children.
- `auctionBuyback`: `auctionId`, `payTxId`, and `grantTxId`.

Keep those ids when reporting a problem. The system can replay a confirmed
receipt, distinguish a stale request from a new one, and tell the Ref whether a
physical write is confirmed or still needs reconciliation.

## What not to do

- Do not edit `system.currency` directly to pay for a Village action.
- Do not edit `system.purse.held` directly to move money between Actors.
- Do not treat a proposal, chat card, or timeout as proof that payment happened.
- Do not create a replacement Item after a grant or buyback timeout.
- Do not consume crafting materials as part of a purchase. Equipment owns
  recipe matching and material consumption when a project completes.

For the wider installation and table setup, see the [project README](../../README.md).
