# Bonsai Garden — local Hermes Desktop page

Work by thehangingforest for the Hermes plugin hackathon. Artwork: the artist's approved GIMP
composition of **BONSAI GARDEN 3**; the twelve tree sprites are unchanged from v1, asserted at the
pixel. The tests install nothing.

## Files

- `src/plugin.mjs` — single-file ESM SDK page. Plugin id `bonsai-garden`, route `/bonsai-garden`,
  sidebar **Garden**, palette **Open Bonsai Garden**.
- `assets/scene.json` — 1340×650 manifest: embedded PNG data URIs, twelve tree ids, monk, cat, four
  stands, the four HUD anchors (time, date, crons, cost) plus the painted season strip, XCF
  provenance.
- `assets/care-tips.json` — twelve English care lines, keyed `01`..`12` (one per month, 40–60 chars).
  `assets/avatars.json` — nine inline pixel portraits, one per profile. Both ship with the art.
- `scripts/prepare_art3.py` — packs the exported XCF, deriving every number from its layers and
  asserting it against the geometry measured inside the XCF; tree sprites are asserted
  pixel-for-pixel against the frozen v1 assets. The export hides *and* moves the drawn shelf, so the
  pack re-anchors that layer to its v1/v2 position and asserts every opaque plank pixel against the
  frozen v2 room.
- `scripts/build_plugin.py` — replaces the art placeholder in `src/plugin.mjs` with the JSON object
  (art + tips + avatars) and writes `desktop/plugin.js`.
- `hermes plugins validate .` must pass (`Validation passed.`). Imports are limited to
  `@hermes/plugin-sdk`, `react` and `react/jsx-runtime`: no Python backend, no extra npm
  dependencies, no core patches.

## Deploy (a separate, explicit step)

Copy `desktop/plugin.js` and `plugin.yaml` into `~/.hermes/desktop-plugins/bonsai-garden/`, compare
the `sha256sum` of both copies, then let the running Desktop hot-reload (fallback: palette action
*Reload desktop plugins*). Building alone changes nothing on screen — the background lives base64
inside `scene.json` and `plugin.js`.

## What is real

Subscriptions go through SDK `useValue` on `host.state.busy`, `focusedSessionProfile`,
`focusedSessionId` and `focusedUsage`; the gateway socket is not work; clock and date use `Date.now()`
and the local timezone. Cost uses only a finite nonnegative `focusedUsage.cost_usd`: absent, null or
invalid means **Unavailable**, never a fabricated zero, and a reported zero shows as zero. Tokens
without dollars (local models, older gateways) give an *approximate* line at one documented blended
rate, `APPROX_USD_PER_MTOKEN = 0.15`, marked with a tilde (`~$0.3000`); a reported cost always wins.

Routines are read on demand from each profile's own gateway cron store (`host.profileRoutes()` plus
`host.requestProfile(route, 'cron.manage', …)`), the same scoped contract the desktop bot plugins
use. Only recurring agent work qualifies: script-only watchers, one-shots and finished jobs never
appear; suspended routines stay visible as suspended, with their real schedule and next run. Failed
routes and mismatched `scoped` replies count as **incomplete**, never charged to a profile; without
profile routing the garden claims nothing and keeps **Crons unavailable**.

One bonsai per agent, from those routes plus the focused agent itself when the route list does not
carry it yet. A stable hash with linear probing gives each agent a distinct sheet sprite — no shared
sprite, no filler tree. Homes are the measured grid: four columns by three planks (dividers at x = 58,
120, 189, 259, 324; plank lines at y = 367, 456, 545), twelve compartments for nine agents; the
cascade bunjingi sits on the fourth stand (x = 752, y = 575). Only the focused busy agent's tree
moves, to `stands[0]`, and returns to its exact home. The monk is never frozen: it drifts ±30 px
around its home on a triangle wave from accumulated monotonic time, 2 px/s at rest and 8 px/s while
busy, so the pace never depends on the tick rate. The cat spawns at random, can be dragged, and
carries no action.

Task text is the actual `session.info.title` (read-only), requested only when focused-session
ownership matches the active connection/profile and fenced by the gateway activation epoch;
cross-owner tiles, missing titles and offline gateways fall back clearly. No transcript is requested,
and metadata refreshes on focus or busy transitions through the host's React Query integration, not a
fake timer. Older SDKs without focused atoms get a primary-session fallback, with usage and title
unavailable where unsupported; native rendering of those paths is left to the parent to verify.

## Gestures

- Every drawn bonsai has a **click-to-open** hit area (`data-tree-hit`) over its canopy: a click
  resolves the agent to a profile route like the roster row and opens the conversation.
- A black **name cartouche** under each pot (`data-tree-name`, avatar included, `pointer-events: none`)
  signs the agent: `agentLabel` prefers the label the route ships, otherwise capitalises the profile,
  so a raw slug never reaches the visitor.
- **Conversation** on each row (`data-gesture="open"`): the name resolves to a route matching
  `profile` or `targetProfile`, the most recent stored session resumes in place when one exists,
  otherwise a new chat draft opens on that route.
- **Stop** (`data-gesture="interrupt"`) appears only while that agent is busy, calls
  `session.interrupt` with the runtime session id from `session.active_list`, and disappears after a
  successful stop; refusals are reported as `not-busy`, `not-interrupted`, `no-route`, `unsupported`
  or `failed`, never as a silent success.

## Rendering, tools and season

Art positions are manifest coordinates used as percentages inside a responsive,
aspect-ratio-preserving stage capped at 1340 px, with `image-rendering: pixelated`. No readout breaks
mid-word: the widest unbreakable token (`Unavailable`) is asserted to fit the drawn frame's usable
width.

The four readouts are **movable objects**, not painted labels: black plaques with agave-white type,
placed from their measured `hud` anchor, clamped inside the drawn frame (`placeTool`), and keeping
that anchor's width and height so the black covers the painted rectangle instead of shrinking onto
its own text — only the position moves. Stacking order is fixed (`time` < `date` < `crons` <
`cost`); the dragged plaque comes forward only under the finger, moves nothing else, and falls back
into rank on release. Cream HUD text comes from the artwork palette; shell text and background use
real Desktop theme variables.

Season and month come from the local clock, in English and without locale guessing:
`seasonOf`/`seasonLine` return `Autumn · November` (winter December–February, spring March–May,
summer June–August, autumn September–November). One care line per month is read from the shipped
`assets/care-tips.json` (`careTip(art, now)`) and appended to the footer strip; a blank or missing
line adds nothing. Only the page's own elements are rendered — no body observers, no global DOM
injection — and scoped timers dispose on unmount.

## Tests

```sh
node --test tests/plugin.test.mjs
```

A test-only transform injects fixture art or the real `assets/scene.json` and maps only the SDK
boundary to a small stub, so the real source exports and the existing Hermes React/ReactDOM/React
Query are exercised without installing anything. Node module hooks need a modern Node release
(`registerHooks`; verified on v26.8.1). JSDOM checks render structure, not browser pixels.

**Twenty-five tests**: registration and navigation; the one-bonsai-per-agent roster (distinct sprites,
focused profile always placed, homes inside the frame and non-overlapping); tree identity and exact
home return; busy/idle; null or invalid usage; clock and date formatting; the monk's walk; the cat's
spawn and clamped drag; both row gestures and their refusal codes; verified, read-only, stale-fenced
titles; the old-SDK fallback; live scoped routine collection and its rendering; the movable plaques
and their mounted drag; the English season line; the approximate cost line; the agent signature; the
monthly tip from the shipped art; reactive host updates with timer cleanup. The last test re-derives
`desktop/plugin.js` from `src/plugin.mjs` and the three art files (code textually, so a stale build
fails the suite; art structurally).

Interaction notes: `docs/GESTES.md`. Build and deploy recipes, red/green evidence and measured art
numbers: `/home/papa/Bureau/SESSIONS/`.

## Attribution, sources and boundaries

Garden art and design: thehangingforest. Upstream attribution retained: **office-3d**, Copyright (c)
2026 office-3d contributors, MIT License — this page is a separate SDK implementation, not a claim of
authorship of office-3d. Both notices live in `LICENSE`; keep them in any derived package. The
background is packed by `scripts/prepare_art31.py` from the artist's `BONSAI GARDEN 31.xcf` (sha256
`bad9db9f…`, edits recorded in the scene provenance: the four painted black pavers removed, the tool
frames now opaque DOM plaques); the earlier v3 XCF (`8c854dbd…`) remains the source of the tree and
stand geometry, asserted pixel-for-pixel. The source XCFs stay outside this package.

Routines read only each profile's own scoped cron store, on demand, through the public SDK: no
CLI-global state, no all-profile monitoring backend, no season or weather service, no inferred
dollars, no activity demo timers. Installed plugins and Hermes core stay untouched.
