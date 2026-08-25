import {
  firstSideForRound,
  readCrowsFlag
} from "../helpers/initiative.mjs";

// Foundry exposes applications through this namespace. The fallback exists
// only so the system entry point can be parsed by the node boot test.
const CombatTrackerBase = globalThis.foundry?.applications?.sidebar?.tabs?.CombatTracker
  ?? globalThis.CombatTracker
  ?? class {
    static DEFAULT_OPTIONS = { actions: {} };
    static PARTS = {};
  };

const localize = (key, fallback) => {
  const value = globalThis.game?.i18n?.localize?.(key);
  return value && value !== key ? value : fallback;
};

const sideName = (side) => side === "crows"
  ? localize("CROWS.Combat.side.crows", "Crows")
  : localize("CROWS.Combat.side.enemies", "Enemies");

const combatantsOf = (combat) => combat?.turns ?? [
  ...(combat?.combatants?.contents ?? combat?.combatants ?? [])
];

const finiteOrder = (combatant) => {
  const value = Number(combatant?.order);
  return Number.isFinite(value) ? value : 0;
};

/** Select an order between the adjacent entries without updating another player's combatant. */
function orderForMove(members, index, direction) {
  if (direction === "up") {
    const neighbor = members[index - 1];
    const lower = members[index - 2];
    if (!neighbor) return null;
    const upperValue = finiteOrder(neighbor);
    const lowerValue = lower ? finiteOrder(lower) : null;
    if (lowerValue !== null && upperValue > lowerValue) return (lowerValue + upperValue) / 2;
    return upperValue - 1;
  }

  if (direction === "down") {
    const neighbor = members[index + 1];
    const upper = members[index + 2];
    if (!neighbor) return null;
    const lowerValue = finiteOrder(neighbor);
    const upperValue = upper ? finiteOrder(upper) : null;
    if (upperValue !== null && upperValue > lowerValue) return (lowerValue + upperValue) / 2;
    return lowerValue + 1;
  }
  return null;
}

const canEdit = (combatant) => !!globalThis.game?.user?.isGM || !!combatant?.isOwner;

const getCombatant = (tracker, target) => {
  const id = target?.closest("[data-combatant-id]")?.dataset?.combatantId;
  return tracker.viewed?.combatants?.get?.(id) ?? null;
};

/** Crows tracker: side groups, round roll, surprise, and manual order controls. */
export class CrowsCombatTracker extends CombatTrackerBase {
  static DEFAULT_OPTIONS = {
    ...(CombatTrackerBase.DEFAULT_OPTIONS ?? {}),
    actions: {
      ...(CombatTrackerBase.DEFAULT_OPTIONS?.actions ?? {}),
      toggleSurprised: CrowsCombatTracker.#onToggleSurprised,
      moveCombatant: CrowsCombatTracker.#onMoveCombatant
    }
  };

  static PARTS = {
    ...(CombatTrackerBase.PARTS ?? {}),
    tracker: {
      ...(CombatTrackerBase.PARTS?.tracker ?? {}),
      template: "systems/crows/templates/sidebar/combat-tracker.hbs",
      scrollable: ["ol.combat-tracker"]
    }
  };

  static #onToggleSurprised(...args) {
    return this._onToggleSurprised(...args);
  }

  static #onMoveCombatant(...args) {
    return this._onMoveCombatant(...args);
  }

  /** Add side-group and Crows-specific turn fields to the inherited context. */
  async _prepareTrackerContext(context, options) {
    await super._prepareTrackerContext(context, options);
    const combat = this.viewed;
    if (!combat) {
      context.groups = [];
      context.needsSideRoll = false;
      return;
    }

    const allCombatants = combatantsOf(combat);
    const byId = new Map(allCombatants.map((combatant) => [combatant.id, combatant]));
    const visibleTurns = context.turns ?? [];
    for (const turn of visibleTurns) {
      const combatant = byId.get(turn.id);
      if (!combatant) continue;
      const side = combatant.side;
      const members = allCombatants.filter((candidate) => candidate.side === side);
      const index = members.indexOf(combatant);
      turn.side = side;
      turn.surprised = !!combatant.surprised;
      turn.canReorder = canEdit(combatant);
      turn.canToggleSurprised = canEdit(combatant);
      turn.canMoveUp = turn.canReorder && index > 0;
      turn.canMoveDown = turn.canReorder && index >= 0 && index < members.length - 1;
    }

    const firstSide = firstSideForRound(combat);
    const order = firstSide
      ? [firstSide, firstSide === "crows" ? "enemies" : "crows"]
      : ["crows", "enemies"];
    context.groups = order.map((side) => ({
      side,
      label: sideName(side),
      turns: visibleTurns.filter((turn) => turn.side === side)
    }));

    const round = Number(combat.round);
    const rolledForRound = readCrowsFlag(combat, "rolledForRound");
    context.firstSide = firstSide;
    context.firstSideLabel = firstSide ? sideName(firstSide) : "";
    context.sideRoll = readCrowsFlag(combat, "sideRoll", null);
    context.rolledForRound = rolledForRound;
    context.rolledThisRound = !!firstSide && Number(rolledForRound) === round;
    context.needsSideRoll = round > 0 && Number(rolledForRound) !== round;
    context.canRollSide = combat.canRollSide?.() ?? false;
  }

  /** Toggle the combatant's round-1 surprise flag. */
  async _onToggleSurprised(event, target) {
    const combatant = getCombatant(this, target);
    if (!combatant || !canEdit(combatant)) return;
    const surprised = !combatant.surprised;
    if (typeof combatant.setFlag === "function") {
      await combatant.setFlag("crows", "surprised", surprised);
    } else {
      await combatant.update?.({ "flags.crows.surprised": surprised });
    }
  }

  /**
   * Strip Foundry's bulk initiative controls.
   *
   * "Roll All" and "Roll NPCs" live in the stock `header` part, gated only on
   * isGM, and both call rollInitiative — which in Crows is a no-op that warns.
   * Offering a Ref two buttons whose entire behaviour is to explain themselves
   * is worse than not offering them: there is no per-creature initiative here,
   * so the side roll is the only control that should exist.
   *
   * Removed from the DOM rather than by overriding header.hbs, so a Foundry
   * update to that template cannot silently revert this or fork it stale.
   */
  _onRender(context, options) {
    super._onRender?.(context, options);
    for (const action of ["rollAll", "rollNPC"]) {
      this.element?.querySelector?.(`[data-action="${action}"]`)?.remove();
    }
  }

  /** Move one owned combatant within its side without requiring ownership of its neighbor. */
  async _onMoveCombatant(event, target) {
    const combatant = getCombatant(this, target);
    if (!combatant || !canEdit(combatant)) return;
    const direction = target?.dataset?.direction;
    const members = combatantsOf(this.viewed).filter((candidate) => candidate.side === combatant.side);
    const index = members.indexOf(combatant);
    const order = orderForMove(members, index, direction);
    if (order === null) return;

    if (typeof combatant.setFlag === "function") await combatant.setFlag("crows", "order", order);
    else await combatant.update?.({ "flags.crows.order": order });
    this.viewed?.setupTurns?.();
  }
}

export default CrowsCombatTracker;

