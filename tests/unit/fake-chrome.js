function evt() {
  const ls = [];
  return { addListener: (f) => ls.push(f), emit: async (...a) => { for (const f of ls) await f(...a); } };
}

export function installFakeChrome() {
  const store = {};
  const c = {
    runtime: { id: 'fake-ext-id', onStartup: evt(), onInstalled: evt(), onMessage: evt() },
    storage: {
      local: {
        async get(keys) {
          const ks = keys == null ? Object.keys(store) : [].concat(keys);
          const o = {};
          for (const k of ks) if (k in store) o[k] = structuredClone(store[k]);
          return o;
        },
        async set(obj) {
          const changes = {};
          for (const [k, v] of Object.entries(obj)) { changes[k] = { oldValue: store[k], newValue: structuredClone(v) }; store[k] = structuredClone(v); }
          await c.storage.onChanged.emit(changes, 'local');
        },
        async remove(keys) { for (const k of [].concat(keys)) delete store[k]; },
      },
      onChanged: evt(),
    },
    alarms: { alarms: {}, async create(name, info) { c.alarms.alarms[name] = info; }, async clear(name) { delete c.alarms.alarms[name]; return true; }, onAlarm: evt() },
    tabs: {
      list: [],
      async query() { return c.tabs.list; },
      async get(id) { const t = c.tabs.list.find(t => t.id === id); if (!t) throw new Error('No tab with id: ' + id); return t; },
      captureVisibleTab: async () => 'data:image/jpeg;base64,/9j/FAKE',
      onActivated: evt(), onRemoved: evt(), onUpdated: evt(),
    },
    windows: {
      WINDOW_ID_NONE: -1, list: [],
      async get(id) { const w = c.windows.list.find(w => w.id === id); if (!w) throw new Error('No window with id: ' + id); return w; },
      async getAll() { return c.windows.list; },
      async getLastFocused() { return c.windows.list.find(w => w.focused) || c.windows.list[0] || { id: -1, focused: false }; },
      onFocusChanged: evt(), onCreated: evt(), onRemoved: evt(),
    },
    webNavigation: { onCommitted: evt() },
    idle: { async setDetectionInterval() {}, onStateChanged: evt() },
    downloads: {
      calls: [], items: [], erased: [], nextId: 1, failWhen: null, uiOptions: null,
      async download(opts) {
        if (c.downloads.failWhen?.(opts)) throw new Error('Download rejected by fake');
        c.downloads.calls.push(opts);
        return c.downloads.nextId++;
      },
      async search(q) { return c.downloads.items.filter(i => q.id === undefined || i.id === q.id); },
      async erase(q) { c.downloads.erased.push(q.id); return [q.id]; },
      async setUiOptions(o) { c.downloads.uiOptions = o; },
      onCreated: evt(), onChanged: evt(),
    },
    scripting: {
      registered: [],
      async registerContentScripts(list) { c.scripting.registered.push(...list); },
      async unregisterContentScripts() { if (!c.scripting.registered.length) throw new Error('Nonexistent script ID'); c.scripting.registered = []; },
    },
  };
  globalThis.chrome = c;
  return c;
}
