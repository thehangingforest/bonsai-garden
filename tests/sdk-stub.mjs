// Test-only host boundary. Production imports still resolve to Hermes Desktop.
import { createRequire } from 'node:module';
const require = createRequire('/home/papa/.hermes/hermes-agent/apps/desktop/package.json');
const React = require('react');
export const ROUTES_AREA = 'routes';
export const SIDEBAR_NAV_AREA = 'sidebar.nav';
export const PALETTE_AREA = 'palette';
export function atom(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    get: () => value,
    set(next) { value = next; for (const listener of listeners) listener(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  };
}
export const host = {
  state: {
    busy: atom(false), activeSessionId: atom('runtime-a'), focusedSessionId: atom('runtime-a'),
    focusedStoredSessionId: atom('stored-a'), focusedSessionProfile: atom('default'),
    focusedSessionOwner: atom({ connectionId: 'local', profile: 'default' }),
    focusedUsage: atom(null), connectionId: atom('local'), profile: atom('default')
  },
  navigate(path) { host.navigated = path; },
  profileRoutes: async () => [{ connectionId: 'local', profile: 'default', targetProfile: 'default', mode: 'local' }],
  requestProfile: async () => ({ title: null })
};
export function useValue(store) {
  return React.useSyncExternalStore(store.subscribe, store.get, store.get);
}
export let epoch = 1;
export function setEpoch(value) { epoch = value; }
export function gatewayActivationEpoch() { return epoch; }
export function useGatewayActivationEpoch() { return epoch; }
const query = require('@tanstack/react-query');
export const { useQuery, QueryClient, QueryClientProvider } = query;
export function context() {
  const contributions = [];
  const timers = new Map();
  return {
    contributions, timers,
    registerMany(entries) { contributions.push(...entries); return () => contributions.splice(0); },
    register(entry) { contributions.push(entry); return () => {}; },
    setInterval(fn, ms) { const key = {}; timers.set(key, { fn, ms }); return () => timers.delete(key); }
  };
}
export function resetHost() {
  host.state.busy.set(false);
  host.state.focusedSessionId.set('runtime-a');
  host.state.focusedStoredSessionId.set('stored-a');
  host.state.focusedSessionProfile.set('default');
  host.state.focusedSessionOwner.set({ connectionId: 'local', profile: 'default' });
  host.state.focusedUsage.set(null);
  epoch = 1;
  host.profileRoutes = async () => [{ connectionId: 'local', profile: 'default', targetProfile: 'default', mode: 'local' }];
  host.requestProfile = async () => ({ title: null });
}
