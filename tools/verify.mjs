import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { checkSession } from '../src/core/verify.js';

const dir = process.argv[2];
if (!dir) { console.error('usage: node tools/verify.mjs <session folder>'); process.exit(2); }
const lines = (await readFile(path.join(dir, 'log.txt'), 'utf8')).split('\n');
if (lines.at(-1) === '') lines.pop();
const events = (await readFile(path.join(dir, 'events.jsonl'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const exists = (f) => access(path.join(dir, f)).then(() => true, () => false);
const r = await checkSession({ lines, events, exists });
if (r.ok) {
  console.log(`OK ${dir}: ${r.lines} lines, ${r.events} events, ${r.shots} screenshots present`);
  process.exit(0);
}
console.log(`BROKEN ${dir}`);
for (const p of r.problems) console.log(`  ${p}`);
process.exit(1);
