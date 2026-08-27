const { TypeDataModel } = foundry.abstract;
const fields = foundry.data.fields;

import { PARTY_CAPACITY_MODES } from "../../helpers/slots.mjs";

// COMMERCE SEAM: build-money-service is extracting the durable
// `system.commerce.{revision,receipts}` fields into `commerceFields()` in
// helpers/schema.mjs. This branch predates that shared fragment, so PartyData
// intentionally does not hand-copy it; compose `...commerceFields()` when that
// sibling change lands rather than creating a second receipt shape.

/**
 * Native Party stash data model.
 *
 * A Party is deliberately not a creature model and does not inherit
 * CrowData.  It has only the shared loose-coin field plus the durable policy
 * placeholder needed while the generous strongbox's numeric bound remains an
 * open decision.  Coin Purses stay ordinary embedded Gear Items; slots.mjs
 * reads them into Layout.coin for all Actor types.
 *
 * Do not copy shadowdark-extras' party-creation registration workaround here.
 * That module has to patch Actor creation because it is not the owning system;
 * Crows owns system.json and can register this type natively.
 */
export class PartyData extends TypeDataModel {
  static defineSchema() {
    return {
      // Shared money contract: loose gc only.  Purse balances are embedded
      // Item state and must not be duplicated in this model.
      currency: new fields.NumberField({ initial: 0, min: 0, integer: true }),

      // `limit: 0` is a sentinel for the unresolved/default mode.  It is not a
      // chosen capacity of zero; partyCapacityPolicy() ignores it until a
      // fixed or per-Party configured mode supplies a positive bound.
      capacity: new fields.SchemaField({
        mode: new fields.StringField({ initial: "unresolved", choices: PARTY_CAPACITY_MODES }),
        limit: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        note: new fields.StringField({ initial: "", blank: true })
      })
    };
  }
}
