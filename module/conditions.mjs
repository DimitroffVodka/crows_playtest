export const CROWS_STATUS = [
  { id: "blessed", name: "Blessed", img: "icons/svg/angel.svg" },
  { id: "boned", name: "Boned", img: "icons/svg/skull.svg" },
  { id: "grabbed", name: "Grabbed", img: "icons/svg/net.svg" },
  { id: "prone", name: "Prone", img: "icons/svg/falling.svg" },
  { id: "unconscious", name: "Unconscious", img: "icons/svg/unconscious.svg" },
  { id: "hidden", name: "Hidden", img: "icons/svg/invisible.svg" },
  { id: "invisible", name: "Invisible", img: "icons/svg/invisible.svg" }
];

export function registerConditions() {
  CONFIG.statusEffects = CROWS_STATUS.map(s => ({ ...s }));
}
