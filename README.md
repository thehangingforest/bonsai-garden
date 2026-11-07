# Bonsai Garden — local Hermes Desktop page

Work by thehangingforest, prepared for the Hermes plugin hackathon (public deposit). The artwork is hangingforest's approved GIMP composition of **BONSAI GARDEN 3**, packed by `scripts/prepare_art3.py`; the twelve tree sprites are unchanged from v1, asserted at the pixel. Nothing is installed by the tests.

## Source and packaging

- `src/plugin.mjs`: native single-file ESM SDK page. Default plugin id `bonsai-garden`.
- Route `/bonsai-garden`, sidebar **Garden**, palette **Open Bonsai Garden**.
- `assets/scene.json`: parent-supplied 1340×650 art manifest, embedded PNG data URIs, twelve tree ids, monk, cat, four stands, HUD rectangles and the season readout, plus the provenance of the XCF it was measured from.
- `scripts/prepare_art3.py`: packs Axel's exported v3 XCF into `assets/` — background, trees, stands, HUD anchors, season strip — deriving every number from the exported layers and asserting it against `xcf3-delivery.json` (the geometry measured inside the XCF), so a silent drift fails the build instead of shipping a misaligned garden. Tree sprites are asserted pixel-for-pixel against the frozen v1 assets, so a redrawn tree fails the pack rather than shipping quietly. The v3 XCF also hides *and* moves the drawn shelf (`ETAGERE` parked 19 px left / 35 px up), so the pack re-anchors that layer to its v1/v2 position — with the edit listed in the scene provenance — and asserts every opaque plank pixel against the frozen v2 room, so the trees never stand on thin air.
- Parent packaging replaces the single art placeholder in `src/plugin.mjs` with the JSON object and writes `desktop/plugin.js`. The source template itself is not an installed plugin.
- Deploying on this machine is a separate, explicit step: copy `desktop/plugin.js` (and `plugin.yaml`) into `~/.hermes/desktop-plugins/bonsai-garden/`, compare the `sha256sum` of both copies, then let the running Desktop app hot-reload the file (fallback: palette action *Reload desktop plugins*). Building alone changes nothing on screen — the background lives base64 inside `scene.json` and `plugin.js`.
- `hermes plugins validate .` must pass (`Validation passed.` — manifest, loadable entry, security scan, desktop surface); the v3.1 log is `SESSIONS/2026-11-07/validate-0.5.1.log`.
- Imports are restricted to `@hermes/plugin-sdk`, `react`, and `react/jsx-runtime`. No Python backend, additional npm dependencies, core patches, or configuration changes.

## What is real

The page subscribes through SDK `useValue` to `host.state.busy`, `focusedSessionProfile`, `focusedSessionId`, and `focusedUsage`. The gateway socket is not treated as work. System time/date use `Date.now()` and the local timezone. Cost uses only finite nonnegative `focusedUsage.cost_usd`; absent, null or invalid data is **Unavailable**, never a fabricated zero. A reported real zero is displayed as such. Tokens use the host's reported total.

Agent routines are read on demand from each profile's own gateway cron store through `host.profileRoutes()` and `host.requestProfile(route, 'cron.manage', { action: 'list', include_disabled: true, profile })` — the same scoped contract the desktop bot plugins use. Only recurring agent work qualifies: script-only watchers (`no_agent`), one-shots (`once …`) and completed jobs never appear. Suspended routines stay visible as suspended; every routine shows its real schedule and, when one exists, its real next run. Failed routes and mismatched `scoped` replies are counted as **incomplete**, never attributed to a profile; before a reply the summary stays **Unavailable**. Without profile routing, no routine claims are made.

One bonsai per agent. The roster is the same set of scoped profile routes used for routines; each agent is projected onto a distinct sheet sprite by a stable hash with linear probing, so no two agents share a sprite and no decorative filler tree is drawn. Every sprite keeps its manifest id, image, dimensions and keyed React node, and sits in its own measured slot of the layout grid. Only the focused busy agent's tree moves — to `stands[0]`, centred and resting on it — and returns to its exact manifest home coordinates; the other trees stay put.

The slot grid was measured on the shipped artwork, not assumed: on the v1/v2 art the drawn shelf has four columns by three planks (vertical dividers at x = 58, 120, 189, 259, 324; plank lines at y = 367, 456, 545), i.e. twelve compartments for nine agents, so three compartments stay empty. Those measured homes are kept unchanged in v3, so the tree layout is the same grid. The exported **BONSAI GARDEN 3** document drops that shelf twice over: the `ETAGERE` layer is masked *and* parked at (-22, 7) — 19 px left and 35 px up of where v1/v2 drew it — while the homes and every tree sprite never moved. `prepare_art3.py` therefore puts the line work back on the v1/v2 anchor (the edit is listed in the scene provenance) and asserts every opaque plank pixel of that layer against the frozen v2 room (the shelf band y 300–320 × x 30–300 comes out pixel-identical to v2 — the 5 158 dominant fond pixels plus the drawn line work — where the v3-as-exported art showed one flat (102, 0, 0) fill across all 5 400 px), so a re-export either lands on the drawn shelf or fails the build. Measured on the shipped background: the eleven grid trees sit on a plank (58–60 % near-black along their base line) exactly as in v2, where the v3-as-exported art showed 0 % — they were floating on the fond. The cascade bunjingi sits outside the grid: its manifest home is the fourth stand (x = 752, y = 575), the drawn stand it belongs to, and it returns there like any other tree. Of the eleven sprites on the grid, ten land exactly on a plank line; yose-ue's measured cell ends one pixel lower (546 against 545) — as exported, not nudged. No two home rectangles intersect.

The monk travels horizontally at at most three source pixels per second within ±30 source pixels, advancing from elapsed monotonic busy time; idle time does not advance it. The cat spawns at a random position at the start of each session and can be dragged; it carries no action. In v3 the monk is repainted and the cat's home is nudged, at the pixel level measured from the XCF.

Task text is the actual `session.info.title`, not a summary inferred from messages. `session.info` is read-only, verified against the local SDK and canonical gateway source. The request is made only when focused-session ownership matches the active connection/profile, fenced before/after by the gateway activation epoch. Cross-owner tiles, missing titles and offline gateways use a clear fallback. No conversation transcript is requested. Metadata is refreshed on focus or busy transitions via the host's React Query integration, not by a fake timer.

Older SDKs without focused atoms show a primary-session fallback; usage/title stay unavailable where unsupported. SDKs without profile routing show no routine section and keep **Crons unavailable** in the footer. Missing epoch support disables title RPC rather than risking a cross-connection result. The checked local Desktop dist contains focused atoms and epoch exports, but native rendering is left to the parent to verify.

## Gestures

Each agent row carries an **open** gesture (`data-gesture="open"`, label *Conversation*): the agent name is resolved to a profile route, matching either `profile` or `targetProfile` so a bare `cloe` still finds `cloe@box`; the most recent stored session is resumed in place when one exists (`in-place` / `awaitHydration` / `forceResume`), otherwise a new chat draft is opened on that route. A **Stop** gesture (`data-gesture="interrupt"`) appears only while the agent is busy and calls `session.interrupt` with the runtime session id taken from `session.active_list`; it disappears after a successful stop. Refusals are reported honestly as `not-busy`, `not-interrupted`, `no-route`, `unsupported` or `failed` — never as a silent success.

## Rendering

All art positions use manifest coordinates as percentages inside a responsive, aspect-ratio-preserving stage capped at 1340 px. Images use `image-rendering: pixelated` (no smoothing). Small containers reduce the whole scene without moving entities independently. HUD readouts are sized against the frame they sit in: the widest unbreakable token of a readout (`Unavailable`) is asserted to fit the drawn frame's usable width, so a value never breaks mid-word — a longer phrase wraps between words instead. Cream HUD text comes from the approved artwork palette, not the shell theme; shell text/background use real Desktop theme variables. Only the page's own elements are rendered—no body observers or global DOM injection. Scoped timers dispose on page unmount and plugin unload.

## Tests

Run on this machine:

```sh
node --test tests/plugin.test.mjs
```

The test-only source transform injects fixture art or the actual `assets/scene.json`, and maps only the SDK boundary to a small stub. Tests execute the real source exports and actual React/ReactDOM/React Query using the existing Hermes installation's dependencies; no install is needed. Node module hooks require a modern Node release (`registerHooks`; verified on v26.8.1). JSDOM checks render structure, not browser pixel output.

Tests cover registration/navigation, the one-bonsai-per-agent roster projection (distinct sprites per agent, focused profile always placed, home rectangles inside the frame and non-overlapping), exact tree identity/home return, busy/idle transitions, null/invalid usage, real clock/date formatting, elapsed-time horizontal monk bounds, the cat's random spawn and clamped drag, both gestures (route resolution including `targetProfile`, resume-versus-new-chat, Stop only while busy, honest refusal codes), verified/read-only/stale-fenced titles, old-SDK fallback, live scoped routine collection (per-profile routes, failure and `scoped`-mismatch handling, script/one-shot/completed exclusion, suspended split) and its per-agent rendering, mounted reactive host updates and timer cleanup — twenty-one tests in all. The last one re-derives `desktop/plugin.js` from `src/plugin.mjs` plus `assets/scene.json` and compares the shipped file byte for byte, so a stale build fails the suite instead of shipping. Red/green evidence and the report live under `/home/papa/Bureau/SESSIONS/2026-11-06/`.

## Attribution and boundaries

Garden art/design: Axel / thehangingforest. Upstream inspiration and attribution retained: **office-3d**, Copyright (c) 2026 office-3d contributors, MIT License. This page is a separate SDK implementation, not a claim of authorship of office-3d. Both notices are kept in `LICENSE`; preserve them in any derived package. The source XCF stays outside this package (`/home/papa/Bureau/BONSAI GARDEN 3.xcf`, sha256 `8c854dbd…` verified against `assets/scene.json`).

Routines read only each profile's own scoped cron store, on demand, through the public SDK; no CLI-global state, all-profile monitoring backend, season/weather service, inferred dollars or activity demo timers are included. Installed plugins and Hermes core remain untouched.
