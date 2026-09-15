export const supported = () => Boolean(chrome.desktopCapture);
export const holderUrl = () => chrome.runtime.getURL('src/holder/holder.html');

async function send(tabId, name, extra = {}) {
  if (tabId == null) return null;
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'holder', name, ...extra });
  } catch {
    return null;
  }
}

export async function openHolder() {
  const win = await chrome.windows.create({ url: holderUrl(), type: 'popup', width: 460, height: 140, focused: true });
  const tabId = win.tabs?.[0]?.id ?? (await chrome.tabs.query({ windowId: win.id }))[0]?.id ?? null;
  return { windowId: win.id, tabId };
}
export const showWindow = (id) => chrome.windows.update(id, { state: 'normal', focused: true });
export const minimizeWindow = (id) => chrome.windows.update(id, { state: 'minimized' });
export const closeWindow = (id) => chrome.windows.remove(id).catch(() => {});

export async function grabDesktop(tabId) {
  return (await send(tabId, 'grab')) ?? { b64: null, alive: false };
}

export const setAway = (tabId, on) => send(tabId, 'away', { on });
export const askHolder = (tabId) => send(tabId, 'ask');
