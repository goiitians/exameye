export const getTab = (id) => chrome.tabs.get(id).catch(() => null);
export const queryAllTabs = () => chrome.tabs.query({});
export const queryActiveTab = (windowId) => chrome.tabs.query({ active: true, windowId });
