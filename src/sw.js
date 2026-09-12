import * as store from './adapters/storage.js';
import * as alarms from './adapters/alarms.js';
import { registerExamScript } from './adapters/scripting.js';
import { getWindow, focusedWindowId } from './adapters/windows.js';
import { normalize, validate, resolved } from './core/config.js';
import { initial, reduce } from './core/session.js';
import { headerLine, formatLine, chainLine } from './core/logline.js';
import { GENESIS, shortHash } from './core/hashchain.js';

const GAP_MS = 90000;
const now = () => Date.now();

let queue = Promise.resolve();
const enqueue = (fn) => { queue = queue.catch(() => {}).then(fn); return queue; };
export const settled = () => queue;

async function loadConfig() {
  const { config } = await store.get('config');
  const cfg = normalize(config);
  return validate(cfg).length ? null : resolved(cfg);
}

async function applyConfigNow() {
  const { config } = await store.get('config');
  const cfg = normalize(config);
  const errors = validate(cfg);
  await store.patchMeta({ configErrors: errors });
  if (errors.length) return;
  await registerExamScript(resolved(cfg));
  await alarms.setPeriodic('periodic', cfg.shotIntervalMin);
}

export const applyConfig = () => enqueue(applyConfigNow);

export function dispatch(input) {
  return enqueue(async () => {
    const cfg = await loadConfig();
    if (!cfg) return;
    const st = await store.get(['session', 'events', 'lines', 'lastHash', 'meta']);
    let session = st.session || initial();
    let { events = [], lines = [], lastHash = GENESIS } = st;
    const meta = st.meta || {};
    const newEvents = [];
    if (session.state === 'ARMED' && meta.lastSeenAt && input.at - meta.lastSeenAt > GAP_MS) {
      const g = reduce(session, { kind: 'GAP', at: input.at, lastSeenAt: meta.lastSeenAt, reason: input.kind === 'STARTUP' ? 'browser-restart' : 'sw-restart' }, cfg);
      session = g.session;
      newEvents.push(...g.events);
    }
    const r = reduce(session, input, cfg);
    newEvents.push(...r.events);
    if (r.session.state === 'ARMED' && session.state === 'IDLE') {
      const h = headerLine(r.session);
      events = []; lines = [h]; lastHash = await shortHash(h);
      await store.set({ shots: {} });
    }
    for (const ev of newEvents) {
      const line = chainLine(formatLine(ev), lastHash);
      ev.hash = lastHash = await shortHash(line);
      lines.push(line);
      events.push(ev);
    }
    await store.set({ session: r.session, events, lines, lastHash });
    await store.patchMeta({ lastSeenAt: input.at });
    await runEffects(r.effects, cfg);
  });
}

async function runEffects(effects, cfg) {
  for (const e of effects) {
    if (e.type === 'ABANDON_ALARM_SET') await alarms.setAt('abandon', e.when);
    else if (e.type === 'ABANDON_ALARM_CLEAR') await alarms.clear('abandon');
    else if (e.type === 'PROBE') setTimeout(probe, 0);
  }
}

async function probeWindow() {
  const { session } = await store.get('session');
  if (session?.state !== 'ARMED') return;
  const w = await getWindow(session.examWindowId);
  if (w) await dispatch({ kind: 'WINDOW_STATE', windowId: w.id, state: w.state, at: now() });
}

export async function probe() {
  await dispatch({ kind: 'FOCUS', windowId: await focusedWindowId(), at: now() });
  await probeWindow();
}

async function boot() {
  await applyConfig();
  await alarms.setPeriodic('tick', 0.5);
  await chrome.idle.setDetectionInterval(60);
}

chrome.runtime.onInstalled.addListener(boot);
chrome.runtime.onStartup.addListener(boot);
chrome.storage.onChanged.addListener((changes) => { if (changes.config) applyConfig(); });
