import {
  readCrowsFlag,
  sideFromCombatant
} from "../helpers/initiative.mjs";

// The fallback keeps the system entry point importable by the node boot tests.
// Foundry supplies the real client document class before the init hook runs.
const CombatantBase = globalThis.foundry?.documents?.Combatant
  ?? globalThis.Combatant
  ?? class {};

/** Crows combatant state: side assignment, manual order, and surprise. */
export class CrowsCombatant extends CombatantBase {
  /** Persist insertion order once for each batch of newly-created combatants. */
  static async _preCreateOperation(documents, operation, user) {
    const existing = operation.parent?.combatants?.contents
      ?? operation.parent?.combatants
      ?? [];
    const existingOrders = [...existing]
      .map((combatant) => Number(readCrowsFlag(combatant, "order")))
      .filter(Number.isFinite);
    const offset = Math.max([...existing].length, ...existingOrders.map((order) => order + 1), 0);
    for (const [index, document] of documents.entries()) {
      const raw = readCrowsFlag(document, "order");
      if (raw === undefined || raw === null || raw === "") {
        document.updateSource?.({ "flags.crows.order": offset + index });
      }
    }
    return super._preCreateOperation?.(documents, operation, user);
  }

  /**
   * Which side this combatant belongs to.
   *
   * `crows.side` is an explicit Ref override. Otherwise the pure rule seam
   * handles player ownership and the token's Friendly disposition.
   */
  get side() {
    const friendlyDisposition = globalThis.CONST?.TOKEN_DISPOSITIONS?.FRIENDLY ?? 1;
    return sideFromCombatant(this, { friendlyDisposition });
  }

  /** A round-1-only flag; the value is intentionally not cleared in round 2. */
  get surprised() {
    return !!readCrowsFlag(this, "surprised", false);
  }

  /**
   * Manual within-side ordering. Unassigned combatants use their embedded
   * collection index, which preserves insertion order until an arrow writes a
   * persistent `crows.order` flag.
   */
  get order() {
    const raw = readCrowsFlag(this, "order");
    if (raw !== undefined && raw !== null && raw !== "") {
      const value = Number(raw);
      if (Number.isFinite(value)) return value;
    }

    const contents = this.parent?.combatants?.contents;
    const index = Array.isArray(contents) ? contents.indexOf(this) : -1;
    return index >= 0 ? index : 0;
  }
}

export default CrowsCombatant;
