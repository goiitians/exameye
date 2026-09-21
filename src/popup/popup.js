import { tally } from '../core/counters.js';
import { describeDesktop } from '../core/desktop.js';
import { flagCount } from '../core/flags.js';

// The SW treats focus lost while this port is open as its own UI, not the candidate leaving Chrome.
// A service-worker restart drops the port; reconnecting keeps the still-open popup visible to the new SW.
const connect = () => chrome.runtime.connect({ name: 'popup' }).onDisconnect.addListener(connect);
connect();
const $ = (id) => document.getElementById(id);

async function render() {
  const { session = { state: 'IDLE' }, events = [], meta = {} } = await chrome.storage.local.get(['session', 'events', 'meta']);
  $('state').textContent = session.state;
  $('session').textContent = session.id || '-';
  $('version').textContent = chrome.runtime.getManifest().version;
  $('flush').textContent = meta.lastFlushAt ? new Date(meta.lastFlushAt).toLocaleTimeString() : 'never';
  const errors = (meta.configErrors || []).map(e => `${e.field}: ${e.message}`);
  if (meta.lastFlushError) errors.push(`flush: ${meta.lastFlushError}`);
  if (meta.lastError) errors.push(`last error: ${meta.lastError}`);
  $('errors').textContent = errors.join('\n') || '-';
  $('options').hidden = !(meta.configErrors || []).length;
  const { counts, desktop } = tally(events);
  $('counts').textContent = Object.keys(counts).sort().map(n => `${n}: ${counts[n]}`).join('\n') || '(no events)';
  $('desktop').textContent = describeDesktop(meta.desktop, desktop.frames);
  $('flags').textContent = String(flagCount(counts));
}

$('options').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });
chrome.storage.onChanged.addListener(render);
render();
