# ExamEye Follow-up — Badge, Verifier, Multi-monitor, Long-run — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the invigilator a live red badge with the count of flagged events, an offline verifier for a session folder, a flag when the candidate has more than one screen, and (only if the 3-hour run shows trouble) per-file screenshot storage.

**Architecture:** Unchanged (spec §2). The `FLAGS` table moves from `src/core/summary-html.js` to a new `src/core/flags.js` so the report, the popup and the badge share one list. The badge is painted from inside the queue after each dispatch that added events, through a thin `src/adapters/badge.js`. The verifier is a pure `src/core/verify.js` with the file I/O in `tools/verify.mjs`. Multi-monitor is one boolean from the holder page, reduced into one event per session.

**Tech Stack:** Manifest V3, plain ES modules, `node --test` (Node 22), `tests/unit/fake-chrome.js`, Playwright Chromium for integration.

**Spec:** `docs/superpowers/specs/2026-09-12-exameye-design.md` (authority). Run the review-hardening plan (`docs/superpowers/plans/2026-09-15-review-hardening-plan.md`) first: its Tasks 4 to 6 add `FLAGS` rows that Task 1 here moves into `src/core/flags.js`. If this plan runs first, Task 1 moves the 14 existing rows and the hardening plan edits `src/core/flags.js` instead (its file map says so).

## Global constraints

- Baseline before Task 1: `git status` clean on `main`; `npm test` green at the count the hardening plan left; `npm run test:integration` 4/4; `npm run check` clean; `pgrep -fl "ms-playwright/chromium"` empty afterwards. Read the ledger `.superpowers/sdd/2026-09-13-test-finish/progress.md` first and append to it as you go.
- TDD: failing test first, run it, minimal code, full command, read the real output. `npm test`, `npm run test:integration`, `npm run check` in the foreground.
- One commit per task, trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`, `git status` before, `git add` intended paths only, all three commands green before every commit. Never push a broken main.
- No emojis. No comments unless the WHY is non-obvious. Surgical diffs; match the existing style.
- No new manifest permission: `chrome.action.setBadgeText` needs only the existing `action` key. `tests/unit/manifest.test.js` must keep passing unchanged.
- Task 4 is **gated**: plan only, execute only when the owner's 3-hour run shows storage trouble (slow dispatches, `lastError` quota messages, or a `summary.html` that fell back to linked screenshots).
- The owner must Reload the unpacked extension after every push.

## File map

| Path | Change |
|---|---|
| `src/core/flags.js` (new) | `FLAGS`, `flagCount(counts)` (T1) |
| `src/core/summary-html.js` | imports `FLAGS` from `./flags.js` (T1) |
| `src/adapters/badge.js` (new) | `setBadge(text, color)` (T1) |
| `src/sw.js` | `paintBadge` after each dispatch and at boot (T1); `screens` on the resumed STARTED input (T3) |
| `src/popup/popup.html`, `popup.js` | `Flags` line (T1) |
| `tests/unit/fake-chrome.js` | `action.setBadgeText/setBadgeBackgroundColor` + `action.badge` (T1) |
| `src/core/verify.js` (new), `tools/verify.mjs` (new), `tests/fixtures/session-ok/` (new), `package.json` scripts | verifier (T2) |
| `src/holder/holder.js` | `screens` in `started` (T3) |
| `src/core/desktop.js` | `EMPTY_DESKTOP.screens`, `started` copies it (T3) |
| `src/core/session.js` | `MULTI_MONITOR` once per session (T3) |
| `src/core/counters.js`, `summary-text.js` | `tally.desktop.screens`; `describeDesktopSummary` suffix (T3) |
| `docs/centre-setup.md` | §6 badge line, new §9 verifier (T1, T2), §7 multi-monitor (T3) |
| spec §2, §5, §6a, §8, §14 | per task |

---

## Task 1: toolbar badge with the live flag count

**Files:** `src/core/flags.js` (new), `src/core/summary-html.js`, `src/adapters/badge.js` (new), `src/sw.js`, `src/popup/popup.html`, `src/popup/popup.js`, `tests/unit/fake-chrome.js`, `tests/unit/flags.test.js` (new), `tests/unit/sw-badge.test.js` (new), `tests/unit/popup.test.js`, `docs/centre-setup.md` §6, spec §2 and a new §6b.

**Interfaces:**
- `FLAGS: Array<[eventName, label, level]>` and `flagCount(counts: Record<string, number>): number` from `src/core/flags.js`.
- `setBadge(text: string, color?: string): Promise<void>` from `src/adapters/badge.js`.
- `sw.js` internal `paintBadge(session, events)`: `''` when IDLE or no session, otherwise `String(flagCount(tally(events).counts))` on `#d03b3b`.
- Fake: `chrome.action.badge = { text, color }` records the last values.

- [ ] **Step 1: fake** — `tests/unit/fake-chrome.js`, add to the object after `scripting`:

```js
    action: {
      badge: { text: '', color: null },
      async setBadgeText({ text }) { c.action.badge.text = text; },
      async setBadgeBackgroundColor({ color }) { c.action.badge.color = color; },
    },
```

- [ ] **Step 2: failing tests**

`tests/unit/flags.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLAGS, flagCount } from '../../src/core/flags.js';

test('FLAGS keeps the report order and flagCount sums only flagged names', () => {
  assert.equal(FLAGS[0][0], 'PARALLEL_PAGE');
  assert.ok(FLAGS.some(([n]) => n === 'SCREENSAVER'));
  assert.ok(FLAGS.every(([, , level]) => ['warning', 'serious', 'critical'].includes(level)));
  assert.equal(flagCount({}), 0);
  assert.equal(flagCount({ TAB_SWITCH: 2, PARALLEL_PAGE: 1, EXAM_NAV: 9, SESSION_ARMED: 1 }), 3);
});
```

`tests/unit/sw-badge.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome } from './fake-chrome.js';

const chrome = installFakeChrome();
const config = { startPrefix: 'https://e.x/start', examPrefix: '', resultPrefix: 'https://e.x/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10, startButton: '', endButton: '', endMarker: '', maxMin: 0, tailMin: 0, desktopCapture: 'off', desktopRepromptMin: 5 };
await chrome.storage.local.set({ config });
const sw = await import('../../src/sw.js');
chrome.tabs.list = [
  { id: 1, windowId: 3, url: 'https://e.x/start', title: 'Exam', incognito: false, active: true },
  { id: 2, windowId: 3, url: 'https://g.x/', title: 'G', incognito: false },
];
chrome.windows.list = [{ id: 3, focused: true, state: 'normal' }];

test('badge: empty while IDLE, red 0 at arm, counts flagged events, cleared at session end', async () => {
  await sw.settled();
  assert.equal(chrome.action.badge.text, '');
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/start', at: 1000 });
  assert.equal(chrome.action.badge.text, '0');
  assert.equal(chrome.action.badge.color, '#d03b3b');
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/q/1', at: 2000 });
  assert.equal(chrome.action.badge.text, '0');
  await sw.dispatch({ kind: 'TAB_ACTIVATED', tabId: 2, windowId: 3, url: 'https://g.x/', title: 'G', incognito: false, at: 4000 });
  assert.equal(chrome.action.badge.text, '2');
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/result', at: 9000 });
  assert.equal((await chrome.storage.local.get('session')).session.state, 'IDLE');
  assert.equal(chrome.action.badge.text, '');
});

test('badge is repainted from storage on a service worker start', async () => {
  const chrome2 = installFakeChrome();
  await chrome2.storage.local.set({
    config,
    session: { state: 'ARMED', id: 'S', seat: 'A17', startedAt: 1000, examTabId: 1, examWindowId: 3, examUrl: 'https://e.x/start', seq: 2, away: { tabAt: null, tabId: null, tabUrl: null, focusAt: null, minAt: null, idleAt: null, idleState: null }, tabLostAt: null, windowState: 'normal', maxAt: null },
    events: [{ seq: 1, t: 1000, name: 'SESSION_ARMED', data: {}, shot: null }, { seq: 2, t: 2000, name: 'COPY', data: { len: 3 }, shot: null }],
  });
  const sw2 = await import('../../src/sw.js?badge=2');
  await new Promise((r) => setTimeout(r, 20));
  await sw2.settled();
  assert.equal(chrome2.action.badge.text, '1');
});
```
(The second test relies on the hardening plan's `ensureBoot()`; if that plan has not run yet, call `sw2.recover()` after the import instead and keep the assertion.)

`tests/unit/popup.test.js`: add `'flags'` to the `installFakeDom` id list and to the loop in `'popup has the live-state slots…'`; in `'render: idle with nothing stored'` add `assert.equal(dom.flags.textContent, '0');`; in `'render shows the desktop line'` (two `FOCUS_LEFT_CHROME` events stored) add `assert.equal(dom.flags.textContent, '2');`.

- [ ] **Step 3: run** — `node --test tests/unit/flags.test.js tests/unit/sw-badge.test.js tests/unit/popup.test.js`. Expected: FAIL (`flags.js` missing; badge text never set; `dom.flags` undefined).

- [ ] **Step 4: implement**

`src/core/flags.js`:
```js
export const FLAGS = [
  ['PARALLEL_PAGE', 'Parallel pages', 'critical'],
  ['TAB_SWITCH', 'Tab switches', 'warning'],
  ['FOCUS_LEFT_CHROME', 'Left Chrome', 'warning'],
  ['INCOGNITO_WINDOW_OPENED', 'Incognito windows', 'critical'],
  ['DEVTOOLS_OPENED', 'DevTools', 'critical'],
  ['COPY', 'Copy', 'serious'],
  ['CUT', 'Cut', 'serious'],
  ['PASTE', 'Paste', 'serious'],
  ['PRINT', 'Print', 'serious'],
  ['DRAG', 'Drag out', 'serious'],
  ['DOWNLOAD_STARTED', 'Downloads', 'serious'],
  ['WINDOW_MINIMIZED', 'Window minimised', 'warning'],
  ['FULLSCREEN_EXIT', 'Fullscreen exits', 'warning'],
  ['SCREENSAVER', 'Screensaver / lock', 'warning'],
  ['EXTENSION_GAP', 'Recording gaps', 'serious'],
  ['CONFIG_CHANGED', 'Config changed', 'critical'],
  ['CLOCK_BACKWARDS', 'Clock set back', 'critical'],
];

export const flagCount = (counts) => FLAGS.reduce((n, [name]) => n + (counts[name] || 0), 0);
```
(Move whatever rows `src/core/summary-html.js` holds at that moment; the list above is the expected state after the hardening plan's Tasks 4 to 6. Drop rows for events that do not exist yet.)

`src/core/summary-html.js`: delete the local `FLAGS` constant and add `import { FLAGS } from './flags.js';`.

`src/adapters/badge.js`:
```js
export async function setBadge(text, color) {
  await chrome.action.setBadgeText({ text });
  if (color) await chrome.action.setBadgeBackgroundColor({ color });
}
```

`src/sw.js`:
- imports: `import { flagCount } from './core/flags.js'; import { setBadge } from './adapters/badge.js';`
- constant `const BADGE_COLOR = '#d03b3b';`
- helper:
```js
async function paintBadge(session, events) {
  if (!session || session.state === 'IDLE') return setBadge('');
  return setBadge(String(flagCount(tally(events).counts)), BADGE_COLOR);
}
```
- in `dispatchNow`, right after the batched `store.set(batch)` (or after the two writes if Task 8 of the hardening plan has not run): `if (newEvents.length || endEffect) await paintBadge(r.session, endEffect ? [] : events);`
- in `ensureBoot()` (or `boot()` if `ensureBoot` does not exist yet), as the last line: `const { session, events = [] } = await store.get(['session', 'events']); await paintBadge(session, events);` — inside `ensureBoot` run it in both branches.

`src/popup/popup.html`: after the `Desktop capture` pair add `<dt>Flags</dt><dd id="flags"></dd>`. `src/popup/popup.js`: `import { flagCount } from '../core/flags.js';` and after `const { counts, desktop } = tally(events);` add `$('flags').textContent = String(flagCount(counts));`.

- [ ] **Step 5: verify** — `npm test`, `npm run check`, `npm run test:integration`.

- [ ] **Step 6: docs** — `docs/centre-setup.md` §6 step 1: "The toolbar icon shows a red badge with `0` once ARMED; it counts flagged events (tab switches, parallel pages, copy, paste, focus left, …) and clears when the session ends." Spec §2: `core/flags.js` in the module list; new §6b "Toolbar badge": text = number of flagged events (`flags.flagCount(tally(events).counts)`), background `#d03b3b`, painted inside the queue after every dispatch that appended events and at SW start from storage, empty while IDLE. §8 summary.html: "Flags section rows come from `core/flags.js`".

- [ ] **Step 7: commit**

```bash
git add src/core/flags.js src/core/summary-html.js src/adapters/badge.js src/sw.js src/popup/popup.html src/popup/popup.js tests/unit/fake-chrome.js tests/unit/flags.test.js tests/unit/sw-badge.test.js tests/unit/popup.test.js docs/centre-setup.md docs/superpowers/specs/2026-09-12-exameye-design.md
git commit -m "feat(badge): red toolbar badge with the live count of flagged events; FLAGS shared by report, popup and badge"
```

## Task 2: independent verifier for a session folder

**Files:** `src/core/verify.js` (new), `tools/verify.mjs` (new), `tests/fixtures/session-ok/` (new: `log.txt`, `events.jsonl`, `screenshots/*.jpg`), `tests/unit/verify.test.js` (new), `package.json` (`check` and a `verify` script), `docs/centre-setup.md` new §9, spec §8.

**Interfaces:**
- `checkSession({ lines, events, exists }): Promise<{ ok, problems: string[], lines, events, shots }>` — `lines` = `log.txt` split on `\n` without the trailing empty element; `events` = parsed `events.jsonl` rows; `exists(relPath) → Promise<boolean>`.
- Problems (exact prefixes, tested): `log chain broken at line N` · `events.jsonl has E events, log.txt has L lines` · `event S hash H does not match log line N (X)` · `unsafe path P` · `missing P`.
- CLI: `node tools/verify.mjs <folder>` prints `OK <folder>: L lines, E events, S screenshots present` and exits 0, or `BROKEN <folder>` plus one indented problem per line and exits 1; usage error exits 2.

- [ ] **Step 1: fixture** — run once from the repo root (scratch script, not committed):

```js
// gen-fixture.mjs
import { headerLine, formatLine, chainLine } from './src/core/logline.js';
import { shortHash } from './src/core/hashchain.js';
import { makeEvent } from './src/core/events.js';
import { mkdir, writeFile } from 'node:fs/promises';
const t0 = Date.UTC(2026, 8, 12, 3, 45, 2);
const session = { id: '20260912-091502_A17', seat: 'A17', startedAt: t0 };
const evs = [
  makeEvent({ seq: 1, at: t0, name: 'SESSION_ARMED', tabId: 41, windowId: 3, data: { url: 'https://e.x/start?c=1', trigger: 'nav' } }),
  makeEvent({ seq: 2, at: t0 + 128000, name: 'TAB_SWITCH', tabId: 42, windowId: 3, data: { toTabId: 42, toUrl: 'https://g.x/', toTitle: 'G', toWindowId: 3, incognito: false } }),
];
evs[0].shot = 'screenshots/20260912-091502_SESSION_ARMED.jpg';
evs[1].shot = 'screenshots/20260912-091710_TAB_SWITCH.jpg';
const lines = [headerLine(session)];
let last = await shortHash(lines[0]);
for (const ev of evs) { const line = chainLine(formatLine(ev), last); ev.hash = last = await shortHash(line); lines.push(line); }
const dir = 'tests/fixtures/session-ok';
await mkdir(`${dir}/screenshots`, { recursive: true });
await writeFile(`${dir}/log.txt`, lines.join('\n') + '\n');
await writeFile(`${dir}/events.jsonl`, evs.map(e => JSON.stringify(e)).join('\n') + '\n');
for (const ev of evs) await writeFile(`${dir}/${ev.shot}`, Buffer.from('/9j/FAKE', 'base64'));
```
Run `node gen-fixture.mjs` from the scratchpad with the import paths adjusted to absolute, inspect the three files, then delete the script. The fixture is committed as generated (the header carries the generating machine's tz offset; the chain is valid regardless).

- [ ] **Step 2: failing tests** — `tests/unit/verify.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access, mkdtemp, cp, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { checkSession } from '../../src/core/verify.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const dir = path.join(ROOT, 'tests/fixtures/session-ok');

async function load(folder = dir) {
  const lines = (await readFile(path.join(folder, 'log.txt'), 'utf8')).split('\n');
  if (lines.at(-1) === '') lines.pop();
  const events = (await readFile(path.join(folder, 'events.jsonl'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const exists = (f) => access(path.join(folder, f)).then(() => true, () => false);
  return { lines, events, exists };
}

test('the intact fixture verifies', async () => {
  assert.deepEqual(await checkSession(await load()), { ok: true, problems: [], lines: 3, events: 2, shots: 2 });
});

test('an edited log line breaks the chain at the next line and its event hash', async () => {
  const f = await load();
  f.lines[1] = f.lines[1].replace('trigger="nav"', 'trigger="button"');
  const r = await checkSession(f);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p === 'log chain broken at line 2'), r.problems.join('; '));
  assert.ok(r.problems.some((p) => p.startsWith('event 1 hash ')), r.problems.join('; '));
});

test('a truncated log is a count mismatch', async () => {
  const f = await load();
  f.lines.pop();
  const r = await checkSession(f);
  assert.ok(r.problems.includes('events.jsonl has 2 events, log.txt has 1 lines'), r.problems.join('; '));
});

test('a missing screenshot and an escaping path are reported', async () => {
  const f = await load();
  f.events[1].shot = '../outside.jpg';
  const r = await checkSession({ ...f, exists: async (p) => p !== 'screenshots/20260912-091502_SESSION_ARMED.jpg' });
  assert.ok(r.problems.includes('missing screenshots/20260912-091502_SESSION_ARMED.jpg'), r.problems.join('; '));
  assert.ok(r.problems.includes('unsafe path ../outside.jpg'), r.problems.join('; '));
});

test('CLI: OK exits 0, a tampered copy exits 1 with BROKEN', async () => {
  const out = execFileSync(process.execPath, ['tools/verify.mjs', dir], { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /^OK .*: 3 lines, 2 events, 2 screenshots present\n$/);
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'exameye-verify-'));
  try {
    await cp(dir, tmp, { recursive: true });
    const log = await readFile(path.join(tmp, 'log.txt'), 'utf8');
    await writeFile(path.join(tmp, 'log.txt'), log.replace('TAB_SWITCH', 'TAB_SWITCX'));
    let code = 0, stdout = '';
    try { execFileSync(process.execPath, ['tools/verify.mjs', tmp], { cwd: ROOT, encoding: 'utf8' }); }
    catch (e) { code = e.status; stdout = e.stdout; }
    assert.equal(code, 1);
    assert.match(stdout, /^BROKEN /);
    assert.match(stdout, /event 2 hash /);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
```
(`rm` here removes only the `mkdtemp` directory this test created.)

- [ ] **Step 3: run** — `node --test tests/unit/verify.test.js`. Expected: FAIL (`verify.js` missing).

- [ ] **Step 4: implement**

`src/core/verify.js`:
```js
import { shortHash, verify } from './hashchain.js';

const unsafe = (p) => p.startsWith('/') || p.startsWith('\\') || p.split(/[\\/]/).includes('..');

export async function checkSession({ lines, events, exists }) {
  const problems = [];
  const chain = await verify(lines);
  if (!chain.ok) problems.push(`log chain broken at line ${chain.firstBad}`);
  const bodyLines = lines.length - 1;
  if (events.length !== bodyLines) problems.push(`events.jsonl has ${events.length} events, log.txt has ${bodyLines} lines`);
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
```

`tools/verify.mjs`:
```js
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
```

`package.json` scripts: `"verify": "node tools/verify.mjs"`, and append `&& node --check tools/verify.mjs` to `check`.

- [ ] **Step 5: verify** — `npm test`, `npm run check`, `npm run verify tests/fixtures/session-ok` (prints OK).

- [ ] **Step 6: docs** — `docs/centre-setup.md` new §9 "Verifying a session folder": requires Node 22 on the invigilator's machine (or any machine the folder is copied to); command `node tools/verify.mjs "<download dir>/ExamEye/<session>"` from the ExamEye folder; what OK and BROKEN mean (chain recomputed from `log.txt`, `events.jsonl` cross-checked line by line, every screenshot referenced must exist); a BROKEN result means the folder was edited or is incomplete after the session ended, and the first bad line says where. Note that the check is offline and never modifies the folder. Spec §8: "`tools/verify.mjs` recomputes the chain (`core/verify.checkSession`) and cross-checks `events.jsonl` and screenshot presence".

- [ ] **Step 7: commit**

```bash
git add src/core/verify.js tools/verify.mjs tests/fixtures/session-ok tests/unit/verify.test.js package.json docs/centre-setup.md docs/superpowers/specs/2026-09-12-exameye-design.md
git commit -m "feat(verify): offline verifier for a session folder (hash chain, events.jsonl cross-check, screenshot presence)"
```

## Task 3: multi-monitor flag

**Files:** `src/holder/holder.js`, `src/core/desktop.js`, `src/core/session.js`, `src/sw.js`, `src/core/counters.js`, `src/core/summary-text.js`, `src/core/flags.js`, `tests/unit/holder.test.js`, `tests/unit/desktop.test.js`, `tests/unit/session-hardening.test.js` (or `session-b.test.js` if the hardening plan has not run), `tests/unit/counters.test.js`, `tests/unit/summary-text.test.js`, `docs/centre-setup.md` §7, spec §5, §6a, §8, §14.

**Interfaces:**
- Holder `started` message gains `screens: 2 | 1 | null` (`globalThis.screen?.isExtended` true → 2, false → 1, unavailable → null). Ruling: `screen.isExtended` is a boolean, so `2` means "two or more"; the summary renders it as `2+ screens`.
- `meta.desktop.screens` (`EMPTY_DESKTOP.screens: null`), copied from `started`; the resumed `STARTED` input at arm carries it.
- Event `MULTI_MONITOR{ screens }` emitted once per session by the reducer on the first `DESKTOP STARTED` whose `data.screens > 1` (`session.multiMonitorSeen`); flag `warning`; no screenshot.
- `tally.desktop.screens` = max `data.screens` over `DESKTOP_CAPTURE_STARTED` events (default 1); `describeDesktopSummary` appends ` (2+ screens; only the shared one is captured)` when `> 1`.

- [ ] **Step 1: failing tests**

`tests/unit/holder.test.js` (a new test using the file's `loadHolder` helper and its `gum`/`dom` fakes; follow the existing `started` test to drive the stream to `started`):
```js
test('started reports screens 2 when screen.isExtended is true, 1 when false, null when unknown', async () => {
  for (const [scr, want] of [[{ isExtended: true }, 2], [{ isExtended: false }, 1], [{}, null]]) {
    globalThis.screen = scr;
    const h = await loadHolder({ readyResponse: { ask: true } });
    h.chooseCalls[0].cb('stream-id');
    const { stream } = makeStream();
    h.gum.resolve(stream);
    await flush();
    h.dom.v.onloadedmetadata();
    await flush();
    const started = h.sent.find((m) => m.name === 'started');
    assert.equal(started.screens, want, JSON.stringify(scr));
  }
  delete globalThis.screen;
});
```
(Same stream-start sequence as the existing `'the stream id is consumed by getUserMedia…'` test in this file.)

`tests/unit/desktop.test.js`:
```js
test('started copies screens into the desktop state and the input; EMPTY_DESKTOP.screens is null', () => {
  const r = onHolder(EMPTY_DESKTOP, { name: 'started', width: 1, height: 1, pickMs: 5, screens: 2 }, { at: T0, repromptMin: 5 });
  assert.equal(r.desktop.screens, 2);
  assert.equal(r.input.data.screens, 2);
  assert.equal(EMPTY_DESKTOP.screens, null);
  assert.equal(onHolder(EMPTY_DESKTOP, { name: 'started', width: 1, height: 1, pickMs: 5 }, { at: T0, repromptMin: 5 }).desktop.screens, null);
});
```

Reducer test:
```js
test('MULTI_MONITOR is emitted once per session on the first STARTED with screens > 1', () => {
  const started = (screens, at) => ({ kind: 'DESKTOP', name: 'STARTED', data: { width: 1, height: 1, pickMs: 1, screens }, at });
  let r = reduce(arm().session, started(2, T0 + 1000), cfg);
  assert.deepEqual(names(r), ['DESKTOP_CAPTURE_STARTED', 'MULTI_MONITOR']);
  assert.deepEqual(r.events[1].data, { screens: 2 });
  r = reduce(r.session, started(2, T0 + 2000), cfg);
  assert.deepEqual(names(r), ['DESKTOP_CAPTURE_STARTED']);
  assert.deepEqual(names(reduce(arm().session, started(1, T0 + 1000), cfg)), ['DESKTOP_CAPTURE_STARTED']);
  assert.deepEqual(names(reduce(arm().session, started(null, T0 + 1000), cfg)), ['DESKTOP_CAPTURE_STARTED']);
});
```

`tests/unit/counters.test.js` (uses the file's `ev` helper):
```js
test('desktop.screens is the largest screens value reported by a STARTED event, default 1', () => {
  assert.equal(tally([ev(1, 0, 'SESSION_ARMED', { url: 's' }, 1)]).desktop.screens, 1);
  const events = [
    ev(1, 0, 'SESSION_ARMED', { url: 's' }, 1),
    ev(2, 1000, 'DESKTOP_CAPTURE_STARTED', { width: 1, height: 1, pickMs: 1, screens: 2 }),
    ev(3, 2000, 'DESKTOP_CAPTURE_STOPPED', { reason: 'stop-sharing' }),
    ev(4, 3000, 'DESKTOP_CAPTURE_STARTED', { width: 1, height: 1, pickMs: 1, screens: 1 }),
  ];
  assert.equal(tally(events).desktop.screens, 2);
});
```

`tests/unit/summary-text.test.js`: `describeDesktopSummary({ frames: 3, declined: 0, screens: 2, spans: [{ from: onAt, to: null, stopped: false }] }, endAt)` ends with ` (3 frames) (2+ screens; only the shared one is captured)`; with `screens: 1` the suffix is absent.

- [ ] **Step 2: run** — the five files; expected FAIL on each new assertion.

- [ ] **Step 3: implement**
- `holder.js` in `ask()`'s success path: `const screens = typeof globalThis.screen?.isExtended === 'boolean' ? (globalThis.screen.isExtended ? 2 : 1) : null;` and `send({ name: 'started', width: v.videoWidth, height: v.videoHeight, pickMs, screens });`
- `core/desktop.js`: `EMPTY_DESKTOP` gains `screens: null`; `started` sets `screens: msg.screens ?? null` on the desktop and `data: { width, height, pickMs, screens: msg.screens ?? null }` on the input.
- `sw.js` resumed input at arm: `data: { width: d.width, height: d.height, screens: d.screens ?? null, pickMs: null, resumed: true }`.
- `core/session.js`: `arm()` adds `multiMonitorSeen: false`; `HANDLERS.DESKTOP`:
```js
  DESKTOP(s, input, cfg, emit) {
    const name = DESKTOP_EVENT[input.name];
    if (name) emit(name, input.data || {});
    if (input.name === 'STARTED' && input.data?.screens > 1 && !s.multiMonitorSeen) {
      s.multiMonitorSeen = true;
      emit('MULTI_MONITOR', { screens: input.data.screens });
    }
  },
```
- `core/counters.js`: `let screens = 1;` and in the `DESKTOP_CAPTURE_STARTED` branch `if (ev.data.screens > screens) screens = ev.data.screens;`; return `desktop: { frames: …, screens, spans }`.
- `core/summary-text.js` `describeDesktopSummary`: destructure `screens = 1`; after `line += \` (${frames} frames)\`;` add `if (screens > 1) line += \` (${screens}+ screens; only the shared one is captured)\`;`.
- `core/flags.js`: `['MULTI_MONITOR', 'Multiple screens', 'warning'],`.

- [ ] **Step 4: verify** — `npm test`, `npm run check`, `npm run test:integration`.

- [ ] **Step 5: docs** — spec §5 row `| MULTI_MONITOR | first DESKTOP STARTED with screens > 1 (once per session) | screens | no |`; §6a "Messages": `started{width,height,pickMs,screens}`; "State": `screens`; §8: the `Desktop:` suffix; §14 new item "Multiple screens: the share dialog captures the one screen the candidate picks; `screen.isExtended` only says whether more than one exists, so the summary reads `2+ screens`". `docs/centre-setup.md` §7: "A second monitor is flagged (`MULTI_MONITOR`); only the shared screen is captured. Disconnect extra displays before the paper where possible."

- [ ] **Step 6: commit**

```bash
git add src/holder/holder.js src/core/desktop.js src/core/session.js src/sw.js src/core/counters.js src/core/summary-text.js src/core/flags.js tests/unit/holder.test.js tests/unit/desktop.test.js tests/unit/session-hardening.test.js tests/unit/counters.test.js tests/unit/summary-text.test.js docs/centre-setup.md docs/superpowers/specs/2026-09-12-exameye-design.md
git commit -m "feat(desktop): flag MULTI_MONITOR once per session when the candidate has more than one screen"
```

## Task 4 (gated): per-file screenshot storage and the summary.html size check

**Gate:** execute only if the owner's 3-hour run shows trouble: dispatch latency visible in the popup's "Last flush" lag, `lastError` mentioning quota or serialisation, or `summary.html` produced in the linked variant. Otherwise leave this task unexecuted and record `Owner: 3-hour run clean; Task 4 not needed`.

**Files:** `src/sw.js` (`dispatchNow` arm-time clear, `takeShots`, the END snapshot, `endSession`), `src/adapters/storage.js`, `tests/unit/sw-shots.test.js`, `tests/unit/sw-end.test.js`, `tests/unit/sw-startup.test.js`, spec §7.

**Interfaces:**
- Storage: one key per screenshot, `shot:<file>` → base64; an index `shotIndex: string[]` (file names in capture order). The `shots{}` map disappears.
- `pendingEnd.shotFiles: string[]` replaces `pendingEnd.shots`; `endSession` reads the blobs it needs by key and removes them after the summary is written, then clears `pendingEnd`.
- Arm sweeps orphan `shot:*` keys (from a kill between the summary write and the key removal) with one `storage.local.get(null)`; this is the only `get(null)` and runs once per session.

- [ ] **Step 1: failing tests**
- `sw-shots.test.js`: after a shot-bearing dispatch, `(await get('shotIndex')).shotIndex` lists the file and `(await get('shot:' + file))['shot:' + file]` is the base64; the existing `'a dispatch with no shot-worthy event never loads the shots map'` test now asserts no key starting with `shot:` and not `shotIndex` is read.
- `sw-end.test.js`: after END, no `shot:*` key remains and `summary.html` (inline variant) still embeds every screenshot; `meta.pendingEnd.shotFiles` is a string array while the END is pending.
- `sw-startup.test.js`: the replay test (`recover()` with a stored `pendingEnd`) renders `summary.html` byte-identical to the first attempt when the blobs are still present; when they are gone the linked variant is produced and the fact is recorded in `meta.lastError`.

- [ ] **Step 2: implement**
- `takeShots`: replace `const { shots = {} } = await store.get('shots')` and `await store.set({ shots })` with a `store.set(Object.fromEntries(added.map(s => ['shot:' + s.file, s.b64])))` plus `shotIndex` append (`const { shotIndex = [] } = await store.get('shotIndex'); … await store.set({ shotIndex: [...shotIndex, ...added.map(s => s.file)] })`) — one `set` carrying both.
- Arm-time clear in `dispatchNow`: replace `await store.set({ shots: {} })` with `await sweepShots()`: `const all = await store.get(null); const keys = Object.keys(all).filter(k => k.startsWith('shot:')); if (keys.length) await store.remove(keys); await store.set({ shotIndex: [] });`
- END snapshot: `pendingEnd = { …, shotFiles: shotIndex }` and `batch.shotIndex = []` (no `shots: {}`).
- `endSession`: `const got = await store.get(e.shotFiles.map(f => 'shot:' + f)); const shots = Object.fromEntries(e.shotFiles.filter(f => got['shot:' + f]).map(f => [f, got['shot:' + f]]));` render as today; after the summary write(s): `await store.patchMeta({ pendingEnd: null }); await store.remove(e.shotFiles.map(f => 'shot:' + f));` in that order (a kill between the two leaves orphans for the next arm's sweep, never a broken replay).
- `recover()`/`finishPendingEndNow` unchanged.
- Spec §7 storage layout updated; the `shots{}` entry removed.

- [ ] **Step 3: summary.html size check (manual, owner)** — after a real session with desktop capture on and at least 40 desktop frames: `ls -l summary.html`; `grep -c 'src="data:image' summary.html` versus `grep -c 'src="screenshots/' summary.html`. Inline variant present → the data: download accepted that size on Chrome 153; linked variant → record the size at which the fallback fired in spec §14 item 2.

- [ ] **Step 4: verify + commit** — `npm test`, `npm run check`, `npm run test:integration`; `git commit -m "perf(storage): one key per screenshot; END reads and removes its own blobs"`.

## Task 5: review and push

- [ ] `npm test`, `npm run test:integration`, `npm run check`; `pgrep -fl "ms-playwright/chromium"` empty.
- [ ] `/code-review high` on the range from the first commit of this session to `HEAD`; fix every finding with a test; re-run the three commands.
- [ ] Ledger: DONE lines per task, the rulings below, the parked decisions unchanged (distribution route; devtools_page detector; rename of `resumed` → `sharedBeforeArm`), and the owner-verification list (Windows dry run §6 steps 1a/2a; 3-hour run; Edge; NTA config: blank in-progress prefix, marker "Submitted Successfully", max 190, periodic 10; the dev-mode bubble's Disable button).
- [ ] `git push origin main`; tell the owner to Reload the extension.
- [ ] End with the list of rulings and a paste-ready review prompt.

## Rulings made while planning (copy into the ledger when executing)

- Ruling: the badge shows `0` in red as soon as a session arms (it doubles as the "recording" indicator) and is empty while IDLE.
- Ruling: `flagCount` sums `tally(events).counts` over `FLAGS`, so `SCREENSAVER` (derived by `tally`) counts like any event.
- Ruling: `screens` is a lower bound (`screen.isExtended` is boolean); the summary reads `2+ screens`. `system.display` was not added: it would need a new permission for a count the flag does not need.
- Ruling: the verifier refuses shot paths that are absolute or contain `..` instead of probing them.
- Ruling: Task 4 stays gated on the owner's 3-hour run.
