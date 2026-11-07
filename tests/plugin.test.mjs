import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks, createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire('/home/papa/.hermes/hermes-agent/apps/desktop/package.json');
const pluginURL = new URL('../src/plugin.mjs', import.meta.url);
const stubURL = new URL('./sdk-stub.mjs', import.meta.url);
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
export const art = {
  width: 1340, height: 650, background: pixel,
  trees: [
    { id: 'elm', x: 80, y: 150, width: 60, height: 90, src: `${pixel}elm` },
    { id: 'pine', x: 200, y: 170, width: 70, height: 100, src: `${pixel}pine` }
  ],
  monk: { x: 650, y: 430, width: 50, height: 80, src: `${pixel}monk` },
  cat: { x: 490, y: 460, width: 35, height: 30, src: `${pixel}cat` },
  stands: [{ x: 730, y: 480, width: 90, height: 50 }],
  hud: { time: { x: 30, y: 30, width: 150, height: 40 }, date: { x: 200, y: 30, width: 210, height: 40 },
    crons: { x: 430, y: 30, width: 190, height: 40 }, cost: { x: 650, y: 30, width: 180, height: 40 },
    season: { x: 860, y: 30, width: 170, height: 40 } }
};
const actualArt = {
  ...JSON.parse(await readFile(new URL('../assets/scene.json', import.meta.url), 'utf8')),
  // what ships is the scene plus the monthly tips and the agent avatars
  tips: JSON.parse(await readFile(new URL('../assets/care-tips.json', import.meta.url), 'utf8')),
  avatars: JSON.parse(await readFile(new URL('../assets/avatars.json', import.meta.url), 'utf8'))
};
const reactURLs = new Map(['react', 'react/jsx-runtime'].map(name => [name, pathToFileURL(require.resolve(name)).href]));
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@hermes/plugin-sdk') return { url: stubURL.href, shortCircuit: true };
    if (['react', 'react/jsx-runtime'].includes(specifier)) {
      return { url: reactURLs.get(specifier), shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url.startsWith(pluginURL.href)) return { ...result, source: String(result.source).replace('__BONSAI_ART__', JSON.stringify(url.includes('?actual-art') ? actualArt : art)) };
    return result;
  }
});
const sdk = await import(stubURL.href);
let modulePromise;
async function plugin() { return modulePromise ??= import(pluginURL.href); }

test('source exists with one art injection point and only allowed imports', async () => {
  let source = '';
  try { source = await readFile(pluginURL, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  assert.ok(source.includes('const ART = __BONSAI_ART__;'), 'native plugin source is missing');
  assert.equal(source.split('__BONSAI_ART__').length - 1, 1);
  const imports = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map(match => match[1]);
  assert.ok(imports.length > 0);
  assert.ok(imports.every(name => ['@hermes/plugin-sdk', 'react', 'react/jsx-runtime'].includes(name)));
  assert.doesNotMatch(source, /\beval\s*\(|\bnew\s+Function\b|MutationObserver|document\.body|\bimport\s*\(/);
});

test('default plugin registers a real route, Garden nav and working command', async () => {
  const { default: entry } = await plugin();
  assert.equal(entry.id, 'bonsai-garden');
  const ctx = sdk.context();
  entry.register(ctx);
  const route = ctx.contributions.find(item => item.area === sdk.ROUTES_AREA);
  assert.equal(route?.data.path, '/bonsai-garden');
  assert.equal(typeof route.render, 'function');
  const nav = ctx.contributions.find(item => item.area === sdk.SIDEBAR_NAV_AREA);
  assert.deepEqual(nav?.data, { path: '/bonsai-garden', label: 'Garden', codicon: 'symbol-color' });
  const command = ctx.contributions.find(item => item.area === sdk.PALETTE_AREA);
  assert.equal(command?.data.label, 'Open Bonsai Garden');
  command.data.run();
  assert.equal(sdk.host.navigated, '/bonsai-garden');
  assert.equal(new Set(ctx.contributions.map(item => item.id)).size, ctx.contributions.length);
});

test('profile tree keeps its identity, sprite and home through busy and idle transitions', async () => {
  const mod = await plugin();
  assert.equal(typeof mod.layoutTrees, 'function', 'tree layout is not implemented');
  const before = structuredClone(art);
  const agents = [{ connectionId: 'local', profile: 'cloe', label: 'Cloe' }];
  const idle = mod.layoutTrees(art, { profile: 'cloe', busy: false, agents });
  assert.equal(idle.length, 1, 'the shelf holds one bonsai per agent');
  const active = idle.find(tree => tree.assigned);
  assert.ok(active);
  const busy = mod.layoutTrees(art, { profile: 'cloe', busy: true, agents });
  const moved = busy.find(tree => tree.assigned);
  assert.equal(moved.id, active.id);
  assert.equal(moved.src, active.src);
  assert.equal(moved.x + moved.width / 2, art.stands[0].x + art.stands[0].width / 2);
  assert.equal(moved.y + moved.height, art.stands[0].y + 2);
  assert.equal(busy.filter(tree => tree.location === 'stand').length, 1);
  assert.deepEqual(mod.layoutTrees(art, { profile: 'cloe', busy: false, agents }), idle);
  assert.deepEqual(art, before, 'manifest must not be mutated');
  const roster = ['cloe', 'vera', 'mana', 'ana', 'lana'].map(profile => ({ connectionId: 'local', profile }));
  const shelf = mod.layoutTrees(art, { profile: 'cloe', busy: false, agents: roster });
  assert.equal(shelf.length, 2, 'never more bonsai than the drawing has sprites');
  assert.equal(new Set(shelf.map(tree => tree.id)).size, 2, 'two agents never share one bonsai');
  assert.equal(shelf.filter(tree => tree.assigned).length, 1);
  assert.equal(shelf.find(tree => tree.assigned).profile, 'cloe');
  assert.equal(mod.layoutTrees(art, { profile: 'cloe', busy: false }).length, 0, 'no roster, no bonsai');
  assert.equal(mod.layoutTrees(art, { profile: null, busy: true, agents }).filter(tree => tree.assigned).length, 0);
  assert.deepEqual(mod.layoutTrees({ ...art, trees: [] }, { profile: 'cloe', busy: true, agents }), []);
  assert.equal(mod.layoutTrees({ ...art, stands: [] }, { profile: 'cloe', busy: true, agents }).find(tree => tree.assigned).location, 'shelf');
  // Focus changes never reassign a given profile at a later busy transition.
  mod.layoutTrees(art, { profile: 'vera', busy: true, agents });
  assert.equal(mod.layoutTrees(art, { profile: 'cloe', busy: true, agents }).find(tree => tree.assigned).id, active.id);
});

test('monk moves slowly on elapsed busy time, horizontally within bounds, never on idle time', async () => {
  const mod = await plugin();
  assert.equal(typeof mod.advanceMonk, 'function', 'elapsed-time motion is missing');
  const focus = { busy: true, profile: 'cloe', sessionId: 'runtime-a' };
  const start = mod.advanceMonk(null, focus, 1000, art);
  const direct = mod.advanceMonk(start, focus, 11000, art);
  let stepped = start;
  for (let now = 1100; now <= 11000; now += 100) stepped = mod.advanceMonk(stepped, focus, now, art);
  assert.equal(stepped.x, direct.x, 'motion must be independent of frame count');
  assert.ok(Math.abs(direct.x - start.x) > 0 && Math.abs(direct.x - start.x) <= 30);
  assert.equal(direct.y, art.monk.y);
  const idle = mod.advanceMonk(direct, { ...focus, busy: false }, 12000, art);
  const longIdle = mod.advanceMonk(idle, { ...focus, busy: false }, 1000000, art);
  assert.equal(longIdle.x, idle.x);
  const resumed = mod.advanceMonk(longIdle, focus, 1000100, art);
  assert.equal(resumed.x, idle.x, 'idle interval must not count as busy movement');
  for (let time = 0; time < 20000000; time += 7919) {
    const position = mod.advanceMonk(start, focus, time, art);
    assert.ok(position.x >= art.monk.x - 30 && position.x <= art.monk.x + 30);
    assert.ok(position.x >= 0 && position.x + art.monk.width <= art.width);
    assert.equal(position.y, art.monk.y);
    assert.ok(Number.isFinite(position.x));
  }
  const edge = { ...art, monk: { ...art.monk, x: 0 } };
  assert.ok(mod.advanceMonk(mod.advanceMonk(null, focus, 0, edge), focus, 30000, edge).x >= 0);
});

test('usage and calendar show only host values and the supplied system date', async () => {
  const mod = await plugin();
  assert.equal(typeof mod.readouts, 'function', 'honest HUD readouts are missing');
  const now = new Date('2026-11-06T12:34:56Z');
  const empty = mod.readouts(null, now, 'en-GB');
  assert.equal(empty.cost, 'Unavailable');
  assert.equal(empty.tokens, 'Unavailable');
  assert.equal(empty.time, now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }));
  assert.equal(empty.date, now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }));
  assert.equal(empty.crons, 'Unavailable');
  assert.equal(empty.season, 'Automne · novembre', 'the season strip reads the local clock, in French');
  assert.equal(mod.seasonOf(now).index, 11);
  assert.equal(mod.readouts(null, new Date('2026-07-15T12:00:00Z'), 'en-GB').season, 'Été · juillet');
  assert.equal(mod.readouts(null, new Date('2026-01-15T12:00:00Z'), 'en-GB').season, 'Hiver · janvier');
  assert.equal(mod.readouts(null, new Date('2026-04-15T12:00:00Z'), 'en-GB').season, 'Printemps · avril');
  for (const cost of [undefined, null, NaN, Infinity, -1, '0.5']) {
    assert.equal(mod.readouts({ cost_usd: cost }, now).cost, 'Unavailable');
  }
  assert.equal(mod.readouts({ cost_usd: 0 }, now).cost, '$0.0000');
  assert.equal(mod.readouts({ cost_usd: 0.1234, total: 1234 }, now).cost, '$0.1234');
  assert.equal(mod.readouts({ total: 1234 }, now).tokens, '1,234');
});

test('agent roster comes from the gateway profile routes, deduplicated and deterministic', async () => {
  const mod = await plugin();
  assert.equal(typeof mod.loadAgentRoster, 'function', 'the roster must come from the gateway routes, not from routines');
  const previous = sdk.host.profileRoutes;
  try {
    let calls = 0;
    sdk.host.profileRoutes = async () => {
      calls += 1;
      return [
        { connectionId: 'local', profile: 'vera' },
        { connectionId: 'local', profile: 'cloe' },
        { connectionId: 'cloud', profile: 'vera' },
        { connectionId: 'local', profile: '  ' },
        { connectionId: 'local' }
      ];
    };
    const roster = await mod.loadAgentRoster();
    assert.deepEqual(roster.agents.map(agent => agent.profile), ['cloe', 'vera'], 'one bonsai per profile, in a stable order');
    assert.equal(roster.errors, 0);
    assert.deepEqual(await mod.loadAgentRoster(), roster, 'the same routes always give the same roster');
    assert.equal(calls, 2);
    sdk.host.profileRoutes = async () => { throw new Error('gateway offline'); };
    assert.equal(await mod.loadAgentRoster(), null, 'a failing gateway must not invent agents');
    sdk.host.profileRoutes = async () => 'nonsense';
    assert.equal(await mod.loadAgentRoster(), null, 'a non-array answer is not a roster');
    sdk.host.profileRoutes = undefined;
    assert.equal(await mod.loadAgentRoster(), null, 'no gateway routes, no roster');
  } finally { sdk.host.profileRoutes = previous; }
});

test('tool plaques are movable objects with a fixed stacking order, and the art is never rewritten', async () => {
  const mod = await plugin();
  assert.deepEqual(mod.TOOL_KEYS, ['time', 'date', 'crons', 'cost'], 'the four data frames are the tool plaques');
  const before = structuredClone(art);
  const start = mod.initialTools(art);
  assert.deepEqual(Object.keys(start).sort(), [...mod.TOOL_KEYS].sort());
  assert.deepEqual(start.cost, { x: art.hud.cost.x, y: art.hud.cost.y });
  assert.equal(start.season, undefined, 'the season strip is not a tool plaque');
  assert.deepEqual(mod.placeTool(art, art.hud.time, 100, 100), { x: 100, y: 100 });
  assert.deepEqual(mod.placeTool(art, art.hud.time, -40, 900), { x: 0, y: art.height - art.hud.time.height }, 'a plaque always stays inside the stage');
  assert.equal(mod.toolZ('time', null), 1);
  assert.equal(mod.toolZ('cost', null), 4);
  assert.equal(mod.toolZ('cost', 'cost'), mod.TOOL_KEYS.length + 1, 'the dragged plaque comes forward');
  assert.equal(mod.toolZ('season', null), 0, 'the season strip stays behind the tools');
  assert.deepEqual(art, before, 'dragging must never rewrite the delivered art');
});

test('the monthly care tip and the agent avatars come from the delivered art', async () => {
  const mod = await plugin();
  assert.equal(typeof mod.careTip, 'function', 'the monthly tip is missing');
  const tips = JSON.parse(await readFile(new URL('../assets/care-tips.json', import.meta.url), 'utf8'));
  // JSON.parse hoists the canonical integer keys ('10'-'12') in front of '01'-'09', so compare sorted.
  assert.deepEqual([...Object.keys(tips)].sort(), Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0')), 'all twelve months must be present');
  for (const [key, tip] of Object.entries(tips)) {
    assert.equal(tip, tip.trim(), `${key} must not be padded`);
    assert.ok(tip.length >= 40 && tip.length <= 60, `${key} is ${tip.length} characters`);
    assert.doesNotMatch(tip, /[";«»]|[\u{1F000}-\u{1FAFF}]/u, `${key} must stay plain single-sentence text`);
    assert.equal(mod.careTip({ ...art, tips }, new Date(`2026-${key}-10T12:00:00Z`)), tip, `${key} tip must be read from the art`);
  }
  assert.equal(mod.careTip(art, new Date('2026-11-06T12:34:56Z')), null, 'no delivered tip, no invented tip');
  const avatars = JSON.parse(await readFile(new URL('../assets/avatars.json', import.meta.url), 'utf8'));
  assert.ok(Object.keys(avatars).length >= 8, 'every desk profile needs a drawn avatar');
  for (const [profile, source] of Object.entries(avatars)) {
    assert.match(source, /^data:image\/png;base64,[A-Za-z0-9+/=]+$/, `${profile} avatar must be an inline PNG`);
    assert.equal(mod.avatarFor({ ...art, avatars }, profile), source);
  }
  assert.equal(mod.avatarFor(art, 'cloe'), null, 'no avatars in the art, no avatar shown');
  assert.equal(mod.avatarFor({ ...art, avatars: { cloe: 'not-an-image' } }, 'cloe'), null, 'anything but an inline image falls back');
  assert.equal(mod.monogram('cloe'), 'C');
  assert.equal(mod.monogram(''), '?');
});

test('every shipped HUD frame fits its widest unbreakable token, so no readout breaks mid-word', async () => {
  const mod = await plugin();
  assert.equal(typeof mod.hudReadoutFits, 'function', 'the HUD text-fitting guard is missing');
  // The season strip is sized on its own (0.9cqw, no label), so only the four data frames use HUD_TEXT.
  const frames = Object.entries(actualArt.hud).filter(([key]) => key !== 'season');
  assert.equal(frames.length, 4, 'the shipped art must expose the four data frames');
  for (const [key, rect] of frames) {
    assert.equal(mod.hudReadoutFits(rect, actualArt.width), true, `the ${key} frame is too narrow for "${mod.HUD_TEXT.widest}"`);
  }
  const narrowest = Math.min(...frames.map(([, rect]) => rect.width));
  const usable = (narrowest / actualArt.width) * 100 - 2 * mod.HUD_TEXT.paddingCqw;
  assert.ok(mod.HUD_TEXT.widest.length * mod.HUD_TEXT.monospaceAdvanceEm * mod.HUD_TEXT.fontCqw <= usable);
  // The shipped frame used to run 1.05cqw text inside 1.2% padding: those two numbers
  // together overflowed this frame, which is the mid-word wrap this guards against.
  const legacyNeed = mod.HUD_TEXT.widest.length * mod.HUD_TEXT.monospaceAdvanceEm * 1.05;
  const legacyUsable = (narrowest / actualArt.width) * 100 - 2 * 1.2;
  assert.ok(legacyNeed > legacyUsable, 'the legacy 1.05cqw sizing no longer overflows this frame — the guard has gone stale');
});

test('task title reads only verified session.info and refuses stale or wrong-owner results', async () => {
  const mod = await plugin();
  assert.equal(typeof mod.loadSessionTitle, 'function', 'read-only title lookup is missing');
  sdk.resetHost();
  const scope = { sessionId: 'runtime-a', profile: 'default', connectionId: 'local', epoch: 1 };
  const calls = [];
  sdk.host.request = async (method, params) => { calls.push({ method, params }); return { title: '  A real\nsession title  ', messages: [{ content: 'DO NOT USE' }] }; };
  assert.equal(await mod.loadSessionTitle(scope), 'A real session title');
  assert.deepEqual(calls, [{ method: 'session.info', params: { session_id: 'runtime-a' } }]);
  sdk.host.request = async () => ({ title: null, messages: [{ content: 'DO NOT USE' }] });
  assert.equal(await mod.loadSessionTitle(scope), null);
  sdk.host.request = async () => { throw new Error('offline'); };
  assert.equal(await mod.loadSessionTitle(scope), null);
  let resolve;
  sdk.host.request = () => new Promise(done => { resolve = done; });
  const pending = mod.loadSessionTitle(scope);
  sdk.setEpoch(2);
  resolve({ title: 'old connection title' });
  assert.equal(await pending, null);
  sdk.resetHost();
  sdk.host.state.focusedSessionOwner.set({ connectionId: 'remote', profile: 'default' });
  sdk.host.request = () => { throw new Error('must not request an unrelated gateway'); };
  assert.equal(await mod.loadSessionTitle(scope), null);
  sdk.resetHost();
});

test('legacy SDK missing focused atoms renders an honest fallback instead of crashing', async () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const client = new sdk.QueryClient();
  const saved = new Map();
  for (const key of ['focusedSessionId', 'focusedSessionProfile', 'focusedUsage', 'focusedSessionOwner', 'connectionId']) {
    saved.set(key, sdk.host.state[key]); delete sdk.host.state[key];
  }
  try {
    const mod = await plugin();
    const output = renderToStaticMarkup(React.createElement(sdk.QueryClientProvider, { client }, React.createElement(mod.GardenPage, { ctx: sdk.context() })));
    assert.match(output, /Primary session only/i);
    assert.doesNotMatch(output, /Focused session only/i);
    assert.match(output, /Unavailable/);
    assert.doesNotMatch(output, /\$0\.0000/);
  } finally {
    for (const [key, value] of saved) sdk.host.state[key] = value;
    client.clear();
  }
});

test('actual 1340x650 manifest keeps twelve sprite sources and lays out one bonsai per agent', async () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { JSDOM } = require('jsdom');
  const client = new sdk.QueryClient();
  sdk.resetHost();
  const mod = await import(`${pluginURL.href}?actual-art`);
  const output = renderToStaticMarkup(React.createElement(sdk.QueryClientProvider, { client }, React.createElement(mod.GardenPage, { ctx: sdk.context() })));
  const dom = new JSDOM(output);
  try {
    assert.equal(actualArt.width, 1340); assert.equal(actualArt.height, 650);
    assert.equal(actualArt.trees.length, 12);
    assert.equal(new Set(actualArt.trees.map(tree => tree.id)).size, 12);
    const rendered = [...dom.window.document.querySelectorAll('[data-tree-id]')];
    assert.equal(rendered.length, 1, 'an offline shelf holds one bonsai per known agent, never a decorative filler');
    const home = actualArt.trees.find(tree => tree.id === rendered[0].dataset.treeId);
    assert.ok(home, 'rendered bonsai must come from the artwork manifest');
    assert.equal(rendered[0].getAttribute('src'), home.src);
    assert.equal(rendered[0].style.left, `${home.x / actualArt.width * 100}%`);
    assert.equal(rendered[0].style.top, `${home.y / actualArt.height * 100}%`);
    assert.equal(dom.window.document.querySelector('[data-sprite="monk"]').style.top, `${actualArt.monk.y / 650 * 100}%`);
    const cat = dom.window.document.querySelector('[data-cat-drag="true"]');
    assert.ok(cat, 'the cat must be draggable even when idle');
    assert.equal(cat.style.pointerEvents, 'auto');
    assert.equal(cat.style.cursor, 'grab');
    assert.equal(cat.getAttribute('src'), actualArt.cat.src);
    const box = { left: parseFloat(cat.style.left), top: parseFloat(cat.style.top) };
    assert.ok(box.left >= 0 && box.left <= (actualArt.width - actualArt.cat.width) / actualArt.width * 100 + 1e-9);
    assert.ok(box.top >= 0 && box.top <= (actualArt.height - actualArt.cat.height) / actualArt.height * 100 + 1e-9);
    // The four readout frames are movable tool plaques; the season strip stays painted in.
    const plaques = [...dom.window.document.querySelectorAll('[data-tool]')];
    assert.deepEqual(plaques.map(node => node.dataset.tool), mod.TOOL_KEYS, 'every readout frame is a movable tool plaque');
    assert.equal(plaques.filter(node => node.dataset.draggable === 'true').length, mod.TOOL_KEYS.length);
    assert.equal(dom.window.document.querySelector('[data-hud="season"]').dataset.draggable, 'false', 'the season strip is drawn into the artwork, not a tool');
    // The roster names each agent with its shipped avatar, and the footer carries
    // the local season in French plus the monthly care tip.
    const roster = dom.window.document.querySelector('[data-roster]');
    assert.ok(roster, 'the roster block must name the agents');
    const lines = [...roster.querySelectorAll('[data-roster-agent]')];
    assert.equal(lines.length, rendered.length, 'one roster line per drawn bonsai');
    for (const line of lines) {
      const profile = line.dataset.rosterAgent;
      assert.equal(line.dataset.rosterState, 'idle');
      const avatar = line.querySelector('[data-avatar]');
      assert.ok(avatar, `${profile} must wear its shipped avatar`);
      assert.equal(avatar.getAttribute('src'), actualArt.avatars[profile], 'avatars come from the delivered manifest');
      assert.equal(avatar.getAttribute('width'), '16');
    }
    const footer = [...dom.window.document.querySelectorAll('p')].map(node => node.textContent).find(text => text.startsWith('Hermes Desktop'));
    assert.ok(footer, 'the page keeps its footer line');
    assert.ok(footer.includes(mod.seasonLine(new Date())), 'the footer states the local season, in French');
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    assert.ok(footer.includes(`Care: ${actualArt.tips[month]}`), 'the footer carries the tip of the current month');
    const solo = mod.layoutTrees(actualArt, { profile: 'cloe', agents: [{ connectionId: 'local', profile: 'cloe' }] });
    assert.equal(solo.length, 1);
    assert.equal(solo[0].assigned, true);
    assert.ok(actualArt.trees.some(tree => tree.id === solo[0].id), 'an agent only ever gets a drawn bonsai');
    const shelf = mod.layoutTrees(actualArt, { profile: 'cloe', agents: ['cloe', 'vera', 'mana', 'ana'].map(profile => ({ connectionId: 'local', profile })) });
    assert.equal(shelf.length, 4, 'exactly one bonsai per agent');
    assert.equal(new Set(shelf.map(tree => tree.id)).size, 4, 'two agents never share one bonsai');
    assert.equal(shelf.filter(tree => tree.assigned).length, 1);
    assert.deepEqual(mod.layoutTrees(actualArt, { agents: [] }), [], 'an empty roster shows an empty shelf');
    assert.deepEqual(mod.placeCat(actualArt, -100, 9000), { x: 0, y: 650 - actualArt.cat.height });
    assert.deepEqual(mod.spawnCat(actualArt, () => 0.5), mod.placeCat(actualArt, 0.5 * (1340 - actualArt.cat.width), 0.5 * (650 - actualArt.cat.height)));
    const active = mod.layoutTrees(actualArt, { profile: 'default', busy: true, agents: [{ connectionId: null, profile: 'default' }] }).find(tree => tree.assigned);
    // A busy agent stands the first delivered pedestal, centred and resting on its top.
    const pedestal = actualArt.stands[0];
    assert.equal(active.x + active.width / 2, pedestal.x + pedestal.width / 2);
    assert.equal(active.y + active.height, pedestal.y + 2);
  } finally { dom.window.close(); client.clear(); }
});

test('registered page mounts real React, reacts to host busy/usage/profile, scales art and disposes timers', async t => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const previous = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const { act } = React;
  const queryClient = new sdk.QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const root = createRoot(document.getElementById('root'));
  const ctx = sdk.context();
  sdk.resetHost();
  sdk.host.request = async () => ({ title: 'Verified session title' });
  let wall = Date.parse('2026-11-06T12:34:56Z');
  let monotonic = 100;
  t.mock.method(Date, 'now', () => wall);
  t.mock.method(performance, 'now', () => monotonic);
  t.mock.method(Math, 'random', () => 0.5);
  try {
    const mod = await plugin();
    const entry = mod.default;
    entry.register(ctx);
    const route = ctx.contributions.find(item => item.area === sdk.ROUTES_AREA);
    await act(async () => { root.render(React.createElement(sdk.QueryClientProvider, { client: queryClient }, route.render())); });
    await act(async () => { await new Promise(done => setTimeout(done, 10)); });
    const stage = document.querySelector('[data-bonsai-stage]');
    assert.ok(stage, 'registered page does not render the garden scene');
    assert.equal(stage.style.aspectRatio, `${art.width} / ${art.height}`);
    assert.equal(stage.style.width, '100%');
    assert.equal(stage.style.maxWidth, `${art.width}px`);
    const background = document.querySelector('[data-sprite="background"]');
    assert.equal(background.getAttribute('src'), art.background);
    assert.equal(background.style.imageRendering, 'pixelated');
    assert.equal(document.querySelector('section').style.background, 'var(--ui-bg-editor)');
    assert.equal(document.querySelector('[data-hud="cost"]').style.color, 'rgb(255, 255, 204)');
    assert.match(document.body.textContent, /focused session only/i);
    assert.match(document.body.textContent, /one bonsai per agent/i);
    assert.doesNotMatch(document.body.textContent, /decorative/i, 'the shelf must not claim decorative filler bonsai');
    assert.match(document.body.textContent, /CLI.*unavailable/i);
    assert.equal(document.querySelector('[data-hud="cost"]').textContent.includes('Unavailable'), true);
    const tree = document.querySelector('[data-tree-assigned="true"]');
    assert.ok(tree);
    const identity = tree.dataset.treeId;
    const sprite = tree.getAttribute('src');
    const home = { left: tree.style.left, top: tree.style.top };
    assert.equal(tree.dataset.location, 'shelf');
    assert.ok(document.querySelector('[data-task-title]') === null, 'idle bonsai must not carry a working caption');
    assert.equal(document.querySelectorAll('[data-tree-id]').length, 1, 'the shelf shows one bonsai per agent, not one per drawn sprout');
    for (const [key, rect] of Object.entries(art.hud)) {
      const node = document.querySelector(`[data-hud="${key}"]`);
      assert.equal(node.style.left, `${rect.x / art.width * 100}%`);
      assert.equal(node.style.top, `${rect.y / art.height * 100}%`);
      assert.equal(node.style.overflowWrap, 'anywhere');
    }
    for (const key of mod.TOOL_KEYS) {
      const node = document.querySelector(`[data-hud="${key}"]`);
      assert.equal(node.dataset.tool, key, `${key} must be a movable tool plaque`);
      assert.equal(node.dataset.draggable, 'true');
      assert.equal(node.style.background, 'rgb(0, 0, 0)', 'tool plaques are black rectangles over the painted ones');
      assert.equal(node.style.cursor, 'grab');
      assert.equal(node.style.pointerEvents, 'auto');
      assert.equal(node.style.zIndex, String(mod.toolZ(key, null)), 'the stacking order is fixed until one is picked up');
    }
    const seasonFrame = document.querySelector('[data-hud="season"]');
    assert.equal(seasonFrame.dataset.draggable, 'false', 'the season strip stays drawn into the artwork');
    assert.equal(seasonFrame.style.background, 'transparent');
    assert.equal(seasonFrame.style.pointerEvents, 'none');
    const cat = document.querySelector('[data-cat-drag="true"]');
    assert.ok(cat, 'the cat must be draggable, even while idle');
    assert.equal(cat.style.pointerEvents, 'auto');
    assert.equal(cat.style.cursor, 'grab');
    assert.equal(document.querySelector('[data-sprite="monk"]').style.pointerEvents, 'none', 'pure decor never steals pointer events');
    const catHome = mod.spawnCat(art, () => 0.5);
    assert.equal(cat.style.left, `${catHome.x / art.width * 100}%`, 'the cat starts at its seeded spot, not a fixed manifest spot');
    assert.equal(cat.style.top, `${catHome.y / art.height * 100}%`);
    const stageRect = stage.getBoundingClientRect();
    stage.getBoundingClientRect = () => ({ ...stageRect, left: 0, top: 0, right: art.width / 2, bottom: art.height / 2, width: art.width / 2, height: art.height / 2 });
    const pointer = (type, x, y) => {
      const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
      Object.defineProperty(event, 'pointerId', { value: 3 });
      return event;
    };
    await act(async () => {
      cat.dispatchEvent(pointer('pointerdown', 200, 150));
      cat.dispatchEvent(pointer('pointermove', 240, 150));
    });
    const dragged = mod.placeCat(art, catHome.x + 80, catHome.y);
    assert.equal(cat.style.left, `${dragged.x / art.width * 100}%`, 'dragging maps screen distance onto the drawing');
    assert.equal(cat.style.top, `${dragged.y / art.height * 100}%`);
    await act(async () => {
      cat.dispatchEvent(pointer('pointerup', 240, 150));
      cat.dispatchEvent(pointer('pointermove', 900, 700));
    });
    assert.equal(cat.style.left, `${dragged.x / art.width * 100}%`, 'the cat settles once the drag ends');
    assert.equal(cat.style.top, `${dragged.y / art.height * 100}%`);
    assert.equal(document.querySelectorAll('[data-cat-drag="true"]').length, 1, 'dragging must not clone the cat');
    const plaque = document.querySelector('[data-hud="date"]');
    const plaqueHome = { left: plaque.style.left, top: plaque.style.top };
    await act(async () => {
      plaque.dispatchEvent(pointer('pointerdown', 300, 200));
      plaque.dispatchEvent(pointer('pointermove', 340, 200));
    });
    const shifted = mod.placeTool(art, art.hud.date, art.hud.date.x + 80, art.hud.date.y);
    assert.equal(plaque.style.left, `${shifted.x / art.width * 100}%`, 'a tool plaque follows the finger across the drawing');
    assert.equal(plaque.style.top, `${shifted.y / art.height * 100}%`);
    assert.equal(plaque.style.zIndex, String(mod.toolZ('date', 'date')), 'the plaque under the finger comes forward while dragged');
    assert.equal(document.querySelector('[data-hud="time"]').style.left, `${art.hud.time.x / art.width * 100}%`, 'dragging one plaque leaves the others alone');
    await act(async () => {
      plaque.dispatchEvent(pointer('pointerup', 340, 200));
      plaque.dispatchEvent(pointer('pointermove', 900, 700));
    });
    assert.equal(plaque.style.left, `${shifted.x / art.width * 100}%`, 'a plaque settles once the drag ends');
    assert.equal(plaque.style.zIndex, String(mod.toolZ('date', null)), 'the plaque falls back into the fixed order');
    assert.equal(document.querySelector('[data-hud="date"]'), plaque, 'dragging must not clone a plaque');
    assert.notDeepEqual({ left: plaque.style.left, top: plaque.style.top }, plaqueHome);
    const clock = document.querySelector('[data-hud="time"]').textContent;
    await act(async () => {
      sdk.host.state.busy.set(true);
      sdk.host.state.focusedUsage.set({ cost_usd: 0.1234, total: 2468 });
    });
    await act(async () => { await new Promise(done => setTimeout(done, 10)); });
    const moved = document.querySelector('[data-tree-assigned="true"]');
    assert.strictEqual(moved, tree, 'same keyed image node must move, not duplicate');
    assert.equal(moved.dataset.treeId, identity);
    assert.equal(moved.getAttribute('src'), sprite);
    assert.equal(moved.dataset.location, 'stand');
    assert.match(document.querySelector('[data-hud="cost"]').textContent, /\$0\.1234/);
    assert.match(document.querySelector('[data-task-title]').textContent, /Verified session title/);
    assert.match(document.querySelector('[data-task-title]').textContent, /default/, 'busy bonsai caption must identify the agent as well as its task');
    assert.equal(document.querySelector('[data-task-title]').style.whiteSpace, 'nowrap');
    const monk = document.querySelector('[data-sprite="monk"]');
    const start = { left: monk.style.left, top: monk.style.top };
    await act(async () => { wall += 10000; monotonic += 10000; for (const timer of [...ctx.timers.values()]) timer.fn(); });
    assert.notEqual(monk.style.left, start.left);
    assert.equal(monk.style.top, start.top);
    assert.notEqual(document.querySelector('[data-hud="time"]').textContent, clock);
    await act(async () => { sdk.host.state.busy.set(false); sdk.host.state.focusedUsage.set(null); });
    assert.equal(tree.dataset.location, 'shelf');
    assert.deepEqual({ left: tree.style.left, top: tree.style.top }, home);
    const idleLeft = monk.style.left;
    await act(async () => { monotonic += 900000; for (const timer of [...ctx.timers.values()]) timer.fn(); });
    assert.equal(monk.style.left, idleLeft);
    assert.match(document.querySelector('[data-hud="cost"]').textContent, /Unavailable/);
    assert.ok(document.querySelector('[data-task-title]') === null, 'caption disappears when work finishes');
    await act(async () => { sdk.host.state.busy.set(true); sdk.host.state.focusedSessionOwner.set({ connectionId: 'other-source', profile: 'default' }); });
    assert.doesNotMatch(document.querySelector('[data-task-title]').textContent, /Verified session title/, 'disabled/wrong-owner metadata must not keep a cached title');
    await act(async () => { sdk.host.state.focusedSessionProfile.set('cloe'); });
    assert.match(document.querySelector('[data-focus-label]').textContent, /cloe/);
    assert.equal(document.querySelectorAll('[data-tree-assigned="true"]').length, 1);
  } finally {
    await act(async () => root.unmount());
    assert.equal(ctx.timers.size, 0, 'page-owned timers survive unmount');
    queryClient.clear();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});

test('real recurring agent jobs are grouped per profile; scripts, one-shots and finished jobs never become routines', async () => {
  const mod = await plugin();
  assert.equal(typeof mod.routinesByAgent, 'function', 'routine aggregation is missing');
  const entries = [
    { connectionId: 'local', profile: 'cloe', label: 'Cloe', jobs: [
      { job_id: 'a1', name: 'veille-ia', schedule: '0 9 * * 1', state: 'scheduled', enabled: true, next_run_at: '2026-11-09T09:00:00+01:00' },
      { job_id: 'a2', name: 'veille-x', schedule: '0 9 * * 4', state: 'paused', enabled: false, next_run_at: '2026-11-08T09:00:00+01:00' },
      { job_id: 'a3', name: 'script-only', schedule: 'every 5m', no_agent: true, state: 'scheduled', enabled: true },
      { job_id: 'a4', name: 'one-shot', schedule: 'once at 2026-11-07 02:00', state: 'scheduled', enabled: true, next_run_at: '2026-11-07T02:00:00+01:00' },
      { job_id: 'a5', name: 'finished', schedule: '0 4 * * 0', state: 'completed', enabled: false },
      { job_id: 'a6', name: 'bad-date', schedule: '0 1 * * *', state: 'scheduled', enabled: true, next_run_at: 'not-a-date' },
      { job_id: 'a7', name: 'no-schedule', schedule: '?', state: 'scheduled', enabled: true }
    ] },
    { connectionId: 'local', profile: 'ana', jobs: [
      { job_id: 'b1', name: 'billets-ana', schedule: '0 8 1 * *', state: 'scheduled', enabled: true, next_run_at: '2026-12-01T08:00:00+01:00' }
    ] },
    { connectionId: 'local', profile: 'ava', jobs: [
      { job_id: 'c1', name: 'journal-once', schedule: 'once at 2026-11-07 02:00', state: 'scheduled', enabled: true, next_run_at: '2026-11-07T02:00:00+01:00' }
    ] },
    { connectionId: 'local', profile: 'vera', jobs: [] }
  ];
  const clone = structuredClone(entries);
  const agents = mod.routinesByAgent(entries);
  assert.deepEqual(agents.map(agent => agent.profile), ['ana', 'cloe']);
  const cloe = agents.find(agent => agent.profile === 'cloe');
  assert.equal(cloe.label, 'Cloe');
  assert.equal(cloe.activeCount, 3);
  assert.equal(cloe.suspendedCount, 1);
  assert.deepEqual(cloe.routines.map(routine => routine.name), ['veille-ia', 'bad-date', 'no-schedule', 'veille-x']);
  assert.deepEqual(cloe.routines.map(routine => routine.suspended), [false, false, false, true]);
  assert.equal(cloe.routines[0].nextAt, '2026-11-09T09:00:00+01:00');
  assert.equal(cloe.routines[1].nextAt, null, 'an unparseable date must not become a value');
  assert.equal(cloe.nextAt, '2026-11-09T09:00:00+01:00', 'the soonest active valid date wins; suspended or invalid dates never do');
  const ana = agents.find(agent => agent.profile === 'ana');
  assert.equal(ana.label, 'ana');
  assert.equal(ana.nextAt, '2026-12-01T08:00:00+01:00');
  assert.deepEqual(entries, clone, 'aggregation must not mutate its input');
  assert.deepEqual(mod.routinesByAgent([]), []);
  assert.deepEqual(mod.routinesByAgent([null, {}, { profile: 'nobody' }]), []);
});

test('loadRoutines asks every profile route for its scoped cron store and survives failures, mismatches and old SDKs', async () => {
  const mod = await plugin();
  assert.equal(typeof mod.loadRoutines, 'function', 'routine loader is missing');
  const cloeJobs = [
    { job_id: 'a1', name: 'veille-ia', schedule: '0 9 * * 1', state: 'scheduled', enabled: true, next_run_at: '2026-11-09T09:00:00+01:00' },
    { job_id: 'a2', name: 'veille-x', schedule: '0 9 * * 4', state: 'paused', enabled: false }
  ];
  const calls = [];
  const routes = [
    { connectionId: 'local', profile: 'cloe', targetProfile: 'cloe', mode: 'local' },
    { connectionId: 'local', profile: 'ana', targetProfile: 'ana', mode: 'local' },
    { connectionId: 'local', profile: 'boom', targetProfile: 'boom', mode: 'local' },
    { connectionId: 'local', profile: 'wrong', targetProfile: 'wrong', mode: 'local' }
  ];
  const api = {
    profileRoutes: async () => routes,
    profiles: { list: async () => ({ profiles: [{ name: 'cloe', display_name: 'Cloe' }, { name: 'ana' }] }) },
    requestProfile: async (route, method, params) => {
      calls.push({ route, method, params });
      if (route.profile === 'boom') throw new Error('profile offline');
      if (route.profile === 'wrong') return { success: true, scoped: 'someone-else', jobs: cloeJobs };
      if (route.profile === 'ana') return { success: true, scoped: 'ana' };
      return { success: true, scoped: 'cloe', jobs: cloeJobs };
    }
  };
  const result = await mod.loadRoutines(api);
  assert.ok(result, 'a supported host must produce a result');
  assert.equal(calls.length, 4);
  assert.ok(calls.every(call => call.method === 'cron.manage' && call.params.action === 'list'
    && call.params.include_disabled === true
    && call.params.profile === (call.route.targetProfile || call.route.profile)));
  assert.deepEqual(result.agents.map(agent => agent.profile), ['cloe']);
  assert.equal(result.agents[0].label, 'Cloe');
  assert.equal(result.agents[0].activeCount, 1);
  assert.equal(result.agents[0].suspendedCount, 1);
  assert.equal(result.errors, 2, 'a failed fetch and a mismatched scoped store both count as unavailable');
  const noLabels = { profileRoutes: async () => [routes[0]], profiles: { list: async () => { throw new Error('nope'); } }, requestProfile: async () => ({ success: true, scoped: 'cloe', jobs: cloeJobs }) };
  const fallback = await mod.loadRoutines(noLabels);
  assert.equal(fallback.agents[0].label, 'cloe');
  assert.equal(fallback.errors, 0);
  const toolError = { profileRoutes: async () => [routes[0]], requestProfile: async () => ({ success: false, error: 'gateway down' }) };
  const failed = await mod.loadRoutines(toolError);
  assert.equal(failed.errors, 1);
  assert.deepEqual(failed.agents, []);
  assert.equal(await mod.loadRoutines({}), null, 'old SDK without profile routing must read Unavailable');
  assert.equal(await mod.loadRoutines({ profileRoutes: async () => routes }), null);
  assert.equal(await mod.loadRoutines({ profileRoutes: async () => { throw new Error('down'); }, requestProfile: async () => ({}) }), null);
});

test('HUD and summary report loaded routines honestly and never fabricate counts', async () => {
  const mod = await plugin();
  assert.equal(typeof mod.routineSummary, 'function', 'routine summary is missing');
  assert.equal(typeof mod.formatRoutineWhen, 'function', 'routine date formatting is missing');
  assert.equal(mod.routineSummary(null), 'Unavailable');
  assert.equal(mod.routineSummary(undefined), 'Unavailable');
  assert.equal(mod.routineSummary({ agents: [], errors: 0 }), 'No recurring agent routines');
  assert.equal(mod.routineSummary({ agents: [], errors: 2 }), 'Unavailable');
  const one = { agents: [{ profile: 'cloe', activeCount: 2, suspendedCount: 1, routines: [{}, {}, {}] }], errors: 0 };
  assert.equal(mod.routineSummary(one), '1 agent · 3 routines');
  const many = { agents: [
    { profile: 'ana', activeCount: 1, suspendedCount: 0, routines: [{}] },
    { profile: 'cloe', activeCount: 2, suspendedCount: 1, routines: [{}, {}, {}] }
  ], errors: 1 };
  assert.equal(mod.routineSummary(many), '2 agents · 4 routines · incomplete');
  const now = new Date('2026-11-06T12:34:56Z');
  assert.equal(mod.readouts({ cost_usd: 0, total: 5 }, now, 'en-GB', one).crons, '1 agent · 3 routines');
  assert.equal(mod.readouts({ cost_usd: 0, total: 5 }, now, 'en-GB', null).crons, 'Unavailable');
  assert.equal(mod.readouts({ cost_usd: 0, total: 5 }, now, 'en-GB').crons, 'Unavailable', 'no routine data must keep the honest default');
  const expected = new Date('2026-11-09T09:00:00+01:00').toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  assert.equal(mod.formatRoutineWhen('2026-11-09T09:00:00+01:00', 'en-GB'), expected);
  assert.equal(mod.formatRoutineWhen(null), null);
  assert.equal(mod.formatRoutineWhen('not-a-date'), null);
});

test('registered garden renders per-agent routines from live scoped cron lists', async () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const previous = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const { act } = React;
  const queryClient = new sdk.QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const root = createRoot(document.getElementById('root'));
  const ctx = sdk.context();
  sdk.resetHost();
  const calls = [];
  sdk.host.profileRoutes = async () => [
    { connectionId: 'local', profile: 'cloe', targetProfile: 'cloe', mode: 'local' },
    { connectionId: 'local', profile: 'lana', targetProfile: 'lana', mode: 'local' }
  ];
  sdk.host.requestProfile = async (route, method, params) => {
    calls.push({ route, method, params });
    if (route.profile === 'cloe') return { success: true, scoped: 'cloe', jobs: [
      { job_id: 'j1', name: 'veille-ia', schedule: '0 9 * * 1', state: 'scheduled', enabled: true, next_run_at: '2026-11-09T09:00:00+01:00' },
      { job_id: 'j2', name: 'veille-x', schedule: '0 9 * * 4', state: 'paused', enabled: false }
    ] };
    return { success: true, scoped: 'lana', jobs: [
      { job_id: 'j3', name: 'formation-lana', schedule: '0 4 * * 0', state: 'scheduled', enabled: true, next_run_at: '2026-11-08T04:00:00+01:00' }
    ] };
  };
  try {
    const entry = (await plugin()).default;
    entry.register(ctx);
    const route = ctx.contributions.find(item => item.area === sdk.ROUTES_AREA);
    await act(async () => { root.render(React.createElement(sdk.QueryClientProvider, { client: queryClient }, route.render())); });
    await act(async () => { await new Promise(done => setTimeout(done, 15)); });
    const cronCalls = calls.filter(call => call.method === 'cron.manage');
    assert.equal(cronCalls.length, 2);
    assert.ok(cronCalls.every(call => call.params.action === 'list'
      && call.params.include_disabled === true && call.params.profile === call.route.profile));
    assert.match(document.querySelector('[data-hud="crons"]').textContent, /2 agents · 3 routines/);
    const list = document.querySelector('[data-routines]');
    assert.ok(list, 'routine list is missing');
    const cloe = document.querySelector('[data-agent="cloe"]');
    assert.match(cloe.textContent, /[Cc]loe/);
    assert.match(cloe.textContent, /1 active/);
    assert.match(cloe.textContent, /1 suspended/);
    const active = document.querySelector('[data-routine="j1"]');
    assert.equal(active.dataset.status, 'active');
    assert.match(active.textContent, /veille-ia/);
    assert.match(active.textContent, /0 9 \* \* 1/);
    assert.match(active.textContent, /next /);
    const paused = document.querySelector('[data-routine="j2"]');
    assert.equal(paused.dataset.status, 'suspended');
    assert.match(paused.textContent, /suspended/);
    assert.doesNotMatch(paused.textContent, /next /);
    assert.match(document.querySelector('[data-agent="lana"]').textContent, /formation-lana/);
    assert.match(document.body.textContent, /Routines: 2 agents · 3 routines/);
    assert.match(document.body.textContent, /one bonsai per agent/i, 'the bonsai footer fact must survive the routines view');
  } finally {
    await act(async () => root.unmount());
    queryClient.clear();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});

test('garden without profile routing renders no routine section and says so', async () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const client = new sdk.QueryClient();
  sdk.resetHost();
  const savedRoutes = sdk.host.profileRoutes;
  const savedRequest = sdk.host.requestProfile;
  delete sdk.host.profileRoutes;
  delete sdk.host.requestProfile;
  try {
    const mod = await plugin();
    const output = renderToStaticMarkup(React.createElement(sdk.QueryClientProvider, { client }, React.createElement(mod.GardenPage, { ctx: sdk.context() })));
    assert.doesNotMatch(output, /data-routines/, 'no routing means no routine claims');
    assert.match(output, /Crons unavailable/);
  } finally {
    sdk.host.profileRoutes = savedRoutes;
    sdk.host.requestProfile = savedRequest;
    client.clear();
  }
});

test('gesture routes resolve by agent name and prefer the backend profile', async () => {
  const mod = await plugin();
  const local = { connectionId: 'local', profile: 'default', targetProfile: 'default', mode: 'local' };
  const cloe = { connectionId: 'remote', profile: 'cloe', targetProfile: 'cloe@box', mode: 'local' };
  assert.deepEqual(mod.resolveAgentRoute([local, cloe], 'cloe'), cloe);
  assert.deepEqual(mod.resolveAgentRoute([local, cloe], 'cloe@box'), cloe);
  assert.equal(mod.resolveAgentRoute([local], 'eva'), null);
  assert.equal(mod.resolveAgentRoute(null, 'cloe'), null);
  assert.equal(mod.resolveAgentRoute([], ''), null);
});

test('a busy agent is the most recently active session that is not idle', async () => {
  const mod = await plugin();
  assert.equal(mod.pickBusySession(null), null);
  assert.equal(mod.pickBusySession([]), null);
  assert.equal(mod.pickBusySession([
    { id: 'live-1', status: 'idle', last_active: 9 },
    { id: 'live-2', status: 'zombie', last_active: 11 }
  ]), null, 'unknown statuses never offer an interrupt');
  const busy = mod.pickBusySession([
    { id: 'live-1', status: 'idle', last_active: 9 },
    { id: 'live-2', status: 'streaming', last_active: 4 },
    { id: 'live-3', status: 'working', last_active: 7 },
    { id: 'live-4', status: 'starting' }
  ]);
  assert.equal(busy.id, 'live-3');
});

test('opening an agent conversation resumes its last stored session or starts a draft', async () => {
  const mod = await plugin();
  const route = { connectionId: 'local', profile: 'cloe', targetProfile: 'cloe', mode: 'local' };
  const seen = { listed: [], opened: [], started: [] };
  const api = (sessions) => ({
    profileRoutes: async () => [route],
    listPersistedSessions: async (r, options) => {
      seen.listed.push([r, options]);
      return { sessions, total: sessions.length, limit: options.limit, offset: 0 };
    },
    openSession: async (...args) => { seen.opened.push(args); },
    newChat: async (...args) => { seen.started.push(args); }
  });
  const stored = [
    { id: 'stored-old', last_active: 3 },
    { id: 'stored-kid', last_active: 99, is_internal_child: true },
    { id: 'stored-c1', last_active: 9 }
  ];
  const opened = await mod.openAgentConversation('cloe', api(stored));
  assert.deepEqual(opened, { ok: true, kind: 'session', storedId: 'stored-c1' });
  assert.deepEqual(seen.listed[0], [route, { profile: 'cloe', limit: 5 }]);
  assert.deepEqual(seen.opened[0], ['stored-c1', {
    route, profile: 'cloe', intent: 'in-place', awaitHydration: true, forceResume: true
  }]);
  assert.equal(seen.started.length, 0);

  const fresh = await mod.openAgentConversation('cloe', api([]));
  assert.deepEqual(fresh, { ok: true, kind: 'draft' });
  assert.deepEqual(seen.started[0], [route]);

  assert.deepEqual(await mod.openAgentConversation('eva', api([])), { ok: false, reason: 'no-route' });

  const noOpen = api([{ id: 'stored-c1', last_active: 9 }]);
  delete noOpen.openSession;
  assert.deepEqual(await mod.openAgentConversation('cloe', noOpen), { ok: false, reason: 'unsupported' });

  const broken = api([]);
  broken.listPersistedSessions = async () => { throw new Error('offline'); };
  assert.deepEqual(await mod.openAgentConversation('cloe', broken), { ok: false, reason: 'failed' });
  assert.equal(seen.started.length, 1, 'a failed stored list never silently starts a draft');
});

test('interrupting an agent stops only its own live session and reports honestly', async () => {
  const mod = await plugin();
  const route = { connectionId: 'remote', profile: 'cloe', targetProfile: 'cloe@box', mode: 'local' };
  const calls = [];
  const api = (sessions, interruptResult = { status: 'interrupted' }) => ({
    profileRoutes: async () => [route],
    requestProfile: async (r, method, params) => {
      calls.push({ route: r, method, params });
      if (method === 'session.active_list') return { sessions };
      return interruptResult;
    }
  });
  const done = await mod.interruptAgent('cloe', api([
    { id: 'live-1', session_key: 'live-1', status: 'idle', last_active: 9 },
    { id: 'live-2', session_key: 'live-2', status: 'working', last_active: 4 }
  ]));
  assert.deepEqual(done, { ok: true, sessionId: 'live-2' });
  assert.deepEqual(calls[0], { route, method: 'session.active_list', params: { profile: 'cloe@box' } });
  assert.deepEqual(calls[1], { route, method: 'session.interrupt', params: { session_id: 'live-2' } });

  const idle = await mod.interruptAgent('cloe', api([{ id: 'live-1', status: 'idle', last_active: 9 }]));
  assert.deepEqual(idle, { ok: false, reason: 'not-busy' });

  const refused = await mod.interruptAgent('cloe', api(
    [{ id: 'live-3', status: 'working', last_active: 5 }],
    { status: 'not_interrupted', interrupted: false }
  ));
  assert.deepEqual(refused, { ok: false, reason: 'not-interrupted' });

  assert.deepEqual(await mod.interruptAgent('eva', api([])), { ok: false, reason: 'no-route' });
  assert.deepEqual(await mod.interruptAgent('cloe', { profileRoutes: async () => [route] }), { ok: false, reason: 'unsupported' });

  const offline = api([]);
  offline.requestProfile = async () => { throw new Error('offline'); };
  assert.deepEqual(await mod.interruptAgent('cloe', offline), { ok: false, reason: 'failed' });
});

test('registered garden opens conversations and stops busy agents from their rows', async () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const previous = new Map();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true
  })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const { act } = React;
  const queryClient = new sdk.QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const root = createRoot(document.getElementById('root'));
  const ctx = sdk.context();
  sdk.resetHost();
  const routes = [
    { connectionId: 'local', profile: 'cloe', targetProfile: 'cloe', mode: 'local' },
    { connectionId: 'local', profile: 'lana', targetProfile: 'lana', mode: 'local' }
  ];
  const job = (profile, id, name) => ({
    job_id: id, name, schedule: '0 9 * * 1', state: 'scheduled', enabled: true,
    next_run_at: '2026-11-09T09:00:00+01:00', profile
  });
  const events = [];
  const saved = {};
  for (const key of ['openSession', 'newChat', 'listPersistedSessions']) saved[key] = sdk.host[key];
  sdk.host.profileRoutes = async () => routes;
  let cloeBusy = true;
  sdk.host.requestProfile = async (route, method, params) => {
    events.push({ route, method, params });
    if (method === 'cron.manage') {
      return { success: true, jobs: route.profile === 'cloe'
        ? [job('cloe', 'j1', 'veille-ia')]
        : [job('lana', 'j3', 'cabinet')] };
    }
    if (method === 'session.active_list') {
      return { sessions: route.profile === 'cloe' && cloeBusy
        ? [{ id: 'live-1', session_key: 'live-1', status: 'working', last_active: 7 }]
        : [] };
    }
    if (method === 'session.interrupt') { cloeBusy = false; return { status: 'interrupted' }; }
    throw new Error(`unexpected ${method}`);
  };
  sdk.host.listPersistedSessions = async (route) => ({
    sessions: route.profile === 'cloe' ? [{ id: 'stored-c1', last_active: 9 }] : [],
    total: 1
  });
  sdk.host.openSession = async (...args) => { events.push({ method: 'openSession', args }); };
  sdk.host.newChat = async (...args) => { events.push({ method: 'newChat', args }); };
  try {
    const entry = (await plugin()).default;
    entry.register(ctx);
    const route = ctx.contributions.find(item => item.area === sdk.ROUTES_AREA);
    await act(async () => {
      root.render(React.createElement(sdk.QueryClientProvider, { client: queryClient }, route.render()));
    });
    await act(async () => { await new Promise(done => setTimeout(done, 25)); });
    const openCloe = document.querySelector('[data-agent="cloe"] [data-gesture="open"]');
    assert.ok(openCloe, 'cloe needs a conversation gesture');
    assert.match(openCloe.textContent, /conversation/i);
    assert.ok(document.querySelector('[data-agent="cloe"] [data-gesture="interrupt"]'),
      'a working agent needs a stop gesture');
    assert.equal(document.querySelector('[data-agent="lana"] [data-gesture="interrupt"]'), null,
      'an idle agent offers no interrupt');
    await act(async () => { openCloe.click(); await new Promise(done => setTimeout(done, 10)); });
    const opened = events.find(event => event.method === 'openSession');
    assert.ok(opened, 'opening cloe must resume her stored session');
    assert.equal(opened.args[0], 'stored-c1');
    assert.equal(opened.args[1].route.profile, 'cloe');
    assert.equal(opened.args[1].intent, 'in-place');
    const stopCloe = document.querySelector('[data-agent="cloe"] [data-gesture="interrupt"]');
    await act(async () => { stopCloe.click(); await new Promise(done => setTimeout(done, 30)); });
    assert.ok(events.some(event => event.method === 'session.interrupt'
      && event.params.session_id === 'live-1'));
    assert.equal(document.querySelector('[data-agent="cloe"] [data-gesture="interrupt"]'), null,
      'a stopped agent loses its stop gesture instead of lying');
    const openLana = document.querySelector('[data-agent="lana"] [data-gesture="open"]');
    await act(async () => { openLana.click(); await new Promise(done => setTimeout(done, 10)); });
    assert.ok(events.some(event => event.method === 'newChat'
      && event.args[0].profile === 'lana'), 'an agent without stored sessions starts a draft');
  } finally {
    await act(async () => root.unmount());
    queryClient.clear();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    sdk.host.profileRoutes = async () => [{ connectionId: 'local', profile: 'default', targetProfile: 'default', mode: 'local' }];
    sdk.host.requestProfile = async () => ({ title: null });
    for (const key of ['openSession', 'newChat', 'listPersistedSessions']) {
      if (saved[key] === undefined) delete sdk.host[key];
      else sdk.host[key] = saved[key];
    }
  }
});

test('built desktop plugin embeds exactly the delivered art, tips and avatars', async () => {
  const [built, source, sceneRaw, tipsRaw, avatarsRaw] = await Promise.all([
    readFile(new URL('../desktop/plugin.js', import.meta.url), 'utf8'),
    readFile(pluginURL, 'utf8'),
    readFile(new URL('../assets/scene.json', import.meta.url), 'utf8'),
    readFile(new URL('../assets/care-tips.json', import.meta.url), 'utf8'),
    readFile(new URL('../assets/avatars.json', import.meta.url), 'utf8')
  ]);
  const scene = JSON.parse(sceneRaw);
  const delivered = { ...scene, tips: JSON.parse(tipsRaw), avatars: JSON.parse(avatarsRaw) };
  // desktop/plugin.js is what ships: it must be this source with this art inlined. The check is
  // textual for the code (a stale build is a stale build) and structural for the art, because
  // JSON.parse hoists the integer-like tip keys ('10'-'12') in front of '01'-'09'.
  const token = '__BONSAI_ART__';
  const at = source.indexOf(token);
  assert.ok(at > 0, 'source lost its art injection point');
  const head = source.slice(0, at);
  const tail = source.slice(at + token.length);
  assert.ok(built.startsWith(head) && built.endsWith(tail), 'desktop/plugin.js is stale — rebuild it with scripts/build_plugin.py');
  const embedded = JSON.parse(built.slice(head.length, built.length - tail.length));
  assert.deepEqual(embedded, delivered);
  assert.equal(embedded.trees.length, 12);
  assert.equal(embedded.provenance.source, scene.provenance.source);
  assert.deepEqual([...Object.keys(embedded.tips)].sort(), ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']);
  for (const [month, tip] of Object.entries(embedded.tips)) {
    assert.equal(typeof tip, 'string');
    assert.ok(tip.length >= 40 && tip.length <= 60, `tip ${month} must stay inside the strip budget`);
    assert.doesNotMatch(tip, /[;"«»]/, `tip ${month} must stay plain`);
  }
  assert.deepEqual(Object.keys(embedded.avatars).sort(), Object.keys(delivered.avatars).sort());
  for (const [profile, source64] of Object.entries(embedded.avatars)) {
    assert.match(source64, /^data:image\/png;base64,/, `${profile} must ship as an inline PNG`);
  }
  // The tips and avatars live only in the shipped bundle: the source stays art-free.
  assert.doesNotMatch(source, /data:image\/png;base64/);
  for (const tip of Object.values(embedded.tips)) assert.ok(!source.includes(tip), 'the monthly tips ship in the bundle only');
});
