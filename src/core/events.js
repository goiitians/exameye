export const SHOT_EVENTS = new Set([
  'SESSION_ARMED', 'TAB_SWITCH', 'FOCUS_LEFT_CHROME', 'WINDOW_OPENED', 'INCOGNITO_WINDOW_OPENED',
  'FULLSCREEN_EXIT', 'COPY', 'CUT', 'PASTE', 'CONTEXTMENU', 'PRINT', 'DRAG', 'DEVTOOLS_OPENED',
  'DOWNLOAD_STARTED', 'PERIODIC',
  'START_BUTTON_CLICKED', 'END_BUTTON_CLICKED', 'END_MARKER_SEEN', 'RESULT_PAGE',
  'MAX_TIME_REACHED', 'SCREEN_CHANGED', 'CONFIG_CHANGED',
  'DESKTOP_CAPTURE_STARTED', 'DESKTOP_CAPTURE_DECLINED', 'DESKTOP_CAPTURE_STOPPED', 'DESKTOP_CAPTURE_FAILED',
]);

export function needsShot(ev) {
  if (ev.name === 'PARALLEL_PAGE') return ev.data.trigger === 'activated' || ev.data.active === true;
  if (ev.name === 'SESSION_DISARMED') return ev.data.outcome !== 'ABANDONED';
  return SHOT_EVENTS.has(ev.name);
}

// Chrome refuses chrome:// and other extensions' pages with an activeTab message that means nothing to staff
export const describeShotError = (err) => /activeTab/.test(err) ? 'Chrome does not let extensions capture this page (chrome:// or another extension)' : String(err);

export const DESKTOP_FRAME_EVENTS = new Set(['FOCUS_LEFT_CHROME', 'FOCUS_RETURNED', 'PERIODIC', 'DESKTOP_FRAME']);

export function needsDesktopFrame(ev) {
  return DESKTOP_FRAME_EVENTS.has(ev.name);
}

export function makeEvent({ seq, at, name, tabId, windowId, data = {} }) {
  const ev = { seq, ts: new Date(at).toISOString(), t: at, name, data, shot: null };
  if (tabId !== undefined) ev.tabId = tabId;
  if (windowId !== undefined) ev.windowId = windowId;
  return ev;
}
