import { originOf } from './urlmatch.js';

export const DEFAULTS = Object.freeze({
  startPrefix: '', examPrefix: '', resultPrefix: '', seat: '',
  subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10,
});
const STR = ['startPrefix', 'examPrefix', 'resultPrefix', 'seat', 'subfolder'];
const NUM = ['shotIntervalMin', 'abandonMin'];

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
  if (!isHttpUrl(cfg.resultPrefix)) errors.push({ field: 'resultPrefix', message: 'must be an http(s) URL prefix' });
  if (!cfg.seat) errors.push({ field: 'seat', message: 'required' });
  if (!cfg.subfolder || /[\\/]|\.\./.test(cfg.subfolder) || cfg.subfolder.length > 64) errors.push({ field: 'subfolder', message: 'required; no slashes or ".."; max 64 chars' });
  if (!Number.isInteger(cfg.shotIntervalMin) || cfg.shotIntervalMin < 1 || cfg.shotIntervalMin > 60) errors.push({ field: 'shotIntervalMin', message: 'integer 1-60' });
  if (!Number.isInteger(cfg.abandonMin) || cfg.abandonMin < 1 || cfg.abandonMin > 120) errors.push({ field: 'abandonMin', message: 'integer 1-120' });
  return errors;
}

export function effectiveExamPrefix(cfg) {
  return cfg.examPrefix || originOf(cfg.startPrefix);
}

export function resolved(cfg) {
  return { ...cfg, examPrefix: effectiveExamPrefix(cfg) };
}
