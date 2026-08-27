import {
  openVillageCreator,
  validateVillageCreatorInput,
  createVillageRecord
} from "../helpers/village-map.mjs";

// The creator is launched through the native v14 DialogV2 workflow.  Keep a
// small import-safe fallback so boot-time static checks can resolve this file
// before a live Foundry application namespace exists.
const DialogBase = globalThis.foundry?.applications?.api?.DialogV2
  ?? class {
    static DEFAULT_OPTIONS = {};
  };

/** Public application seam for the Village creator. */
export class VillageCreator extends DialogBase {
  static DEFAULT_OPTIONS = {
    ...(DialogBase.DEFAULT_OPTIONS ?? {}),
    classes: ["crows", "village-creator"]
  };

  static async open(options = {}) {
    return openVillageCreator(options);
  }
}

export const VillageCreatorApplication = VillageCreator;
export { openVillageCreator, validateVillageCreatorInput, createVillageRecord };

export default VillageCreator;
