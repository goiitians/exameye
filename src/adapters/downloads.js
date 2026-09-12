export async function suppressUi() {
  try { await chrome.downloads.setUiOptions({ enabled: false }); } catch { /* browser without downloads.ui support (some Edge builds): flyout stays visible, nothing else breaks */ }
}

export function writeFile(filename, url) {
  return chrome.downloads.download({ url, filename, conflictAction: 'overwrite', saveAs: false });
}

export function eraseOwnCompleted() {
  chrome.downloads.onChanged.addListener(async (delta) => {
    if (delta.state?.current !== 'complete') return;
    const [item] = await chrome.downloads.search({ id: delta.id });
    if (item?.byExtensionId === chrome.runtime.id) await chrome.downloads.erase({ id: delta.id });
  });
}
