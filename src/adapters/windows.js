export const getWindow = (id) => chrome.windows.get(id).catch(() => null);
export const getAllWindows = () => chrome.windows.getAll({});

export async function focusedWindowId() {
  const w = await chrome.windows.getLastFocused().catch(() => null);
  return w && w.focused ? w.id : -1;
}

export async function lastFocusedWindowId() {
  const w = await chrome.windows.getLastFocused().catch(() => null);
  return w ? w.id : -1;
}
