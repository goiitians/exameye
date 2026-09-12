export async function captureJpeg(windowId) {
  const url = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 50 });
  return url.slice(url.indexOf(',') + 1);
}
