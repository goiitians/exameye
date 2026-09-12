import { classify } from './urlmatch.js';
import { sessionId } from './ids.js';
import { makeEvent } from './events.js';

const freshAway = () => ({ tabAt: null, focusAt: null, minAt: null, idleAt: null });

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
    if (input.kind === 'NAV' && classify(input.url, cfg) === 'start') {
      Object.assign(s, {
        state: 'ARMED', id: sessionId(input.at, cfg.seat), seat: cfg.seat, startedAt: input.at,
        examTabId: input.tabId, examWindowId: input.windowId, examUrl: input.url, seq: 0,
        lastActivityAt: input.at, tabLostAt: null, windowState: 'normal', away: freshAway(),
      });
      emit('SESSION_ARMED', { url: input.url }, input);
      out.effects.push({ type: 'ABANDON_ALARM_CLEAR' });
    }
    return out;
  }
  s.lastActivityAt = input.at;
  HANDLERS[input.kind]?.(s, input, cfg, emit, out);
  return out;
}

function disarm(s, out, emit, input, outcome, data = {}) {
  emit('SESSION_DISARMED', { outcome, ...data }, input);
  out.effects.push({ type: 'END', outcome, session: { ...s } });
  out.session = initial();
}

function examTabNav(s, input, cfg, emit, out) {
  if (classify(input.url, cfg) === 'result') return disarm(s, out, emit, input, 'RESULT', { url: input.url });
  if (input.url !== s.examUrl) { s.examUrl = input.url; emit('EXAM_NAV', { url: input.url }, input); }
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
    if (s.tabLostAt !== null) disarm(s, out, emit, input, 'ABANDONED');
  },
  PERIODIC(s, input, cfg, emit) {
    emit('PERIODIC', {}, input);
  },
};

export { HANDLERS };
