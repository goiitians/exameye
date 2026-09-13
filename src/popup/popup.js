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
  const { counts } = tally(events);
  $('counts').textContent = Object.keys(counts).sort().map(n => `${n}: ${counts[n]}`).join('\n') || '(no events)';
}

chrome.storage.onChanged.addListener(render);
render();
