import { shortHash, verify } from './hashchain.js';

const unsafe = (p) => p.startsWith('/') || p.startsWith('\\') || p.split(/[\\/]/).includes('..');

export async function checkSession({ lines, events, exists }) {
  const problems = [];
  const chain = await verify(lines);
  if (!chain.ok) problems.push(`log chain broken at line ${chain.firstBad}`);
  const bodyLines = lines.length - 1;
  if (events.length !== bodyLines) problems.push(`events.json has ${events.length} events, log.txt has ${bodyLines} lines`);
  for (let i = 0; i < Math.min(events.length, bodyLines); i++) {
    const h = await shortHash(lines[i + 1]);
    if (events[i].hash !== h) { problems.push(`event ${events[i].seq} hash ${events[i].hash} does not match log line ${i + 1} (${h})`); break; }
  }
  const files = new Set();
  for (const ev of events) {
    if (ev.shot) files.add(ev.shot);
    if (ev.data?.desktopShot) files.add(ev.data.desktopShot);
  }
  for (const f of files) {
    if (unsafe(f)) { problems.push(`unsafe path ${f}`); continue; }
    if (!(await exists(f))) problems.push(`missing ${f}`);
  }
  return { ok: problems.length === 0, problems, lines: lines.length, events: events.length, shots: files.size };
}
