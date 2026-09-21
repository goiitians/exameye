// Chrome allows two captureVisibleTab calls per second per extension (MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND).
// The listener and the queue can both capture now, so the third call within a second waits for the
// window to pass instead of being refused. Monotonic clock: a clock set back must not stall captures.
const QUOTA = 2;
const WINDOW_MS = 1000;
const recent = [];

async function throttle() {
  for (;;) {
    const now = performance.now();
    while (recent.length && now - recent[0] >= WINDOW_MS) recent.shift();
    if (recent.length < QUOTA) { recent.push(now); return; }
    await new Promise((r) => setTimeout(r, Math.ceil(recent[0] + WINDOW_MS - now)));
  }
}

export async function captureJpeg(windowId) {
  await throttle();
  const url = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 50 });
  return url.slice(url.indexOf(',') + 1);
}
