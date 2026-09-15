import * as store from './adapters/storage.js';
import * as alarms from './adapters/alarms.js';
import { registerExamScript } from './adapters/scripting.js';
import { getWindow, getAllWindows, focusedWindowId, lastFocusedWindowId } from './adapters/windows.js';
import { getTab, queryAllTabs, queryActiveTab, awaitLoaded } from './adapters/tabs.js';
import { captureJpeg } from './adapters/capture.js';
import { normalize, validate, resolved } from './core/config.js';
import { initial, reduce } from './core/session.js';
import { headerLine, formatLine, chainLine } from './core/logline.js';
import { GENESIS, shortHash, verify } from './core/hashchain.js';
import { needsShot } from './core/events.js';
import { EMPTY_TAIL, decide } from './core/tailshots.js';
import { shotFile } from './core/ids.js';
import { classify } from './core/urlmatch.js';
import { EMPTY_DESKTOP, shouldPrompt, onHolder } from './core/desktop.js';
import { supported, holderUrl, openHolder, showWindow, minimizeWindow, closeWindow, askHolder } from './adapters/desktop.js';
import { suppressUi, writeFile, eraseOwnCompleted } from './adapters/downloads.js';
import { putText, putBase64, remove, dataUrl, toBase64 } from './core/sink.js';
import { tally } from './core/counters.js';
import { renderSummaryText } from './core/summary-text.js';
import { renderSummaryHtml } from './core/summary-html.js';

const GAP_MS = 90000;
const SHOT_GAP_MS = 2000;
const PAINT_WAIT_MS = 1500;
// arm/disarm fire at onCommitted, before the new page has painted; without a wait the shot shows the previous page
const NAV_BORN = new Set(['SESSION_ARMED', 'SESSION_DISARMED', 'RESULT_PAGE']);
const HOLDER_KINDS = new Set(['NAV', 'TAB_ACTIVATED', 'WINDOW_CREATED', 'WINDOW_REMOVED']);
const now = () => Date.now();

let queue = Promise.resolve();
// A step that throws is recorded (console + meta.lastError for the popup) and swallowed: the
// queue must keep serving later inputs, and nothing awaits dispatch() from the listeners anyway.
const enqueue = (fn) => {
  queue = queue.then(fn).catch(async (e) => {
    console.error('ExamEye step failed', e);
    await store.patchMeta({ lastError: `${new Date().toISOString()} ${e?.message || e}` }).catch(() => {});
  });
  return queue;
};
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
  if (cfg.desktopCapture === 'off') {
    await closeHolderNow();
  } else {
    const { session } = await store.get('session');
    if (session && (session.state === 'ARMED' || session.state === 'CLOSING')) await promptDesktopNow();
  }
}

export const applyConfig = () => enqueue(applyConfigNow);

export const dispatch = (input) => enqueue(() => dispatchNow(input));

async function dispatchNow(input) {
  const cfg = await loadConfig();
  if (!cfg) return;
  const st = await store.get(['session', 'events', 'lines', 'lastHash', 'meta']);
  let session = st.session || initial();
  let { events = [], lines = [], lastHash = GENESIS } = st;
  const meta = st.meta || {};
  if (HOLDER_KINDS.has(input.kind) && (input.url === holderUrl() || input.windowId === meta.desktop?.holderWindowId)) return;
  const newEvents = [];
  if (session.state !== 'IDLE' && meta.lastSeenAt && input.at - meta.lastSeenAt > GAP_MS) {
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
    await store.patchMeta({ lastShot: null, lastError: null });
  }
  if (r.session.state === 'CLOSING' && session.state === 'ARMED') {
    await store.patchMeta({ tail: EMPTY_TAIL });
  }
  const added = await takeShots(newEvents, input.pre);
  for (const ev of newEvents) {
    const line = chainLine(formatLine(ev), lastHash);
    ev.hash = lastHash = await shortHash(line);
    lines.push(line);
    events.push(ev);
  }
  if (newEvents.length) {
    const base = `${cfg.subfolder}/${(r.session.state !== 'IDLE' ? r.session : session).id}`;
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
  if (r.session.state === 'ARMED' && session.state === 'IDLE') {
    const { meta: m2 = {} } = await store.get('meta');
    const d = m2.desktop || EMPTY_DESKTOP;
    await store.patchMeta({ desktop: { ...d, asks: 0 } });
    if (d.state === 'on') await dispatchNow({ kind: 'DESKTOP', name: 'STARTED', data: { width: d.width, height: d.height, pickMs: null, resumed: true }, at: input.at });
    else await promptDesktopNow();
  }
}

async function runEffects(effects, cfg, pendingEnd) {
  for (const e of effects) {
    if (e.type === 'ABANDON_ALARM_SET') await alarms.setAt('abandon', e.when);
    else if (e.type === 'ABANDON_ALARM_CLEAR') await alarms.clear('abandon');
    else if (e.type === 'MAX_ALARM_SET') await alarms.setAt('max', e.when);
    else if (e.type === 'MAX_ALARM_CLEAR') await alarms.clear('max');
    else if (e.type === 'CLOSING_ALARM_SET') await alarms.setAt('closing', e.when);
    else if (e.type === 'CLOSING_ALARM_CLEAR') await alarms.clear('closing');
    else if (e.type === 'PROBE') setTimeout(probe, 0);
    else if (e.type === 'END') { await endSession(pendingEnd, cfg); await closeHolderNow(); }
  }
}

async function takeShots(events, pre) {
  if (!events.some(needsShot)) return [];
  const { meta = {}, shots = {} } = await store.get(['meta', 'shots']);
  let last = meta.lastShot || { at: 0, file: null };
  const added = [];
  for (const ev of events) {
    if (!needsShot(ev)) continue;
    if (ev.name === 'SCREEN_CHANGED') {
      const file = shotFile(ev.t, ev.name);
      shots[file] = pre.b64;
      added.push({ file, b64: pre.b64 });
      ev.shot = file;
      last = { at: ev.t, file };
      continue;
    }
    if (last.file && ev.t - last.at < SHOT_GAP_MS) { ev.shot = last.file; continue; }
    try {
      if (NAV_BORN.has(ev.name)) await awaitLoaded(ev.tabId, PAINT_WAIT_MS);
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

export const screenChanged = (input) => enqueue(() => screenChangedNow(input));

async function screenChangedNow(input) {
  const { session, meta = {} } = await store.get(['session', 'meta']);
  if (!session || session.state !== 'CLOSING' || input.tabId !== session.examTabId) return;
  const tab = await getTab(input.tabId);
  if (!tab || !tab.active) return;
  const b64 = await captureJpeg(session.examWindowId);
  const hash = await shortHash(b64);
  const { keep, tail } = decide(meta.tail, { hash, at: input.at });
  if (!keep) return;
  await store.patchMeta({ tail });
  await dispatchNow({ ...input, data: { hash }, pre: { b64 } });
}

export const promptDesktop = () => enqueue(promptDesktopNow);

async function promptDesktopNow() {
  const cfg = await loadConfig();
  if (!cfg || cfg.desktopCapture !== 'on' || !supported()) return;
  const { meta = {} } = await store.get('meta');
  const d = meta.desktop || EMPTY_DESKTOP;
  if (!shouldPrompt(d, { at: now(), repromptMin: cfg.desktopRepromptMin })) return;
  await askNow(d, cfg);
}

async function askNow(d, cfg) {
  if (cfg.desktopCapture !== 'on') return;
  let id = d.holderWindowId;
  if (id !== null && (await getWindow(id))) {
    await showWindow(id);
    await askHolder();
  } else {
    id = (await openHolder()).id;
  }
  await store.patchMeta({ desktop: { ...d, state: 'prompting', at: now(), holderWindowId: id, asks: d.asks + 1 } });
  await alarms.clear('desktopAsk');
}

async function applyHolder(d, msg, cfg) {
  const r = onHolder(d, msg, { at: now(), repromptMin: cfg?.desktopRepromptMin ?? 0 });
  await store.patchMeta({ desktop: r.desktop });
  let reask = false;
  for (const e of r.effects) {
    if (e.type === 'MINIMIZE') await minimizeWindow(r.desktop.holderWindowId);
    else if (e.type === 'ASK_ALARM_SET') await alarms.setAt('desktopAsk', e.when);
    else if (e.type === 'ASK_ALARM_CLEAR') await alarms.clear('desktopAsk');
    else if (e.type === 'REASK') reask = true;
  }
  if (r.input) await dispatchNow(r.input);
  if (reask) await askNow(r.desktop, cfg);
}

async function desktopMessageNow(msg, sender, respond) {
  const { meta = {} } = await store.get('meta');
  const d = meta.desktop || EMPTY_DESKTOP;
  if (msg.name === 'ready') {
    respond(sender.tab?.windowId === d.holderWindowId ? { ask: d.state === 'prompting' } : { close: true });
    return;
  }
  const cfg = await loadConfig();
  await applyHolder(d, msg, cfg);
}

async function holderRemovedNow(windowId) {
  const { meta = {} } = await store.get('meta');
  const d = meta.desktop || EMPTY_DESKTOP;
  if (windowId !== d.holderWindowId) return;
  const cfg = await loadConfig();
  await applyHolder(d, { name: 'closed' }, cfg);
}

async function closeHolderNow() {
  const { meta = {} } = await store.get('meta');
  const d = meta.desktop || EMPTY_DESKTOP;
  if (d.state === 'off' && d.holderWindowId === null) return;
  await store.patchMeta({ desktop: { ...EMPTY_DESKTOP, holderWindowId: d.holderWindowId } });
  await alarms.clear('desktopAsk');
  if (d.holderWindowId !== null) await closeWindow(d.holderWindowId);
}

async function desktopAskNow() {
  const { session } = await store.get('session');
  if (!session || session.state === 'IDLE') return;
  await promptDesktopNow();
}

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
async function finishPendingEndNow() {
  const { meta = {} } = await store.get('meta');
  if (!meta.pendingEnd) return;
  const cfg = await loadConfig();
  if (cfg) await endSession(meta.pendingEnd, cfg);
}

const finishPendingEnd = () => enqueue(finishPendingEndNow);

export async function tick() {
  await finishPendingEnd();
  const { session } = await store.get('session');
  const windows = (await getAllWindows()).map(w => ({ id: w.id, state: w.state }));
  const examTabPresent = session && session.state !== 'IDLE' && (await getTab(session.examTabId)) !== null;
  await dispatch({ kind: 'TICK', at: now(), windows, examTabPresent });
  await flush();
}

// One queue step, enqueued synchronously by the onStartup listener: restored tabs' onCommitted
// fires while boot() is still awaiting, and a NAV from the exam tab's new id dispatched before
// STARTUP re-adopts it would be logged as a PARALLEL_PAGE (and the gap as 'sw-restart').
export function recover() {
  return enqueue(async () => {
    await finishPendingEndNow();
    const cfg = await loadConfig();
    const { session } = await store.get('session');
    if (!cfg || !session || session.state === 'IDLE') return;
    const examTabs = (await queryAllTabs()).filter(t => classify(t.url, cfg)).map(t => ({ tabId: t.id, windowId: t.windowId, url: t.url }));
    await dispatchNow({ kind: 'STARTUP', at: now(), examTabs });
  });
}

async function probeWindow() {
  const { session } = await store.get('session');
  if (!session || session.state === 'IDLE') return;
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
  await dispatch({ kind: 'TAB_ACTIVATED', tabId: tab.id, windowId: tab.windowId, url: tab.pendingUrl || tab.url || '', title: tab.title || '', incognito: Boolean(tab.incognito), at: now() });
}

async function boot() {
  await suppressUi();
  await applyConfig();
  await alarms.setPeriodic('tick', 0.5);
  await chrome.idle.setDetectionInterval(60);
}

eraseOwnCompleted();
chrome.runtime.onInstalled.addListener(boot);
chrome.runtime.onStartup.addListener(() => { recover(); return boot(); });
chrome.storage.onChanged.addListener((changes) => { if (changes.config) applyConfig(); });
async function onNav(d) {
  if (d.frameId !== 0) return;
  const tab = await getTab(d.tabId);
  dispatch({ kind: 'NAV', tabId: d.tabId, windowId: tab?.windowId ?? -1, url: d.url, incognito: Boolean(tab?.incognito), at: now() });
  const cfg = await loadConfig();
  if (cfg && classify(d.url, cfg) === 'start') promptDesktop();
}
chrome.webNavigation.onCommitted.addListener(onNav);
chrome.webNavigation.onHistoryStateUpdated.addListener(onNav);
chrome.webNavigation.onReferenceFragmentUpdated.addListener(onNav);
chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  const tab = await getTab(tabId);
  dispatch({ kind: 'TAB_ACTIVATED', tabId, windowId, url: tab?.pendingUrl || tab?.url || '', title: tab?.title || '', incognito: Boolean(tab?.incognito), at: now() });
});
chrome.tabs.onRemoved.addListener((tabId) => dispatch({ kind: 'TAB_REMOVED', tabId, at: now() }));
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  dispatch({ kind: 'FOCUS', windowId, at: now() });
  setTimeout(probeWindow, 0);
  if (windowId >= 0) await returnToWindow(windowId);
});
// block body, not an implicit return: this listener must not hand back dispatch()'s promise —
// chrome.windows.create() (openHolder) now fires onCreated synchronously from inside a running
// queue step, and awaiting a promise chained onto that very step would deadlock.
chrome.windows.onCreated.addListener((w) => { dispatch({ kind: 'WINDOW_CREATED', windowId: w.id, incognito: Boolean(w.incognito), at: now() }); });
chrome.windows.onRemoved.addListener((windowId) => { dispatch({ kind: 'WINDOW_REMOVED', windowId, at: now() }); enqueue(() => holderRemovedNow(windowId)); });
chrome.idle.onStateChanged.addListener((state) => dispatch({ kind: 'IDLE', state, at: now() }));
chrome.downloads.onCreated.addListener((item) => {
  // own writes are data: URLs and byExtensionId is unreliable under DevTools download overrides;
  // this also drops page-initiated data: downloads (e.g. <a download href="data:...">), accepted.
  if (item.byExtensionId === chrome.runtime.id || item.url?.startsWith('data:')) return;
  dispatch({ kind: 'DOWNLOAD', url: item.url, filename: item.filename, mime: item.mime, at: now() });
});
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg?.type === 'desktop') { enqueue(() => desktopMessageNow(msg, sender, respond)); return true; }
  if (msg?.type !== 'cs' || !sender.tab) return;
  const input = { kind: 'CS', name: msg.name, data: msg.data, tabId: sender.tab.id, windowId: sender.tab.windowId, url: sender.url, at: now() };
  if (msg.name === 'SCREEN_CHANGED') screenChanged(input);
  else dispatch(input);
});
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === 'tick') await tick();
  else if (a.name === 'periodic') dispatch({ kind: 'PERIODIC', at: now() });
  else if (a.name === 'abandon') dispatch({ kind: 'ABANDON_TIMER', at: now() });
  else if (a.name === 'max') dispatch({ kind: 'MAX_TIMER', at: now() });
  else if (a.name === 'closing') dispatch({ kind: 'CLOSING_TIMER', at: now() });
  else if (a.name === 'desktopAsk') enqueue(desktopAskNow);
});
