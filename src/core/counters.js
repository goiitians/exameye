const CLOSERS = new Set(['TAB_RETURN', 'FOCUS_LEFT_CHROME', 'WINDOW_MINIMIZED', 'SESSION_DISARMED']);
const DURATION = { TAB_RETURN: ['tabAwayMs', 'awayMs'], WINDOW_RESTORED: ['minimizedMs', 'minimizedMs'] };
const ATTRIBUTION_WINDOW_MS = 3000;

export function tally(events) {
  const counts = {};
  const durations = { tabAwayMs: 0, focusLeftMs: 0, minimizedMs: 0, idleMs: 0, screensaverMs: 0 };
  const parallel = new Map();
  const idleStarts = [];
  const focusIntervals = [];
  const tailShots = new Set();
  const desktopFiles = new Set();
  const spans = [];
  let desktopAsks = 0, desktopDeclined = 0, desktopFailed = 0;
  let openSpan = null;
  let tailEvents = 0;
  let open = null;
  let openIdleState = null;
  let openFocusAt = null;
  let lastT = 0;

  for (const ev of events) {
    lastT = ev.t;
    counts[ev.name] = (counts[ev.name] || 0) + 1;
    if (ev.data.phase === 'tail') { tailEvents += 1; if (ev.shot) tailShots.add(ev.shot); }
    if (DURATION[ev.name]) { const [k, f] = DURATION[ev.name]; durations[k] += ev.data[f] || 0; }

    if (ev.data.desktopShot) desktopFiles.add(ev.data.desktopShot);
    if (ev.name === 'DESKTOP_FRAME' && ev.shot) desktopFiles.add(ev.shot);
    if (ev.name === 'DESKTOP_CAPTURE_STARTED') {
      if (!ev.data.resumed) desktopAsks += 1;
      openSpan = { from: ev.t, to: null, stopped: false };
      spans.push(openSpan);
    } else if (ev.name === 'DESKTOP_CAPTURE_STOPPED') {
      if (openSpan) { openSpan.to = ev.t; openSpan.stopped = true; openSpan = null; }
    } else if (ev.name === 'DESKTOP_CAPTURE_DECLINED') {
      desktopAsks += 1; desktopDeclined += 1;
    } else if (ev.name === 'DESKTOP_CAPTURE_FAILED') {
      desktopAsks += 1; desktopFailed += 1;
    }

    if (ev.name === 'IDLE_START') {
      idleStarts.push({ t: ev.t, state: ev.data.state });
      if (ev.data.state === 'locked') counts.SCREENSAVER = (counts.SCREENSAVER || 0) + 1;
      openIdleState = ev.data.state;
    } else if (ev.name === 'IDLE_END') {
      const idleMs = ev.data.idleMs || 0;
      if (openIdleState === 'locked') durations.screensaverMs += idleMs; else durations.idleMs += idleMs;
      openIdleState = null;
    } else if (ev.name === 'FOCUS_LEFT_CHROME') {
      openFocusAt = ev.t;
    } else if (ev.name === 'FOCUS_RETURNED') {
      if (openFocusAt !== null) focusIntervals.push({ t0: openFocusAt, t1: ev.t, awayMs: ev.data.awayMs || 0 });
      openFocusAt = null;
    }

    const isParallel = ev.name === 'PARALLEL_PAGE';
    const closes = isParallel ? (ev.data.trigger === 'activated' || (open !== null && ev.tabId === open.tabId)) : CLOSERS.has(ev.name);
    if (closes && open !== null) { open.entry.focusedMs += ev.t - open.at; open = null; }
    if (isParallel) {
      const entry = parallel.get(ev.data.url) || { url: ev.data.url, title: '', incognito: Boolean(ev.data.incognito), visits: 0, focusedMs: 0 };
      entry.visits += 1;
      if (ev.data.title) entry.title = ev.data.title;
      parallel.set(ev.data.url, entry);
      if (closes) open = { entry, at: ev.t, tabId: ev.tabId };
    }
  }
  if (openFocusAt !== null) focusIntervals.push({ t0: openFocusAt, t1: lastT, awayMs: 0 });

  const attribution = { screensaver: 0, idle: 0, user: 0 };
  for (const { t0, t1, awayMs } of focusIntervals) {
    const lo = t0 - ATTRIBUTION_WINDOW_MS;
    const locked = idleStarts.some(s => s.state === 'locked' && s.t >= lo && s.t <= t1);
    const idle = !locked && idleStarts.some(s => s.state === 'idle' && s.t >= lo && s.t <= t1);
    if (locked) attribution.screensaver += 1;
    else if (idle) attribution.idle += 1;
    else { attribution.user += 1; durations.focusLeftMs += awayMs; }
  }

  return {
    counts, durations, parallel: [...parallel.values()].sort((a, b) => b.focusedMs - a.focusedMs), attribution,
    tail: { events: tailEvents, shots: tailShots.size },
    desktop: { frames: desktopFiles.size, asks: desktopAsks, declined: desktopDeclined, failed: desktopFailed, spans },
  };
}
