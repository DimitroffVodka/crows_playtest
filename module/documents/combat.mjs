import {
  canRollForCombat,
  compareSideCombatants,
  firstSideFromRoll,
  firstSideForRound,
  nextPlayableTurnIndex,
  readCrowsFlag,
  shouldSkipSurprised
} from "../helpers/initiative.mjs";

// The fallback keeps module/crows.mjs importable by the node boot test. In a
// live world Foundry has already exposed its client document class here.
const CombatBase = globalThis.foundry?.documents?.Combat
  ?? globalThis.Combat
  ?? class {
    async startCombat() { return this; }
    async nextRound() { return this; }
    async nextTurn() { return this; }
    setupTurns() { return this.turns ?? []; }
  };
const baseCombatUpdate = CombatBase.metadata?.permissions?.update;

const sideLabel = (side) => ({ crows: "Crows", enemies: "Enemies" }[side] ?? side);

const localize = (key, fallback, data) => {
  const i18n = globalThis.game?.i18n;
  if (typeof i18n?.format === "function") return i18n.format(key, data ?? {});
  if (typeof i18n?.localize === "function") {
    const value = i18n.localize(key);
    return value === key ? fallback : value;
  }
  return fallback;
};

const escapeHTML = (value) => {
  if (typeof globalThis.foundry?.utils?.escapeHTML === "function") {
    return globalThis.foundry.utils.escapeHTML(String(value));
  }
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
};

/** Combat document implementing the Crows side-based initiative rule. */
export class CrowsCombat extends CombatBase {
  /**
   * Base Combat permits non-GMs to update only round/turn/combatants. Crows
   * side rolls are explicitly player-rollable, so permit only the three Crows
   * round flags for a player who owns a combatant; all other player writes
   * retain the narrow base shape.
   */
  static metadata = Object.freeze({
    ...(CombatBase.metadata ?? {}),
    permissions: {
      ...(CombatBase.metadata?.permissions ?? {}),
      update: (user, document, data = {}) => {
        if (user?.isGM) return true;
        const keys = Object.keys(data);
        const allowedTurnKeys = new Set(["_id", "round", "turn", "combatants"]);
        if (keys.every((key) => allowedTurnKeys.has(key))) {
          return typeof baseCombatUpdate === "function"
            ? baseCombatUpdate(user, document, data)
            : true;
        }

        const allowedFlags = new Set([
          "flags.crows.firstSide",
          "flags.crows.sideRoll",
          "flags.crows.rolledForRound"
        ]);
        const flagKeys = keys.filter((key) => key !== "_id");
        return keys.length > 0
          && flagKeys.length > 0
          && flagKeys.every((key) => allowedFlags.has(key))
          && canRollForCombat(document, user);
      }
    }
  });

  /** Who acts first in the current round, if a current side roll exists. */
  get firstSide() {
    return firstSideForRound(this);
  }

  /** The stored 1d10 face, retained for tracker display. */
  get sideRoll() {
    return readCrowsFlag(this, "sideRoll", null);
  }

  /** The round to which the stored side roll belongs. */
  get rolledForRound() {
    return readCrowsFlag(this, "rolledForRound", null);
  }

  /** GM or a player who owns at least one combatant may roll the side. */
  canRollSide(user = globalThis.game?.user) {
    return canRollForCombat(this, user);
  }

  /**
   * Roll the one side die for the active round.
   *
   * @param {object} [options]
   * @param {Roll|number} [options.roll] injected roll/face for probes and tests
   */
  async rollSide({ roll = null } = {}) {
    if (!this.canRollSide()) {
      globalThis.ui?.notifications?.warn?.(
        localize("CROWS.Combat.rollPermission", "Only the Ref or a player who owns a combatant can roll side initiative.")
      );
      return this;
    }

    const round = Number(this.round);
    if (!Number.isInteger(round) || round < 1) return this;

    let result = roll;
    if (typeof result === "number") result = { total: result };
    if (!result) {
      const Roll = globalThis.Roll ?? globalThis.foundry?.dice?.Roll;
      if (typeof Roll !== "function") {
        globalThis.ui?.notifications?.error?.("Crows could not create the 1d10 side roll.");
        return this;
      }
      result = new Roll("1d10");
    }
    if (typeof result.evaluate === "function") await result.evaluate();

    const face = Number(result.total);
    const firstSide = firstSideFromRoll(face);
    if (!Number.isFinite(face) || !firstSide) return this;

    // The flags are the authoritative round snapshot. Do this update before
    // setupTurns so the unbound comparator sees the new first side.
    await this.update?.({
      "flags.crows.firstSide": firstSide,
      "flags.crows.sideRoll": face,
      "flags.crows.rolledForRound": round
    }, { turnEvents: false });

    this.setupTurns?.();
    // Keep the first side at the head of the tracker after every round roll.
    await this.update?.({ turn: 0 }, { turnEvents: false });
    // A surprised combatant cannot be the first active turn of round 1. The
    // reset above is still deliberate (and is the documented rollSide state);
    // choose the first playable entry without recursively opening another
    // round roll when every entry happens to be surprised.
    if (round === 1 && shouldSkipSurprised(this.combatant, round)) {
      const firstPlayable = nextPlayableTurnIndex(this.turns ?? [], -1, {
        round,
        skipDefeated: !!this.settings?.skipDefeated
      });
      if (firstPlayable !== null) await this.update?.({ turn: firstPlayable }, { turnEvents: false });
    }

    const roller = globalThis.game?.user?.name ?? "Ref";
    const side = firstSide === "crows"
      ? localize("CROWS.Combat.side.crows", sideLabel(firstSide))
      : localize("CROWS.Combat.side.enemies", sideLabel(firstSide));
    const text = localize(
      "CROWS.Combat.chatSideRoll",
      `${roller} rolled 1d10 (${face}): ${side} act first.`,
      { roller, roll: face, side }
    );
    const ChatMessage = globalThis.ChatMessage;
    if (typeof ChatMessage?.create === "function") {
      const speaker = typeof ChatMessage.getSpeaker === "function"
        ? ChatMessage.getSpeaker({ alias: roller })
        : { alias: roller };
      await ChatMessage.create({
        content: `<p>${escapeHTML(text)}</p>`,
        speaker,
        flags: { crows: { sideRoll: { round, face, firstSide } } }
      });
    }
    return this;
  }

  /** Start round 1, then roll its side order. */
  async startCombat(...args) {
    const result = await super.startCombat(...args);
    await this.rollSide();
    return result;
  }

  /** Advance a round, then roll the new round's side order. */
  async nextRound(...args) {
    const result = await super.nextRound(...args);
    await this.rollSide();
    return result;
  }

  /**
   * Skip surprised combatants in round 1. Base Combat still owns defeated
   * skipping, time deltas, hooks, and the round transition; repeatedly asking
   * it for the next turn keeps all of those v14 behaviors intact.
   */
  async nextTurn(...args) {
    let result = await super.nextTurn(...args);
    const maxSkips = Math.max(1, (this.turns?.length ?? this.combatants?.size ?? 0) + 1);
    let skips = 0;
    while (this.round === 1 && shouldSkipSurprised(this.combatant, this.round) && skips < maxSkips) {
      skips += 1;
      result = await super.nextTurn(...args);
    }
    return result;
  }

  /** Initiative is not a Crows mechanic; leave every combatant at null. */
  async rollInitiative() {
    globalThis.ui?.notifications?.warn?.(
      localize("CROWS.Combat.noCreatureInitiative", "Crows uses one side roll per round; creatures do not roll initiative.")
    );
    return this;
  }

  /**
   * Re-sort when the side roll changes, on EVERY client.
   *
   * Foundry re-runs setupTurns() when combatants change; it has no idea that in
   * this system a Combat FLAG decides the order. `rollSide` calls setupTurns
   * itself, but only on the machine that rolled — every other client received
   * the flags over the socket and kept its old `turns` array. The roller and
   * the rest of the table would then be looking at different turn orders, and
   * the tracker would still show the losing side at the top.
   *
   * Verified before this existed: forcing firstSide to "enemies" left
   * `combat.turns` unchanged while the comparator, called directly, sorted the
   * enemy to the front.
   */
  _onUpdate(changed, options, userId) {
    super._onUpdate?.(changed, options, userId);
    const paths = ["flags.crows.firstSide", "flags.crows.rolledForRound", "flags.crows.order"];
    const has = (path) =>
      foundry.utils.hasProperty(changed ?? {}, path) || (path in (changed ?? {}));
    if (!paths.some(has)) return;
    this.setupTurns?.();
    if (this.isView) globalThis.ui?.combat?.render?.();
  }

  /** Seed legacy/no-flag combatants before the base class mutates its array in sort(). */
  setupTurns(...args) {
    const contents = this.combatants?.contents ?? this.combatants ?? [];
    for (const [index, combatant] of [...contents].entries()) {
      const raw = readCrowsFlag(combatant, "order");
      if ((raw === undefined || raw === null || raw === "") && typeof combatant?.updateSource === "function") {
        combatant.updateSource({ "flags.crows.order": index });
      }
    }
    return super.setupTurns(...args);
  }

  /**
   * Foundry invokes this comparator unbound from setupTurns(). Do not use
   * `this` here: compareSideCombatants reaches the Combat through a.parent.
   */
  _sortCombatants(a, b) {
    return compareSideCombatants(a, b);
  }
}

export default CrowsCombat;
