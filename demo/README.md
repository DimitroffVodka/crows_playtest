# Village generator demo

A single static page that runs the system's village generator in the browser.
**[Live demo →](https://dimitroffvodka.github.io/crows_playtest/)**

![A ruin village and an open village generated from the same seed](preview.png)

## What it is

Not a port and not a copy. The page imports the shipped modules straight from
`module/helpers/` and calls the same functions Foundry does:

| | |
| --- | --- |
| `village-plan.mjs` | `buildVillagePlan()` — boundary, streets, plots, assignment, dressing |
| `village-plan-draw.mjs` | `renderPlanToSvg()` — the plan as an SVG string |
| `village-map.mjs` | `stampFootprints()` — where each building stands |
| `village-stamp-art.mjs` | the authored institution and housing art |

The planner already reads no globals and touches no Scene, which is what makes
this possible at all. Only two things are demo-specific, both in
[`render.mjs`](render.mjs): rewriting Foundry's `systems/crows/…` asset route to
a path the page can fetch, and compositing the buildings into the same SVG —
in Foundry each one is a Tile standing on the rendered ground, and there are no
Tiles here.

## Running it locally

No build step and no dependencies. Serve the **repository root** — not `demo/` —
because the page imports `../module/…`:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/demo/>.

Opening `index.html` from the filesystem will not work: ES module imports and
the art fetches are both blocked under `file://`.

## Deployment

[`.github/workflows/demo.yml`](../.github/workflows/demo.yml) assembles a
`_site` that mirrors the repository layout, so the relative imports resolve
identically in CI and locally, and publishes it to GitHub Pages on every push to
`master` that touches `demo/`, `module/`, or the institution and rural art.

Pages must be enabled once, in **Settings → Pages → Build and deployment →
Source: GitHub Actions**.

## Regenerating `preview.png`

The image above is two renders of seed `balhaunis-32` — the page's default — one
per form, taken from the demo itself. Use the browser's **Download SVG** button
on each form and rasterize, or re-render from Node with the same calls
`render.mjs` makes.
