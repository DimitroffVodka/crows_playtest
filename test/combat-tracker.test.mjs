import "./shim/foundry.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { CrowsCombatTracker } from "../module/applications/combat-tracker.mjs";

const sideRollAction = () => CrowsCombatTracker.DEFAULT_OPTIONS.actions.rollSide;

function trackerFor(combat) {
  const tracker = Object.create(CrowsCombatTracker.prototype);
  tracker.viewed = combat;
  return tracker;
}

describe("combat tracker side-roll action", () => {
  test("registers rollSide and routes the click through combat authority", async () => {
    const calls = [];
    const combat = {
      canRollSide() {
        calls.push("authority");
        return true;
      },
      async rollSide() {
        calls.push("roll");
        return "rolled";
      }
    };

    const action = sideRollAction();
    assert.equal(typeof action, "function");
    const result = await action.call(trackerFor(combat), {}, {});

    assert.equal(result, "rolled");
    assert.deepEqual(calls, ["authority", "roll"]);
  });

  test("refuses an unauthorized click without calling rollSide", async () => {
    let rolls = 0;
    const combat = {
      canRollSide: () => false,
      rollSide: async () => {
        rolls += 1;
      }
    };

    await sideRollAction().call(trackerFor(combat), {}, {});

    assert.equal(rolls, 0);
  });

  test("shares one in-flight roll when the button is clicked twice", async () => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    let rolls = 0;
    const combat = {
      canRollSide: () => true,
      async rollSide() {
        rolls += 1;
        await pending;
        return "rolled";
      }
    };
    const tracker = trackerFor(combat);
    const action = sideRollAction();

    const first = action.call(tracker, {}, {});
    const second = action.call(tracker, {}, {});
    await Promise.resolve();
    assert.equal(rolls, 1);

    release();
    assert.deepEqual(await Promise.all([first, second]), ["rolled", "rolled"]);
    assert.equal(rolls, 1);
  });
});
