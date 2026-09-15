export const supported = () => Boolean(chrome.desktopCapture);
export const holderUrl = () => chrome.runtime.getURL('src/holder/holder.html');

async function send(name, extra = {}) {
  try {
    return await chrome.runtime.sendMessage({ type: 'holder', name, ...extra });
  } catch {
    return null;
  }
}

export const openHolder = () => chrome.windows.create({ url: holderUrl(), type: 'popup', width: 460, height: 140, focused: true });
export const showWindow = (id) => chrome.windows.update(id, { state: 'normal', focused: true });
export const minimizeWindow = (id) => chrome.windows.update(id, { state: 'minimized' });
export const closeWindow = (id) => chrome.windows.remove(id).catch(() => {});

export async function grabDesktop() {
  return (await send('grab')) ?? { b64: null, alive: false };
}

export const setAway = (on) => send('away', { on });
export const askHolder = () => send('ask');
