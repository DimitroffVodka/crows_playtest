# Village map demo

Two static pages that run the system's village code in the browser.
**[Live demo →](https://dimitroffvodka.github.io/crows_playtest/)**

![Balhaunis at Prosperity −6, +2 and +10 — the same roads and plots, filling in](preview.png)

## `index.html` — Balhaunis

The village the system actually ships. The map is authored: roads, ground, and
the position, size and facing of every plot are frozen in
[`canonical-village-layout.mjs`](../module/helpers/canonical-village-layout.mjs)
— 12 institution slots, 69 homes, 22 fields, 77 pieces of dressing.

What varies is only how much of it is standing, and
[`buildVillageProjection()`](../module/helpers/village-map.mjs) decides that:

- **Institutions** — a founded one gets its authored art, an unfounded one gets
  `unbuilt-plot.svg` on the plot being held for it. The slot never moves.
- **Homes, fields, dressing** — an ordered prefix of each list, sized by
  Prosperity via `canonicalPrefixCount`. Prefixes rather than a random draw, so
  a village that loses Prosperity and regains it gets the identical village back.

The page calls that function for every frame; the controls only build the record
it takes.

## `planner/` — the procedural layout engine

A separate, older thing: [`village-plan.mjs`](../module/helpers/village-plan.mjs)
generates a settlement from a seed — boundary, streets, plots, then institutions
scored onto the ground each one wants. It is **not** what a Crows village uses.
It is still in the repository and still worth looking at, so it has its own page.

## Why tiles are `<image>` references

Each canonical asset carries what it needs on its own root `<svg>` element: the
background declares `viewBox="0 0 500 500"` against a 6000-unit map, and every
housing file sets `fill="none"` and `preserveAspectRatio="none"` there. Lifting
the body out of the file and inlining it drops exactly those attributes — the
background lands in the corner at 1/12 scale and every house fills solid black.
Referencing the file is also what Foundry does: a Tile is a texture, not a copy.

The cost is that the page pulls ~180 small files, and a self-contained SVG export
is not free. **Download PNG** rasterizes instead, inlining each asset as a data
URI into a detached copy of the map first so the canvas is never tainted.

## Running it locally

No build step and no dependencies. Serve the **repository root** — not `demo/` —
because the pages import `../module/…` and reference `../assets/…`:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/demo/>.

Opening `index.html` from the filesystem will not work: ES module imports and the
asset fetches are both blocked under `file://`.

## Deployment

[`.github/workflows/demo.yml`](../.github/workflows/demo.yml) assembles a `_site`
mirroring the repository layout, so the relative paths resolve identically in CI
and locally. Before publishing it checks that the modules still load outside
Foundry, and that every asset path the projection names is actually in the
artifact — a missing file otherwise shows up as a silent gap in the map.

Pages must be enabled once, in **Settings → Pages → Build and deployment →
Source: GitHub Actions**.

## Regenerating `preview.png`

Three screenshots of this page's map at Prosperity −6, +2 and +10 with the
starting six founded, cropped to the map and appended side by side.
