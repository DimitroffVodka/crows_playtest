import "./shim/foundry.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { basename, join } from "node:path";
import { readFileSync, readdirSync } from "node:fs";

import {
  petActionState,
  petViewData,
  petViewReasonKey
} from "../module/helpers/pet-view.mjs";

function crow({ uuid = "Actor.crow1", isOwner = true } = {}) {
  return { id: "crow1", uuid, type: "crow", name: "Mara", isOwner, system: {} };
}

function animal({
  id = "pet1",
  uuid = `Actor.${id}`,
  name = "Horse",
  ownerUuid = "",
  prospectiveOwnerUuid = "",
  followsUntil = 0,
  size = "large",
  slots = 10
} = {}) {
  return {
    id,
    uuid,
    name,
    img: `${id}.webp`,
    type: "monster",
    system: {
      creatureType: "animal",
      size,
      power: 4,
      slots,
      pet: { ownerUuid, prospectiveOwnerUuid, followsUntil }
    }
  };
}

const localize = (key) => `localized:${key}`;
const MONSTER_DIR = new URL("../src/packs/crows-monsters/", import.meta.url).pathname;

function scalar(source, key) {
  return source.match(new RegExp(`^  ${key}:\\s*([^\\n#]+)`, "m"))?.[1]?.trim() ?? "";
}

function shippedAnimals() {
  return readdirSync(MONSTER_DIR)
    .filter(file => file.endsWith(".yaml"))
    .map(file => {
      const source = readFileSync(join(MONSTER_DIR, file), "utf8");
      const id = basename(file, ".yaml");
      return {
        id,
        uuid: `Actor.${id}`,
        name: source.match(/^name:\s*([^\n#]+)/m)?.[1]?.trim() ?? id,
        type: "monster",
        system: {
          creatureType: scalar(source, "creatureType"),
          size: scalar(source, "size"),
          power: Number(scalar(source, "power")),
          slots: Number(scalar(source, "slots")),
          pet: {}
        }
      };
    })
    .filter(actor => actor.system.creatureType === "animal");
}

describe("pet sheet view model", () => {
  test("owner sees ownerless animals as tame candidates and owned pets as commands", () => {
    const owner = crow();
    const horse = animal();
    const dog = animal({ id: "pet2", name: "Dog", ownerUuid: owner.uuid, size: "medium", slots: 1 });
    const data = petViewData(owner, [horse, dog], { now: 100, localize });

    assert.equal(data.animals.length, 2);
    assert.equal(data.candidates[0].name, "Horse");
    assert.equal(data.candidates[0].actions.tame.enabled, true,
      "friendliness is asserted in the tame dialog, not stored in the model");
    assert.equal(data.candidates[0].actions.command.enabled, false);
    assert.equal(data.candidates[0].actions.command.reason, "not-owned-pet");

    assert.equal(data.pets[0].name, "Dog");
    assert.equal(data.pets[0].ownedByCurrent, true);
    assert.equal(data.pets[0].statusKey, "ownedByYou");
    assert.equal(data.pets[0].ownerName, "Mara");
    assert.equal(data.pets[0].actions.command.enabled, true);
    assert.equal(data.pets[0].actions.commandTest.enabled, true);
    assert.equal(data.pets[0].actions.tame.enabled, false);
    assert.equal(data.pets[0].actions.tame.reason, "already-owned");
  });

  test("non-owners receive no actionable buttons", () => {
    const owner = crow({ isOwner: false });
    const data = petViewData(owner, [animal({ ownerUuid: owner.uuid })], { localize });
    const pet = data.animals[0];

    assert.equal(data.canAct, false);
    assert.equal(pet.actions.visible, false);
    assert.equal(pet.actions.tame.visible, false);
    assert.equal(pet.actions.command.visible, false);
    assert.equal(pet.actionable, false);
  });

  test("active bonding follow is visible and blocks a second tame attempt", () => {
    const owner = crow();
    const following = animal({ prospectiveOwnerUuid: owner.uuid, followsUntil: 200 });
    const data = petActionState(following, owner, { now: 100, actors: [owner], localize });

    assert.equal(data.statusKey, "followingYou");
    assert.equal(data.followSecondsRemaining, 100);
    assert.equal(data.actions.tame.enabled, false);
    assert.equal(data.actions.tame.reason, "bonding-pending");
    assert.match(data.actions.tame.reasonLabel, /bondingPending/);
  });

  test("following another prospective owner is not offered as a tame target", () => {
    const owner = crow();
    const following = animal({ prospectiveOwnerUuid: "Actor.other", followsUntil: 200 });
    const view = petActionState(following, owner, { now: 100, localize });

    assert.equal(view.statusKey, "followingOther");
    assert.equal(view.actions.tame.enabled, false);
    assert.equal(view.actions.tame.reason, "following-other");
  });

  test("zero-slot animals render a safe capacity state instead of 0/0", () => {
    const view = petActionState(animal({ slots: 0 }), crow(), { localize });

    assert.equal(view.slots.capacity, 0);
    assert.equal(view.slots.occupied, 0);
    assert.equal(view.slots.free, 0);
    assert.equal(view.slots.hasCapacity, false);
    assert.equal(view.slots.percent, null);
  });

  test("the shipped zero-slot animal rows stay renderable", () => {
    const owner = crow();
    const animals = shippedAnimals();
    const data = petViewData(owner, animals, { localize });

    assert.equal(animals.length, 32, "guard: the real shipped animal corpus was loaded");
    // T3.5 replaced this set wholesale. Bear and Wolf were OUR transcription
    // errors — PT2 prints Slots 10 and 5 (F:718, F:1025). The six below print 0
    // in the book, so a zero-slot animal is a fact to render, not a bug to fix.
    // No rule derives it: Cat is Tiny with 1 slot, Hawk is Small with 0.
    assert.deepEqual(
      data.animals.filter(entry => entry.slots.capacity === 0).map(entry => entry.name).sort(),
      ["Chicken", "Crow", "Hawk", "Rat", "Snake, Venomous", "Spider"]
    );
    for (const entry of data.animals.filter(animal => animal.slots.capacity === 0)) {
      assert.equal(entry.slots.percent, null, entry.name);
      assert.equal(entry.slots.hasCapacity, false, entry.name);
    }
  });

  test("view data filters non-animals and duplicate actor references", () => {
    const owner = crow();
    const pet = animal();
    const notAnimal = { id: "monster", uuid: "Actor.monster", type: "monster", system: { creatureType: "blood" } };
    const data = petViewData(owner, [pet, pet, notAnimal], { localize });

    assert.deepEqual(data.animals.map(entry => entry.uuid), [pet.uuid]);
    assert.equal(data.hasAnimals, true);
    assert.equal(data.empty, false);
  });
});

describe("pet view reason mapping", () => {
  test("engine reason codes always resolve to localized sheet keys", () => {
    assert.equal(
      petViewReasonKey("invalid-animal-uuid"),
      "CROWS.Sheet.Crow.pets.reason.invalidAnimalUuid"
    );
    assert.equal(
      petViewReasonKey("future-engine-reason"),
      "CROWS.Sheet.Crow.pets.reason.unavailable"
    );
  });
});
