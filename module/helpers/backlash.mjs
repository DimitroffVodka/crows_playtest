/**
 * Magic backlashes — R:1555–R:1567 and the d100 + rank table at R:1573–R:1659.
 *
 * A backlash resolves INSTEAD of the spell that triggered it, but the caster
 * still rolls the spellbook's UD (R:1559). If a backlash effect needs a
 * creature target and the spell targeted an object, the CASTER becomes the
 * target (R:1561). A duplicate backlash with a duration is re-rolled unless its
 * effects stack (R:1561). UD for backlash effects are rolled at the end of each
 * DT (R:1561).
 *
 * THE TABLE IS TRANSCRIBED HERE, NOT LOOKED UP IN A COMPENDIUM.
 * The Playtest 1 implementation parsed the Rules journal's HTML at roll time
 * and fell back to "consult the compendium" whenever the pack was missing, the
 * page was renamed or the markup shifted — i.e. it could silently stop
 * resolving backlashes without any test noticing. The table is 55 rows of
 * static rules text; it belongs in code where it can be pinned by a test that
 * proves every value 1-105 resolves.
 *
 * ERRATA — the source rows are kept VERBATIM in `sourceRange` / `sourceNote`
 * and are NOT silently corrected. See docs/discrepancies/crows-rules.md.
 *   * Row "62-64" overlaps row "61-62"; 62 would belong to two rows and 63
 *     would belong to none. Read as 63-64, which is the only reading that
 *     leaves the table total.
 *   * Row 51-52 calls for a "Might RR". No such characteristic exists in this
 *     game (Agility / Mind / Strength). Almost certainly Strength.
 *   * The RR sub-tables and a handful of words arrive from the OCR pipeline
 *     run together ("16 damage; weakened", "accordionplays", "by1d6"). Spacing
 *     and the RR tier labels are repaired; no wording is changed.
 */

/** Lowest value the table covers: d100 minimum 1, rank minimum 0. */
export const BACKLASH_MIN = 1;

/** Highest value the table covers: d100 maximum 100 + rank maximum 5 (R:1449). */
export const BACKLASH_MAX = 105;

/**
 * The Backlashes table (R:1573–R:1659).
 *
 * @type {ReadonlyArray<{lo: number, hi: number, sourceRange: string,
 *                       text: string, sourceNote?: string}>}
 */
export const BACKLASH_TABLE = Object.freeze([
  { lo: 1, hi: 2, sourceRange: "01-02",
    text: "Your head transforms into a donkey’s head. You can’t speak, only bray at a loud volume. This effect has 1 UD." },
  { lo: 3, hi: 4, sourceRange: "03-04",
    text: "Your magic makes you feels so good that you are compelled to dance at all times. While under this effect, your speed is reduced by 2 and you take a bane to tests made to climb, hide, sneak, or swim. This effect has 1 UD." },
  { lo: 5, hi: 6, sourceRange: "05-06",
    text: "You summon a ghostly, self-playing accordion that can’t be destroyed and follows you wherever you go and plays polka loudly until the end of this DT. It is impossible to go anywhere without notice as this accordion plays." },
  { lo: 7, hi: 8, sourceRange: "07-08",
    text: "Each time you speak between now and the end of this DT, roll a d10. On a 10, your words unleash a thunderous boom. Each creature within 3 squares of you takes 1d6 damage. If you are already suffering this backlash, the damage increases by 1d6." },
  { lo: 9, hi: 10, sourceRange: "09-10",
    text: "Your mood becomes fiery and irritable. If you don’t harm another creature before the end of this DT, then the fire inside you makes you take 1d6 P damage. If you are already suffering this backlash, the damage increases by 1d6." },
  { lo: 11, hi: 12, sourceRange: "11-12",
    text: "Your body temperature drops, making you very cold until the end of this DT. During this time, your speed is reduced by 1 and if you start your turn submerged in water or soaked with water, you take 1d6 P damage. If you are already suffering this backlash, then your speed is further reduced by 1." },
  { lo: 13, hi: 14, sourceRange: "13-14",
    text: "Magic muddles your mind. You are weakened." },
  { lo: 15, hi: 16, sourceRange: "15-16",
    text: "Your body becomes seasoned by magic, making your bones and psyche brittle. The next time you take damage before the end of the DT, you take twice as much as you normally would." },
  { lo: 17, hi: 18, sourceRange: "17-18",
    text: "Magic makes your body fragile. You are vulnerable." },
  { lo: 19, hi: 20, sourceRange: "19-20",
    text: "A limb you use to hold items goes numb and can’t be moved. The Ref picks one of your hand slots. You drop any item in that slot and you can’t use the hand slot until the end of the DT." },
  { lo: 21, hi: 22, sourceRange: "21-22",
    text: "Hungry magic erupts from your body and destroys the nearest 1d6 rations." },
  { lo: 23, hi: 24, sourceRange: "23-24",
    text: "Your magic creates a thunderous boom that can be heard by all creatures within 100 squares of you. The curious ones come to investigate." },
  { lo: 25, hi: 26, sourceRange: "25-26",
    text: "A powerful gust of wind pushes you and every creature within 10 squares of you 1d6 squares in a random direction determined by the Ref." },
  { lo: 27, hi: 28, sourceRange: "27-28",
    text: "You infuse negative energy into yourself and take 1d6 damage." },
  { lo: 29, hi: 30, sourceRange: "29-30",
    text: "You teleport 1d6 squares in a direction chosen by the Ref into an unoccupied space." },
  { lo: 31, hi: 32, sourceRange: "31-32",
    text: "Shuffle your inventory cards into a deck. Roll a d10. Then pull a number of cards equal to the result from the top of the deck. The last card pulled is a piece of equipment that turns into a goat under the Ref’s control. The equipment remains a goat until the goat dies, at which point it transforms back into the original equipment." },
  { lo: 33, hi: 34, sourceRange: "33-34",
    text: "Shuffle your inventory cards into a deck. Roll a d10. Then pull a number of cards equal to the result from the top of the deck. The last card pulled is a piece of equipment that is teleported into the possession of another creature randomly chosen by the Ref within 20 squares of you." },
  { lo: 35, hi: 36, sourceRange: "35-36",
    text: "Shuffle your inventory cards into a deck. Roll a d10. Then pull a number of cards equal to the result from the top of the deck. The last card pulled is a piece of equipment that transforms into a feather duster until the end of this DT." },
  { lo: 37, hi: 38, sourceRange: "37-38",
    text: "A sticky goo falls from the sky onto your body. Until this goo disappears at the end of this DT, your speed is reduced by 2. If you are already suffering from the effect of this backlash, your speed is reduced an additional 2." },
  { lo: 39, hi: 40, sourceRange: "39-40",
    text: "A noxious, unpleasant-smelling cloud of gas forms around your head and follows you wherever you go. This gas imposes a bane on all tests. This effect has 1 UD." },
  { lo: 41, hi: 42, sourceRange: "41-42",
    text: "You open a channel into the target of the spell’s mind and their worst fears are shared with your allies within 10 squares of them. Each ally takes 1d6 P damage." },
  { lo: 43, hi: 44, sourceRange: "43-44",
    text: "You are compelled to speak only in rhyming couplets. If you fail to do so, you take 1d6 P damage. This effect has 1 UD." },
  { lo: 45, hi: 46, sourceRange: "45-46",
    text: "Your body becomes porcelain. While in this form, whenever you take non-piercing damage, you take twice as much. This effect has 1 UD." },
  { lo: 47, hi: 48, sourceRange: "47-48",
    text: "You are outlined in a supernatural light which makes it impossible for you to hide and easy to attack. Attacks against you gain +2 while this light is active. This effect has 1 UD." },
  { lo: 49, hi: 50, sourceRange: "49-50",
    text: "Fire erupts from your body. You and each creature within 2 squares of you takes 1d6 damage." },
  { lo: 51, hi: 52, sourceRange: "51-52",
    text: "You summon open a portal that unleashes a horde of demonic bees that flit through the local area and then fly back through the portal before it closes. You and each creature within 3 squares of you must make a Might RR. Tier 1: 6 damage; weakened. Tier 2: 3 damage. Tier 3: No effect.",
    sourceNote: "Source says \"Might RR\"; this game has Agility, Mind and Strength only — probably Strength. Transcribed as printed; see docs/discrepancies/crows-rules.md." },
  { lo: 53, hi: 54, sourceRange: "53-54",
    text: "Tentacles erupt from your body. You and each creature within 3 squares of you takes 1d6 damage. The tentacles become nonfunctional immediately after emerging and you gain three special wounds. You or a creature who can reach you can remove a special wound’s worth of tentacles from your body with a bladed tool or weapon as an action without doing further harm to you. Once all these wounds are removed, so are all the tentacles." },
  { lo: 55, hi: 56, sourceRange: "55-56",
    text: "You summon a load of dirt that falls from the sky, smashing down on you and each creature within 2 squares of you. Each affected creature must make an Agility RR. Tier 1: 6 damage; prone. Tier 2: 3 damage. Tier 3: No effect." },
  { lo: 57, hi: 58, sourceRange: "57-58",
    text: "Your magic summons 1d6 blood creatures who appear in unoccupied spaces within 5 squares of you. These creatures are hostile to you." },
  { lo: 59, hi: 60, sourceRange: "59-60",
    text: "You are so overwhelmed with emotion that you fall prone and can’t stand up, crawling wherever you wish to go. This effect has 1 UD." },
  { lo: 61, hi: 62, sourceRange: "61-62",
    text: "Your hands become feet until the end of the DT. You gain +2 speed, but you can’t hold or manipulate any objects with your hands while this effect lasts." },
  { lo: 63, hi: 64, sourceRange: "62-64",
    text: "The ground beneath you and within 1 square of you turns to quicksand. Each creature standing on the ground must make an Agility RR. Tier 1: The creature is grappled by the sand and takes 1d6 P dam at the end of each round they are grappled. Tier 2: The creature is grappled by the quicksand until the end of their next turn. Tier 3: The creature can move 2 squares. A non-grappled creature who enters the quicksand or starts their turn in it must make the Agility RR. If you are not touching the ground, roll for a different backlash.",
    sourceNote: "Source prints \"62-64\", which overlaps the \"61-62\" row above it and leaves 63 uncovered. Read as 63-64; see docs/discrepancies/crows-rules.md." },
  { lo: 65, hi: 66, sourceRange: "65-66",
    text: "You open a one-way viewing portal that follows you around wherever you go until the end of this DT. You can’t sense anything on the other side of the portal, but anyone on the other side can see and hear through the portal. The other side of the portal appears near a personal enemy or rival of the Ref’s choice." },
  { lo: 67, hi: 68, sourceRange: "67-68",
    text: "You teleport up to 50 squares away in a horizontal direction chosen by the Ref into an unoccupied space." },
  { lo: 69, hi: 70, sourceRange: "69-70",
    text: "You take 1d6 damage and become encased in earth from the neck down and are grappled. Another creature must use an action to free you. Each time you start a combat round grappled, you take 1d6 damage." },
  { lo: 71, hi: 72, sourceRange: "71-72",
    text: "If the effect of the spell is good, you cast it and target the nearest enemy, regardless of the spell’s range. If the effect of the spell is bad, you cast it and target yourself, regardless of the spell’s range. The Ref determines if the spell is good or bad." },
  { lo: 73, hi: 74, sourceRange: "73-74",
    text: "You get a full feeling in your stomach. At the start of each of your turns in combat, you must roll any die. On an odd result, you spend the turn vomiting slugs and can do nothing else. This effect has 1 UD." },
  { lo: 75, hi: 76, sourceRange: "75-76",
    text: "The Ref randomly chooses 1d6 × 100 coins or a gem or other mundane treasure that you carry. It melts." },
  { lo: 77, hi: 78, sourceRange: "77-78",
    text: "You transform into a frog. Your size us Tiny, your Stamina maximum is reduced to 1, you have 0 slots, and you lose all your expertises. You have a climb and swim speed equal to your walking speed and Jump +2. This effect has 1 UD." },
  { lo: 79, hi: 80, sourceRange: "79-80",
    text: "Shuffle your inventory cards into a deck. Roll a d10. Then pull a number of cards equal to the result from the top of the deck. The last card pulled is a piece of equipment that is teleported off your person into a dungeon of the Ref’s choice." },
  { lo: 81, hi: 82, sourceRange: "81-82",
    text: "Your mouth and ears meld shut until you finish a rest. During this time, you can’t speak or hear anything." },
  { lo: 83, hi: 84, sourceRange: "83-84",
    text: "Your eyes become light sensitive. You treat bright light as if it were darkness. This effect has 2 UD." },
  { lo: 85, hi: 86, sourceRange: "85-86",
    text: "You summon a cloud of buzzing, stinging insects that follow you around and don’t allow you to rest until you feed them 1,000 pounds of flesh." },
  { lo: 87, hi: 88, sourceRange: "87-88",
    text: "Your Strength score decreases by 1 until you finish a rest. This effect is cumulative." },
  { lo: 89, hi: 90, sourceRange: "89-90",
    text: "Your Agility score decreases by 1 until you finish a rest. This effect is cumulative." },
  { lo: 91, hi: 92, sourceRange: "91-92",
    text: "Your Mind score decreases by 1 until you finish a rest. This effect is cumulative." },
  { lo: 93, hi: 94, sourceRange: "93-94",
    text: "Magic bursts forth from inside your body, causing you to suffer 1d6 wounds." },
  { lo: 95, hi: 96, sourceRange: "95-96",
    text: "Lightning flies from your body. You and each creature within 5 squares of you takes 3d6 damage." },
  { lo: 97, hi: 98, sourceRange: "97-98",
    text: "You become allergic to magic. Whenever you or any creature activates a magic item or casts a spell within 10 squares of you, you take 1d6 P damage. This effect has 2 UD." },
  { lo: 99, hi: 100, sourceRange: "99-100",
    text: "Whenever you cast a spell, the result is treated as one tier lower. If you get a tier 1 result, it is treated as a doom. This effect has 2 UD." },
  { lo: 101, hi: 101, sourceRange: "101",
    text: "Antlers grow from your head. If you cut these off, they instantly grow back. You can’t wear hats or any type of headgear that isn’t specially modified to fit your new noggin." },
  { lo: 102, hi: 102, sourceRange: "102",
    text: "Your mind is warped by magic. The Ref randomly chooses an expertise you have and one you don’t. You lose all uses of the expertise you have and gain an equivalent number of uses of the one you do not." },
  { lo: 103, hi: 103, sourceRange: "103",
    text: "Magic within your body reshapes one of your hands into a deadly weapon. The Ref randomly chooses a mundane 1-handed weapon. Your hand is now this weapon. You can’t ever use that hand slot to hold another object." },
  { lo: 104, hi: 104, sourceRange: "104",
    text: "Magic lighting wracks your body with pain. Your Stamina is reduce to 0 and you gain 2d6 wounds." },
  { lo: 105, hi: 105, sourceRange: "105",
    text: "A portal to Hell opens beneath you and sucks you into it as a chorus of demons laughs at your unfortunate fate. The portal shuts as your soul and body are forever sealed away." }
]);

/**
 * Look up a backlash row. PURE.
 *
 * `total` is clamped into the table's range rather than falling through to a
 * "consult the rulebook" message: content with a rank above 5 (or a future
 * modifier) must still land on a row, and the top row is the correct one.
 *
 * @param {number} total  d100 + the effective spell rank.
 * @returns {{row: object, total: number, clamped: boolean}}
 */
export function lookupBacklash(total) {
  const raw = Math.floor(Number(total) || 0);
  const clampedTotal = Math.min(BACKLASH_MAX, Math.max(BACKLASH_MIN, raw));
  const row = BACKLASH_TABLE.find(r => clampedTotal >= r.lo && clampedTotal <= r.hi);
  return { row, total: clampedTotal, clamped: clampedTotal !== raw };
}

/**
 * R:1561 — if a backlash effect requires the spell to have a creature target
 * and the spell targeted an object, the CASTER becomes the target.
 *
 * @param {object} p
 * @param {"creature"|"object"|"none"|string} p.spellTargetKind
 * @param {string} p.casterId
 * @param {string[]} [p.spellTargetIds]
 * @returns {{targetIds: string[], redirectedToCaster: boolean}}
 */
export function backlashTargets({ spellTargetKind, casterId, spellTargetIds = [] } = {}) {
  if (spellTargetKind === "creature" && spellTargetIds.length) {
    return { targetIds: [...spellTargetIds], redirectedToCaster: false };
  }
  return { targetIds: casterId ? [casterId] : [], redirectedToCaster: true };
}

/**
 * R:1561 — a caster already suffering a durational backlash who gets the SAME
 * one again re-rolls, unless that backlash's effects stack. Conditions
 * (weakened, vulnerable) are excluded by the rule itself.
 *
 * Rows whose text says the damage/penalty increases if you are already
 * suffering it ARE the stacking ones, so they are detected from the text
 * rather than from a hand-maintained list that could drift from it.
 *
 * @param {object} row              The row just rolled.
 * @param {string[]} activeRanges   `sourceRange` values already active on the caster.
 * @returns {{reroll: boolean, reason: string}}
 */
export function shouldRerollBacklash(row, activeRanges = []) {
  if (!row) return { reroll: false, reason: "no row" };
  if (!activeRanges.includes(row.sourceRange)) return { reroll: false, reason: "not already active" };
  if (isConditionOnlyBacklash(row)) return { reroll: false, reason: "condition, not a duration" };
  if (backlashStacks(row)) return { reroll: false, reason: "effects stack" };
  if (!hasDuration(row)) return { reroll: false, reason: "no duration" };
  return { reroll: true, reason: "duplicate durational backlash" };
}

/**
 * True when the row's only effect is applying a condition — R:1561 excludes
 * those from the re-roll rule explicitly ("aside from a condition, like
 * weakened or vulnerable").
 */
export function isConditionOnlyBacklash(row) {
  return /\bYou are (weakened|vulnerable)\.$/i.test((row?.text ?? "").trim());
}

/** True when the row says it gets worse if you are already suffering it. */
export function backlashStacks(row) {
  return /already suffering/i.test(row?.text ?? "");
}

/** True when the row lasts beyond the instant it lands. */
export function hasDuration(row) {
  return /\bUD\b|end of (?:this|the) DT|until you finish a rest|cumulative/i.test(row?.text ?? "");
}

/**
 * How many UD a backlash effect carries. R:1561 — these are rolled at the end
 * of each DT, which is T1.5's clock; this only reports the count.
 * @returns {number} 0 when the effect has no UD.
 */
export function backlashUsageDice(row) {
  const m = (row?.text ?? "").match(/This effect has (\d+) UD/i);
  return m ? Number(m[1]) : 0;
}

/**
 * Roll a backlash and post the Ref-facing card. Foundry-touching.
 *
 * @param {object} p
 * @param {number} p.rank             The EFFECTIVE rank (Mastery reduction already applied).
 * @param {string} [p.cause]          "doom" or "chaos roll" — R:1563's two routes.
 * @param {Actor}  [p.actor]          The caster, for the speaker.
 * @param {string[]} [p.activeRanges] `sourceRange` values already active on the caster.
 * @param {() => Promise<number>} [p.d100]  Injectable die source, for probes/tests.
 * @returns {Promise<{total, rank, row, rerolled, sourceRange, text}>}
 */
export async function rollBacklash({ rank = 0, cause = "", actor = null, activeRanges = [],
                                     d100 = null } = {}) {
  const effRank = Math.max(0, Math.floor(Number(rank) || 0));
  const roll = d100 ? { total: await d100() } : await new Roll(`1d100 + ${effRank}`).evaluate();
  let total = d100 ? roll.total + effRank : roll.total;
  let { row, clamped } = lookupBacklash(total);

  // R:1561 — one re-roll for a duplicate durational backlash.
  let rerolled = false;
  const dup = shouldRerollBacklash(row, activeRanges);
  if (dup.reroll) {
    const second = d100 ? { total: (await d100()) + effRank } : await new Roll(`1d100 + ${effRank}`).evaluate();
    total = second.total;
    ({ row, clamped } = lookupBacklash(total));
    rerolled = true;
  }

  const causeNote = cause ? ` <em>(${cause})</em>` : "";
  const rerollNote = rerolled ? ` <em>(re-rolled — duplicate durational backlash)</em>` : "";
  const errataNote = row?.sourceNote ? `<div class="bk-errata"><small>${row.sourceNote}</small></div>` : "";
  const content = `<div class="crows backlash">
  <header><strong>Backlash!</strong>${causeNote}</header>
  <div class="bk-roll">d100 + rank ${effRank} = <strong>${total}</strong>${clamped ? " (clamped)" : ""} → ${row?.sourceRange ?? "?"}${rerollNote}</div>
  <div class="bk-effect"><em>${row?.text ?? ""}</em></div>
  ${errataNote}
</div>`;

  await ChatMessage.create({
    content,
    whisper: ChatMessage.getWhisperRecipients?.("GM") ?? [],
    speaker: actor ? ChatMessage.getSpeaker({ actor }) : { alias: "Backlash" }
  });

  return { total, rank: effRank, row, rerolled, sourceRange: row?.sourceRange, text: row?.text };
}
