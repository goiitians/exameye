import { tally } from '../core/counters.js';

const $ = (id) => document.getElementById(id);

async function render() {
  const { session = { state: 'IDLE' }, events = [], meta = {} } = await chrome.storage.local.get(['session', 'events', 'meta']);
  $('state').textContent = session.state;
  $('session').textContent = session.id || '-';
  $('flush').textContent = meta.lastFlushAt ? new Date(meta.lastFlushAt).toLocaleTimeString() : 'never';
  const errors = (meta.configErrors || []).map(e => `${e.field}: ${e.message}`);
  if (meta.lastFlushError) errors.push(`flush: ${meta.lastFlushError}`);
  if (meta.lastError) errors.push(`last error: ${meta.lastError}`);
  $('errors').textContent = errors.join('\n') || '-';
  $('options').hidden = !(meta.configErrors || []).length;
  const { counts } = tally(events);
  $('counts').textContent = Object.keys(counts).sort().map(n => `${n}: ${counts[n]}`).join('\n') || '(no events)';
}

$('options').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });
chrome.storage.onChanged.addListener(render);
render();
