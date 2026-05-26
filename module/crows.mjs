import { CROWS } from "./config.mjs";

Hooks.once("init", () => {
  console.log("crows | init");
  CONFIG.CROWS = CROWS;
});

Hooks.once("ready", () => {
  console.log("crows | ready");
});
