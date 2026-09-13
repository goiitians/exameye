export const SHOT_EVENTS = new Set([
  'SESSION_ARMED', 'TAB_SWITCH', 'FOCUS_LEFT_CHROME', 'WINDOW_OPENED', 'INCOGNITO_WINDOW_OPENED',
  'FULLSCREEN_EXIT', 'COPY', 'CUT', 'PASTE', 'CONTEXTMENU', 'PRINT', 'DEVTOOLS_OPENED',
  'DOWNLOAD_STARTED', 'PERIODIC',
  'START_BUTTON_CLICKED', 'END_BUTTON_CLICKED', 'END_MARKER_SEEN', 'RESULT_PAGE',
  'MAX_TIME_REACHED', 'SCREEN_CHANGED',
]);

export function needsShot(ev) {
  if (ev.name === 'PARALLEL_PAGE') return ev.data.trigger === 'activated';
  if (ev.name === 'SESSION_DISARMED') return ev.data.outcome !== 'ABANDONED';
  return SHOT_EVENTS.has(ev.name);
}

export function makeEvent({ seq, at, name, tabId, windowId, data = {} }) {
  const ev = { seq, ts: new Date(at).toISOString(), t: at, name, data, shot: null };
  if (tabId !== undefined) ev.tabId = tabId;
  if (windowId !== undefined) ev.windowId = windowId;
  return ev;
}
