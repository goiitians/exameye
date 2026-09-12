const TIMEOUT_MS = 15000;
const pending = new Map();
// Chrome can, in principle, fire a terminal onChanged before download()'s own promise has
// resolved with the id (we only learn the id from that promise). Without this, such an event
// would be dropped on the floor and writeFile would wait out the full timeout despite Chrome
// having already told us the outcome.
const early = new Map();

// A plain browser setTimeout has no .unref(); guarding it lets a stray onChanged for an id we
// never end up waiting on (any download in the browser, ours or not) not hold a Node test
// process open for TIMEOUT_MS, with no effect on real Chrome.
const unref = (timer) => { if (typeof timer?.unref === 'function') timer.unref(); return timer; };

function settle(entry, current, error, id) {
  if (current === 'complete') entry.resolve(id);
  else entry.reject(new Error(error?.current || 'interrupted'));
}

chrome.downloads.onChanged.addListener((delta) => {
  const current = delta.state?.current;
  if (current !== 'complete' && current !== 'interrupted') return;
  const p = pending.get(delta.id);
  if (p) { pending.delete(delta.id); settle(p, current, delta.state.error, delta.id); return; }
  if (early.has(delta.id)) return;
  const timer = unref(setTimeout(() => early.delete(delta.id), TIMEOUT_MS));
  early.set(delta.id, { current, error: delta.state.error, timer });
});

export async function suppressUi() {
  try { await chrome.downloads.setUiOptions({ enabled: false }); } catch { /* browser without downloads.ui support (some Edge builds): flyout stays visible, nothing else breaks */ }
}

export function writeFile(filename, url) {
  return new Promise((resolve, reject) => {
    let id;
    let settled = false;
    const finish = (fn, arg) => { if (settled) return; settled = true; clearTimeout(timer); fn(arg); };
    const entry = { resolve: (v) => finish(resolve, v), reject: (e) => finish(reject, e) };
    const timer = unref(setTimeout(() => { if (id !== undefined) pending.delete(id); finish(reject, new Error('timeout')); }, TIMEOUT_MS));
    chrome.downloads.download({ url, filename, conflictAction: 'overwrite', saveAs: false }).then((downloadId) => {
      id = downloadId;
      if (settled) return;
      const e = early.get(id);
      if (e) { clearTimeout(e.timer); early.delete(id); settle(entry, e.current, e.error, id); return; }
      pending.set(id, entry);
    }, (err) => finish(reject, err));
  });
}

export function eraseOwnCompleted() {
  chrome.downloads.onChanged.addListener(async (delta) => {
    if (delta.state?.current !== 'complete') return;
    const [item] = await chrome.downloads.search({ id: delta.id });
    if (item?.byExtensionId === chrome.runtime.id) await chrome.downloads.erase({ id: delta.id });
  });
}
