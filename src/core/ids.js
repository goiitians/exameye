const pad = (n) => String(n).padStart(2, '0');

export function stamp(date) {
  const d = new Date(date);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function fmtLocal(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function tzOffset(date) {
  const m = -new Date(date).getTimezoneOffset();
  const a = Math.abs(m);
  return `${m >= 0 ? '+' : '-'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

export function fmtDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export function sanitizeSeat(seat) {
  return String(seat).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 32) || 'SEAT';
}

export function sessionId(date, seat) {
  return `${stamp(date)}_${sanitizeSeat(seat)}`;
}

export function shotFile(date, eventName) {
  return `screenshots/${stamp(date)}_${eventName}.jpg`;
}
