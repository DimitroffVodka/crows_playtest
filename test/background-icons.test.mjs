import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

const BACKGROUNDS = "src/packs/crows-backgrounds";
const ICONS = "icons/backgrounds";

const load = () => readdirSync(BACKGROUNDS)
  .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
  .map((f) => ({ file: f, doc: yaml.load(readFileSync(join(BACKGROUNDS, f), "utf8")) }));

/**
 * Backgrounds ship vendored game-icons.net SVGs rather than pointing at
 * Foundry's bundled library like every other pack.
 *
 * That buys two obligations a test can actually hold us to: the files must be
 * IN the release payload, and the CC BY 3.0 attribution must cover every icon
 * that ships. Both are silent failures otherwise — a missing payload entry
 * gives every player a broken image, and a missing credit is a licence breach
 * that nothing else would ever surface.
 */
describe("background icons", () => {
  test("all 36 backgrounds declare an icon", () => {
    const all = load();
    assert.equal(all.length, 36);
    const without = all.filter(({ doc }) => !doc.img).map(({ file }) => file);
    assert.deepEqual(without, [], "every background needs an img");
  });

  test("every declared icon file actually exists", () => {
    const broken = [];
    for (const { doc } of load()) {
      const rel = String(doc.img).replace(/^systems\/crows\//, "");
      if (!existsSync(rel)) broken.push(`${doc.name}: ${doc.img}`);
    }
    assert.deepEqual(broken, []);
  });

  test("icons are system-relative paths, not bare or absolute", () => {
    // A bare `icons/...` path resolves against Foundry's OWN library, silently
    // showing the wrong art or nothing at all.
    for (const { doc } of load()) {
      assert.match(doc.img, /^systems\/crows\/icons\/backgrounds\/[a-z0-9-]+\.svg$/,
        `${doc.name}: ${doc.img}`);
    }
  });

  test("each background has a DISTINCT icon", () => {
    const seen = new Map();
    for (const { doc } of load()) {
      assert.ok(!seen.has(doc.img), `${doc.name} reuses ${seen.get(doc.img)}'s icon`);
      seen.set(doc.img, doc.name);
    }
    assert.equal(seen.size, 36);
  });

  test("no vendored icon is left unused", () => {
    const used = new Set(load().map(({ doc }) => doc.img.split("/").pop()));
    const onDisk = readdirSync(ICONS).filter((f) => f.endsWith(".svg"));
    assert.deepEqual(onDisk.filter((f) => !used.has(f)), [], "dead files in icons/backgrounds");
    assert.equal(onDisk.length, 36);
  });

  test("every shipped icon is credited in NOTICE.md — CC BY 3.0 requires it", () => {
    const notice = readFileSync("NOTICE.md", "utf8");
    const uncredited = readdirSync(ICONS)
      .filter((f) => f.endsWith(".svg"))
      .filter((f) => !notice.includes(f));
    assert.deepEqual(uncredited, [], "attribution missing");
    assert.match(notice, /CC BY 3\.0|Attribution 3\.0/, "the licence must be named");
  });

  test("the release payload ships icons/ and NOTICE.md", () => {
    // Without these, a released system shows a broken image for every
    // background and redistributes CC BY art with no credit.
    const release = readFileSync("release.sh", "utf8");
    const line = release.match(/^PAYLOAD=\((.*)\)$/m);
    assert.ok(line, "PAYLOAD not found in release.sh");
    const entries = line[1].split(/\s+/);
    assert.ok(entries.includes("icons"), "icons/ missing from the release payload");
    assert.ok(entries.includes("NOTICE.md"), "NOTICE.md missing from the release payload");
  });

  test("the glyph CSS composites — it must NOT force colour with a filter", () => {
    // game-icons files are a white silhouette on an OPAQUE BLACK rect. A
    // `brightness(0) invert(1)` whitens that rect too and renders a solid white
    // diamond, which is what shipped first. `mix-blend-mode: screen` drops the
    // black ground against the black header and leaves the silhouette, so the
    // SVGs need no modification.
    const css = readFileSync("css/crows.css", "utf8");
    const rule = css.slice(css.indexOf(".crows-item.background .bg-glyph img"));
    const body = rule.slice(0, rule.indexOf("}"));
    assert.match(body, /mix-blend-mode:\s*screen/, "glyph must composite with screen");
    assert.ok(!/filter:\s*brightness\(0\)\s*invert\(1\)/.test(body),
      "the brightness/invert filter turns every icon into a white block");
  });

  test("icons are shipped exactly as published — NOTICE must not claim otherwise", () => {
    // CC BY only requires indicating changes if there ARE changes. Keeping the
    // files pristine keeps that claim true, and the CSS makes it possible.
    const withGround = readdirSync(ICONS)
      .filter((f) => f.endsWith(".svg"))
      .filter((f) => /<path d="M0 0h512v512H0z"/.test(readFileSync(join(ICONS, f), "utf8")));
    assert.equal(withGround.length, 36, "all 36 should still carry their original ground rect");
    const notice = readFileSync("NOTICE.md", "utf8");
    assert.match(notice, /Unmodified/i);
  });

  test("the SVGs are real and unmodified-looking", () => {
    for (const f of readdirSync(ICONS).filter((x) => x.endsWith(".svg"))) {
      const svg = readFileSync(join(ICONS, f), "utf8");
      assert.match(svg, /^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, `${f} is not an SVG`);
      assert.ok(svg.length > 200 && svg.length < 60_000, `${f} suspicious size ${svg.length}`);
      assert.ok(!/<script/i.test(svg), `${f} contains a script tag`);
    }
  });
});
