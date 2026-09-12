import * as store from './adapters/storage.js';
import * as alarms from './adapters/alarms.js';
import { registerExamScript } from './adapters/scripting.js';
import { getWindow, getAllWindows, focusedWindowId, lastFocusedWindowId } from './adapters/windows.js';
import { getTab, queryAllTabs, queryActiveTab } from './adapters/tabs.js';
import { captureJpeg } from './adapters/capture.js';
import { normalize, validate, resolved } from './core/config.js';
import { initial, reduce } from './core/session.js';
import { headerLine, formatLine, chainLine } from './core/logline.js';
import { GENESIS, shortHash, verify } from './core/hashchain.js';
import { needsShot } from './core/events.js';
import { shotFile } from './core/ids.js';
import { classify } from './core/urlmatch.js';
import { suppressUi, writeFile, eraseOwnCompleted } from './adapters/downloads.js';
import { putText, putBase64, remove, dataUrl, toBase64 } from './core/sink.js';
import { tally } from './core/counters.js';
import { renderSummaryText } from './core/summary-text.js';
import { renderSummaryHtml } from './core/summary-html.js';

const GAP_MS = 90000;
const SHOT_GAP_MS = 2000;
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
    const added = await takeShots(newEvents);
    for (const ev of newEvents) {
      const line = chainLine(formatLine(ev), lastHash);
      ev.hash = lastHash = await shortHash(line);
      lines.push(line);
      events.push(ev);
    }
    if (newEvents.length) {
      const base = `${cfg.subfolder}/${(r.session.state === 'ARMED' ? r.session : session).id}`;
      let { pending = {} } = await store.get('pending');
      pending = putText(pending, `${base}/log.txt`, 'text/plain', lines.join('\n') + '\n');
      for (const s of added) pending = putBase64(pending, `${base}/${s.file}`, 'image/jpeg', s.b64);
      await store.set({ pending });
    }
    const endEffect = r.effects.find(e => e.type === 'END');
    let pendingEnd;
    if (endEffect) {
      const { shots: endShots = {} } = await store.get('shots');
      pendingEnd = { outcome: endEffect.outcome, session: endEffect.session, events: [...events], lines: [...lines], shots: endShots };
      const { meta: currentMeta = {} } = await store.get('meta');
      // events/lines/shots are cleared here, atomically with the pendingEnd snapshot that now
      // holds them: leaving the live clear for endSession's own (later, possibly much later)
      // final write would risk wiping a NEW session armed in between (see below).
      await store.set({ session: r.session, events: [], lines: [], shots: {}, lastHash, meta: { ...currentMeta, pendingEnd } });
    } else {
      await store.set({ session: r.session, events, lines, lastHash });
    }
    await store.patchMeta({ lastSeenAt: input.at });
    await runEffects(r.effects, cfg, pendingEnd);
    if (newEvents.length) await flushNow();
  });
}

async function runEffects(effects, cfg, pendingEnd) {
  for (const e of effects) {
    if (e.type === 'ABANDON_ALARM_SET') await alarms.setAt('abandon', e.when);
    else if (e.type === 'ABANDON_ALARM_CLEAR') await alarms.clear('abandon');
    else if (e.type === 'PROBE') setTimeout(probe, 0);
    else if (e.type === 'END') await endSession(pendingEnd, cfg);
  }
}

async function takeShots(events) {
  const { meta = {}, shots = {} } = await store.get(['meta', 'shots']);
  let last = meta.lastShot || { at: 0, file: null };
  const added = [];
  for (const ev of events) {
    if (!needsShot(ev)) continue;
    if (last.file && ev.t - last.at < SHOT_GAP_MS) { ev.shot = last.file; continue; }
    try {
      const windowId = ev.windowId >= 0 ? ev.windowId : await lastFocusedWindowId();
      const b64 = await captureJpeg(windowId);
      const file = shotFile(ev.t, ev.name);
      shots[file] = b64;
      added.push({ file, b64 });
      ev.shot = file;
      last = { at: ev.t, file };
    } catch (e) {
      ev.data.shotError = String(e?.message || e);
    }
  }
  if (added.length) { await store.set({ shots }); await store.patchMeta({ lastShot: last }); }
  return added;
}

async function flushNow() {
  let { pending = {} } = await store.get('pending');
  let error = null;
  for (const [path, f] of Object.entries(pending)) {
    try {
      await writeFile(path, dataUrl(f.mime, f.b64));
      pending = remove(pending, path);
    } catch (e) {
      error = `${path}: ${e?.message || e}`;
    }
  }
  await store.set({ pending });
  await store.patchMeta({ lastFlushAt: now(), lastFlushError: error });
}

export const flush = () => enqueue(flushNow);

// e.events/e.lines/e.shots are a snapshot taken when pendingEnd was written (dispatch()), not
// read live from storage: a replay (recover()/tick() re-running this from meta.pendingEnd) must
// render byte-identical files regardless of what the first, possibly-interrupted attempt already
// did to the live events/lines/shots keys.
async function endSession(e, cfg) {
  const { session, outcome, events, lines, shots } = e;
  const base = `${cfg.subfolder}/${session.id}`;
  const ctx = { session, outcome, endedAt: now(), events, tally: tally(events), integrity: { ...(await verify(lines)), lines: lines.length } };
  const { pending: p0 = {} } = await store.get('pending');
  let pending = putText(p0, `${base}/log.txt`, 'text/plain', lines.join('\n') + '\n');
  pending = putText(pending, `${base}/events.jsonl`, 'application/json', events.map(ev => JSON.stringify(ev)).join('\n') + '\n');
  pending = putText(pending, `${base}/summary.txt`, 'text/plain', renderSummaryText(ctx));
  await store.set({ pending });
  await flushNow();
  try {
    await writeFile(`${base}/summary.html`, dataUrl('text/html', toBase64(renderSummaryHtml({ ...ctx, shots, inlineShots: true }))));
  } catch {
    const { pending: p1 = {} } = await store.get('pending');
    await store.set({ pending: putText(p1, `${base}/summary.html`, 'text/html', renderSummaryHtml({ ...ctx, shots, inlineShots: false })) });
    await flushNow();
  }
  // events/lines/shots are NOT touched here: they were already cleared atomically with the
  // pendingEnd snapshot when it was created (dispatch()), and by the time a replay reaches this
  // point they may belong to an entirely different, newer session that has since armed.
  await store.patchMeta({ pendingEnd: null });
}

// Reads meta.pendingEnd INSIDE the enqueued closure, not before: a tick/recover racing an
// in-flight dispatch()+endSession() must see it only after that call (and its own pendingEnd
// clear) has actually finished, never a stale value captured before the queue was even reached.
function finishPendingEnd() {
  return enqueue(async () => {
    const { meta = {} } = await store.get('meta');
    if (!meta.pendingEnd) return;
    const cfg = await loadConfig();
    if (cfg) await endSession(meta.pendingEnd, cfg);
  });
}

export async function tick() {
  await finishPendingEnd();
  const { session } = await store.get('session');
  const windows = (await getAllWindows()).map(w => ({ id: w.id, state: w.state }));
  const examTabPresent = session?.state === 'ARMED' && (await getTab(session.examTabId)) !== null;
  await dispatch({ kind: 'TICK', at: now(), windows, examTabPresent });
  await flush();
}

export async function recover() {
  await finishPendingEnd();
  const cfg = await loadConfig();
  const { session } = await store.get('session');
  if (!cfg || session?.state !== 'ARMED') return;
  const examTabs = (await queryAllTabs()).filter(t => classify(t.url, cfg)).map(t => ({ tabId: t.id, windowId: t.windowId, url: t.url }));
  await dispatch({ kind: 'STARTUP', at: now(), examTabs });
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

async function returnToWindow(windowId) {
  const [tab] = await queryActiveTab(windowId);
  if (!tab) return;
  await dispatch({ kind: 'TAB_ACTIVATED', tabId: tab.id, windowId: tab.windowId, url: tab.url || '', title: tab.title || '', incognito: Boolean(tab.incognito), at: now() });
}

async function boot() {
  await suppressUi();
  await applyConfig();
  await alarms.setPeriodic('tick', 0.5);
  await chrome.idle.setDetectionInterval(60);
}

eraseOwnCompleted();
chrome.runtime.onInstalled.addListener(boot);
chrome.runtime.onStartup.addListener(async () => { await boot(); await recover(); });
chrome.storage.onChanged.addListener((changes) => { if (changes.config) applyConfig(); });
chrome.webNavigation.onCommitted.addListener(async (d) => {
  if (d.frameId !== 0) return;
  const tab = await getTab(d.tabId);
  dispatch({ kind: 'NAV', tabId: d.tabId, windowId: tab?.windowId ?? -1, url: d.url, incognito: Boolean(tab?.incognito), at: now() });
});
chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  const tab = await getTab(tabId);
  dispatch({ kind: 'TAB_ACTIVATED', tabId, windowId, url: tab?.url || '', title: tab?.title || '', incognito: Boolean(tab?.incognito), at: now() });
});
chrome.tabs.onRemoved.addListener((tabId) => dispatch({ kind: 'TAB_REMOVED', tabId, at: now() }));
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  dispatch({ kind: 'FOCUS', windowId, at: now() });
  setTimeout(probeWindow, 0);
  if (windowId >= 0) await returnToWindow(windowId);
});
chrome.windows.onCreated.addListener((w) => dispatch({ kind: 'WINDOW_CREATED', windowId: w.id, incognito: Boolean(w.incognito), at: now() }));
chrome.windows.onRemoved.addListener((windowId) => dispatch({ kind: 'WINDOW_REMOVED', windowId, at: now() }));
chrome.idle.onStateChanged.addListener((state) => dispatch({ kind: 'IDLE', state, at: now() }));
chrome.downloads.onCreated.addListener((item) => {
  // own writes are data: URLs and byExtensionId is unreliable under DevTools download overrides;
  // this also drops page-initiated data: downloads (e.g. <a download href="data:...">), accepted.
  if (item.byExtensionId === chrome.runtime.id || item.url?.startsWith('data:')) return;
  dispatch({ kind: 'DOWNLOAD', url: item.url, filename: item.filename, mime: item.mime, at: now() });
});
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== 'cs' || !sender.tab) return;
  dispatch({ kind: 'CS', name: msg.name, data: msg.data, tabId: sender.tab.id, windowId: sender.tab.windowId, at: now() });
});
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === 'tick') await tick();
  else if (a.name === 'periodic') dispatch({ kind: 'PERIODIC', at: now() });
  else if (a.name === 'abandon') dispatch({ kind: 'ABANDON_TIMER', at: now() });
});
