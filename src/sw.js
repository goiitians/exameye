import * as store from './adapters/storage.js';
import * as alarms from './adapters/alarms.js';
import { registerExamScript } from './adapters/scripting.js';
import { getWindow, getAllWindows, focusedWindowId, lastFocusedWindowId } from './adapters/windows.js';
import { getTab, queryAllTabs, queryActiveTab, awaitLoaded } from './adapters/tabs.js';
import { captureJpeg } from './adapters/capture.js';
import { normalize, validate, resolved, changedKeys } from './core/config.js';
import { initial, reduce } from './core/session.js';
import { headerLine, formatLine, chainLine } from './core/logline.js';
import { GENESIS, shortHash, verify } from './core/hashchain.js';
import { needsShot, needsDesktopFrame } from './core/events.js';
import { EMPTY_TAIL, decide } from './core/tailshots.js';
import { shotFile, desktopShotFile } from './core/ids.js';
import { classify, paperPrefixIsSpecific } from './core/urlmatch.js';
import { EMPTY_DESKTOP, shouldPrompt, onHolder } from './core/desktop.js';
import { supported, holderUrl, openHolder, showWindow, minimizeWindow, closeWindow, grabDesktop, setAway, askHolder, isHolderWindow } from './adapters/desktop.js';
import { suppressUi, writeFile, eraseOwnCompleted } from './adapters/downloads.js';
import { putText, putBase64, remove, dataUrl, toBase64 } from './core/sink.js';
import { tally } from './core/counters.js';
import { renderSummaryText } from './core/summary-text.js';
import { renderSummaryHtml } from './core/summary-html.js';
import { flagCount } from './core/flags.js';
import { setBadge } from './adapters/badge.js';

const GAP_MS = 90000;
const CLOCK_SLACK_MS = 5000;
const SHOT_GAP_MS = 2000;
const BADGE_COLOR = '#d03b3b';
const PAINT_WAIT_MS = 1500;
const FOCUS_SETTLE_MS = 500;
// arm/disarm and a commit on the tab the candidate is looking at fire at onCommitted, before the
// new page has painted; without a wait the shot shows the previous page
const NAV_BORN = new Set(['SESSION_ARMED', 'SESSION_DISARMED', 'RESULT_PAGE', 'PARALLEL_PAGE']);
const HOLDER_KINDS = new Set(['NAV', 'TAB_ACTIVATED', 'WINDOW_CREATED', 'WINDOW_REMOVED']);
// events about another tab: the image must show that tab or nothing (a shot of the exam tab under this name is worse than none)
const TAB_BOUND = new Set(['TAB_SWITCH', 'PARALLEL_PAGE']);
const now = () => Date.now();

let popupPorts = 0;
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

async function paintBadge(session, events) {
  if (!session || session.state === 'IDLE') return setBadge('');
  return setBadge(String(flagCount(tally(events).counts)), BADGE_COLOR);
}

async function dispatchNow(input) {
  const cfg = await loadConfig();
  if (!cfg) return;
  const st = await store.get(['session', 'events', 'lines', 'lastHash', 'meta']);
  let session = st.session || initial();
  let { events = [], lines = [], lastHash = GENESIS } = st;
  const meta = st.meta || {};
  if (HOLDER_KINDS.has(input.kind) && (input.url === holderUrl() || input.windowId === meta.desktop?.holderWindowId)) return;
  // focus resting on ExamEye's own toolbar popup is not the candidate leaving Chrome
  if (input.kind === 'FOCUS' && input.windowId === -1 && popupPorts > 0) return;
  const newEvents = [];
  if (session.state !== 'IDLE' && meta.lastSeenAt && input.at - meta.lastSeenAt > GAP_MS) {
    const g = reduce(session, { kind: 'GAP', at: input.at, lastSeenAt: meta.lastSeenAt, reason: input.kind === 'STARTUP' ? 'browser-restart' : 'sw-restart' }, cfg);
    session = g.session;
    newEvents.push(...g.events);
  }
  if (session.state !== 'IDLE' && meta.lastSeenAt && input.at < meta.lastSeenAt - CLOCK_SLACK_MS) {
    const c = reduce(session, { kind: 'CLOCK', at: input.at, lastSeenAt: meta.lastSeenAt }, cfg);
    session = c.session;
    newEvents.push(...c.events);
  }
  const r = reduce(session, input, cfg);
  newEvents.push(...r.events);
  const armed = r.session.state === 'ARMED' && session.state === 'IDLE';
  const closing = r.session.state === 'CLOSING' && session.state === 'ARMED';
  if (armed) {
    const h = headerLine(r.session);
    events = []; lines = [h]; lastHash = await shortHash(h);
  }
  const { added, shots, last } = await takeShots(newEvents, input.pre, armed, r.session.examWindowId ?? session.examWindowId);
  if (meta.desktop?.state === 'on') {
    for (const ev of newEvents) {
      if (ev.name === 'FOCUS_LEFT_CHROME') { await store.patchMeta({ desktopAway: EMPTY_TAIL }); await setAway(meta.desktop.holderTabId, true); }
      else if (ev.name === 'FOCUS_RETURNED') await setAway(meta.desktop.holderTabId, false);
    }
  }
  for (const ev of newEvents) {
    const line = chainLine(formatLine(ev), lastHash);
    ev.hash = lastHash = await shortHash(line);
    lines.push(line);
    events.push(ev);
  }
  const batch = { session: r.session, events, lines, lastHash };
  if (armed || added.length) batch.shots = shots;
  if (newEvents.length) {
    const sess = r.session.state !== 'IDLE' ? r.session : session;
    const base = `${sess.subfolder ?? cfg.subfolder}/${sess.id}`;
    let { pending = {} } = await store.get('pending');
    pending = putText(pending, `${base}/log.txt`, 'text/plain', lines.join('\n') + '\n');
    for (const s of added) pending = putBase64(pending, `${base}/${s.file}`, 'image/jpeg', s.b64);
    batch.pending = pending;
  }
  const endEffect = r.effects.find(e => e.type === 'END');
  let pendingEnd;
  const { meta: currentMeta = {} } = await store.get('meta');
  batch.meta = { ...currentMeta, lastSeenAt: input.at };
  if (armed) Object.assign(batch.meta, { lastShot: null, lastError: null });
  if (closing) batch.meta.tail = EMPTY_TAIL;
  if (last) batch.meta.lastShot = last;
  if (endEffect) {
    const endShots = batch.shots ?? (await store.get('shots')).shots ?? {};
    pendingEnd = { outcome: endEffect.outcome, session: endEffect.session, events: [...events], lines: [...lines], shots: endShots };
    // events/lines/shots are cleared here, atomically with the pendingEnd snapshot that now
    // holds them: leaving the live clear for endSession's own (later, possibly much later)
    // final write would risk wiping a NEW session armed in between (see below).
    Object.assign(batch, { events: [], lines: [], shots: {}, meta: { ...batch.meta, pendingEnd } });
  }
  await store.set(batch);
  if (newEvents.length || endEffect) await paintBadge(r.session, endEffect ? [] : events);
  await runEffects(r.effects, cfg, pendingEnd);
  if (newEvents.length) await flushNow();
  if (armed) {
    const { meta: m2 = {} } = await store.get('meta');
    const d = m2.desktop || EMPTY_DESKTOP;
    await store.patchMeta({ desktop: { ...d, asks: 0 } });
    if (d.state === 'on') await dispatchNow({ kind: 'DESKTOP', name: 'STARTED', data: { width: d.width, height: d.height, screens: d.screens ?? null, pickMs: null, resumed: true }, at: input.at });
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

// The holder is ExamEye's own page: when it is the last-focused window (the share dialog has
// just closed) the exam window is what the candidate sees behind it.
async function shotSubject(ev, examWindowId, holderWindowId) {
  let windowId = ev.windowId >= 0 ? ev.windowId : await lastFocusedWindowId();
  if (windowId === holderWindowId && examWindowId != null) windowId = examWindowId;
  const [tab] = await queryActiveTab(windowId).catch(() => []);
  return { windowId, tabId: tab?.id ?? null };
}

async function takeShots(events, pre, fresh, examWindowId) {
  const { meta = {} } = await store.get('meta');
  const desktopOn = meta.desktop?.state === 'on';
  const wantDesktop = events.some(e => e.name === 'DESKTOP_FRAME' || (needsDesktopFrame(e) && desktopOn));
  if (!events.some(needsShot) && !wantDesktop) return { added: [], shots: fresh ? {} : null, last: null };
  const shots = fresh ? {} : ((await store.get('shots')).shots || {});
  let last = (fresh ? null : meta.lastShot) || { at: 0, file: null, tabId: null };
  const added = [];
  let preFile = null;
  // a clock set back can reproduce an earlier stamp; the earlier JPEG must not be overwritten
  const unique = (file) => { let f = file, n = 2; while (f in shots) f = file.replace(/\.jpg$/, `-${n++}.jpg`); return f; };
  for (const ev of events) {
    if (ev.name === 'DESKTOP_FRAME') {
      const file = unique(desktopShotFile(ev.t, ev.name));
      shots[file] = pre.desktop;
      added.push({ file, b64: pre.desktop });
      ev.shot = file;
      continue;
    }
    if (needsDesktopFrame(ev) && desktopOn) {
      const { b64, alive } = await grabDesktop(meta.desktop?.holderTabId);
      if (b64) {
        const file = unique(desktopShotFile(ev.t, ev.name));
        shots[file] = b64;
        added.push({ file, b64 });
        ev.data.desktopShot = file;
      } else {
        ev.data.desktopShotError = alive ? 'no frame' : 'stream not alive';
      }
    }
    if (!needsShot(ev)) continue;
    // an image captured at listener time is the truth for that instant: file it once
    if (pre?.b64) {
      if (!preFile) {
        preFile = unique(shotFile(ev.t, ev.name));
        shots[preFile] = pre.b64;
        added.push({ file: preFile, b64: pre.b64 });
        last = { at: ev.t, file: preFile, tabId: pre.tabId };
      }
      ev.shot = preFile;
      continue;
    }
    let subject = await shotSubject(ev, examWindowId, meta.desktop?.holderWindowId);
    const visible = () => !TAB_BOUND.has(ev.name) || subject.tabId === ev.tabId;
    // a capture refused at listener time (quota, chrome:// page) is retried here only while the
    // switched-to tab is still the visible one; after a flip back, a fresh capture would show the exam tab
    if (!visible()) { ev.data.shotError = pre?.error ?? 'tab no longer visible'; continue; }
    // reuse only a shot of the same tab; a negative delta means the clock was set back and the
    // previous shot is not "2 s old", capture again
    if (last.file && last.tabId != null && last.tabId === subject.tabId && ev.t >= last.at && ev.t - last.at < SHOT_GAP_MS) { ev.shot = last.file; continue; }
    try {
      // the subject is what is visible after the wait: a tab flipped during it must not be filed under the old tab id
      if (NAV_BORN.has(ev.name)) {
        await awaitLoaded(ev.tabId, PAINT_WAIT_MS);
        subject = await shotSubject(ev, examWindowId, meta.desktop?.holderWindowId);
        if (!visible()) { ev.data.shotError = 'tab no longer visible'; continue; }
      }
      const b64 = await captureJpeg(subject.windowId);
      const file = unique(shotFile(ev.t, ev.name));
      shots[file] = b64;
      added.push({ file, b64 });
      ev.shot = file;
      last = { at: ev.t, file, tabId: subject.tabId };
    } catch (e) {
      ev.data.shotError = String(e?.message || e);
    }
  }
  return { added, shots, last: added.length ? last : null };
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
  await dispatchNow({ ...input, data: { hash }, pre: { b64, tabId: input.tabId } });
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
  let { holderWindowId: id, holderTabId: tabId } = d;
  if (tabId != null && (await isHolderWindow(id, tabId))) {
    await showWindow(id);
    await askHolder(tabId);
  } else {
    ({ windowId: id, tabId } = await openHolder());
  }
  await store.patchMeta({ desktop: { ...d, state: 'prompting', at: now(), holderWindowId: id, holderTabId: tabId, asks: d.asks + 1 } });
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
  // the holder is a (window, tab) pair: ids persisted before a browser restart can each collide with a live one
  const fromHolder = d.holderTabId !== null && sender.tab?.id === d.holderTabId && sender.tab?.windowId === d.holderWindowId;
  if (msg.name === 'ready') { respond(fromHolder ? { ask: d.state === 'prompting' } : { close: true }); return; }
  if (!fromHolder) { respond({}); return; }
  if (msg.name === 'frame') await desktopFrameNow(msg.b64);
  else await applyHolder(d, msg, await loadConfig());
  respond({});
}

async function desktopFrameNow(b64) {
  const { session, meta = {} } = await store.get(['session', 'meta']);
  const d = meta.desktop || EMPTY_DESKTOP;
  if (!session || (session.state !== 'ARMED' && session.state !== 'CLOSING') || d.state !== 'on' || !b64) return;
  const at = now();
  const hash = await shortHash(b64);
  const { keep, tail } = decide(meta.desktopAway, { hash, at }, { cap: 40 });
  if (!keep) return;
  await store.patchMeta({ desktopAway: tail });
  await dispatchNow({ kind: 'DESKTOP', name: 'FRAME', data: { n: tail.count }, at, pre: { desktop: b64 } });
}

// The holder's own 10 s away loop runs in a minimised page, which Chrome throttles to one
// timer a minute after five minutes hidden; a frame per tick is the floor under it.
async function desktopPingNow() {
  const { session, meta = {} } = await store.get(['session', 'meta']);
  const d = meta.desktop || EMPTY_DESKTOP;
  if (d.state !== 'on') return;
  const { b64, alive } = await grabDesktop(d.holderTabId);
  if (!alive) {
    const cfg = await loadConfig();
    await applyHolder(d, { name: 'dead', error: 'ping failed' }, cfg);
    return;
  }
  if (session?.away?.focusAt != null) await desktopFrameNow(b64);
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
  // the tombstone keeps the id so the holder's own WINDOW_REMOVED (possibly already queued) is dropped by the HOLDER_KINDS gate
  const alive = await isHolderWindow(d.holderWindowId, d.holderTabId);
  await store.patchMeta({ desktop: { ...EMPTY_DESKTOP, holderWindowId: d.holderWindowId } });
  await alarms.clear('desktopAsk');
  if (alive) await closeWindow(d.holderWindowId);
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
  const base = `${session.subfolder ?? cfg.subfolder}/${session.id}`;
  const ctx = { session, outcome, endedAt: now(), events, tally: tally(events), integrity: { ...(await verify(lines)), lines: lines.length } };
  const { pending: p0 = {} } = await store.get('pending');
  let pending = putText(p0, `${base}/log.txt`, 'text/plain', lines.join('\n') + '\n');
  // events.json, one event per line inside a JSON array: Chrome renames a download to an extension on the MIME type's
  // list (its own table plus OS-registered ones), and .json is the only name application/json keeps on every machine
  pending = putText(pending, `${base}/events.json`, 'application/json', '[\n' + events.map(ev => JSON.stringify(ev)).join(',\n') + '\n]\n');
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
  await enqueue(desktopPingNow);
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
    await store.patchMeta({ desktop: EMPTY_DESKTOP, desktopAway: EMPTY_TAIL });
    await finishPendingEndNow();
    const cfg = await loadConfig();
    const { session } = await store.get('session');
    if (!cfg || !session || session.state === 'IDLE') return;
    const examTabs = (await queryAllTabs()).filter(t => classify(t.url, cfg)).map(t => ({ tabId: t.id, windowId: t.windowId, url: t.url }));
    await dispatchNow({ kind: 'STARTUP', at: now(), examTabs });
    await promptDesktopNow();
  });
}

async function probeWindow() {
  const { session } = await store.get('session');
  if (!session || session.state === 'IDLE') return;
  const w = await getWindow(session.examWindowId);
  if (w) await dispatch({ kind: 'WINDOW_STATE', windowId: w.id, state: w.state, at: now() });
}

// A modal dialog (the site's alert/confirm, Chrome's share dialog) makes Chrome report "no
// window focused" for ~200 ms and then the window again; only a loss that outlasts the settle
// window is a real switch away — and by then the other app is on screen for the desktop frame.
async function focusInput() {
  const at = now();
  let windowId = await focusedWindowId();
  if (windowId === -1) {
    await new Promise((r) => setTimeout(r, FOCUS_SETTLE_MS));
    windowId = await focusedWindowId();
  }
  return { kind: 'FOCUS', windowId, at };
}

export async function probe() {
  await dispatch(await focusInput());
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

// Enabling a disabled extension fires neither onInstalled nor onStartup; a missing tick alarm is
// the signature of an enabled lifetime that never booted.
async function ensureBoot() {
  if (await alarms.get('tick')) await suppressUi();
  else await boot();
  await enqueue(async () => {
    const { session, events = [] } = await store.get(['session', 'events']);
    await paintBadge(session, events);
  });
}

// A centre ships its settings as defaults.json next to manifest.json (see tools/build-installer.mjs);
// they are used once, on first install, and never replace settings that already exist.
async function seedDefaults() {
  const { config } = await store.get('config');
  if (config) return;
  let raw;
  try { raw = await (await fetch(chrome.runtime.getURL('defaults.json'))).json(); } catch { return; }
  await store.set({ config: normalize(raw) });
}

async function installed(d) {
  const reason = d?.reason;
  if (reason === 'install') await seedDefaults();
  await boot();
  if (reason === 'install') await chrome.runtime.openOptionsPage();
}

eraseOwnCompleted();
ensureBoot();
chrome.runtime.onInstalled.addListener(installed);
chrome.runtime.onStartup.addListener(() => { recover(); return boot(); });
chrome.storage.onChanged.addListener((changes) => {
  if (!changes.config) return;
  applyConfig();
  dispatch({ kind: 'CONFIG_CHANGED', keys: changedKeys(changes.config.oldValue, changes.config.newValue), at: now() });
});
async function onNav(d) {
  if (d.frameId !== 0) return;
  const tab = await getTab(d.tabId);
  dispatch({ kind: 'NAV', tabId: d.tabId, windowId: tab?.windowId ?? -1, url: d.url, incognito: Boolean(tab?.incognito), at: now() });
  const cfg = await loadConfig();
  const cls = cfg && classify(d.url, cfg);
  if (cls === 'start' || (cls === 'exam' && paperPrefixIsSpecific(cfg))) promptDesktop();
}
chrome.webNavigation.onCommitted.addListener(onNav);
chrome.webNavigation.onHistoryStateUpdated.addListener(onNav);
chrome.webNavigation.onReferenceFragmentUpdated.addListener(onNav);
// The queue is serial: an activation queued behind a paint wait or a holder round trip would be
// captured ~1.5 s late, after a quick flip back to the exam tab. Capture at activation instead;
// only during a session, never the exam tab or the holder.
async function preCapture(tabId, windowId, url) {
  const { session, meta = {} } = await store.get(['session', 'meta']);
  if (!session || session.state === 'IDLE' || tabId === session.examTabId) return undefined;
  if (url === holderUrl() || windowId === meta.desktop?.holderWindowId) return undefined;
  try { return { b64: await captureJpeg(windowId), tabId }; } catch (e) { return { error: String(e?.message || e), tabId }; }
}
chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  const tab = await getTab(tabId);
  const url = tab?.pendingUrl || tab?.url || '';
  const input = { kind: 'TAB_ACTIVATED', tabId, windowId, url, title: tab?.title || '', incognito: Boolean(tab?.incognito), at: now() };
  input.pre = await preCapture(tabId, windowId, url);
  dispatch(input);
});
chrome.tabs.onRemoved.addListener((tabId) => dispatch({ kind: 'TAB_REMOVED', tabId, at: now() }));
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === -1) dispatch(await focusInput());
  else dispatch({ kind: 'FOCUS', windowId, at: now() });
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
// The popup holds a port while open. When it closes, focus may land on another app rather than a
// Chrome window and fire no onFocusChanged, so the SW asks where focus is now.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'popup') return;
  popupPorts += 1;
  port.onDisconnect.addListener(() => { popupPorts -= 1; setTimeout(probe, 0); });
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
