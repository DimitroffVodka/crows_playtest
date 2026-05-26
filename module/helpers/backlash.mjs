/**
 * Magic backlash — rolls d100 + spell rank and looks up the matching row
 * on the Backlashes table stored in the Rules Reference journal. Posts a
 * GM-whispered chat card with the rolled total and effect text.
 *
 * Rules Booklet p.25–28: the d100+rank table. Single-cell rows 101+ are
 * one-shots; double-cell rows (01-02, etc.) span two values.
 */

const PACK_KEY = "crows.crows-rules";

/**
 * @param {number} rank      Spell rank (0–5+); added to the d100.
 * @param {object} [opts]
 * @param {string} [opts.cause]   Optional reason label (e.g. "doom", "chaos 13+").
 * @param {Actor}  [opts.actor]   The caster (used for speaker on the chat card).
 * @returns {Promise<{total, rank, rangeText, effect}>}
 */
export async function rollBacklash(rank = 0, { cause = "", actor = null } = {}) {
  rank = Math.max(0, Math.floor(Number(rank) || 0));
  const roll = await new Roll(`1d100 + ${rank}`).evaluate();
  const total = roll.total;

  const lookup = await lookupBacklash(total);
  const causeNote = cause ? ` <em>(${cause})</em>` : "";
  const content = `<div class="crows backlash">
  <header><strong>Backlash!</strong>${causeNote}</header>
  <div class="bk-roll">d100 + rank ${rank} = <strong>${total}</strong> ${lookup.rangeText ? `→ ${lookup.rangeText}` : ""}</div>
  <div class="bk-effect"><em>${lookup.effect}</em></div>
</div>`;

  const whisper = ChatMessage.getWhisperRecipients?.("GM") ?? [];
  await ChatMessage.create({
    content,
    whisper,
    speaker: actor ? ChatMessage.getSpeaker({ actor }) : { alias: "Backlash" }
  });

  return { total, rank, rangeText: lookup.rangeText, effect: lookup.effect };
}

/**
 * Parse the rules journal's Backlashes table to find the row matching `total`.
 * Returns {rangeText, effect}. Falls back to a guidance message if the table
 * can't be parsed.
 */
export async function lookupBacklash(total) {
  try {
    const pack = game.packs.get(PACK_KEY);
    if (!pack) return _fallback(total, "rules journal pack not found");
    if (!pack.index?.contents?.length) return _fallback(total, "rules pack empty");
    const journal = await pack.getDocument(pack.index.contents[0]._id);
    const page = journal?.pages?.find?.(p => /backlash/i.test(p.name));
    if (!page) return _fallback(total, "no Backlashes page in journal");
    const html = page.text?.content ?? "";
    const div = document.createElement("div");
    div.innerHTML = html;
    const rows = [...div.querySelectorAll("table tr")];
    let bestExact = null;
    let highestSingle = null;
    for (const tr of rows) {
      const cells = tr.querySelectorAll("td");
      if (cells.length < 2) continue;
      const rangeText = (cells[0].textContent || "").trim();
      const effect = (cells[1].textContent || "").trim();
      // Patterns: "01-02", "01–02", "99-100", "101", "102+"
      const m = rangeText.match(/^(\d+)(?:\s*[-–]\s*(\d+))?(\+?)$/);
      if (!m) continue;
      const lo = Number(m[1]);
      const hi = m[2] ? Number(m[2]) : lo;
      const open = m[3] === "+";
      if (total >= lo && total <= hi) bestExact = { rangeText, effect };
      if (open && total >= lo) bestExact = { rangeText, effect };       // "102+" matches anything ≥102
      if (!m[2] && !open && lo > 100 && lo <= total) highestSingle = { rangeText, effect };
    }
    return bestExact ?? highestSingle ?? _fallback(total, "no matching row");
  } catch (e) {
    return _fallback(total, e?.message ?? "lookup failed");
  }
}

function _fallback(total, why) {
  return { rangeText: "", effect: `(d100+rank = ${total}; lookup unavailable — ${why}. Consult the Rules Reference compendium.)` };
}
