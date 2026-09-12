import { GENESIS } from './hashchain.js';
import { tzOffset } from './ids.js';

const fmtValue = (v) => (typeof v === 'number' || typeof v === 'boolean' || v === null) ? String(v) : JSON.stringify(v);

export function headerLine(session) {
  return `# ExamEye session ${session.id} seat=${JSON.stringify(session.seat)} started=${new Date(session.startedAt).toISOString()} tz=${tzOffset(session.startedAt)} #${GENESIS}`;
}

export function formatLine(ev) {
  const parts = [ev.ts, ev.name];
  if (ev.tabId !== undefined) parts.push(`tab=${ev.tabId}`);
  if (ev.windowId !== undefined) parts.push(`win=${ev.windowId}`);
  for (const [k, v] of Object.entries(ev.data || {})) parts.push(`${k}=${fmtValue(v)}`);
  if (ev.shot) parts.push(`shot=${JSON.stringify(ev.shot)}`);
  return parts.join(' ');
}

export function chainLine(text, prevHash) {
  return `${text} #${prevHash}`;
}
