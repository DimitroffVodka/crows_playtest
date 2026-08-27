const { TypeDataModel } = foundry.abstract;
const fields = foundry.data.fields;

import { PARTY_CAPACITY_MODES } from "../../helpers/slots.mjs";
import { commerceFields } from "../../helpers/schema.mjs";

/**
 * Native Party stash data model.
 *
 * A Party is deliberately not a creature model and does not inherit
 * CrowData. It uses the shared money fields and keeps an optional configured
 * cap for future Ref policy; the settled default is a generous uncapped
 * strongbox. Coin Purses stay ordinary embedded Gear Items; slots.mjs reads
 * them into Layout.coin for all Actor types.
 *
 * Do not copy shadowdark-extras' party-creation registration workaround here.
 * That module has to patch Actor creation because it is not the owning system;
 * Crows owns system.json and can register this type natively.
 */
export class PartyData extends TypeDataModel {
  static defineSchema() {
    return {
      ...commerceFields(),

      // `limit: 0` is a sentinel for the uncapped/default mode. It is not a
      // chosen capacity of zero; a positive fixed/configured limit is an
      // explicit Ref-facing restriction.
      capacity: new fields.SchemaField({
        mode: new fields.StringField({ initial: "uncapped", choices: PARTY_CAPACITY_MODES }),
        limit: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        note: new fields.StringField({ initial: "", blank: true })
      })
    };
  }
}
