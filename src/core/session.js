import { classify } from './urlmatch.js';
import { sessionId } from './ids.js';
import { makeEvent } from './events.js';

const freshAway = () => ({ tabAt: null, tabId: null, tabUrl: null, focusAt: null, minAt: null, idleAt: null, idleState: null });

export function initial() {
  return { state: 'IDLE' };
}

export function reduce(session, input, cfg) {
  const out = { session: structuredClone(session), events: [], effects: [] };
  const s = out.session;
  // src defaults to the top-level input, but a handler re-invoking another handler with a
  // synthesized input (e.g. TICK -> TAB_REMOVED) must pass that input explicitly, or the
  // emitted event would carry the outer input's (possibly absent) ids instead.
  const emit = (name, data = {}, src = input) => {
    s.seq += 1;
    out.events.push(makeEvent({ seq: s.seq, at: src.at, name, tabId: src.tabId, windowId: src.windowId, data }));
  };
  if (s.state === 'IDLE') {
    if (input.kind === 'NAV' && !cfg.startButton && classify(input.url, cfg) === 'start') {
      arm(s, input, cfg, emit, out, { trigger: 'nav' });
    } else if (input.kind === 'CS' && input.name === 'START_CLICK' && cfg.startButton && classify(input.url, cfg) === 'start') {
      arm(s, input, cfg, emit, out, { trigger: 'button', label: input.data.label });
    }
    return out;
  }
  s.lastActivityAt = input.at;
  HANDLERS[input.kind]?.(s, input, cfg, emit, out);
  return out;
}

function arm(s, input, cfg, emit, out, { trigger, label }) {
  const maxAt = cfg.maxMin > 0 ? input.at + cfg.maxMin * 60000 : null;
  Object.assign(s, {
    state: 'ARMED', id: sessionId(input.at, cfg.seat), seat: cfg.seat, startedAt: input.at,
    examTabId: input.tabId, examWindowId: input.windowId, examUrl: input.url, seq: 0,
    lastActivityAt: input.at, tabLostAt: null, windowState: 'normal', away: freshAway(),
    maxAt, endClickAt: null, markerSeen: false,
    outcome: null, trigger: null, triggerLabel: null, examEndedAt: null, closingUntil: null,
  });
  emit('SESSION_ARMED', label !== undefined ? { url: input.url, trigger, label } : { url: input.url, trigger }, input);
  out.effects.push({ type: 'ABANDON_ALARM_CLEAR' });
  if (maxAt !== null) out.effects.push({ type: 'MAX_ALARM_SET', when: maxAt });
}

function disarm(s, out, emit, input, outcome, trigger, data = {}) {
  const wasClosing = s.state === 'CLOSING';
  emit('SESSION_DISARMED', { outcome, trigger, ...data }, input);
  out.effects.push({ type: 'MAX_ALARM_CLEAR' });
  if (wasClosing) out.effects.push({ type: 'CLOSING_ALARM_CLEAR' });
  out.effects.push({ type: 'END', outcome, session: { ...s } });
  out.session = initial();
}

function beginTail(s, out, emit, input, cfg, outcome, trigger, label) {
  s.outcome = outcome; s.trigger = trigger; s.triggerLabel = label ?? null; s.examEndedAt = input.at;
  const extra = label === undefined ? {} : trigger === 'result' ? { url: label } : { label };
  if (cfg.tailMin === 0) return disarm(s, out, emit, input, outcome, trigger, extra);
  out.effects.push({ type: 'MAX_ALARM_CLEAR' });
  s.state = 'CLOSING';
  s.closingUntil = input.at + cfg.tailMin * 60000;
  out.effects.push({ type: 'CLOSING_ALARM_SET', when: s.closingUntil });
}

function examTabNav(s, input, cfg, emit, out) {
  const cls = classify(input.url, cfg);
  if (cls === 'result') {
    emit('RESULT_PAGE', { url: input.url }, input);
    return beginTail(s, out, emit, input, cfg, 'RESULT', 'result', input.url);
  }
  if (input.url !== s.examUrl) {
    s.examUrl = input.url;
    emit('EXAM_NAV', { url: input.url }, input);
    if (cls === null) emit('PARALLEL_PAGE', { url: input.url, trigger: 'committed', incognito: false }, input);
  }
}

const HANDLERS = {
  NAV(s, input, cfg, emit, out) {
    if (input.tabId === s.examTabId) return examTabNav(s, input, cfg, emit, out);
    if (s.tabLostAt !== null && classify(input.url, cfg)) {
      Object.assign(s, { examTabId: input.tabId, examWindowId: input.windowId, examUrl: input.url, tabLostAt: null });
      emit('EXAM_NAV', { url: input.url, adopted: true }, input);
      out.effects.push({ type: 'ABANDON_ALARM_CLEAR' });
      return examTabNav(s, input, cfg, emit, out);
    }
    if (classify(input.url, cfg) === 'result') {
      emit('RESULT_PAGE', { url: input.url }, input);
      return beginTail(s, out, emit, input, cfg, 'RESULT', 'result', input.url);
    }
    if (input.tabId === s.away.tabId) s.away.tabUrl = input.url;
    emit('PARALLEL_PAGE', { url: input.url, trigger: 'committed', incognito: Boolean(input.incognito) }, input);
  },
  TAB_REMOVED(s, input, cfg, emit, out) {
    if (input.tabId !== s.examTabId || s.tabLostAt !== null) return;
    s.tabLostAt = input.at;
    emit('EXAM_TAB_CLOSED', {}, input);
    out.effects.push({ type: 'ABANDON_ALARM_SET', when: input.at + cfg.abandonMin * 60000 });
  },
  STARTUP(s, input, cfg, emit, out) {
    const t = input.examTabs[0];
    if (t) {
      Object.assign(s, { examTabId: t.tabId, examWindowId: t.windowId, examUrl: t.url, tabLostAt: null, away: freshAway() });
      out.effects.push({ type: 'ABANDON_ALARM_CLEAR' });
      return;
    }
    s.tabLostAt ??= input.at;
    out.effects.push({ type: 'ABANDON_ALARM_SET', when: s.tabLostAt + cfg.abandonMin * 60000 });
  },
  GAP(s, input, cfg, emit) {
    emit('EXTENSION_GAP', { lastSeenAt: input.lastSeenAt, gapMs: input.at - input.lastSeenAt, reason: input.reason }, input);
  },
  ABANDON_TIMER(s, input, cfg, emit, out) {
    if (s.tabLostAt !== null) disarm(s, out, emit, input, 'ABANDONED', 'abandon');
  },
  PERIODIC(s, input, cfg, emit) {
    emit('PERIODIC', {}, input);
  },
  MAX_TIMER(s, input, cfg, emit, out) {
    const ids = { ...input, tabId: s.examTabId, windowId: s.examWindowId };
    emit('MAX_TIME_REACHED', { maxAt: s.maxAt }, ids);
    if (s.tabLostAt !== null) {
      out.effects.push({ type: 'ABANDON_ALARM_CLEAR' });
      return disarm(s, out, emit, input, 'TIMED_OUT', 'max');
    }
    beginTail(s, out, emit, input, cfg, 'TIMED_OUT', 'max');
  },
};

function windowState(s, windowId, state, at, emit) {
  if (windowId !== s.examWindowId) return;
  const ids = { windowId, at };
  if (state === 'minimized' && s.away.minAt === null) { s.away.minAt = at; emit('WINDOW_MINIMIZED', {}, ids); }
  if (state !== 'minimized' && s.away.minAt !== null) { emit('WINDOW_RESTORED', { minimizedMs: at - s.away.minAt }, ids); s.away.minAt = null; }
  if (s.windowState === 'fullscreen' && state !== 'fullscreen') emit('FULLSCREEN_EXIT', { source: 'window' }, ids);
  s.windowState = state;
}

const CS_DIRECT = new Set(['COPY', 'CUT', 'PASTE', 'CONTEXTMENU', 'PRINT']);
const CS_PROBE = new Set(['VISIBILITY', 'BLUR', 'FOCUS']);

Object.assign(HANDLERS, {
  TAB_ACTIVATED(s, input, cfg, emit) {
    if (input.tabId === s.examTabId) {
      if (s.away.tabAt !== null) { emit('TAB_RETURN', { awayMs: input.at - s.away.tabAt }); s.away.tabAt = null; s.away.tabId = null; s.away.tabUrl = null; }
      return;
    }
    const incognito = Boolean(input.incognito);
    if (s.away.tabAt === null) {
      s.away.tabAt = input.at;
      emit('TAB_SWITCH', { toTabId: input.tabId, toUrl: input.url, toTitle: input.title, toWindowId: input.windowId, incognito });
    } else if (s.away.tabId === input.tabId && s.away.tabUrl === input.url) {
      return; // windows.onFocusChanged's synthetic activation of the tab tabs.onActivated already reported
    }
    s.away.tabId = input.tabId; s.away.tabUrl = input.url;
    emit('PARALLEL_PAGE', { url: input.url, title: input.title, incognito, trigger: 'activated' });
  },
  FOCUS(s, input, cfg, emit) {
    if (input.windowId === -1) {
      if (s.away.focusAt === null) { s.away.focusAt = input.at; emit('FOCUS_LEFT_CHROME'); }
    } else if (s.away.focusAt !== null) {
      emit('FOCUS_RETURNED', { awayMs: input.at - s.away.focusAt }); s.away.focusAt = null;
    }
  },
  WINDOW_STATE(s, input, cfg, emit) { windowState(s, input.windowId, input.state, input.at, emit); },
  WINDOW_CREATED(s, input, cfg, emit) { emit(input.incognito ? 'INCOGNITO_WINDOW_OPENED' : 'WINDOW_OPENED', { windowId: input.windowId }); },
  WINDOW_REMOVED(s, input, cfg, emit) { emit('WINDOW_CLOSED', { windowId: input.windowId }); },
  CS(s, input, cfg, emit, out) {
    if (input.tabId !== s.examTabId) return;
    const data = input.data || {};
    if (CS_DIRECT.has(input.name)) emit(input.name, data);
    else if (input.name === 'FULLSCREEN_EXIT') emit('FULLSCREEN_EXIT', { source: 'document' });
    else if (input.name === 'DEVTOOLS') emit('DEVTOOLS_OPENED', data);
    else if (input.name === 'START_CLICK') emit('START_BUTTON_CLICKED', { label: data.label });
    else if (input.name === 'END_CLICK') {
      emit('END_BUTTON_CLICKED', { label: data.label });
      s.endClickAt = input.at;
      beginTail(s, out, emit, input, cfg, 'SUBMITTED', 'button', data.label);
    } else if (input.name === 'END_MARKER') {
      if (s.markerSeen) return;
      emit('END_MARKER_SEEN', { marker: data.marker });
      s.markerSeen = true;
      beginTail(s, out, emit, input, cfg, 'AUTO_SUBMITTED', 'marker', data.marker);
    } else if (CS_PROBE.has(input.name)) out.effects.push({ type: 'PROBE' });
  },
  IDLE(s, input, cfg, emit) {
    if (input.state !== 'active') {
      if (s.away.idleAt === null) {
        s.away.idleAt = input.at; s.away.idleState = input.state;
        emit('IDLE_START', { state: input.state });
      } else if (input.state !== s.away.idleState) {
        emit('IDLE_END', { idleMs: input.at - s.away.idleAt });
        s.away.idleAt = input.at; s.away.idleState = input.state;
        emit('IDLE_START', { state: input.state });
      }
    } else if (s.away.idleAt !== null) {
      emit('IDLE_END', { idleMs: input.at - s.away.idleAt }); s.away.idleAt = null; s.away.idleState = null;
    }
  },
  DOWNLOAD(s, input, cfg, emit) { emit('DOWNLOAD_STARTED', { url: input.url, filename: input.filename, mime: input.mime }); },
  TICK(s, input, cfg, emit, out) {
    const w = input.windows.find(w => w.id === s.examWindowId);
    if (w) windowState(s, w.id, w.state, input.at, emit);
    if (!input.examTabPresent) HANDLERS.TAB_REMOVED(s, { ...input, tabId: s.examTabId }, cfg, emit, out);
  },
});

export { HANDLERS };
