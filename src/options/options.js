import { DEFAULTS, normalize, validate } from '../core/config.js';

const $ = (id) => document.getElementById(id);
const form = $('form');
const status = $('status');
const dest = $('dest');
const recording = $('recording');
const fields = Object.keys(DEFAULTS);

function showDest(cfg) {
  dest.textContent = `Recordings are saved in <Chrome download folder>/${cfg.subfolder}/<date-time_seat>/`;
}

function showErrors(errors) {
  for (const k of fields) { const e = $(`err-${k}`); e.textContent = ''; e.hidden = true; }
  for (const er of errors) {
    const e = $(`err-${er.field}`);
    e.textContent = e.textContent ? `${e.textContent} ${er.message}` : er.message;
    e.hidden = false;
  }
}

async function showRecording() {
  const { session } = await chrome.storage.local.get('session');
  recording.hidden = !(session && session.state !== 'IDLE');
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
  showErrors(errors);
  if (errors.length) {
    status.textContent = `Fix the ${errors.length} highlighted field${errors.length > 1 ? 's' : ''} and save again.`;
    status.className = 'err';
    return;
  }
  await chrome.storage.local.set({ config: cfg });
  status.textContent = 'Saved.';
  status.className = 'ok';
  await load();
});

chrome.storage.onChanged.addListener((changes) => { if (changes.session) showRecording(); });
load();
showRecording();
