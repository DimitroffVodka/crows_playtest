/**
 * Pure pet-sheet view transforms.
 *
 * The sheet supplies the owner, the visible Actor documents, the current
 * world-time snapshot, and localization.  Keeping the collection and action
 * decisions here makes the pet UI testable without booting Foundry and keeps
 * the sheet class at the document boundary.
 */

import {
  canAttemptTaming,
  isAnimal,
  isHumanOwner,
  isOwnedPet,
  petSlotBudget
} from "./pets.mjs";

export const PET_VIEW_REASON_KEYS = Object.freeze({
  "animal-missing-uuid": "CROWS.Sheet.Crow.pets.reason.animalMissingUuid",
  "animal-not-friendly": "CROWS.Sheet.Crow.pets.reason.animalNotFriendly",
  "already-owned": "CROWS.Sheet.Crow.pets.reason.alreadyOwned",
  "bonding-pending": "CROWS.Sheet.Crow.pets.reason.bondingPending",
  "commander-missing-uuid": "CROWS.Sheet.Crow.pets.reason.commanderMissingUuid",
  "commander-not-human": "CROWS.Sheet.Crow.pets.reason.commanderNotHuman",
  "commander-not-owner": "CROWS.Sheet.Crow.pets.reason.commanderNotOwner",
  "following-other": "CROWS.Sheet.Crow.pets.reason.followingOther",
  "invalid-animal-uuid": "CROWS.Sheet.Crow.pets.reason.invalidAnimalUuid",
  "invalid-human-uuid": "CROWS.Sheet.Crow.pets.reason.invalidHumanUuid",
  "not-an-animal": "CROWS.Sheet.Crow.pets.reason.notAnAnimal",
  "not-owned-pet": "CROWS.Sheet.Crow.pets.reason.notOwnedPet",
  "owner-missing-uuid": "CROWS.Sheet.Crow.pets.reason.ownerMissingUuid",
  "owner-not-human": "CROWS.Sheet.Crow.pets.reason.ownerNotHuman",
  "pet-update-failed": "CROWS.Sheet.Crow.pets.reason.petUpdateFailed",
  "world-time-unavailable": "CROWS.Sheet.Crow.pets.reason.worldTimeUnavailable",
  unavailable: "CROWS.Sheet.Crow.pets.reason.unavailable"
});

const asUuid = (actor) => String(actor?.uuid ?? "").trim();

const asNonNegativeNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

const localizeOrKey = (localize, key, data = null) => {
  if (typeof localize !== "function") return key;
  return data === null ? localize(key) : localize(key, data);
};

/** Return the localization key for an engine/view reason without inventing text. */
export function petViewReasonKey(reason) {
  return PET_VIEW_REASON_KEYS[reason] ?? PET_VIEW_REASON_KEYS.unavailable;
}

function reasonView(reason, localize) {
  if (!reason) return { reason: null, reasonKey: "", reasonLabel: "" };
  const reasonKey = petViewReasonKey(reason);
  return {
    reason,
    reasonKey,
    reasonLabel: localizeOrKey(localize, reasonKey)
  };
}

function actionView({ visible, enabled, reason, localize }) {
  const reasonData = reasonView(reason, localize);
  return {
    visible: !!visible,
    enabled: !!visible && !!enabled,
    ...reasonData
  };
}

function actorArray(actors) {
  if (Array.isArray(actors)) return actors;
  if (Array.isArray(actors?.contents)) return actors.contents;
  if (actors && typeof actors[Symbol.iterator] === "function") return [...actors];
  return [];
}

function uniqueAnimals(actors) {
  const seen = new Set();
  return actorArray(actors).filter(actor => {
    if (!isAnimal(actor)) return false;
    const key = asUuid(actor) || String(actor?.id ?? "").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function actorNameByUuid(actors, uuid) {
  if (!uuid) return "";
  return actorArray(actors).find(actor => asUuid(actor) === uuid)?.name ?? "";
}

function activeFollow(animal, now) {
  const pet = animal?.system?.pet ?? {};
  const prospectiveOwnerUuid = String(pet.prospectiveOwnerUuid ?? "").trim();
  const followsUntil = asNonNegativeNumber(pet.followsUntil);
  return prospectiveOwnerUuid && followsUntil > now
    ? { prospectiveOwnerUuid, followsUntil }
    : null;
}

function sizeLabel(size, localize) {
  if (!size) return "";
  return localizeOrKey(localize, `CROWS.Sheet.Crow.value.size.${size}`);
}

function actionReasons(animal, owner, {
  isOwner,
  localize,
  owned,
  ownedByCurrent,
  follow
}) {
  if (!isOwner) {
    return {
      visible: false,
      tame: actionView({ visible: false, enabled: false, reason: null, localize }),
      command: actionView({ visible: false, enabled: false, reason: null, localize }),
      commandTest: actionView({ visible: false, enabled: false, reason: null, localize })
    };
  }

  const human = isHumanOwner(owner);
  const animalUuid = asUuid(animal);
  let tameReason = null;
  let tameEnabled = false;
  if (!human) tameReason = "owner-not-human";
  else if (!animalUuid) tameReason = "animal-missing-uuid";
  else if (owned) tameReason = "already-owned";
  else if (follow?.prospectiveOwnerUuid === asUuid(owner)) tameReason = "bonding-pending";
  else if (follow) tameReason = "following-other";
  else {
    const gate = canAttemptTaming(animal, owner, { friendly: true });
    tameReason = gate.ok ? null : gate.reason;
    tameEnabled = gate.ok;
  }

  let commandReason = null;
  let commandEnabled = false;
  if (!human) commandReason = "commander-not-human";
  else if (!owned) commandReason = "not-owned-pet";
  else if (!ownedByCurrent) commandReason = "commander-not-owner";
  else if (!animalUuid) commandReason = "animal-missing-uuid";
  else if (!asUuid(owner)) commandReason = "commander-missing-uuid";
  else commandEnabled = true;

  return {
    visible: true,
    tame: actionView({ visible: true, enabled: tameEnabled, reason: tameReason, localize }),
    command: actionView({ visible: true, enabled: commandEnabled, reason: commandReason, localize }),
    commandTest: actionView({ visible: true, enabled: commandEnabled, reason: commandReason, localize })
  };
}

/**
 * Build the state and affordances for one animal on a crow's sheet.
 *
 * Taming is preflighted as friendly because the sheet's DialogV2 assertion is
 * the Ref's adjudication. The value is persisted by rollTamingTest; this view
 * model never writes a second friendliness marker or infers a test outcome.
 */
export function petActionState(animal, owner, {
  actors = [],
  now = 0,
  isOwner = owner?.isOwner === true,
  localize = (key) => key
} = {}) {
  const currentUuid = asUuid(owner);
  const animalUuid = asUuid(animal);
  const pet = animal?.system?.pet ?? {};
  const ownerUuid = String(pet.ownerUuid ?? "").trim();
  const owned = isOwnedPet(animal);
  const ownedByCurrent = owned && ownerUuid === currentUuid;
  const currentTime = asNonNegativeNumber(now);
  const follow = activeFollow(animal, currentTime);

  let statusKey = "unowned";
  if (!animalUuid) statusKey = "invalid";
  else if (ownedByCurrent) statusKey = "ownedByYou";
  else if (owned) statusKey = "ownedByOther";
  else if (follow?.prospectiveOwnerUuid === currentUuid) statusKey = "followingYou";
  else if (follow) statusKey = "followingOther";

  const budget = petSlotBudget({ baseSlots: animal?.system?.slots });
  const capacityPercent = budget.capacity > 0
    ? Math.min(100, Math.round((budget.occupied / budget.capacity) * 100))
    : null;
  const actions = actionReasons(animal, owner, {
    isOwner: isOwner === true,
    localize,
    owned,
    ownedByCurrent,
    follow
  });

  return {
    id: animal?.id ?? animalUuid,
    uuid: animalUuid,
    name: String(animal?.name ?? ""),
    img: animal?.img ?? "",
    size: animal?.system?.size ?? "",
    sizeLabel: sizeLabel(animal?.system?.size, localize),
    power: animal?.system?.power ?? 0,
    ownerUuid,
    ownerName: actorNameByUuid(actors, ownerUuid),
    owned,
    ownedByCurrent,
    following: !!follow,
    followsUntil: follow?.followsUntil ?? 0,
    followSecondsRemaining: follow ? Math.max(0, follow.followsUntil - currentTime) : 0,
    statusKey,
    statusLabel: localizeOrKey(localize, `CROWS.Sheet.Crow.pets.status.${statusKey}`),
    slots: {
      capacity: budget.capacity,
      occupied: budget.occupied,
      free: budget.free,
      overfilled: budget.overfilled,
      hasCapacity: budget.capacity > 0,
      percent: capacityPercent
    },
    actions,
    actionable: actions.tame.enabled || actions.command.enabled || actions.commandTest.enabled
  };
}

/** Build the Foundry-free pet tab context for one crow. */
export function petViewData(owner, actors = [], {
  now = 0,
  isOwner = owner?.isOwner === true,
  localize = (key) => key
} = {}) {
  const documents = uniqueAnimals(actors);
  const actorIndex = [owner, ...actorArray(actors)];
  const animals = documents.map(animal => petActionState(animal, owner, {
    actors: actorIndex,
    now,
    isOwner,
    localize
  }));
  const pets = animals.filter(animal => animal.ownedByCurrent);
  const candidates = animals.filter(animal => !animal.owned);
  return {
    isOwner: isOwner === true,
    canAct: isOwner === true,
    hasAnimals: animals.length > 0,
    animals,
    pets,
    candidates,
    empty: animals.length === 0
  };
}
