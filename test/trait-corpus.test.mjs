import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

const DIR = "src/packs/crows-traits";

const shippedTraits = () =>
  readdirSync(DIR).filter((f) => f.endsWith(".yaml"))
    .map((f) => ({ file: f, doc: yaml.load(readFileSync(join(DIR, f), "utf8")) }));

describe("trait corpus", () => {
  test("every document is packable", () => {
    const traits = shippedTraits();
    assert.equal(traits.length, 276, "guard: the real shipped corpus was loaded");

    const seen = new Map();
    for (const { file, doc } of traits) {
      // fvtt-cli SILENTLY SKIPS a document with no _key — no error, no output.
      assert.ok(doc._id, `${file}: missing _id`);
      assert.equal(doc._id.length, 16, `${file}: _id must be 16 chars`);
      assert.equal(doc._key, `!items!${doc._id}`, `${file}: _key must match _id`);
      assert.equal(seen.get(doc._id), undefined,
        `${file}: _id collides with ${seen.get(doc._id)}`);
      seen.set(doc._id, file);
    }
  });

  test("xpCost is never stored — it is computed from tier", () => {
    for (const { file, doc } of shippedTraits()) {
      assert.ok(!(doc.system && "xpCost" in doc.system),
        `${file}: xpCost must stay derived, not stored`);
    }
  });

  /**
   * The check that motivated this file.
   *
   * `connectsTo` is OURS — the register records that the trait graph was never
   * diffed against the book, because the markdown carries no visible edges and a
   * column-aligned default was assumed. Nothing upstream will ever correct a
   * wrong edge.
   *
   * When PT2 renamed or replaced a trait, inbound edges kept naming the old
   * trait. The T3.2 pass found these across every group — Alchemy Bell/Belt,
   * Stop Chopping/Stop, Crit/Chopping Crit, Groundroll/Stacks on Stacks, and
   * four in Travel and Unarmed. None failed a test, none looked wrong in the
   * YAML, and each one is a tree connection a player cannot traverse.
   */
  test("no connectsTo edge points at a trait that does not exist", () => {
    const traits = shippedTraits();
    const names = new Set(traits.map(({ doc }) => doc.name));
    const dangling = [];

    for (const { file, doc } of traits) {
      for (const target of doc.system?.connectsTo ?? []) {
        if (!names.has(target)) dangling.push(`${file} -> "${target}"`);
      }
    }

    assert.deepEqual(dangling, [], "dangling trait-tree edges");
  });

  /**
   * MCDM's own typos, each verified present in the Characters Book PDF.
   *
   * These exist because the pinned markdown SILENTLY CORRECTS them: across all
   * 276 traits the T3.2 pass found ~33 places where the markdown repairs the
   * book, and zero where it introduced an error. Some corrections change
   * grammatical number or phrasing, not just spelling, so they are not safely
   * ignorable.
   *
   * Anyone re-transcribing from the markdown will "fix" these back. This test
   * is what tells them they diverged from the source.
   */
  test("canonical MCDM typos survive re-transcription", () => {
    const blob = JSON.stringify(shippedTraits().map(({ doc }) => doc));
    for (const typo of [
      "vulenarble",        // Bone Breaker, bashing t3-c3
      "Sieze",             // Sieze the Advantage, thievery t1-c1
      "wile",              // Seeing Things, thievery t4-c1
      "one the same turn", // Stabathon / Unrelenting Death
      "car for",           // Share Food, pets
      "a two expertises"   // Tricks / Extra Tricks, pets
    ]) {
      assert.ok(blob.includes(typo), `canonical typo lost: "${typo}"`);
    }
  });
});
