import * as sdk from '@hermes/plugin-sdk';
import { useEffect, useRef, useState } from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';

const { host, useValue, useQuery, ROUTES_AREA, SIDEBAR_NAV_AREA, PALETTE_AREA } = sdk;
const gatewayActivationEpoch = sdk.gatewayActivationEpoch ?? (() => null);
const useGatewayActivationEpoch = sdk.useGatewayActivationEpoch ?? gatewayActivationEpoch;
const unavailable = sdk.atom(null);

const ART = __BONSAI_ART__;

// Stable profile-to-sprite projection: exactly one drawn bonsai per agent, never a filler.
export function layoutTrees(art, { profile, busy, agents, busyAgents } = {}) {
  const sprites = art.trees ?? [];
  const roster = [];
  const seen = new Set();
  for (const agent of Array.isArray(agents) ? agents : []) {
    const name = agent?.profile;
    if (typeof name === 'string' && name && !seen.has(name)) { seen.add(name); roster.push(name); }
  }
  if (!roster.length || !sprites.length) return [];
  const ranked = roster.map(name => ({ name, rank: profileHash(name) }))
    .sort((left, right) => left.rank - right.rank || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  const chosen = ranked.slice(0, sprites.length);
  if (profile && seen.has(profile) && !chosen.some(entry => entry.name === profile)) {
    chosen[chosen.length - 1] = ranked.find(entry => entry.name === profile);
  }
  const placed = new Map();
  const taken = new Set();
  for (const entry of chosen) {
    let index = entry.rank % sprites.length;
    while (taken.has(index)) index = (index + 1) % sprites.length;
    taken.add(index);
    placed.set(entry.name, sprites[index]);
  }
  // Busy agents step onto the drawn pedestals, in the same stable ranking order; a busy
  // focused agent keeps the first pedestal so the caption never jumps around the artwork.
  const working = new Set();
  for (const [name, session] of Object.entries(busyAgents ?? {})) if (session) working.add(name);
  const stands = art.stands ?? [];
  const pedestals = new Map();
  for (const entry of ranked) {
    if (pedestals.size >= stands.length) break;
    if (entry.name === profile && busy) pedestals.set(entry.name, stands[pedestals.size]);
    else if (working.has(entry.name)) pedestals.set(entry.name, stands[pedestals.size]);
  }
  return roster.filter(name => placed.has(name)).map(name => {
    const tree = placed.get(name);
    const assigned = Boolean(profile) && name === profile;
    const stand = pedestals.get(name) ?? null;
    return {
      ...tree, profile: name, assigned, location: stand ? 'stand' : 'shelf',
      x: stand ? stand.x + (stand.width - tree.width) / 2 : tree.x,
      y: stand ? stand.y + 2 - tree.height : tree.y
    };
  });
}

function profileHash(profile) {
  let hash = 0;
  for (const character of profile) hash = (Math.imul(hash, 31) + character.codePointAt(0)) >>> 0;
  return hash;
}

// Screen-to-drawing placement stays inside the artwork; the cat never hides under the frame.
export function placeCat(art, x, y) {
  return {
    x: Math.max(0, Math.min(art.width - art.cat.width, x)),
    y: Math.max(0, Math.min(art.height - art.cat.height, y))
  };
}

// The cat wakes somewhere new each session, seeded so tests and replays agree.
export function spawnCat(art, random = Math.random) {
  return placeCat(art, random() * (art.width - art.cat.width), random() * (art.height - art.cat.height));
}

// Analytical motion uses accumulated monotonic milliseconds, not frame increments, so the
// patrol is frame-independent and every viewer sees the same walk. The monk is never frozen:
// it drifts at a slow idle pace all the time, quicker while its agent works, and the walk is
// a triangle of +/-30 px around its drawn home, so it always comes back to it.
export const MONK_WALK = { speedPxPerSecond: 8, idleSpeedPxPerSecond: 2, amplitude: 30 };

export function advanceMonk(previous, focus, now, art) {
  const key = JSON.stringify([focus.profile, focus.sessionId]);
  const busy = Boolean(focus.busy);
  const elapsed = previous && Number.isFinite(previous.at) && now > previous.at ? now - previous.at : 0;
  const origin = art.monk;
  const span = 4 * MONK_WALK.amplitude;
  const perSecond = busy ? MONK_WALK.speedPxPerSecond : MONK_WALK.idleSpeedPxPerSecond;
  // Distance walked, wrapped on the wave period: the phase is what places the monk, so the
  // position stays continuous when the pace changes and never depends on the tick rate.
  const walked = ((previous?.walked ?? 0) + (elapsed / 1000) * perSecond) % span;
  const phase = walked;
  const offset = phase <= MONK_WALK.amplitude ? phase
    : phase <= 3 * MONK_WALK.amplitude ? 2 * MONK_WALK.amplitude - phase : phase - span;
  return {
    key, at: now, busy, walked,
    x: Math.max(0, Math.min(art.width - origin.width, origin.x + offset)),
    y: Math.max(0, Math.min(art.height - origin.height, origin.y))
  };
}

export function readouts(usage, now = new Date(), locale, routines) {
  const cost = usage?.cost_usd;
  const tokens = usage?.total;
  return {
    time: now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
    date: now.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' }),
    cost: typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? `$${cost.toFixed(4)}` : 'Unavailable',
    tokens: typeof tokens === 'number' && Number.isFinite(tokens) && tokens >= 0 ? tokens.toLocaleString('en-GB') : 'Unavailable',
    crons: routineSummary(routines ?? null), season: seasonLine(now)
  };
}

export const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const SEASONS_FR = { winter: 'Hiver', spring: 'Printemps', summer: 'Été', autumn: 'Automne' };

// Season and month are read from the local clock, in French, with no locale guessing.
export function seasonOf(now = new Date()) {
  const month = now.getMonth();
  const key = month === 11 || month <= 1 ? 'winter' : month <= 4 ? 'spring' : month <= 7 ? 'summer' : 'autumn';
  return { key, label: SEASONS_FR[key], month: MONTHS_FR[month], index: month + 1 };
}

export function seasonLine(now = new Date()) {
  const season = seasonOf(now);
  return `${season.label} · ${season.month}`;
}

// One short care line per month, shipped with the artwork and never invented at render time.
export function careTip(art, now = new Date()) {
  const tip = art?.tips?.[String(seasonOf(now).index).padStart(2, '0')];
  return typeof tip === 'string' && tip.trim() ? tip.trim() : null;
}

// Tool plaques: the four black readout rectangles. They are movable objects with a fixed
// stacking order; the one under the finger only comes forward while it is being dragged.
export const TOOL_KEYS = ['time', 'date', 'crons', 'cost'];

export function toolZ(key, front) {
  if (front === key) return TOOL_KEYS.length + 1;
  const index = TOOL_KEYS.indexOf(key);
  return index < 0 ? 0 : index + 1;
}

export function placeTool(art, rect, x, y) {
  return {
    x: Math.max(0, Math.min(art.width - rect.width, x)),
    y: Math.max(0, Math.min(art.height - rect.height, y))
  };
}

export function initialTools(art) {
  const tools = {};
  for (const key of TOOL_KEYS) if (art.hud?.[key]) tools[key] = { x: art.hud[key].x, y: art.hud[key].y };
  return tools;
}

export function avatarFor(art, profile) {
  const source = art?.avatars?.[profile];
  return typeof source === 'string' && source.startsWith('data:image/') ? source : null;
}

export function monogram(profile) {
  const text = typeof profile === 'string' ? profile.trim() : '';
  return text ? text.slice(0, 1).toUpperCase() : '?';
}

// HUD frames are sized in container units so they scale with the stage. A frame
// is 9.18cqw wide with 1cqw of padding a side, so the widest honest readout has
// to fit in what is left or the browser breaks it mid-word.
export const HUD_TEXT = { fontCqw: 0.95, paddingCqw: 1, monospaceAdvanceEm: 0.6, widest: 'Unavailable' };

export function hudReadoutFits(rect, stageWidth) {
  const frameCqw = (rect.width / stageWidth) * 100;
  const usable = frameCqw - 2 * HUD_TEXT.paddingCqw;
  return HUD_TEXT.widest.length * HUD_TEXT.monospaceAdvanceEm * HUD_TEXT.fontCqw <= usable;
}

// session.info is a read-only projection; never fetch or infer from messages.
export async function loadSessionTitle(scope) {
  const current = () => {
    const owner = host.state.focusedSessionOwner?.get();
    return scope.epoch !== null && scope.sessionId && host.state.focusedSessionId?.get() === scope.sessionId
      && host.state.focusedSessionProfile?.get() === scope.profile
      && host.state.connectionId?.get() === scope.connectionId
      && host.state.profile.get() === scope.profile
      && owner?.connectionId === scope.connectionId && owner?.profile === scope.profile
      && gatewayActivationEpoch() === scope.epoch;
  };
  if (!current()) return null;
  try {
    const info = await host.request('session.info', { session_id: scope.sessionId });
    if (!current() || typeof info?.title !== 'string') return null;
    return info.title.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) || null;
  } catch {
    return null;
  }
}

// Cron routines are read from each profile's own gateway store; never inferred from art.
// A routine runs an agent and recurs: script-only watchers, one-shots and finished jobs are not routines.
export function formatRoutineWhen(nextAt, locale) {
  if (typeof nextAt !== 'string') return null;
  const at = new Date(nextAt);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleString(locale, { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function routinesByAgent(entries) {
  const agents = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const profile = typeof entry?.profile === 'string' ? entry.profile.trim() : '';
    if (!profile) continue;
    const routines = [];
    for (const job of Array.isArray(entry.jobs) ? entry.jobs : []) {
      if (!job || typeof job !== 'object') continue;
      if (job.no_agent === true) continue;
      if (job.state === 'completed') continue;
      const schedule = typeof job.schedule === 'string' ? job.schedule.trim() : '';
      if (!schedule || /^once\b/i.test(schedule)) continue;
      const id = typeof job.job_id === 'string' ? job.job_id : '';
      const name = (typeof job.name === 'string' && job.name.trim()) || id || 'unnamed';
      const nextAt = typeof job.next_run_at === 'string' && !Number.isNaN(Date.parse(job.next_run_at)) ? job.next_run_at : null;
      routines.push({ id, name, schedule, nextAt, suspended: job.enabled === false || job.state === 'paused' });
    }
    if (!routines.length) continue;
    const when = routine => (routine.suspended || routine.nextAt === null ? Number.POSITIVE_INFINITY : Date.parse(routine.nextAt));
    routines.sort((a, b) => when(a) - when(b) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    let nextAt = null;
    for (const routine of routines) {
      if (!routine.suspended && routine.nextAt !== null && (nextAt === null || Date.parse(routine.nextAt) < Date.parse(nextAt))) nextAt = routine.nextAt;
    }
    agents.push({
      connectionId: typeof entry.connectionId === 'string' ? entry.connectionId : null,
      profile, label: (typeof entry.label === 'string' && entry.label.trim()) || profile,
      routines,
      activeCount: routines.filter(routine => !routine.suspended).length,
      suspendedCount: routines.filter(routine => routine.suspended).length,
      nextAt
    });
  }
  agents.sort((a, b) => a.profile.localeCompare(b.profile) || String(a.connectionId).localeCompare(String(b.connectionId)));
  return agents;
}

export async function loadRoutines(api = host) {
  if (typeof api?.profileRoutes !== 'function' || typeof api?.requestProfile !== 'function') return null;
  let routes;
  try { routes = await api.profileRoutes(); } catch { return null; }
  if (!Array.isArray(routes)) return null;
  const wanted = routes.filter(route => route && typeof route.profile === 'string' && route.profile.trim());
  let labels = {};
  try {
    const listed = await api.profiles?.list?.();
    if (Array.isArray(listed?.profiles)) {
      labels = Object.fromEntries(listed.profiles
        .filter(profile => profile && typeof profile.name === 'string')
        .map(profile => [profile.name, typeof profile.display_name === 'string' && profile.display_name.trim() ? profile.display_name.trim() : profile.name]));
    }
  } catch { labels = {}; }
  const settled = await Promise.allSettled(wanted.map(route => api.requestProfile(
    route, 'cron.manage', { action: 'list', include_disabled: true, profile: route.targetProfile || route.profile }
  )));
  let errors = 0;
  const entries = [];
  settled.forEach((outcome, index) => {
    const route = wanted[index];
    if (outcome.status !== 'fulfilled') { errors += 1; return; }
    const data = outcome.value;
    if (!data || data.success === false || typeof data.error === 'string') { errors += 1; return; }
    const scoped = typeof data.scoped === 'string' ? data.scoped : undefined;
    if (scoped !== undefined && scoped !== (route.targetProfile || route.profile)) { errors += 1; return; }
    entries.push({ connectionId: route.connectionId, profile: route.profile, label: labels[route.profile], jobs: Array.isArray(data.jobs) ? data.jobs : [] });
  });
  return { agents: routinesByAgent(entries), errors };
}

// The roster comes from the gateway's own profile routes, so every known agent gets a drawn
// bonsai even when it has no recurring routine yet. Routines only decorate, they never roster.
export async function loadAgentRoster(api = host) {
  if (typeof api?.profileRoutes !== 'function') return null;
  let routes;
  try { routes = await api.profileRoutes(); } catch { return null; }
  if (!Array.isArray(routes)) return null;
  const seen = new Set();
  const agents = [];
  for (const route of routes) {
    const name = typeof route?.profile === 'string' ? route.profile.trim() : '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    agents.push({ connectionId: typeof route?.connectionId === 'string' ? route.connectionId : null, profile: name });
  }
  agents.sort((left, right) => profileHash(left.profile) - profileHash(right.profile) || left.profile.localeCompare(right.profile));
  return { agents, errors: 0 };
}

export function routineSummary(routines) {
  if (!routines || !Array.isArray(routines.agents)) return 'Unavailable';
  const agents = routines.agents;
  const count = agents.reduce((total, agent) => total + (Array.isArray(agent.routines) ? agent.routines.length : 0), 0);
  if (!count) return (routines.errors ?? 0) > 0 ? 'Unavailable' : 'No recurring agent routines';
  return `${agents.length} agent${agents.length === 1 ? '' : 's'} · ${count} routine${count === 1 ? '' : 's'}${(routines.errors ?? 0) > 0 ? ' · incomplete' : ''}`;
}

const BUSY_STATUSES = ['starting', 'waiting', 'working', 'streaming', 'resuming'];

function scopeProfile(route) {
  return (route && (route.targetProfile || route.profile)) || undefined;
}

function agentKey(profile) {
  return typeof profile === 'string' ? profile.trim().toLowerCase() : '';
}

export function resolveAgentRoute(routes, profile) {
  const wanted = agentKey(profile);
  if (!wanted || !Array.isArray(routes)) return null;
  return routes.find(route => route && (agentKey(route.profile) === wanted || agentKey(route.targetProfile) === wanted)) ?? null;
}

export function pickBusySession(sessions) {
  if (!Array.isArray(sessions)) return null;
  let best = null;
  for (const session of sessions) {
    if (!session || typeof session.id !== 'string' || !session.id) continue;
    if (!BUSY_STATUSES.includes(session.status)) continue;
    const at = Number.isFinite(session.last_active) ? session.last_active : 0;
    if (!best || at > best.at) best = { id: session.id, at };
  }
  return best ? { id: best.id } : null;
}

export function pickStoredSession(sessions) {
  if (!Array.isArray(sessions)) return null;
  const usable = sessions.filter(session => session && typeof session.id === 'string' && session.id && !session.is_internal_child);
  if (!usable.length) return null;
  let best = usable[0];
  for (const session of usable.slice(1)) {
    if ((Number.isFinite(session.last_active) ? session.last_active : -Infinity)
      > (Number.isFinite(best.last_active) ? best.last_active : -Infinity)) best = session;
  }
  return best;
}

export async function openAgentConversation(profile, api = host) {
  if (!api || typeof api.profileRoutes !== 'function') return { ok: false, reason: 'unsupported' };
  let route;
  try { route = resolveAgentRoute(await api.profileRoutes(), profile); } catch { return { ok: false, reason: 'failed' }; }
  if (!route) return { ok: false, reason: 'no-route' };
  let stored = null;
  if (typeof api.listPersistedSessions === 'function') {
    try {
      const page = await api.listPersistedSessions(route, { profile: route.profile, limit: 5 });
      stored = pickStoredSession(page?.sessions);
    } catch { return { ok: false, reason: 'failed' }; }
  }
  if (stored) {
    if (typeof api.openSession !== 'function') return { ok: false, reason: 'unsupported' };
    try {
      await api.openSession(stored.id, { route, profile: route.profile, intent: 'in-place', awaitHydration: true, forceResume: true });
    } catch { return { ok: false, reason: 'failed' }; }
    return { ok: true, kind: 'session', storedId: stored.id };
  }
  if (typeof api.newChat !== 'function') return { ok: false, reason: 'unsupported' };
  try { await api.newChat(route); } catch { return { ok: false, reason: 'failed' }; }
  return { ok: true, kind: 'draft' };
}

export async function interruptAgent(profile, api = host) {
  if (!api || typeof api.profileRoutes !== 'function' || typeof api.requestProfile !== 'function') {
    return { ok: false, reason: 'unsupported' };
  }
  let route;
  try { route = resolveAgentRoute(await api.profileRoutes(), profile); } catch { return { ok: false, reason: 'failed' }; }
  if (!route) return { ok: false, reason: 'no-route' };
  try {
    const page = await api.requestProfile(route, 'session.active_list', { profile: scopeProfile(route) });
    const busy = pickBusySession(page?.sessions);
    if (!busy) return { ok: false, reason: 'not-busy' };
    const result = await api.requestProfile(route, 'session.interrupt', { session_id: busy.id });
    if (result && result.interrupted === false) return { ok: false, reason: 'not-interrupted' };
    return { ok: true, sessionId: busy.id };
  } catch { return { ok: false, reason: 'failed' }; }
}

export async function loadAgentActivity(api = host) {
  if (!api || typeof api.profileRoutes !== 'function' || typeof api.requestProfile !== 'function') return null;
  let routes;
  try { routes = await api.profileRoutes(); } catch { return { busy: {}, errors: 1 }; }
  const wanted = Array.isArray(routes) ? routes.filter(route => route && agentKey(route.profile)) : [];
  const settled = await Promise.allSettled(wanted.map(route => api.requestProfile(
    route, 'session.active_list', { profile: scopeProfile(route) }
  )));
  let errors = 0;
  const busy = {};
  settled.forEach((outcome, index) => {
    const route = wanted[index];
    if (outcome.status !== 'fulfilled') { errors += 1; return; }
    const session = pickBusySession(outcome.value?.sessions);
    if (session) busy[route.profile] = session.id;
  });
  return { busy, errors };
}

function rectStyle(rect) {
  return {
    position: 'absolute', left: `${rect.x / ART.width * 100}%`, top: `${rect.y / ART.height * 100}%`,
    width: `${rect.width / ART.width * 100}%`, height: `${rect.height / ART.height * 100}%`
  };
}

function sprite(name, rect, extra = {}) {
  return jsx('img', {
    ...extra, 'data-sprite': name, src: rect.src, alt: extra.alt ?? '', draggable: false,
    style: { ...rectStyle(rect), imageRendering: 'pixelated', pointerEvents: 'none', userSelect: 'none', ...extra.style }
  }, extra['data-tree-id'] ?? name);
}

export function GardenPage({ ctx }) {
  const focused = Boolean(host.state.focusedSessionId && host.state.focusedSessionProfile && host.state.focusedUsage);
  const scopeLabel = focused ? 'Focused session only' : 'Primary session only · focused data unavailable';
  const busy = useValue(host.state.busy);
  const profile = useValue(host.state.focusedSessionProfile ?? host.state.profile);
  const sessionId = useValue(host.state.focusedSessionId ?? host.state.activeSessionId);
  const usage = useValue(host.state.focusedUsage ?? unavailable);
  const owner = useValue(host.state.focusedSessionOwner ?? unavailable);
  const connectionId = useValue(host.state.connectionId ?? unavailable);
  const gatewayProfile = useValue(host.state.profile);
  const epoch = useGatewayActivationEpoch();
  const [now, setNow] = useState(() => Date.now());
  const motionRef = useRef(null);
  const [cat, setCat] = useState(() => spawnCat(ART));
  const dragRef = useRef(null);
  const stageRef = useRef(null);
  const beginCatDrag = event => {
    const box = stageRef.current?.getBoundingClientRect?.();
    const scale = box && box.width > 0 ? ART.width / box.width : 1;
    dragRef.current = { pointerId: event.pointerId ?? 0, clientX: event.clientX, clientY: event.clientY, scale, x: cat.x, y: cat.y };
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* no capture outside a real browser */ }
  };
  const moveCat = event => {
    const drag = dragRef.current;
    if (!drag || (event.pointerId ?? 0) !== drag.pointerId) return;
    setCat(placeCat(ART, drag.x + (event.clientX - drag.clientX) * drag.scale, drag.y + (event.clientY - drag.clientY) * drag.scale));
  };
  const endCatDrag = () => { dragRef.current = null; };
  const [tools, setTools] = useState(() => initialTools(ART));
  const [frontTool, setFrontTool] = useState(null);
  const toolDragRef = useRef(null);
  const beginToolDrag = (key, event) => {
    const rect = ART.hud?.[key];
    if (!rect) return;
    const box = stageRef.current?.getBoundingClientRect?.();
    const scale = box && box.width > 0 ? ART.width / box.width : 1;
    const start = tools[key] ?? { x: rect.x, y: rect.y };
    toolDragRef.current = { key, pointerId: event.pointerId ?? 0, clientX: event.clientX, clientY: event.clientY, scale, x: start.x, y: start.y };
    setFrontTool(key);
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* no capture outside a real browser */ }
  };
  const moveTool = event => {
    const drag = toolDragRef.current;
    if (!drag || (event.pointerId ?? 0) !== drag.pointerId) return;
    const rect = ART.hud?.[drag.key];
    if (!rect) return;
    const x = drag.x + (event.clientX - drag.clientX) * drag.scale;
    const y = drag.y + (event.clientY - drag.clientY) * drag.scale;
    setTools(current => ({ ...current, [drag.key]: placeTool(ART, rect, x, y) }));
  };
  const endToolDrag = () => { toolDragRef.current = null; setFrontTool(null); };
  const [monk, setMonk] = useState(() => ({ x: ART.monk.x, y: ART.monk.y }));
  useEffect(() => ctx.setInterval(() => setNow(Date.now()), 1000), [ctx]);
  useEffect(() => {
    const advance = () => {
      motionRef.current = advanceMonk(motionRef.current, { busy, profile, sessionId }, performance.now(), ART);
      setMonk(motionRef.current);
    };
    advance();
    // The monk is never still: the idle drift ticks once a second, work steps it up to 10 Hz,
    // and both paces are analytical, so the walk does not depend on the tick rate.
    return ctx.setInterval(advance, busy ? 100 : 1000);
  }, [ctx, busy, profile, sessionId]);
  const canReadTitle = Boolean(focused && epoch !== null && sessionId && owner?.connectionId === connectionId && owner?.profile === profile && gatewayProfile === profile);
  const titleQuery = useQuery({
    queryKey: ['bonsai-garden', 'title', connectionId, profile, sessionId, epoch, busy, owner?.connectionId, owner?.profile],
    queryFn: () => loadSessionTitle({ sessionId, profile, connectionId, epoch }),
    enabled: canReadTitle,
    staleTime: 15000, retry: false, refetchOnWindowFocus: false
  });
  const routinesReady = typeof host.profileRoutes === 'function' && typeof host.requestProfile === 'function';
  const routinesQuery = useQuery({
    queryKey: ['bonsai-garden', 'routines', connectionId, epoch],
    queryFn: () => loadRoutines(),
    enabled: routinesReady,
    staleTime: 60000, retry: false, refetchOnWindowFocus: false
  });
  const routines = routinesReady ? (routinesQuery.data ?? null) : null;
  const activityQuery = useQuery({
    queryKey: ['bonsai-garden', 'activity', connectionId, epoch],
    queryFn: () => loadAgentActivity(),
    enabled: routinesReady,
    staleTime: 15000, retry: false, refetchOnWindowFocus: false
  });
  const busyAgents = activityQuery.data?.busy ?? {};
  const rosterQuery = useQuery({
    queryKey: ['bonsai-garden', 'roster', connectionId, epoch],
    queryFn: () => loadAgentRoster(),
    enabled: routinesReady,
    staleTime: 60000, retry: false, refetchOnWindowFocus: false
  });
  // The roster comes from the gateway's own profile routes. The focused agent is always kept:
  // a short or stale route list must never make the bonsai the user is watching disappear.
  const routed = rosterQuery.data?.agents?.length ? rosterQuery.data.agents : [];
  const roster = routed.some(agent => agent?.profile === profile)
    ? routed
    : [{ connectionId: connectionId ?? null, profile }, ...routed];
  const trees = layoutTrees(ART, { profile, busy, agents: roster, busyAgents });
  const activeTree = trees.find(tree => tree.assigned);
  const hud = readouts(usage, new Date(now), undefined, routines);
  const routineNote = routinesReady ? `Routines: ${routineSummary(routines)}` : 'Crons unavailable';
  const tip = careTip(ART, new Date(now));
  const taskTitle = (canReadTitle && titleQuery.data) || (busy ? 'Working · title unavailable' : 'No task title available');
  const captionWidth = 260;
  const caption = activeTree && busy && {
    x: Math.max(0, Math.min(ART.width - captionWidth, activeTree.x + activeTree.width + 12)),
    y: Math.max(0, Math.min(ART.height - 28, activeTree.y + activeTree.height - 38)),
    width: captionWidth, height: 28
  };
  const labels = { time: 'Local time', date: 'Local date', crons: 'Crons', cost: 'Session cost · USD', season: '' };
  return jsxs('section', {
    'aria-label': 'Bonsai Garden',
    style: { height: '100%', overflow: 'auto', padding: 12, boxSizing: 'border-box', color: 'var(--ui-text-primary)', background: 'var(--ui-bg-editor)' },
    children: [
      jsx('p', { 'data-focus-label': true, style: { margin: '0 0 8px', fontSize: 12, color: 'var(--ui-text-secondary)' }, children: `${profile || 'No profile'} · ${busy ? 'Working' : 'Idle'} · ${scopeLabel}` }),
      jsxs('div', {
        'data-bonsai-stage': true, role: 'group', 'aria-label': 'Garden artwork and focused session', ref: stageRef,
        style: { position: 'relative', width: '100%', maxWidth: ART.width, aspectRatio: `${ART.width} / ${ART.height}`, overflow: 'hidden', containerType: 'inline-size', margin: '0 auto', imageRendering: 'pixelated' },
        children: [
          sprite('background', { x: 0, y: 0, width: ART.width, height: ART.height, src: ART.background }),
          ...trees.map(tree => sprite('tree', tree, {
            'data-tree-id': tree.id, 'data-tree-assigned': String(tree.assigned), 'data-location': tree.location,
            alt: `${tree.profile} · ${tree.assigned && busy ? 'working' : 'idle'} bonsai`
          })),
          // One invisible hit area per drawn bonsai, over its sprite and under the cat, the monk
          // and the plaques: clicking a tree opens that agent's conversation, exactly like its
          // roster button. A placard dragged on top of a tree covers it, as a object would.
          ...trees.map(tree => jsx('button', {
            type: 'button', 'data-tree-hit': tree.profile, 'data-tree-hit-state': tree.assigned && busy ? 'working' : 'idle',
            'aria-label': `Open conversation with ${tree.profile}`,
            title: `Open ${tree.profile}'s conversation`,
            onClick: () => { openAgentConversation(tree.profile); },
            style: {
              ...rectStyle(tree), zIndex: 0, margin: 0, padding: 0, border: 'none', display: 'block',
              background: 'transparent', cursor: 'pointer', pointerEvents: 'auto'
            }
          }, `tree-hit-${tree.profile}`)),
          sprite('cat', { ...ART.cat, x: cat.x, y: cat.y }, {
            'data-cat-drag': 'true', style: { pointerEvents: 'auto', cursor: 'grab' },
            onPointerDown: beginCatDrag, onPointerMove: moveCat,
            onPointerUp: endCatDrag, onPointerCancel: endCatDrag
          }),
          sprite('monk', { ...ART.monk, x: monk.x, y: monk.y }),
          ...Object.entries(ART.hud ?? {}).map(([key, rect]) => {
            const movable = TOOL_KEYS.includes(key);
            // The drag state carries only x/y: the frame keeps the painted rectangle's size
            // so the black plaque covers that rectangle instead of shrinking onto its own text.
            const position = movable ? { ...rect, ...tools[key] } : rect;
            return jsxs('div', {
              'data-hud': key, 'data-tool': movable ? key : undefined, 'data-draggable': String(movable),
              style: {
                ...rectStyle(position), zIndex: toolZ(key, frontTool),
                display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
                boxSizing: 'border-box', padding: key === 'season' ? '0 2%' : `${HUD_TEXT.paddingCqw}%`, overflow: 'hidden', overflowWrap: 'anywhere',
                textAlign: 'center', fontFamily: "'Agave', monospace", fontSize: `${key === 'season' ? 0.9 : HUD_TEXT.fontCqw}cqw`, lineHeight: 1.35,
                // These plaques ARE the tools: opaque black pavers, white text and one piece of
                // information each. They are movable objects, so the one under the finger is the
                // one that comes forward — and it neither shrinks nor fades while it is dragged.
                color: '#ffffff', background: movable ? '#000' : 'transparent',
                cursor: movable ? (frontTool === key ? 'grabbing' : 'grab') : 'default', pointerEvents: movable ? 'auto' : 'none', userSelect: 'none'
              },
              ...(movable ? { onPointerDown: event => beginToolDrag(key, event), onPointerMove: moveTool, onPointerUp: endToolDrag, onPointerCancel: endToolDrag } : {}),
              children: [labels[key] && jsx('span', { style: { fontSize: '0.8em' }, children: labels[key] }), jsx('strong', { children: hud[key] ?? 'Unavailable' })]
            }, key);
          }),
          caption && jsx('div', {
            'data-task-title': true, title: taskTitle,
            style: { ...rectStyle(caption), display: 'flex', alignItems: 'center', padding: '0 6px', boxSizing: 'border-box', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontSize: '1cqw', borderRadius: 3, color: 'var(--ui-text-primary)', background: 'var(--ui-bg-elevated)' },
            children: `${profile || 'Agent'} · ${taskTitle}`
          })
        ]
      }),
      trees.length ? jsxs('div', {
        'data-roster': true, 'aria-label': 'Agents · one drawn bonsai each',
        style: { margin: '8px 0 0', fontSize: 12, color: 'var(--ui-text-secondary)', display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
        children: [
          jsx('strong', { style: { color: 'var(--ui-text-primary)' }, children: `Agents · ${trees.length}` }),
          ...trees.map(tree => jsxs('span', {
            'data-roster-agent': tree.profile, 'data-roster-state': busyAgents[tree.profile] ? 'working' : 'idle',
            style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0 6px', borderRadius: 3, background: tree.assigned ? 'var(--ui-bg-elevated)' : 'transparent' },
            children: [
              avatarFor(ART, tree.profile)
                ? jsx('img', { 'data-avatar': tree.profile, src: avatarFor(ART, tree.profile), alt: '', width: 16, height: 16, style: { borderRadius: 3, imageRendering: 'pixelated' } })
                : jsx('span', { 'data-monogram': tree.profile, 'aria-hidden': 'true', style: { fontFamily: 'monospace', fontWeight: 700 }, children: monogram(tree.profile) }),
              jsx('span', { children: tree.profile })
            ]
          }, tree.profile))
        ]
      }) : null,
      routines?.agents?.length ? jsxs('div', {
        'data-routines': true, 'aria-label': 'Agent routines · live gateway cron stores',
        style: { margin: '8px 0 0', fontSize: 12, color: 'var(--ui-text-secondary)', display: 'flex', flexDirection: 'column', gap: 4 },
        children: [
          jsx('strong', { style: { color: 'var(--ui-text-primary)' }, children: 'Agent routines · live gateway cron stores' }),
          ...routines.agents.map(agent => jsxs('div', {
            'data-agent': agent.profile,
            style: { display: 'flex', flexDirection: 'column' },
            children: [
              jsxs('span', {
                style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
                children: [
                  avatarFor(ART, agent.profile)
                    ? jsx('img', { 'data-avatar': agent.profile, src: avatarFor(ART, agent.profile), alt: '', width: 16, height: 16, style: { borderRadius: 3, imageRendering: 'pixelated' } })
                    : jsx('span', { 'data-monogram': agent.profile, 'aria-hidden': 'true', style: { fontFamily: 'monospace', fontWeight: 700 }, children: monogram(agent.profile) }),
                  jsx('span', { children: `${agent.label} · ${agent.activeCount} active${agent.suspendedCount ? ` · ${agent.suspendedCount} suspended` : ''}` }),
                  jsx('button', {
                    type: 'button', 'data-gesture': 'open', children: 'Conversation',
                    'aria-label': `Open conversation with ${agent.label}`, title: `Open ${agent.label}'s last conversation`,
                    onClick: () => { openAgentConversation(agent.profile); },
                    style: { font: 'inherit', padding: '0 6px', borderRadius: 3, cursor: 'pointer' }
                  }),
                  busyAgents[agent.profile] ? jsx('button', {
                    type: 'button', 'data-gesture': 'interrupt', children: 'Stop',
                    'aria-label': `Stop ${agent.label}`, title: `Interrupt ${agent.label}'s busy session`,
                    onClick: () => { interruptAgent(agent.profile).then(result => { if (result.ok) activityQuery.refetch(); }); },
                    style: { font: 'inherit', padding: '0 6px', borderRadius: 3, cursor: 'pointer' }
                  }) : null
                ]
              }),
              ...agent.routines.map(routine => {
                const when = routine.suspended ? null : formatRoutineWhen(routine.nextAt);
                return jsx('span', {
                  'data-routine': routine.id || routine.name, 'data-status': routine.suspended ? 'suspended' : 'active',
                  style: { paddingLeft: 12 },
                  children: `${routine.name} · ${routine.schedule}${routine.suspended ? ' · suspended' : when ? ` · next ${when}` : ''}`
                }, routine.id || routine.name);
              })
            ]
          }, `${agent.connectionId ?? ''}::${agent.profile}`))
        ]
      }) : null,
      jsx('p', {
        style: { margin: '8px 0 0', fontSize: 12, color: 'var(--ui-text-secondary)' },
        children: `Hermes Desktop · ${scopeLabel} · ${seasonLine(new Date(now))} · One bonsai per agent · CLI activity unavailable · Tokens: ${hud.tokens} · ${routineNote}${tip ? ` · Care: ${tip}` : ''}`
      })
    ]
  });
}

export default {
  id: 'bonsai-garden',
  name: 'Bonsai Garden',
  register(ctx) {
    ctx.registerMany([
      { id: 'page', area: ROUTES_AREA, data: { path: '/bonsai-garden' }, render: () => jsx(GardenPage, { ctx }) },
      { id: 'nav', area: SIDEBAR_NAV_AREA, data: { path: '/bonsai-garden', label: 'Garden', codicon: 'symbol-color' } },
      { id: 'open', area: PALETTE_AREA, data: { id: 'bonsai-garden.open', label: 'Open Bonsai Garden', keywords: ['bonsai', 'garden'], run: () => host.navigate('/bonsai-garden') } }
    ]);
  }
};
