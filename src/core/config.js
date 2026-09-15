import { originOf } from './urlmatch.js';
import { normalizeLabel, parseLabels } from './labels.js';

export const DEFAULTS = Object.freeze({
  startPrefix: '', examPrefix: '', resultPrefix: '', seat: '',
  subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10,
  startButton: '', endButton: '', endMarker: '', maxMin: 0, tailMin: 5,
  desktopCapture: 'on', desktopRepromptMin: 5,
});
const STR = ['startPrefix', 'examPrefix', 'resultPrefix', 'seat', 'subfolder', 'startButton', 'endButton', 'endMarker', 'desktopCapture'];
const NUM = ['shotIntervalMin', 'abandonMin', 'maxMin', 'tailMin', 'desktopRepromptMin'];

export function normalize(raw = {}) {
  const cfg = { ...DEFAULTS };
  for (const k of STR) if (typeof raw[k] === 'string') cfg[k] = raw[k].trim();
  for (const k of NUM) { const n = Number(raw[k]); if (raw[k] !== '' && Number.isFinite(n)) cfg[k] = n; }
  return cfg;
}

function isHttpUrl(s) {
  try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
}

export function validate(cfg) {
  const errors = [];
  if (!isHttpUrl(cfg.startPrefix)) errors.push({ field: 'startPrefix', message: 'must be an http(s) URL prefix' });
  if (cfg.examPrefix && !isHttpUrl(cfg.examPrefix)) errors.push({ field: 'examPrefix', message: 'must be blank or an http(s) URL prefix' });
  if (cfg.resultPrefix && !isHttpUrl(cfg.resultPrefix)) errors.push({ field: 'resultPrefix', message: 'must be blank or an http(s) URL prefix' });
  else if (cfg.resultPrefix && cfg.resultPrefix === cfg.startPrefix) errors.push({ field: 'resultPrefix', message: 'must differ from the start prefix' });
  if (!cfg.seat) errors.push({ field: 'seat', message: 'required' });
  if (!cfg.subfolder || /[\\/]|\.\./.test(cfg.subfolder) || cfg.subfolder.length > 64) errors.push({ field: 'subfolder', message: 'required; no slashes or ".."; max 64 chars' });
  if (!Number.isInteger(cfg.shotIntervalMin) || cfg.shotIntervalMin < 1 || cfg.shotIntervalMin > 60) errors.push({ field: 'shotIntervalMin', message: 'integer 1-60' });
  if (!Number.isInteger(cfg.abandonMin) || cfg.abandonMin < 1 || cfg.abandonMin > 120) errors.push({ field: 'abandonMin', message: 'integer 1-120' });
  if (normalizeLabel(cfg.startButton).length > 80) errors.push({ field: 'startButton', message: 'label max 80 chars after normalisation' });
  const endLabels = parseLabels(cfg.endButton);
  if (cfg.endButton && (endLabels.length === 0 || endLabels.some(l => l.length > 80))) errors.push({ field: 'endButton', message: 'each label must be 1-80 chars after normalisation' });
  if (!cfg.endButton && !cfg.endMarker && !cfg.resultPrefix) errors.push({ field: 'endButton', message: 'set an end button, an end marker, or a result URL prefix' });
  if (normalizeLabel(cfg.endMarker).length > 200) errors.push({ field: 'endMarker', message: 'max 200 chars after normalisation' });
  if (!Number.isInteger(cfg.maxMin) || cfg.maxMin < 0 || cfg.maxMin > 600) errors.push({ field: 'maxMin', message: 'integer 0-600' });
  if (!Number.isInteger(cfg.tailMin) || cfg.tailMin < 0 || cfg.tailMin > 60) errors.push({ field: 'tailMin', message: 'integer 0-60' });
  if (cfg.desktopCapture !== 'on' && cfg.desktopCapture !== 'off') errors.push({ field: 'desktopCapture', message: 'on or off' });
  if (!Number.isInteger(cfg.desktopRepromptMin) || cfg.desktopRepromptMin < 0 || cfg.desktopRepromptMin > 60) errors.push({ field: 'desktopRepromptMin', message: 'integer 0-60' });
  return errors;
}

export function effectiveExamPrefix(cfg) {
  return cfg.examPrefix || originOf(cfg.startPrefix);
}

export function resolved(cfg) {
  return { ...cfg, examPrefix: effectiveExamPrefix(cfg) };
}
