/**
 * Chaos Count — the Ref-secret per-world tally that triggers backlashes
 * once it reaches 13 (per Rules Booklet p.24).
 *
 * Stored as a hidden world setting so it persists across reloads and is
 * GM-only visible. registerChaosSetting() must run in the init hook.
 */

const NS = "crows";
const KEY = "chaosCount";
const THRESHOLD = 13;

export function registerChaosSetting() {
  game.settings.register(NS, KEY, {
    scope: "world",
    config: false,
    type: Number,
    default: 0
  });
}

export function getChaos() {
  try { return Number(game.settings.get(NS, KEY)) || 0; }
  catch { return 0; }
}

export async function setChaos(n) {
  return game.settings.set(NS, KEY, Math.max(0, Math.floor(Number(n) || 0)));
}

/**
 * Add (or subtract) chaos. Returns {before, after, threshold} where
 * threshold === true means a backlash should be triggered and CC reset.
 *
 * Whispers a GM-only update card unless {silent: true} is passed.
 */
export async function addToChaos(amount, { silent = false, cause = null } = {}) {
  const before = getChaos();
  const after = Math.max(0, before + Math.floor(Number(amount) || 0));
  await setChaos(after);
  if (!silent) await _whisperChaos({ before, after, cause });
  return { before, after, threshold: after >= THRESHOLD, ceiling: THRESHOLD };
}

export async function resetChaos({ silent = false, cause = "reset" } = {}) {
  const before = getChaos();
  await setChaos(0);
  if (!silent) await _whisperChaos({ before, after: 0, cause });
  return { before, after: 0 };
}

async function _whisperChaos({ before, after, cause }) {
  const delta = after - before;
  const pct = Math.min(100, Math.round((after / THRESHOLD) * 100));
  const causeNote = cause ? ` <em>(${cause})</em>` : "";
  const sign = delta > 0 ? `+${delta}` : `${delta}`;
  const content = `<div class="crows chaos-update">
    <header><strong>Chaos Count</strong>${causeNote}</header>
    <div>${before} → <strong>${after}</strong> (${sign})</div>
    <div class="chaos-bar"><div class="chaos-bar-fill" style="width: ${pct}%"></div></div>
    <div class="chaos-bar-hint">${after}/${THRESHOLD} ${after >= THRESHOLD ? "<strong>— BACKLASH</strong>" : ""}</div>
  </div>`;
  await ChatMessage.create({
    content,
    whisper: ChatMessage.getWhisperRecipients?.("GM") ?? [],
    speaker: { alias: "Chaos" }
  });
}

/**
 * Open a small GM-only dialog displaying the current count with +/-/reset
 * controls. Bound to game.crows.chaos.show().
 */
export async function showChaosDialog() {
  if (!game.user?.isGM) {
    ui.notifications?.warn("Chaos tracker is GM-only.");
    return;
  }
  const cur = getChaos();
  const pct = Math.min(100, Math.round((cur / THRESHOLD) * 100));
  const content = `<div class="crows chaos-dialog">
    <div class="chaos-dialog-value"><strong>${cur}</strong> / ${THRESHOLD}</div>
    <div class="chaos-bar"><div class="chaos-bar-fill" style="width: ${pct}%"></div></div>
    <p>Adjust the Chaos Count. Backlash triggers automatically on the casting that crosses ${THRESHOLD}.</p>
  </div>`;
  const DialogV2 = foundry.applications.api.DialogV2;
  await DialogV2.prompt({
    window: { title: "Chaos Count" },
    content,
    buttons: [
      { action: "minus1", label: "−1",  callback: async () => { await addToChaos(-1, { cause: "manual" }); return "minus1"; } },
      { action: "plus1",  label: "+1",   callback: async () => { await addToChaos( 1, { cause: "manual" }); return "plus1"; } },
      { action: "plus1d6",label: "+1d6", callback: async () => {
          const r = await new Roll("1d6").evaluate();
          await addToChaos(r.total, { cause: `manual +1d6=${r.total}` });
          return "plus1d6";
        } },
      { action: "reset",  label: "Reset 0", callback: async () => { await resetChaos({ cause: "manual reset" }); return "reset"; } },
      { action: "close",  label: "Close", default: true, callback: () => "close" }
    ]
  });
}
