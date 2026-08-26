import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SOURCE_LINES = readFileSync("docs/source/C-characters-book.md", "utf8").split(/\r?\n/);
const CITATION = /\b(C):(\d+)(?:[-–](\d+))?/g;

function filesUnder(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    return statSync(path).isFile() ? [path] : [];
  });
}

/*
 * This guard proves that a cited address exists in the pinned source. It does
 * not prove that the cited line supports the claim attached to it.
 */
test("every C citation in module and test is addressable", () => {
  let count = 0;
  for (const file of ["module", "test"].flatMap(filesUnder)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(CITATION)) {
      const [, prefix, startText, endText] = match;
      const start = Number(startText);
      const end = Number(endText ?? startText);
      assert.equal(prefix, "C", `${file}: citation prefix`);
      assert.ok(Number.isInteger(start) && start > 0, `${file}: invalid citation start`);
      assert.ok(Number.isInteger(end) && end > 0, `${file}: invalid citation end`);
      assert.ok(start <= end, `${file}: citation range runs backwards`);
      assert.ok(end <= SOURCE_LINES.length,
        `${file}: C:${startText}${endText ? `-${endText}` : ""} exceeds source length ${SOURCE_LINES.length}`);
      count += 1;
    }
  }
  assert.ok(count > 0, "the addressability guard must inspect at least one C citation");
});
