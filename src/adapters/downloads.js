const TIMEOUT_MS = 15000;
const pending = new Map();

chrome.downloads.onChanged.addListener((delta) => {
  const current = delta.state?.current;
  if (current !== 'complete' && current !== 'interrupted') return;
  const p = pending.get(delta.id);
  if (!p) return;
  pending.delete(delta.id);
  if (current === 'complete') p.resolve(delta.id);
  else p.reject(new Error(delta.state.error?.current || 'interrupted'));
});

export async function suppressUi() {
  try { await chrome.downloads.setUiOptions({ enabled: false }); } catch { /* browser without downloads.ui support (some Edge builds): flyout stays visible, nothing else breaks */ }
}

export function writeFile(filename, url) {
  return new Promise((resolve, reject) => {
    let id;
    let settled = false;
    const finish = (fn, arg) => { if (settled) return; settled = true; clearTimeout(timer); fn(arg); };
    const timer = setTimeout(() => { if (id !== undefined) pending.delete(id); finish(reject, new Error('timeout')); }, TIMEOUT_MS);
    chrome.downloads.download({ url, filename, conflictAction: 'overwrite', saveAs: false }).then((downloadId) => {
      id = downloadId;
      if (settled) return;
      pending.set(id, { resolve: (v) => finish(resolve, v), reject: (e) => finish(reject, e) });
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
