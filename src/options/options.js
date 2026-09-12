import { DEFAULTS, normalize, validate } from '../core/config.js';

const form = document.getElementById('form');
const status = document.getElementById('status');
const dest = document.getElementById('dest');
const fields = Object.keys(DEFAULTS);

function showDest(cfg) {
  dest.textContent = `Files land in: <Chrome download directory>/${cfg.subfolder}/`;
}

async function load() {
  const { config } = await chrome.storage.local.get('config');
  const cfg = normalize(config);
  for (const k of fields) form.elements[k].value = cfg[k];
  showDest(cfg);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const cfg = normalize(Object.fromEntries(fields.map(k => [k, form.elements[k].value])));
  const errors = validate(cfg);
  if (errors.length) { status.textContent = errors.map(er => `${er.field}: ${er.message}`).join('\n'); status.className = 'err'; return; }
  await chrome.storage.local.set({ config: cfg });
  status.textContent = 'Saved.';
  status.className = 'ok';
  showDest(cfg);
});

load();
