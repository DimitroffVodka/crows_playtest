import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { BACKLASH_TABLE } from "../module/helpers/backlash.mjs";

const JOURNAL_FILE = "src/packs/crows-rules/conditions.yaml";

const readJournal = () =>
  yaml.load(readFileSync(JOURNAL_FILE, "utf8"));

test("rules journal has packable document and page keys", () => {
  const journal = readJournal();

  assert.equal(journal._id, "crowsruleconds01");
  assert.equal(journal._id.length, 16);
  assert.equal(journal._key, "!journal!" + journal._id);
  assert.equal(journal.pages.length, 16, "PT2 journal has 16 pages after replacing Chaos Count");

  const seen = new Set();
  for (const page of journal.pages) {
    assert.match(page._id, /^[A-Za-z0-9]{16}$/, page.name + ": _id must be 16 alphanumeric characters");
    assert.equal(seen.has(page._id), false, page.name + ": duplicate page _id");
    seen.add(page._id);
    assert.equal(
      page._key,
      "!journal.pages!" + journal._id + "." + page._id,
      page.name + ": _key must use the journal/page key shape"
    );
  }
});

test("PT2 journal removes retired mechanics", () => {
  const journal = readJournal();
  for (const page of journal.pages) {
    const pageText = page.name + "\n" + (page.text?.content ?? "");
    assert.doesNotMatch(pageText, /boned/i, page.name + ": retired condition");
    assert.doesNotMatch(pageText, /chaos count/i, page.name + ": retired chaos accumulator");
  }
});

test("journal backlash row 39–40 matches runtime", () => {
  const journal = readJournal();
  const page = journal.pages.find(({ name }) => name === "Backlashes");
  const runtimeRow = BACKLASH_TABLE.find(({ sourceRange }) => sourceRange === "39-40");

  assert.ok(page, "Backlashes page is present");
  assert.ok(runtimeRow, "runtime row 39-40 is present");
  assert.match(page.text.content, /<td>39[–-]40<\/td>/);
  assert.ok(
    page.text.content.includes(runtimeRow.text),
    "journal row 39-40 must end after the runtime's one-UD clause"
  );
});
