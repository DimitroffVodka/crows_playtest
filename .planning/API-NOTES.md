# API Notes — Foundry v14

**Task:** T0.1
**Date:** 2026-08-20
**Verified against:** the v14 API mirror (`foundry-api/*`, built 2026-08-07) **and** the live world `crow-test` running **Foundry 14.367** with crows 0.1.3.

Where the mirror and the runtime were both available, both are cited. Runtime probes are marked **[live]** and are the stronger evidence — the mirror is a snapshot, the runtime is the thing we ship against.

---

## 1. Active Effect change modes — `ACTIVE_EFFECT_CHANGE_TYPES` or `ACTIVE_EFFECT_MODES`?

**Neither guard was right. The question is malformed, and both existing answers lead to a bug.**

`verify.sh` blocks `CONST.ACTIVE_EFFECT_MODES` with the message *"v14: use CONST.ACTIVE_EFFECT_CHANGE_TYPES"*. The research doc says the opposite. In v14.367, **both constants exist** — and they are not alternatives, they hold different things:

| Constant | Keys | Values | Meaning |
|---|---|---|---|
| `CONST.ACTIVE_EFFECT_CHANGE_TYPES` | lowercase — `add` | `custom:0, multiply:10, add:20, subtract:20, downgrade:30, upgrade:40, override:50` | change **types** → their default **priorities** |
| `CONST.ACTIVE_EFFECT_MODES` | UPPERCASE — `ADD` | `CUSTOM:0, MULTIPLY:1, ADD:2, DOWNGRADE:3, UPGRADE:4, OVERRIDE:5` | the legacy numeric **mode** enum |

> `ACTIVE_EFFECT_CHANGE_TYPES: Readonly<{add: 20; custom: 0; downgrade: 30; multiply: 10; override: 50; subtract: 20; upgrade: 40}>` — "Define the core ActiveEffect change types and their default **priorities**. Other arbitrary string types can be used by systems and modules."
> — `foundry-api/variables/CONST.ACTIVE_EFFECT_CHANGE_TYPES.md`

**What the change schema actually wants — [live] round-trip probe:**

```js
new ActiveEffect({ changes: [{ key:"system.x", value:"1", mode: 2      }] }).toObject().changes[0]
new ActiveEffect({ changes: [{ key:"system.x", value:"1", type:"add"   }] }).toObject().changes[0]
// BOTH normalise to:
//   { key: "system.x", value: 1, type: "add", phase: "initial" }
```

So in v14 the numeric `mode` field has been **replaced by a string `type` field**, plus a new `phase` field (`"initial"` | `"final"`, per `CONST.ACTIVE_EFFECT_CHANGE_PHASES`). Legacy `mode:` input is accepted and silently migrated.

### The rule for this codebase

```js
// CORRECT — type is a STRING
changes: [{ key: "system.speed", value: "-1", type: "add" }]

// WRONG — writes 20, because the CONST's VALUES are priorities
changes: [{ key: "system.speed", value: "-1", type: CONST.ACTIVE_EFFECT_CHANGE_TYPES.add }]

// LEGACY — works via migration, but don't author it in v14
changes: [{ key: "system.speed", value: "-1", mode: CONST.ACTIVE_EFFECT_MODES.ADD }]
```

`ACTIVE_EFFECT_CHANGE_TYPES` is useful for its **keys** (valid type strings) and for its **values** when you need a default `priority`. It is not a drop-in for `mode`.

### Action for verify.sh

The guard should stay — authoring `mode:` in new v14 code is still wrong — but **its message is misleading and will cause the exact bug it is trying to prevent.** Suggested replacement message:

```
block 'CONST\.ACTIVE_EFFECT_MODES' 'v14: effect changes use `type: "add"` (a string), not a numeric mode'
```

Consider also blocking the subtler error, which nothing currently catches:

```
block 'type:\s*CONST\.ACTIVE_EFFECT_CHANGE_TYPES\.' 'v14: use the KEY ("add"), not the value — the values are priorities'
```

> **Note:** the crows module currently contains **zero** Active Effect changes (`grep -rn 'ACTIVE_EFFECT\|\.changes\b' module/` is empty), so nothing is broken today. This matters from Wave 1 onward, when Blessed / Weakened / Vulnerable land.

---

## 2. Chat message render hook — name and signature

**`renderChatMessageHTML(message, html, context)`** — confirmed in both mirror and runtime.

> `renderChatMessageHTML(message: ChatMessage, html: HTMLElement, context?: object): void` — "A hook event that fires for each ChatMessage which is rendered for addition to the ChatLog. This hook allows for final customization of the message HTML before it is added to the log."
> — `foundry-api/functions/hookEvents.renderChatMessageHTML.md`

**[live] observations that the mirror does not tell you:**

- `html` is a native **`HTMLLIElement`** — `<li class="chat-message message flexcol">`. **Not jQuery** (`html.jquery` is `undefined`). The v13-era `html.find(...)` idiom will throw.
- `context` **is** supplied in practice (the docs say "only when the core chat message template is rendered").
- ⚠️ **The hook fires TWICE per render.** A probe that logged every invocation recorded two calls for the initial render and two more after a flag update. Any handler attached here must be **idempotent** — otherwise a "spend expertise" button ends up double-bound and fires twice on one click, which is precisely the double-spend the contract's idempotency requirement is guarding against.

`verify.sh`'s existing guard (`renderChatMessage` → `renderChatMessageHTML`) is **correct**.

---

## 3. Click handler on a button inside chat message content

Attach in the render hook, against the native element, idempotently:

```js
Hooks.on("renderChatMessageHTML", (message, html) => {
  const btn = html.querySelector('[data-action="crows-spend-expertise"]');
  if (!btn || btn.dataset.crowsBound === "1") return;   // hook fires twice — see §2
  btn.dataset.crowsBound = "1";
  btn.addEventListener("click", async (ev) => {
    ev.preventDefault();
    await applyExpertise(message, ev.currentTarget.dataset.expertise);
  });
});
```

Notes:
- **`type="button"`** on the element, or a click may submit an enclosing form.
- Gate on ownership inside the handler — the hook runs for every client that renders the message, so *every* player's browser binds a handler to the same button. The handler must check `message.speakerActor?.isOwner` (or the `actorId` in the flag) and bail otherwise. Server-side authority still matters: a non-owner's update will be rejected, but do not rely on that for UX.
- `ChatLog` does have an ApplicationV2 `DEFAULT_OPTIONS.actions` dispatch table **[live]**: `deleteMessage`, `dismissMessage`, `expandRoll`, `export`, `flush`, `jumpToBottom`, `messageMode`. Those are core's own actions and there is no supported way for a system to register into that table for message *content*, so the hook + `addEventListener` route above is the one to use.

---

## 4. Re-rendering a single chat message after updating its flags

**You do not need to do anything.** Updating the document re-renders it. **[live] probe:**

```js
await msg.update({ "flags.world.probe": 2 });
// -> renderChatMessageHTML fires again for that message (twice, per §2)
// -> the button is present in the DOM afterwards
```

So the two-phase card works by simply writing the flag; the hook re-fires and rebuilds the content from the new flag state. This is the mechanism the A1 commit point relies on, and it is confirmed.

If you ever need to force it explicitly:

- **`ui.chat.updateMessage(message, notify)`** — **[live]** present on `ChatLog`. Re-renders one message in the log.
- **`message.renderHTML()`** — **[live]** present on `ChatMessage.prototype`; returns the element if you want to render outside the log.
- DOM anchor for a message is `li.chat-message[data-message-id="<id>"]` **[live]**.
- `foundry.applications.sidebar.apps.ChatPopout` exists for rendering one message in its own frame.

**Design consequence for T1.1:** because the re-render is driven by the flag, the card must be a pure function of `message.flags.crows.test`. Do not hold render state anywhere else — a late-joining client renders from flags alone.

---

## 4b. `CONFIG.statusEffects` is proxy-backed — never REPLACE it

**[live]** Found by T2.3 while mutation-testing init; the original `registerConditions()` I wrote in T0.2 had this bug.

`CONFIG.statusEffects` looks like an ordinary array (`Array.isArray` is `true`, `constructor.name` is `"Array"`), but it carries **both** numeric entries — used by the Token HUD — and **id-keyed** entries, used by `Actor#toggleStatusEffect`. Verified on 14.367:

| probe | result |
|---|---|
| `CONFIG.statusEffects["blessed"]` | **defined** |
| a plain `.map(s => ({...s}))` copy, `copy["blessed"]` | **undefined** |
| `push()` through the live object | creates **both** forms |

```js
// WRONG — replaces the proxy. The HUD looks perfectly populated, and every
// programmatic toggle throws because CONFIG.statusEffects["blessed"] is gone.
CONFIG.statusEffects = CROWS_STATUS.map(s => ({ ...s }));

// RIGHT — mutate in place so the proxy builds both forms.
CONFIG.statusEffects.length = 0;
CONFIG.statusEffects.push(...CROWS_STATUS.map(s => ({ ...s })));
```

The failure mode is the reason this is worth a section: **the HUD renders correctly**, so a visual check passes. Only the programmatic path breaks — which is the path `setCondition` and the condition mirror both use, so conditions would appear toggleable and silently fail to drive `system.conditions`.

Slightly better than this project's usual failure shape in that it *throws* rather than returning a wrong answer, but it throws in a code path nobody exercises by clicking around.

---

## 5. `DocumentSheetConfig.registerSheet` namespace

**[live]** `DocumentSheetConfig.registerSheet` is a function reachable at **both**:

- `foundry.applications.apps.DocumentSheetConfig.registerSheet` — the namespaced v14 path
- `globalThis.DocumentSheetConfig` — still present as a bare global

> Listed under `foundry.applications.apps` — `foundry-api/classes/foundry.applications.apps.DocumentSheetConfig.md`, and in the namespace index `foundry-api/modules/foundry.applications.apps.md`.

**Use the namespaced path.** The bare global is the v13-era access route; it works in 14.367 but is the kind of thing that disappears in v16. Registration belongs in the `init` hook (`foundry-api/functions/hookEvents.init.md`: "Most package registration calls should go in here").

---

## T0.1 decision 2 — packs/ git churn

**Chosen: `.gitattributes`, not gitignore.** The brief recommended gitignoring the built LevelDB with "packs built at release" — **that option is not currently available.**

- There is **no `.github/workflows/`** in this repo. Releases are assembled by hand.
- `system.json` points `download` at a GitHub release zip, and `.gitignore` already records the deliberate choice: *"/packs/ (built LevelDB) IS committed so the system installs and runs without a build step."*

Gitignoring `packs/` with no CI to rebuild them means the first forgotten `npm run pack` ships a release with **no compendiums at all**, and a direct clone has none either. That trades a cosmetic annoyance for a silent, total content failure.

So `.gitattributes` marks them binary with `-diff -merge`. This stops git attempting textual 3-way merges on `.ldb` sstables — a merge of two sstables yields a corrupt database, not a resolvable conflict.

**Honest limitation:** this does **not** stop the churn. Foundry rewrites `CURRENT` and rotates `MANIFEST-*` on every world launch, so those still appear modified. `git status` will not be clean after a launch, and **the T0.1 acceptance criterion "git status clean after a Foundry launch" is therefore not met as written.**

**Recommended real fix** (out of T0.1's scope, needs a decision): add a release workflow that runs `npm run pack` and uploads `crows.zip` + `system.json`, then gitignore `packs/`. That satisfies both goals and removes a manual release step that can silently ship an empty system.

---

## Summary for Wave 1

| Question | Answer | Confidence |
|---|---|---|
| Effect change modes | `type: "add"` (string) + `phase`; `mode:` is legacy, auto-migrated | **[live] + mirror** |
| `ACTIVE_EFFECT_CHANGE_TYPES` values | priorities, **not** mode numbers — never assign to `type` | **[live] + mirror** |
| Chat render hook | `renderChatMessageHTML(message, html, context)`, `html` is a native `HTMLLIElement` | **[live] + mirror** |
| Hook fires once? | **No — twice per render.** Bind idempotently | **[live]** |
| Button handler | `html.querySelector` + `addEventListener` in the hook, guard with a bound-marker, gate on ownership | **[live]** |
| Re-render after flag update | Automatic. `ui.chat.updateMessage()` if forcing | **[live]** |
| `registerSheet` | `foundry.applications.apps.DocumentSheetConfig.registerSheet`, in `init` | **[live] + mirror** |
| packs/ churn | `.gitattributes` binary; gitignore blocked on there being no CI | decision |
