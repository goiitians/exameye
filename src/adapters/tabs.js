export const getTab = (id) => chrome.tabs.get(id).catch(() => null);
export const queryAllTabs = () => chrome.tabs.query({});
