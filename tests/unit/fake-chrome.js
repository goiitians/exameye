function evt() {
  const ls = [];
  return { addListener: (f) => ls.push(f), emit: async (...a) => { for (const f of ls) await f(...a); } };
}

const yieldTick = () => new Promise((r) => setTimeout(r, 0));

export function installFakeChrome() {
  const store = {};
  const c = {
    runtime: { id: 'fake-ext-id', onStartup: evt(), onInstalled: evt(), onMessage: evt() },
    storage: {
      local: {
        async get(keys) {
          await yieldTick();
          const ks = keys == null ? Object.keys(store) : [].concat(keys);
          const o = {};
          for (const k of ks) if (k in store) o[k] = structuredClone(store[k]);
          return o;
        },
        async set(obj) {
          await yieldTick();
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
      async query(q = {}) { return c.tabs.list.filter(t => (q.active === undefined || Boolean(t.active) === q.active) && (q.windowId === undefined || t.windowId === q.windowId)); },
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
      calls: [], items: [], erased: [], nextId: 1, failWhen: null, interruptWhen: null, uiOptions: null,
      async download(opts) {
        if (c.downloads.failWhen?.(opts)) throw new Error('Download rejected by fake');
        c.downloads.calls.push(opts);
        const id = c.downloads.nextId++;
        const error = c.downloads.interruptWhen?.(opts);
        setTimeout(() => {
          if (error) c.downloads.onChanged.emit({ id, state: { current: 'interrupted', error: { current: error } } });
          else c.downloads.onChanged.emit({ id, state: { current: 'complete' } });
        }, 0);
        return id;
      },
      async search(q) { return c.downloads.items.filter(i => q.id === undefined || i.id === q.id); },
      async erase(q) { c.downloads.erased.push(q.id); return [q.id]; },
      async setUiOptions(o) { c.downloads.uiOptions = o; },
      onCreated: evt(), onChanged: evt(),
    },
    scripting: {
      registered: [],
      async registerContentScripts(scripts) {
        for (const s of scripts) {
          if (c.scripting.registered.some((r) => r.id === s.id)) throw new Error(`Duplicate script ID '${s.id}'`);
        }
        c.scripting.registered.push(...scripts);
      },
      async unregisterContentScripts(filter) {
        const ids = filter?.ids;
        if (ids === undefined) { c.scripting.registered = []; return; }
        for (const id of ids) {
          if (!c.scripting.registered.some((r) => r.id === id)) throw new Error(`Nonexistent script ID '${id}'`);
        }
        c.scripting.registered = c.scripting.registered.filter((r) => !ids.includes(r.id));
      },
      async getRegisteredContentScripts(filter) {
        const ids = filter?.ids;
        return ids === undefined ? [...c.scripting.registered] : c.scripting.registered.filter((r) => ids.includes(r.id));
      },
    },
  };
  globalThis.chrome = c;
  return c;
}
