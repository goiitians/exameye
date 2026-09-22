function evt() {
  const ls = [];
  return { addListener: (f) => ls.push(f), emit: async (...a) => { for (const f of ls) await f(...a); } };
}

const yieldTick = () => new Promise((r) => setTimeout(r, 0));

export function installFakeChrome() {
  const store = {};
  const c = {
    runtime: {
      id: 'fake-ext-id', onStartup: evt(), onInstalled: evt(), onMessage: evt(),
      getURL: (p) => 'chrome-extension://fake-ext-id/' + p,
      getManifest: () => ({ version: '0.1.0' }),
      reloads: 0, reload() { c.runtime.reloads += 1; },
      optionsOpened: 0, async openOptionsPage() { c.runtime.optionsOpened += 1; },
      sent: [], responder: null, ports: [], onConnect: evt(),
      connect(info) {
        const port = { name: info?.name, onDisconnect: evt(), disconnect() { port.onDisconnect.emit(port); } };
        c.runtime.ports.push(port);
        c.runtime.onConnect.emit(port);
        return port;
      },
      async sendMessage(msg) {
        c.runtime.sent.push(msg);
        if (c.runtime.responder) return c.runtime.responder(msg);
        throw new Error('Could not establish connection');
      },
    },
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
    alarms: { alarms: {}, async create(name, info) { c.alarms.alarms[name] = info; }, async clear(name) { delete c.alarms.alarms[name]; return true; }, async get(name) { const a = c.alarms.alarms[name]; return a ? { name, ...a } : undefined; }, onAlarm: evt() },
    tabs: {
      list: [],
      async query(q = {}) { return c.tabs.list.filter(t => (q.active === undefined || Boolean(t.active) === q.active) && (q.windowId === undefined || t.windowId === q.windowId)); },
      async get(id) { const t = c.tabs.list.find(t => t.id === id); if (!t) throw new Error('No tab with id: ' + id); return { status: 'complete', ...t }; },
      captureVisibleTab: async () => 'data:image/jpeg;base64,/9j/FAKE',
      sent: [], responder: null,
      async sendMessage(tabId, msg) {
        c.tabs.sent.push({ tabId, msg });
        if (c.tabs.responder) return c.tabs.responder(msg, tabId);
        throw new Error('Could not establish connection');
      },
      onActivated: evt(), onRemoved: evt(), onUpdated: evt(),
    },
    windows: {
      WINDOW_ID_NONE: -1, list: [], nextId: 100,
      async get(id) { const w = c.windows.list.find(w => w.id === id); if (!w) throw new Error('No window with id: ' + id); return w; },
      async getAll() { return c.windows.list; },
      async getLastFocused() { return c.windows.list.find(w => w.focused) || c.windows.list[0] || { id: -1, focused: false }; },
      async create(opts) {
        const win = { id: c.windows.nextId++, focused: true, state: 'normal', type: opts.type, url: opts.url };
        c.windows.list.push(win);
        await c.windows.onCreated.emit(win);
        return win;
      },
      async update(id, info) {
        const w = c.windows.list.find(w => w.id === id);
        if (!w) throw new Error('No window with id: ' + id);
        Object.assign(w, info);
        return w;
      },
      async remove(id) {
        const i = c.windows.list.findIndex(w => w.id === id);
        if (i === -1) throw new Error('No window with id: ' + id);
        c.windows.list.splice(i, 1);
        await c.windows.onRemoved.emit(id);
      },
      onFocusChanged: evt(), onCreated: evt(), onRemoved: evt(),
    },
    webNavigation: { onCommitted: evt(), onHistoryStateUpdated: evt(), onReferenceFragmentUpdated: evt() },
    idle: { async setDetectionInterval() {}, onStateChanged: evt() },
    downloads: {
      calls: [], items: [], erased: [], nextId: 1, failWhen: null, interruptWhen: null, uiOptions: null,
      async download(opts) {
        if (c.downloads.failWhen?.(opts)) throw new Error('Download rejected by fake');
        c.downloads.calls.push({ ...opts, filename: chromeFilename(opts.filename, opts.url) });
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
    action: {
      badge: { text: '', color: null },
      async setBadgeText({ text }) { c.action.badge.text = text; },
      async setBadgeBackgroundColor({ color }) { c.action.badge.color = color; },
    },
  };
  globalThis.chrome = c;
  return c;
}

// Chrome's GetCorrectedExtensionUnsafe (net/base/filename_util_internal.cc): a data: download whose MIME type has a
// preferred extension gets that extension unless the requested one is on the type's list; unknown types keep the name.
// application/x-ndjson -> ndjson is an OS-registered mapping seen on macOS (2026-09-16): the list is per machine, not Chrome's alone
const CHROME_MIME_EXTENSIONS = { 'application/json': ['json'], 'application/x-ndjson': ['ndjson'], 'text/plain': ['txt', 'text'], 'text/html': ['html', 'htm'], 'image/jpeg': ['jpg', 'jpeg', 'jpe'] };
export function chromeFilename(filename, url) {
  const mime = /^data:([^;,]*)/.exec(url ?? '')?.[1] || 'text/plain';
  const known = CHROME_MIME_EXTENSIONS[mime];
  const ext = /\.([^./]+)$/.exec(filename)?.[1];
  if (!known || (ext && known.includes(ext))) return filename;
  return filename.replace(/\.[^./]*$/, '') + '.' + known[0];
}
