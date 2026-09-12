export const get = (keys) => chrome.storage.local.get(keys);
export const set = (obj) => chrome.storage.local.set(obj);
export const remove = (keys) => chrome.storage.local.remove(keys);

export async function patchMeta(patch) {
  const { meta = {} } = await get('meta');
  await set({ meta: { ...meta, ...patch } });
}
