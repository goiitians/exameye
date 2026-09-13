export const getTab = (id) => chrome.tabs.get(id).catch(() => null);
export const queryAllTabs = () => chrome.tabs.query({});
export const queryActiveTab = (windowId) => chrome.tabs.query({ active: true, windowId });

export async function awaitLoaded(tabId, maxMs) {
  const until = Date.now() + maxMs;
  while (Date.now() < until) {
    const t = await getTab(tabId);
    if (!t || t.status === 'complete') return;
    await new Promise((r) => setTimeout(r, 100));
  }
}
