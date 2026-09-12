export const GENESIS = '00000000';

export async function shortHash(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf).slice(0, 4)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function prevHashOf(line) {
  return line.slice(line.lastIndexOf(' #') + 2);
}

export async function verify(lines) {
  if (lines.length === 0) return { ok: true, firstBad: -1 };
  if (prevHashOf(lines[0]) !== GENESIS) return { ok: false, firstBad: 0 };
  for (let i = 1; i < lines.length; i++) {
    if (prevHashOf(lines[i]) !== await shortHash(lines[i - 1])) return { ok: false, firstBad: i };
  }
  return { ok: true, firstBad: -1 };
}
