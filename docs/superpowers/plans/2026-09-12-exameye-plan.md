# ExamEye Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the ExamEye MV3 extension (Chrome + Edge) that records a candidate's browser activity during an exam into `<downloads>/<subfolder>/<sessionId>/` via `chrome.downloads`, with pure, unit-tested core modules and thin chrome.* adapters.

**Architecture:** A module service worker (`src/sw.js`) turns chrome events into inputs for a pure session reducer, appends hash-chained log lines and events to `chrome.storage.local`, takes coalesced screenshots, and flushes pending file writes through `chrome.downloads.download` with `data:` URLs. A classic content script reports page-level events from the exam tab; an options page writes config; a popup reads live state. All business logic lives in `src/core/*` (no chrome.*), all chrome.* calls in `src/adapters/*` or `src/sw.js`.

**Tech Stack:** Plain JS ES modules, no framework, no bundler. Node ≥ 22 with `node --test` for unit tests. Playwright (`chromium.launchPersistentContext`, bundled Chromium) for integration.

**Spec:** `/Users/pawank/DiskAlpha/Development/exameye/docs/superpowers/specs/2026-09-12-exameye-design.md` — read it first; every task below cites the section it implements.

## Global Constraints

- Plain JS ES modules everywhere except `src/content.js`, which must be a classic script (no `import`/`export`) because `scripting.registerContentScripts` does not load modules.
- No framework, no bundler, no build step. `npm install` only pulls `playwright` as a devDependency.
- Node ≥ 22. Unit tests: `node --test tests/unit/`. Integration: `node --test tests/integration/`.
- **Every verification command in this plan is run synchronously in the foreground by whoever executes the task, and its real output is read before the step is ticked.** No backgrounding, no polling, no `sleep`.
- **Commits:** the owner has not authorised commits and `/Users/pawank/DiskAlpha/Development/exameye` is not a git repository. Each task ends with a ready-to-run commit command; the executor does **not** run it (nor `git init`) unless the owner explicitly says so.
- `manifest_version: 3`, `minimum_chrome_version: "120"`, permissions exactly: `tabs, webNavigation, alarms, storage, unlimitedStorage, downloads, downloads.ui, idle, scripting`; `host_permissions: ["<all_urls>"]`; `incognito: "spanning"`.
- `chrome.alarms` floor is 30 s: `tick` alarm `periodInMinutes: 0.5`; never shorter.
- Screenshot: `captureVisibleTab(windowId, { format:'jpeg', quality:50 })`, coalesced to one capture per 2000 ms.
- `chrome.downloads.download({ url:'data:…;base64,…', filename:'<subfolder>/<sessionId>/<rel>', conflictAction:'overwrite', saveAs:false })` — the only persistence sink. Do not reopen this decision.
- Simplicity first: no abstractions for single-use code, no speculative options. Match the code in this plan; do not add features.
- No emojis anywhere. No comments unless the WHY is non-obvious.

---

## File structure

| Path | Responsibility |
|---|---|
| `package.json` | `type: module`, scripts `test`, `test:integration`, `check` |
| `manifest.json` | MV3 manifest (spec §9) |
| `src/core/urlmatch.js` | `matchesPrefix`, `originOf`, `prefixToMatchPattern`, `classify` |
| `src/core/config.js` | `DEFAULTS`, `normalize`, `validate`, `effectiveExamPrefix`, `resolved` |
| `src/core/ids.js` | `stamp`, `tzOffset`, `fmtLocal`, `fmtDuration`, `sanitizeSeat`, `sessionId`, `shotFile` |
| `src/core/hashchain.js` | `GENESIS`, `shortHash`, `prevHashOf`, `verify` |
| `src/core/logline.js` | `headerLine`, `formatLine`, `chainLine` |
| `src/core/events.js` | `SHOT_EVENTS`, `needsShot`, `makeEvent` |
| `src/core/session.js` | `initial`, `reduce` (state machine, spec §4) |
| `src/core/sink.js` | `toBase64`, `dataUrl`, `putText`, `putBase64`, `remove` |
| `src/core/counters.js` | `tally` |
| `src/core/summary-text.js` | `renderSummaryText` |
| `src/core/summary-html.js` | `escapeHtml`, `renderSummaryHtml` |
| `src/adapters/storage.js` | `get`, `set`, `remove`, `patchMeta` |
| `src/adapters/alarms.js` | `setPeriodic`, `setAt`, `clear` |
| `src/adapters/capture.js` | `captureJpeg` |
| `src/adapters/downloads.js` | `suppressUi`, `writeFile`, `eraseOwnCompleted` |
| `src/adapters/scripting.js` | `registerExamScript` |
| `src/adapters/tabs.js` | `getTab`, `queryAllTabs` |
| `src/adapters/windows.js` | `getWindow`, `getAllWindows`, `focusedWindowId` |
| `src/sw.js` | wiring: boot, `dispatch`, listeners, screenshots, effects, `flush`, `endSession` |
| `src/content.js` | classic content script |
| `src/options/options.html`, `options.js` | configuration form |
| `src/popup/popup.html`, `popup.js` | live state |
| `tests/unit/fake-chrome.js` | in-memory `globalThis.chrome` double |
| `tests/unit/*.test.js` | one per module |
| `tests/integration/harness.js`, `session.test.js`, `site/*.html` | Playwright harness |
| `docs/centre-setup.md` | manual centre setup checklist |

---

### Task 1: Project scaffold and test runner

**Files:**
- Create: `package.json`
- Create: `manifest.json`
- Create: `.gitignore`
- Test: `tests/unit/manifest.test.js`

**Interfaces:**
- Produces: `npm test` runs `node --test tests/unit/`; `manifest.json` per spec §9 (referenced by Tasks 13–17 and the harness).

- [ ] **Step 1: Write the failing test**

`tests/unit/manifest.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('manifest is MV3 with the agreed permissions', async () => {
  const m = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
  assert.equal(m.manifest_version, 3);
  assert.deepEqual(m.permissions, ['tabs', 'webNavigation', 'alarms', 'storage', 'unlimitedStorage', 'downloads', 'downloads.ui', 'idle', 'scripting']);
  assert.deepEqual(m.host_permissions, ['<all_urls>']);
  assert.equal(m.background.service_worker, 'src/sw.js');
  assert.equal(m.background.type, 'module');
  assert.equal(m.incognito, 'spanning');
  assert.equal(m.minimum_chrome_version, '120');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/`
Expected: FAIL — `ENOENT ... manifest.json`.

- [ ] **Step 3: Write package.json, manifest.json, .gitignore**

`package.json`:
```json
{
  "name": "exameye",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "node --test tests/unit/",
    "test:integration": "node --test tests/integration/",
    "check": "node --check src/sw.js && node --check src/content.js && node --check src/options/options.js && node --check src/popup/popup.js"
  }
}
```

`manifest.json`:
```json
{
  "manifest_version": 3,
  "name": "ExamEye",
  "version": "0.1.0",
  "description": "Records browser activity during an online exam. Records only; never blocks.",
  "minimum_chrome_version": "120",
  "permissions": ["tabs", "webNavigation", "alarms", "storage", "unlimitedStorage", "downloads", "downloads.ui", "idle", "scripting"],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "src/sw.js", "type": "module" },
  "options_page": "src/options/options.html",
  "action": { "default_popup": "src/popup/popup.html", "default_title": "ExamEye" },
  "incognito": "spanning"
}
```

`.gitignore`:
```
node_modules/
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && npm test`
Expected: `# pass 1`, `# fail 0`.

- [ ] **Step 5: Commit (do not run unless the owner authorised commits)**

```bash
git add package.json manifest.json .gitignore tests/unit/manifest.test.js
git commit -m "chore: scaffold ExamEye MV3 extension with node --test runner"
```

---

### Task 2: URL matching (`src/core/urlmatch.js`)

**Files:**
- Create: `src/core/urlmatch.js`
- Test: `tests/unit/urlmatch.test.js`

**Interfaces:**
- Produces: `matchesPrefix(url: string, prefix: string): boolean`; `originOf(prefix): string` (`scheme://host[:port]/`); `prefixToMatchPattern(prefix): string`; `classify(url, cfg: {startPrefix, examPrefix, resultPrefix}): 'result'|'start'|'exam'|null` — precedence result > start > exam. `cfg.examPrefix` must already be the effective prefix (Task 3 `resolved()`).

- [ ] **Step 1: Write the failing test**

`tests/unit/urlmatch.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesPrefix, originOf, prefixToMatchPattern, classify } from '../../src/core/urlmatch.js';

const cfg = { startPrefix: 'https://exam.example.com/start', examPrefix: 'https://exam.example.com/', resultPrefix: 'https://exam.example.com/result' };

test('matchesPrefix is a plain starts-with; empty prefix never matches', () => {
  assert.equal(matchesPrefix('https://exam.example.com/start?c=9', 'https://exam.example.com/start'), true);
  assert.equal(matchesPrefix('https://exam.example.com/st', 'https://exam.example.com/start'), false);
  assert.equal(matchesPrefix('https://exam.example.com/x', ''), false);
});

test('originOf keeps scheme, host and port', () => {
  assert.equal(originOf('http://127.0.0.1:8080/exam/start.html'), 'http://127.0.0.1:8080/');
  assert.equal(originOf('https://exam.example.com/start?x=1'), 'https://exam.example.com/');
});

test('prefixToMatchPattern drops query/fragment and appends *', () => {
  assert.equal(prefixToMatchPattern('https://exam.example.com/start?x=1#f'), 'https://exam.example.com/start*');
  assert.equal(prefixToMatchPattern('http://127.0.0.1:8080/'), 'http://127.0.0.1:8080/*');
});

test('classify precedence is result > start > exam', () => {
  assert.equal(classify('https://exam.example.com/result/123', cfg), 'result');
  assert.equal(classify('https://exam.example.com/start?c=1', cfg), 'start');
  assert.equal(classify('https://exam.example.com/q/2', cfg), 'exam');
  assert.equal(classify('https://google.com/', cfg), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/urlmatch.test.js`
Expected: FAIL — `Cannot find module .../src/core/urlmatch.js`.

- [ ] **Step 3: Write the implementation**

`src/core/urlmatch.js`:
```js
export function matchesPrefix(url, prefix) {
  return Boolean(prefix) && typeof url === 'string' && url.startsWith(prefix);
}

export function originOf(prefix) {
  const u = new URL(prefix);
  return `${u.protocol}//${u.host}/`;
}

export function prefixToMatchPattern(prefix) {
  const u = new URL(prefix);
  return `${u.protocol}//${u.host}${u.pathname}*`;
}

export function classify(url, cfg) {
  if (matchesPrefix(url, cfg.resultPrefix)) return 'result';
  if (matchesPrefix(url, cfg.startPrefix)) return 'start';
  if (matchesPrefix(url, cfg.examPrefix)) return 'exam';
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/urlmatch.test.js`
Expected: `# pass 4`, `# fail 0`.

- [ ] **Step 5: Commit (do not run unless authorised)**

```bash
git add src/core/urlmatch.js tests/unit/urlmatch.test.js
git commit -m "feat(core): URL prefix matching and match-pattern conversion"
```

---

### Task 3: Configuration (`src/core/config.js`)

**Files:**
- Create: `src/core/config.js`
- Test: `tests/unit/config.test.js`

**Interfaces:**
- Consumes: `originOf` (Task 2).
- Produces: `DEFAULTS` (frozen object with the 7 fields of spec §3); `normalize(raw): cfg`; `validate(cfg): Array<{field, message}>`; `effectiveExamPrefix(cfg): string`; `resolved(cfg): cfg` (copy with `examPrefix` filled by the blank-prefix default rule).

- [ ] **Step 1: Write the failing test**

`tests/unit/config.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalize, validate, effectiveExamPrefix, resolved } from '../../src/core/config.js';

const good = { startPrefix: 'https://exam.example.com/start', examPrefix: '', resultPrefix: 'https://exam.example.com/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10 };

test('normalize merges defaults, trims strings, coerces numbers', () => {
  const cfg = normalize({ startPrefix: '  https://x.example/s ', shotIntervalMin: '5' });
  assert.equal(cfg.startPrefix, 'https://x.example/s');
  assert.equal(cfg.shotIntervalMin, 5);
  assert.equal(cfg.subfolder, DEFAULTS.subfolder);
  assert.equal(cfg.abandonMin, 10);
});

test('validate returns [] for a good config', () => {
  assert.deepEqual(validate(good), []);
});

test('validate names each bad field', () => {
  const errors = validate({ ...good, startPrefix: 'ftp://x', seat: '', subfolder: 'a/b', shotIntervalMin: 0, abandonMin: 500 });
  assert.deepEqual(errors.map(e => e.field), ['startPrefix', 'seat', 'subfolder', 'shotIntervalMin', 'abandonMin']);
});

test('examPrefix may be blank but not garbage', () => {
  assert.deepEqual(validate({ ...good, examPrefix: 'nope' }).map(e => e.field), ['examPrefix']);
});

test('effective exam prefix defaults to the start origin', () => {
  assert.equal(effectiveExamPrefix(good), 'https://exam.example.com/');
  assert.equal(effectiveExamPrefix({ ...good, examPrefix: 'https://exam.example.com/paper/' }), 'https://exam.example.com/paper/');
  assert.equal(resolved(good).examPrefix, 'https://exam.example.com/');
  assert.equal(good.examPrefix, '');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/config.test.js`
Expected: FAIL — `Cannot find module .../src/core/config.js`.

- [ ] **Step 3: Write the implementation**

`src/core/config.js`:
```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/config.test.js`
Expected: `# pass 5`, `# fail 0`.

- [ ] **Step 5: Commit (do not run unless authorised)**

```bash
git add src/core/config.js tests/unit/config.test.js
git commit -m "feat(core): config defaults, validation and blank-exam-prefix default"
```

---

### Task 4: Identifiers and time formatting (`src/core/ids.js`)

**Files:**
- Create: `src/core/ids.js`
- Test: `tests/unit/ids.test.js`

**Interfaces:**
- Produces: `stamp(dateOrMs): 'YYYYMMDD-HHMMSS'` (local time); `tzOffset(dateOrMs): '+05:30'`; `fmtLocal(dateOrMs): 'YYYY-MM-DD HH:MM:SS'`; `fmtDuration(ms): 'HH:MM:SS'`; `sanitizeSeat(seat): string`; `sessionId(dateOrMs, seat): string`; `shotFile(dateOrMs, eventName): 'screenshots/<stamp>_<EVENT>.jpg'`.

- [ ] **Step 1: Write the failing test**

`tests/unit/ids.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stamp, tzOffset, fmtLocal, fmtDuration, sanitizeSeat, sessionId, shotFile } from '../../src/core/ids.js';

const d = new Date(2026, 8, 12, 9, 15, 2);

test('stamp and fmtLocal use local time', () => {
  assert.equal(stamp(d), '20260912-091502');
  assert.equal(fmtLocal(d.getTime()), '2026-09-12 09:15:02');
});

test('tzOffset is signed HH:MM', () => {
  assert.match(tzOffset(d), /^[+-]\d\d:\d\d$/);
});

test('fmtDuration', () => {
  assert.equal(fmtDuration(0), '00:00:00');
  assert.equal(fmtDuration(3723000), '01:02:03');
  assert.equal(fmtDuration(-5), '00:00:00');
});

test('seat is sanitised for file names, raw form untouched elsewhere', () => {
  assert.equal(sanitizeSeat('A 17/B'), 'A_17_B');
  assert.equal(sanitizeSeat(''), 'SEAT');
  assert.equal(sanitizeSeat('x'.repeat(40)).length, 32);
});

test('sessionId and shotFile', () => {
  assert.equal(sessionId(d, 'A17'), '20260912-091502_A17');
  assert.equal(shotFile(d, 'TAB_SWITCH'), 'screenshots/20260912-091502_TAB_SWITCH.jpg');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/ids.test.js`
Expected: FAIL — `Cannot find module .../src/core/ids.js`.

- [ ] **Step 3: Write the implementation**

`src/core/ids.js`:
```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/ids.test.js`
Expected: `# pass 5`, `# fail 0`.

- [ ] **Step 5: Commit (do not run unless authorised)**

```bash
git add src/core/ids.js tests/unit/ids.test.js
git commit -m "feat(core): session ids, screenshot names and time formatting"
```

---

### Task 5: Hash chain (`src/core/hashchain.js`)

**Files:**
- Create: `src/core/hashchain.js`
- Test: `tests/unit/hashchain.test.js`

**Interfaces:**
- Produces: `GENESIS = '00000000'`; `shortHash(text): Promise<string>` (first 8 hex chars of SHA-256, via `globalThis.crypto.subtle`); `prevHashOf(line): string` (text after the last `' #'`); `verify(lines: string[]): Promise<{ok: boolean, firstBad: number}>` (`firstBad` −1 when ok).

- [ ] **Step 1: Write the failing test**

`tests/unit/hashchain.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GENESIS, shortHash, prevHashOf, verify } from '../../src/core/hashchain.js';

test('shortHash is the first 8 hex chars of SHA-256', async () => {
  assert.equal(await shortHash('abc'), 'ba7816bf');
});

test('prevHashOf reads the trailing #hash', () => {
  assert.equal(prevHashOf('2026 X a=1 #ba7816bf'), 'ba7816bf');
});

test('verify accepts a valid chain and pinpoints a break', async () => {
  const l0 = `# header #${GENESIS}`;
  const l1 = `line one #${await shortHash(l0)}`;
  const l2 = `line two #${await shortHash(l1)}`;
  assert.deepEqual(await verify([l0, l1, l2]), { ok: true, firstBad: -1 });
  assert.deepEqual(await verify([l0, l1.replace('one', 'uno'), l2]), { ok: false, firstBad: 2 });
  assert.deepEqual(await verify([`# header #deadbeef`]), { ok: false, firstBad: 0 });
  assert.deepEqual(await verify([]), { ok: true, firstBad: -1 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/hashchain.test.js`
Expected: FAIL — `Cannot find module .../src/core/hashchain.js`.

- [ ] **Step 3: Write the implementation**

`src/core/hashchain.js`:
```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/hashchain.test.js`
Expected: `# pass 3`, `# fail 0`.

- [ ] **Step 5: Commit (do not run unless authorised)**

```bash
git add src/core/hashchain.js tests/unit/hashchain.test.js
git commit -m "feat(core): SHA-256 short hash chain with verifier"
```

---

### Task 6: Log line grammar (`src/core/logline.js`)

**Files:**
- Create: `src/core/logline.js`
- Test: `tests/unit/logline.test.js`

**Interfaces:**
- Consumes: `GENESIS` (Task 5), `tzOffset` (Task 4).
- Produces: `headerLine(session: {id, seat, startedAt}): string`; `formatLine(ev): string` (no hash suffix); `chainLine(text, prevHash): string` (`text + ' #' + prevHash`). Spec §8 grammar.

- [ ] **Step 1: Write the failing test**

`tests/unit/logline.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headerLine, formatLine, chainLine } from '../../src/core/logline.js';

test('headerLine carries id, seat, started, tz and genesis hash', () => {
  const h = headerLine({ id: '20260912-091502_A17', seat: 'A 17', startedAt: Date.UTC(2026, 8, 12, 3, 45, 2, 117) });
  assert.match(h, /^# ExamEye session 20260912-091502_A17 seat="A 17" started=2026-09-12T03:45:02\.117Z tz=[+-]\d\d:\d\d #00000000$/);
});

test('formatLine: ts name tab win data... shot', () => {
  const ev = { seq: 2, ts: '2026-09-12T03:47:10.004Z', t: 0, name: 'TAB_SWITCH', tabId: 42, windowId: 3,
    data: { toUrl: 'https://google.com/', toTitle: 'Go ogle', incognito: false, n: 1.5, x: null }, shot: 'screenshots/a.jpg' };
  assert.equal(formatLine(ev),
    '2026-09-12T03:47:10.004Z TAB_SWITCH tab=42 win=3 toUrl="https://google.com/" toTitle="Go ogle" incognito=false n=1.5 x=null shot="screenshots/a.jpg"');
});

test('formatLine omits absent tab/win/shot and empty data', () => {
  assert.equal(formatLine({ ts: 'T', name: 'PERIODIC', data: {}, shot: null }), 'T PERIODIC');
});

test('chainLine appends the previous hash', () => {
  assert.equal(chainLine('T PERIODIC', 'ba7816bf'), 'T PERIODIC #ba7816bf');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/logline.test.js`
Expected: FAIL — `Cannot find module .../src/core/logline.js`.

- [ ] **Step 3: Write the implementation**

`src/core/logline.js`:
```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/logline.test.js`
Expected: `# pass 4`, `# fail 0`.

- [ ] **Step 5: Commit (do not run unless authorised)**

```bash
git add src/core/logline.js tests/unit/logline.test.js
git commit -m "feat(core): log.txt line grammar with chained hash suffix"
```

---

### Task 7: Event catalogue (`src/core/events.js`)

**Files:**
- Create: `src/core/events.js`
- Test: `tests/unit/events.test.js`

**Interfaces:**
- Produces: `SHOT_EVENTS: Set<string>`; `needsShot(ev): boolean` (spec §5 table, incl. the PARALLEL_PAGE `trigger==='activated'` and SESSION_DISARMED `outcome==='RESULT'` rules); `makeEvent({seq, at, name, tabId?, windowId?, data?}): {seq, ts, t, name, data, shot:null, tabId?, windowId?}`.

- [ ] **Step 1: Write the failing test**

`tests/unit/events.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsShot, makeEvent } from '../../src/core/events.js';

test('needsShot follows the catalogue', () => {
  assert.equal(needsShot({ name: 'TAB_SWITCH', data: {} }), true);
  assert.equal(needsShot({ name: 'COPY', data: {} }), true);
  assert.equal(needsShot({ name: 'PERIODIC', data: {} }), true);
  assert.equal(needsShot({ name: 'WINDOW_MINIMIZED', data: {} }), false);
  assert.equal(needsShot({ name: 'IDLE_START', data: {} }), false);
  assert.equal(needsShot({ name: 'PARALLEL_PAGE', data: { trigger: 'activated' } }), true);
  assert.equal(needsShot({ name: 'PARALLEL_PAGE', data: { trigger: 'committed' } }), false);
  assert.equal(needsShot({ name: 'SESSION_DISARMED', data: { outcome: 'RESULT' } }), true);
  assert.equal(needsShot({ name: 'SESSION_DISARMED', data: { outcome: 'ABANDONED' } }), false);
});

test('makeEvent shapes the record and omits absent ids', () => {
  const ev = makeEvent({ seq: 3, at: 1789530302117, name: 'EXAM_NAV', tabId: 41, data: { url: 'u' } });
  assert.deepEqual(ev, { seq: 3, ts: '2026-09-12T03:45:02.117Z', t: 1789530302117, name: 'EXAM_NAV', data: { url: 'u' }, shot: null, tabId: 41 });
  assert.deepEqual(makeEvent({ seq: 1, at: 0, name: 'PERIODIC' }).data, {});
  assert.equal('windowId' in makeEvent({ seq: 1, at: 0, name: 'PERIODIC' }), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/events.test.js`
Expected: FAIL — `Cannot find module .../src/core/events.js`.

- [ ] **Step 3: Write the implementation**

`src/core/events.js`:
```js
export const SHOT_EVENTS = new Set([
  'SESSION_ARMED', 'TAB_SWITCH', 'FOCUS_LEFT_CHROME', 'WINDOW_OPENED', 'INCOGNITO_WINDOW_OPENED',
  'FULLSCREEN_EXIT', 'COPY', 'CUT', 'PASTE', 'CONTEXTMENU', 'PRINT', 'DEVTOOLS_OPENED',
  'DOWNLOAD_STARTED', 'PERIODIC',
]);

export function needsShot(ev) {
  if (ev.name === 'PARALLEL_PAGE') return ev.data.trigger === 'activated';
  if (ev.name === 'SESSION_DISARMED') return ev.data.outcome === 'RESULT';
  return SHOT_EVENTS.has(ev.name);
}

export function makeEvent({ seq, at, name, tabId, windowId, data = {} }) {
  const ev = { seq, ts: new Date(at).toISOString(), t: at, name, data, shot: null };
  if (tabId !== undefined) ev.tabId = tabId;
  if (windowId !== undefined) ev.windowId = windowId;
  return ev;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/events.test.js`
Expected: `# pass 2`, `# fail 0`.

- [ ] **Step 5: Commit (do not run unless authorised)**

```bash
git add src/core/events.js tests/unit/events.test.js
git commit -m "feat(core): event catalogue and screenshot rule"
```

---

### Task 8: Session reducer, part A — arm, exam navigation, result, tab loss, abandon, startup, gap, periodic

**Files:**
- Create: `src/core/session.js`
- Test: `tests/unit/session-a.test.js`

**Interfaces:**
- Consumes: `classify` (Task 2), `sessionId` (Task 4), `makeEvent` (Task 7).
- Produces: `initial(): {state:'IDLE'}`; `reduce(session, input, cfg): {session, events, effects}`. Inputs and effects exactly as spec §4. `cfg` is a *resolved* config (Task 3). Effects: `{type:'ABANDON_ALARM_SET', when}`, `{type:'ABANDON_ALARM_CLEAR'}`, `{type:'PROBE'}`, `{type:'END', outcome, session}` (`session` = ARMED record snapshot). Task 9 adds the remaining handlers to the same `HANDLERS` object.

- [ ] **Step 1: Write the failing test**

`tests/unit/session-a.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initial, reduce } from '../../src/core/session.js';

const cfg = { startPrefix: 'https://e.x/start', examPrefix: 'https://e.x/', resultPrefix: 'https://e.x/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10 };
const T0 = Date.UTC(2026, 8, 12, 3, 45, 2);
const nav = (tabId, url, at = T0, windowId = 3) => ({ kind: 'NAV', tabId, windowId, url, at });
const arm = () => reduce(initial(), nav(41, 'https://e.x/start?c=1'), cfg);
const names = (r) => r.events.map(e => e.name);

test('IDLE ignores non-start navigations', () => {
  const r = reduce(initial(), nav(41, 'https://e.x/result'), cfg);
  assert.equal(r.session.state, 'IDLE');
  assert.deepEqual(r.events, []);
});

test('IDLE + start navigation arms and emits SESSION_ARMED with seq 1', () => {
  const r = arm();
  assert.equal(r.session.state, 'ARMED');
  assert.equal(r.session.examTabId, 41);
  assert.equal(r.session.examWindowId, 3);
  assert.match(r.session.id, /^\d{8}-\d{6}_A17$/);
  assert.deepEqual(names(r), ['SESSION_ARMED']);
  assert.equal(r.events[0].seq, 1);
  assert.equal(r.events[0].tabId, 41);
  assert.deepEqual(r.effects, [{ type: 'ABANDON_ALARM_CLEAR' }]);
});

test('exam tab navigation emits EXAM_NAV only when the url changes', () => {
  let r = reduce(arm().session, nav(41, 'https://e.x/q/1', T0 + 1000), cfg);
  assert.deepEqual(names(r), ['EXAM_NAV']);
  r = reduce(r.session, nav(41, 'https://e.x/q/1', T0 + 2000), cfg);
  assert.deepEqual(names(r), []);
});

test('result on the exam tab disarms with END effect carrying the session snapshot', () => {
  const armed = arm().session;
  const r = reduce(armed, nav(41, 'https://e.x/result/9', T0 + 5000), cfg);
  assert.equal(r.session.state, 'IDLE');
  assert.deepEqual(names(r), ['SESSION_DISARMED']);
  assert.deepEqual(r.events[0].data, { outcome: 'RESULT', url: 'https://e.x/result/9' });
  assert.equal(r.effects[0].type, 'END');
  assert.equal(r.effects[0].session.id, armed.id);
});

test('result in another tab does not disarm; it is a parallel page', () => {
  const r = reduce(arm().session, nav(77, 'https://e.x/result/9', T0 + 5000), cfg);
  assert.equal(r.session.state, 'ARMED');
  assert.deepEqual(names(r), ['PARALLEL_PAGE']);
  assert.equal(r.events[0].data.trigger, 'committed');
});

test('exam tab removed -> EXAM_TAB_CLOSED and abandon alarm; re-adoption by URL clears it', () => {
  let r = reduce(arm().session, { kind: 'TAB_REMOVED', tabId: 41, at: T0 + 10 }, cfg);
  assert.deepEqual(names(r), ['EXAM_TAB_CLOSED']);
  assert.equal(r.session.tabLostAt, T0 + 10);
  assert.deepEqual(r.effects, [{ type: 'ABANDON_ALARM_SET', when: T0 + 10 + 600000 }]);
  r = reduce(r.session, nav(52, 'https://e.x/q/3', T0 + 20, 4), cfg);
  assert.deepEqual(names(r), ['EXAM_NAV']);
  assert.equal(r.events[0].data.adopted, true);
  assert.equal(r.session.examTabId, 52);
  assert.equal(r.session.tabLostAt, null);
  assert.deepEqual(r.effects, [{ type: 'ABANDON_ALARM_CLEAR' }]);
});

test('re-adoption on a result URL disarms in the same reduce', () => {
  let r = reduce(arm().session, { kind: 'TAB_REMOVED', tabId: 41, at: T0 + 10 }, cfg);
  r = reduce(r.session, nav(52, 'https://e.x/result/1', T0 + 20), cfg);
  assert.deepEqual(names(r), ['EXAM_NAV', 'SESSION_DISARMED']);
  assert.equal(r.session.state, 'IDLE');
});

test('ABANDON_TIMER ends the session only while the tab is lost', () => {
  assert.deepEqual(reduce(arm().session, { kind: 'ABANDON_TIMER', at: T0 }, cfg).events, []);
  let r = reduce(arm().session, { kind: 'TAB_REMOVED', tabId: 41, at: T0 }, cfg);
  r = reduce(r.session, { kind: 'ABANDON_TIMER', at: T0 + 600000 }, cfg);
  assert.deepEqual(r.events[0].data, { outcome: 'ABANDONED' });
  assert.equal(r.effects[0].type, 'END');
  assert.equal(r.session.state, 'IDLE');
});

test('STARTUP re-adopts by URL or starts the abandon clock', () => {
  let r = reduce(arm().session, { kind: 'STARTUP', at: T0, examTabs: [{ tabId: 9, windowId: 2, url: 'https://e.x/q/1' }] }, cfg);
  assert.equal(r.session.examTabId, 9);
  assert.deepEqual(r.effects, [{ type: 'ABANDON_ALARM_CLEAR' }]);
  r = reduce(arm().session, { kind: 'STARTUP', at: T0, examTabs: [] }, cfg);
  assert.equal(r.session.tabLostAt, T0);
  assert.deepEqual(r.effects, [{ type: 'ABANDON_ALARM_SET', when: T0 + 600000 }]);
});

test('GAP and PERIODIC emit their events', () => {
  assert.deepEqual(reduce(arm().session, { kind: 'GAP', at: T0 + 100000, lastSeenAt: T0, reason: 'sw-restart' }, cfg).events[0].data,
    { lastSeenAt: T0, gapMs: 100000, reason: 'sw-restart' });
  assert.deepEqual(names(reduce(arm().session, { kind: 'PERIODIC', at: T0 }, cfg)), ['PERIODIC']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/session-a.test.js`
Expected: FAIL — `Cannot find module .../src/core/session.js`.

- [ ] **Step 3: Write the implementation**

`src/core/session.js`:
```js
import { classify } from './urlmatch.js';
import { sessionId } from './ids.js';
import { makeEvent } from './events.js';

const freshAway = () => ({ tabAt: null, focusAt: null, minAt: null, idleAt: null });

export function initial() {
  return { state: 'IDLE' };
}

export function reduce(session, input, cfg) {
  const out = { session: structuredClone(session), events: [], effects: [] };
  const s = out.session;
  const emit = (name, data = {}, ids = input) => {
    s.seq += 1;
    out.events.push(makeEvent({ seq: s.seq, at: input.at, name, tabId: ids.tabId, windowId: ids.windowId, data }));
  };
  if (s.state === 'IDLE') {
    if (input.kind === 'NAV' && classify(input.url, cfg) === 'start') {
      Object.assign(s, {
        state: 'ARMED', id: sessionId(input.at, cfg.seat), seat: cfg.seat, startedAt: input.at,
        examTabId: input.tabId, examWindowId: input.windowId, examUrl: input.url, seq: 0,
        lastActivityAt: input.at, tabLostAt: null, windowState: 'normal', away: freshAway(),
      });
      emit('SESSION_ARMED', { url: input.url });
      out.effects.push({ type: 'ABANDON_ALARM_CLEAR' });
    }
    return out;
  }
  s.lastActivityAt = input.at;
  HANDLERS[input.kind]?.(s, input, cfg, emit, out);
  return out;
}

function disarm(s, out, emit, outcome, data = {}) {
  emit('SESSION_DISARMED', { outcome, ...data });
  out.effects.push({ type: 'END', outcome, session: { ...s } });
  out.session = initial();
}

function examTabNav(s, input, cfg, emit, out) {
  if (classify(input.url, cfg) === 'result') return disarm(s, out, emit, 'RESULT', { url: input.url });
  if (input.url !== s.examUrl) { s.examUrl = input.url; emit('EXAM_NAV', { url: input.url }); }
}

const HANDLERS = {
  NAV(s, input, cfg, emit, out) {
    if (input.tabId === s.examTabId) return examTabNav(s, input, cfg, emit, out);
    if (s.tabLostAt !== null && classify(input.url, cfg)) {
      Object.assign(s, { examTabId: input.tabId, examWindowId: input.windowId, examUrl: input.url, tabLostAt: null });
      emit('EXAM_NAV', { url: input.url, adopted: true });
      out.effects.push({ type: 'ABANDON_ALARM_CLEAR' });
      return examTabNav(s, input, cfg, emit, out);
    }
    emit('PARALLEL_PAGE', { url: input.url, trigger: 'committed', incognito: Boolean(input.incognito) });
  },
  TAB_REMOVED(s, input, cfg, emit, out) {
    if (input.tabId !== s.examTabId || s.tabLostAt !== null) return;
    s.tabLostAt = input.at;
    emit('EXAM_TAB_CLOSED');
    out.effects.push({ type: 'ABANDON_ALARM_SET', when: input.at + cfg.abandonMin * 60000 });
  },
  STARTUP(s, input, cfg, emit, out) {
    const t = input.examTabs[0];
    if (t) {
      Object.assign(s, { examTabId: t.tabId, examWindowId: t.windowId, examUrl: t.url, tabLostAt: null, away: freshAway() });
      out.effects.push({ type: 'ABANDON_ALARM_CLEAR' });
      return;
    }
    s.tabLostAt ??= input.at;
    out.effects.push({ type: 'ABANDON_ALARM_SET', when: s.tabLostAt + cfg.abandonMin * 60000 });
  },
  GAP(s, input, cfg, emit) {
    emit('EXTENSION_GAP', { lastSeenAt: input.lastSeenAt, gapMs: input.at - input.lastSeenAt, reason: input.reason });
  },
  ABANDON_TIMER(s, input, cfg, emit, out) {
    if (s.tabLostAt !== null) disarm(s, out, emit, 'ABANDONED');
  },
  PERIODIC(s, input, cfg, emit) {
    emit('PERIODIC');
  },
};

export { HANDLERS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/session-a.test.js`
Expected: `# pass 10`, `# fail 0`.

- [ ] **Step 5: Commit (do not run unless authorised)**

```bash
git add src/core/session.js tests/unit/session-a.test.js
git commit -m "feat(core): session reducer - arm, nav, result, tab loss, abandon, startup"
```

---

### Task 9: Session reducer, part B — tab switch/return, focus, window state, windows, content-script events, idle, download, tick

**Files:**
- Modify: `src/core/session.js` (add handlers to `HANDLERS`, add `windowState` helper)
- Test: `tests/unit/session-b.test.js`

**Interfaces:**
- Consumes: Task 8 `HANDLERS`, `emit(name, data, ids)`.
- Produces: handlers `TAB_ACTIVATED`, `FOCUS`, `WINDOW_STATE`, `WINDOW_CREATED`, `WINDOW_REMOVED`, `CS`, `IDLE`, `DOWNLOAD`, `TICK` per spec §4. `TICK` input shape: `{kind:'TICK', at, windows:[{id,state}], examTabPresent}`.

- [ ] **Step 1: Write the failing test**

`tests/unit/session-b.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initial, reduce } from '../../src/core/session.js';

const cfg = { startPrefix: 'https://e.x/start', examPrefix: 'https://e.x/', resultPrefix: 'https://e.x/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10 };
const T0 = 1789530302117;
const armed = () => reduce(initial(), { kind: 'NAV', tabId: 41, windowId: 3, url: 'https://e.x/start', at: T0 }, cfg).session;
const names = (r) => r.events.map(e => e.name);
const act = (tabId, at, extra = {}) => ({ kind: 'TAB_ACTIVATED', tabId, windowId: 3, url: 'https://g.x/', title: 'G', incognito: false, at, ...extra });

test('tab switch away, another parallel activation, then return with awayMs', () => {
  let r = reduce(armed(), act(42, T0 + 1000), cfg);
  assert.deepEqual(names(r), ['TAB_SWITCH', 'PARALLEL_PAGE']);
  assert.deepEqual(r.events[0].data, { toTabId: 42, toUrl: 'https://g.x/', toTitle: 'G', toWindowId: 3, incognito: false });
  assert.deepEqual(r.events[1].data, { url: 'https://g.x/', title: 'G', incognito: false, trigger: 'activated' });
  r = reduce(r.session, act(43, T0 + 2000), cfg);
  assert.deepEqual(names(r), ['PARALLEL_PAGE']);
  r = reduce(r.session, act(41, T0 + 4000), cfg);
  assert.deepEqual(names(r), ['TAB_RETURN']);
  assert.equal(r.events[0].data.awayMs, 3000);
  assert.equal(r.session.away.tabAt, null);
});

test('focus left/returned pair with duration, no duplicates', () => {
  let r = reduce(armed(), { kind: 'FOCUS', windowId: -1, at: T0 }, cfg);
  assert.deepEqual(names(r), ['FOCUS_LEFT_CHROME']);
  r = reduce(r.session, { kind: 'FOCUS', windowId: -1, at: T0 + 10 }, cfg);
  assert.deepEqual(names(r), []);
  r = reduce(r.session, { kind: 'FOCUS', windowId: 3, at: T0 + 2500 }, cfg);
  assert.deepEqual(r.events[0].data, { awayMs: 2500 });
});

test('window minimized/restored and fullscreen exit, exam window only', () => {
  let r = reduce(armed(), { kind: 'WINDOW_STATE', windowId: 9, state: 'minimized', at: T0 }, cfg);
  assert.deepEqual(names(r), []);
  r = reduce(r.session, { kind: 'WINDOW_STATE', windowId: 3, state: 'minimized', at: T0 }, cfg);
  assert.deepEqual(names(r), ['WINDOW_MINIMIZED']);
  r = reduce(r.session, { kind: 'WINDOW_STATE', windowId: 3, state: 'fullscreen', at: T0 + 7000 }, cfg);
  assert.deepEqual(r.events.map(e => [e.name, e.data]), [['WINDOW_RESTORED', { minimizedMs: 7000 }]]);
  r = reduce(r.session, { kind: 'WINDOW_STATE', windowId: 3, state: 'normal', at: T0 + 8000 }, cfg);
  assert.deepEqual(r.events.map(e => [e.name, e.data]), [['FULLSCREEN_EXIT', { source: 'window' }]]);
});

test('windows opened/closed, incognito flagged', () => {
  assert.deepEqual(names(reduce(armed(), { kind: 'WINDOW_CREATED', windowId: 5, incognito: true, at: T0 }, cfg)), ['INCOGNITO_WINDOW_OPENED']);
  assert.deepEqual(names(reduce(armed(), { kind: 'WINDOW_CREATED', windowId: 5, incognito: false, at: T0 }, cfg)), ['WINDOW_OPENED']);
  assert.deepEqual(names(reduce(armed(), { kind: 'WINDOW_REMOVED', windowId: 5, at: T0 }, cfg)), ['WINDOW_CLOSED']);
});

test('content-script events only from the exam tab; probes become effects', () => {
  const cs = (name, tabId = 41, data = {}) => ({ kind: 'CS', name, tabId, windowId: 3, data, at: T0 });
  assert.deepEqual(names(reduce(armed(), cs('COPY', 77), cfg)), []);
  let r = reduce(armed(), cs('PASTE', 41, { len: 12 }), cfg);
  assert.deepEqual(r.events.map(e => [e.name, e.data]), [['PASTE', { len: 12 }]]);
  assert.deepEqual(reduce(armed(), cs('FULLSCREEN_EXIT'), cfg).events[0].data, { source: 'document' });
  assert.deepEqual(reduce(armed(), cs('DEVTOOLS', 41, { dw: 300, dh: 0 }), cfg).events.map(e => e.name), ['DEVTOOLS_OPENED']);
  r = reduce(armed(), cs('VISIBILITY', 41, { hidden: true }), cfg);
  assert.deepEqual(r.events, []);
  assert.deepEqual(r.effects, [{ type: 'PROBE' }]);
});

test('idle start/end and download', () => {
  let r = reduce(armed(), { kind: 'IDLE', state: 'locked', at: T0 }, cfg);
  assert.deepEqual(r.events[0].data, { state: 'locked' });
  r = reduce(r.session, { kind: 'IDLE', state: 'active', at: T0 + 60000 }, cfg);
  assert.deepEqual(r.events.map(e => [e.name, e.data]), [['IDLE_END', { idleMs: 60000 }]]);
  r = reduce(armed(), { kind: 'DOWNLOAD', url: 'https://f.x/a.pdf', filename: 'a.pdf', mime: 'application/pdf', at: T0 }, cfg);
  assert.deepEqual(r.events.map(e => [e.name, e.data]), [['DOWNLOAD_STARTED', { url: 'https://f.x/a.pdf', filename: 'a.pdf', mime: 'application/pdf' }]]);
});

test('TICK reconciles window state and missing exam tab', () => {
  let r = reduce(armed(), { kind: 'TICK', at: T0, windows: [{ id: 3, state: 'minimized' }], examTabPresent: true }, cfg);
  assert.deepEqual(names(r), ['WINDOW_MINIMIZED']);
  r = reduce(r.session, { kind: 'TICK', at: T0 + 30000, windows: [{ id: 3, state: 'normal' }], examTabPresent: false }, cfg);
  assert.deepEqual(names(r), ['WINDOW_RESTORED', 'EXAM_TAB_CLOSED']);
  assert.equal(r.effects[0].type, 'ABANDON_ALARM_SET');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/session-b.test.js`
Expected: FAIL — assertions on empty event lists (handlers missing), e.g. `['TAB_SWITCH','PARALLEL_PAGE']` vs `[]`.

- [ ] **Step 3: Add the handlers**

Append to `src/core/session.js`, before `export { HANDLERS };`:
```js
function windowState(s, windowId, state, at, emit) {
  if (windowId !== s.examWindowId) return;
  const ids = { windowId };
  if (state === 'minimized' && s.away.minAt === null) { s.away.minAt = at; emit('WINDOW_MINIMIZED', {}, ids); }
  if (state !== 'minimized' && s.away.minAt !== null) { emit('WINDOW_RESTORED', { minimizedMs: at - s.away.minAt }, ids); s.away.minAt = null; }
  if (s.windowState === 'fullscreen' && state !== 'fullscreen') emit('FULLSCREEN_EXIT', { source: 'window' }, ids);
  s.windowState = state;
}

const CS_DIRECT = new Set(['COPY', 'CUT', 'PASTE', 'CONTEXTMENU', 'PRINT']);
const CS_PROBE = new Set(['VISIBILITY', 'BLUR', 'FOCUS']);

Object.assign(HANDLERS, {
  TAB_ACTIVATED(s, input, cfg, emit) {
    if (input.tabId === s.examTabId) {
      if (s.away.tabAt !== null) { emit('TAB_RETURN', { awayMs: input.at - s.away.tabAt }); s.away.tabAt = null; }
      return;
    }
    const incognito = Boolean(input.incognito);
    if (s.away.tabAt === null) {
      s.away.tabAt = input.at;
      emit('TAB_SWITCH', { toTabId: input.tabId, toUrl: input.url, toTitle: input.title, toWindowId: input.windowId, incognito });
    }
    emit('PARALLEL_PAGE', { url: input.url, title: input.title, incognito, trigger: 'activated' });
  },
  FOCUS(s, input, cfg, emit) {
    if (input.windowId === -1) {
      if (s.away.focusAt === null) { s.away.focusAt = input.at; emit('FOCUS_LEFT_CHROME'); }
    } else if (s.away.focusAt !== null) {
      emit('FOCUS_RETURNED', { awayMs: input.at - s.away.focusAt }); s.away.focusAt = null;
    }
  },
  WINDOW_STATE(s, input, cfg, emit) { windowState(s, input.windowId, input.state, input.at, emit); },
  WINDOW_CREATED(s, input, cfg, emit) { emit(input.incognito ? 'INCOGNITO_WINDOW_OPENED' : 'WINDOW_OPENED', { windowId: input.windowId }); },
  WINDOW_REMOVED(s, input, cfg, emit) { emit('WINDOW_CLOSED', { windowId: input.windowId }); },
  CS(s, input, cfg, emit, out) {
    if (input.tabId !== s.examTabId) return;
    const data = input.data || {};
    if (CS_DIRECT.has(input.name)) emit(input.name, data);
    else if (input.name === 'FULLSCREEN_EXIT') emit('FULLSCREEN_EXIT', { source: 'document' });
    else if (input.name === 'DEVTOOLS') emit('DEVTOOLS_OPENED', data);
    else if (CS_PROBE.has(input.name)) out.effects.push({ type: 'PROBE' });
  },
  IDLE(s, input, cfg, emit) {
    if (input.state !== 'active') {
      if (s.away.idleAt === null) { s.away.idleAt = input.at; emit('IDLE_START', { state: input.state }); }
    } else if (s.away.idleAt !== null) {
      emit('IDLE_END', { idleMs: input.at - s.away.idleAt }); s.away.idleAt = null;
    }
  },
  DOWNLOAD(s, input, cfg, emit) { emit('DOWNLOAD_STARTED', { url: input.url, filename: input.filename, mime: input.mime }); },
  TICK(s, input, cfg, emit, out) {
    const w = input.windows.find(w => w.id === s.examWindowId);
    if (w) windowState(s, w.id, w.state, input.at, emit);
    if (!input.examTabPresent) HANDLERS.TAB_REMOVED(s, { ...input, tabId: s.examTabId }, cfg, emit, out);
  },
});
```

- [ ] **Step 4: Run all reducer tests to verify they pass**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/session-a.test.js tests/unit/session-b.test.js`
Expected: `# pass 17`, `# fail 0`.

- [ ] **Step 5: Commit (do not run unless authorised)**

```bash
git add src/core/session.js tests/unit/session-b.test.js
git commit -m "feat(core): session reducer - focus, windows, tab switches, page events, idle, tick"
```

---

### Task 10: Pending-write map and data: URL encoding (`src/core/sink.js`)

**Files:**
- Create: `src/core/sink.js`
- Test: `tests/unit/sink.test.js`

**Interfaces:**
- Produces: `toBase64(text: string): string` (UTF-8, chunked `btoa`); `dataUrl(mime, b64): string`; `putText(pending, path, mime, text): pending'`; `putBase64(pending, path, mime, b64): pending'`; `remove(pending, path): pending'`. `pending` is a plain object `{ [path]: { mime, b64 } }`; all functions return new objects.

- [ ] **Step 1: Write the failing test**

`tests/unit/sink.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toBase64, dataUrl, putText, putBase64, remove } from '../../src/core/sink.js';

test('toBase64 encodes UTF-8 like Buffer does, including large bodies', () => {
  assert.equal(toBase64('héllo ✓'), Buffer.from('héllo ✓').toString('base64'));
  const big = 'x'.repeat(200000);
  assert.equal(toBase64(big), Buffer.from(big).toString('base64'));
});

test('dataUrl', () => {
  assert.equal(dataUrl('text/plain', 'aGk='), 'data:text/plain;base64,aGk=');
});

test('put/remove are immutable and later puts overwrite', () => {
  const p0 = {};
  const p1 = putText(p0, 'S/log.txt', 'text/plain', 'a');
  const p2 = putText(p1, 'S/log.txt', 'text/plain', 'ab');
  const p3 = putBase64(p2, 'S/screenshots/x.jpg', 'image/jpeg', '/9j/');
  assert.deepEqual(p0, {});
  assert.equal(p1['S/log.txt'].b64, 'YQ==');
  assert.equal(p2['S/log.txt'].b64, 'YWI=');
  assert.deepEqual(Object.keys(p3), ['S/log.txt', 'S/screenshots/x.jpg']);
  assert.deepEqual(Object.keys(remove(p3, 'S/log.txt')), ['S/screenshots/x.jpg']);
  assert.deepEqual(Object.keys(p3).length, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/sink.test.js`
Expected: FAIL — `Cannot find module .../src/core/sink.js`.

- [ ] **Step 3: Write the implementation**

`src/core/sink.js`:
```js
export function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function dataUrl(mime, b64) {
  return `data:${mime};base64,${b64}`;
}

export function putText(pending, path, mime, text) {
  return { ...pending, [path]: { mime, b64: toBase64(text) } };
}

export function putBase64(pending, path, mime, b64) {
  return { ...pending, [path]: { mime, b64 } };
}

export function remove(pending, path) {
  const next = { ...pending };
  delete next[path];
  return next;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/sink.test.js`
Expected: `# pass 3`, `# fail 0`.

- [ ] **Step 5: Commit (do not run unless authorised)**

```bash
git add src/core/sink.js tests/unit/sink.test.js
git commit -m "feat(core): pending-write map and data URL encoding"
```

---

### Task 11: Counters (`src/core/counters.js`)

**Files:**
- Create: `src/core/counters.js`
- Test: `tests/unit/counters.test.js`

**Interfaces:**
- Produces: `tally(events): { counts: {[name]: n}, durations: {tabAwayMs, focusLeftMs, minimizedMs, idleMs}, parallel: Array<{url, title, incognito, visits, focusedMs}> }` sorted by `focusedMs` desc. Focused time of a parallel page runs from its `activated` PARALLEL_PAGE until the next TAB_RETURN, FOCUS_LEFT_CHROME, WINDOW_MINIMIZED, SESSION_DISARMED, any `activated` PARALLEL_PAGE, or a `committed` PARALLEL_PAGE on the same tab (which starts attribution to the new URL). Used by the popup (Task 17) and summaries (Tasks 20–21). **See Addendum A (end of plan): screensaver/idle attribution is part of this task.**

- [ ] **Step 1: Write the failing test**

`tests/unit/counters.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tally } from '../../src/core/counters.js';

const ev = (seq, t, name, data = {}, tabId) => ({ seq, t, ts: new Date(t).toISOString(), name, data, shot: null, ...(tabId !== undefined ? { tabId } : {}) });

test('counts, durations and parallel focused time', () => {
  const events = [
    ev(1, 0, 'SESSION_ARMED', { url: 's' }, 1),
    ev(2, 1000, 'TAB_SWITCH', { toTabId: 2 }, 2),
    ev(3, 1000, 'PARALLEL_PAGE', { url: 'https://a/', title: 'A', trigger: 'activated', incognito: false }, 2),
    ev(4, 3000, 'PARALLEL_PAGE', { url: 'https://b/', trigger: 'committed', incognito: false }, 2),
    ev(5, 6000, 'PARALLEL_PAGE', { url: 'https://c/', trigger: 'committed', incognito: false }, 9),
    ev(6, 7000, 'TAB_RETURN', { awayMs: 6000 }, 1),
    ev(7, 8000, 'FOCUS_LEFT_CHROME', {}),
    ev(8, 9500, 'FOCUS_RETURNED', { awayMs: 1500 }),
    ev(9, 10000, 'WINDOW_MINIMIZED', {}),
    ev(10, 12000, 'WINDOW_RESTORED', { minimizedMs: 2000 }),
    ev(11, 13000, 'IDLE_START', { state: 'idle' }),
    ev(12, 14000, 'IDLE_END', { idleMs: 1000 }),
    ev(13, 15000, 'PARALLEL_PAGE', { url: 'https://a/', title: 'A2', trigger: 'activated', incognito: false }, 2),
    ev(14, 16000, 'SESSION_DISARMED', { outcome: 'RESULT' }, 1),
  ];
  const t = tally(events);
  assert.equal(t.counts.PARALLEL_PAGE, 4);
  assert.equal(t.counts.TAB_SWITCH, 1);
  assert.deepEqual(t.durations, { tabAwayMs: 6000, focusLeftMs: 1500, minimizedMs: 2000, idleMs: 1000 });
  assert.deepEqual(t.parallel, [
    { url: 'https://b/', title: '', incognito: false, visits: 1, focusedMs: 4000 },
    { url: 'https://a/', title: 'A2', incognito: false, visits: 2, focusedMs: 3000 },
    { url: 'https://c/', title: '', incognito: false, visits: 1, focusedMs: 0 },
  ]);
});

test('empty input', () => {
  assert.deepEqual(tally([]), { counts: {}, durations: { tabAwayMs: 0, focusLeftMs: 0, minimizedMs: 0, idleMs: 0 }, parallel: [] });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/counters.test.js`
Expected: FAIL — `Cannot find module .../src/core/counters.js`.

- [ ] **Step 3: Write the implementation**

`src/core/counters.js`:
```js
const CLOSERS = new Set(['TAB_RETURN', 'FOCUS_LEFT_CHROME', 'WINDOW_MINIMIZED', 'SESSION_DISARMED']);
const DURATION = { TAB_RETURN: ['tabAwayMs', 'awayMs'], FOCUS_RETURNED: ['focusLeftMs', 'awayMs'], WINDOW_RESTORED: ['minimizedMs', 'minimizedMs'], IDLE_END: ['idleMs', 'idleMs'] };

export function tally(events) {
  const counts = {};
  const durations = { tabAwayMs: 0, focusLeftMs: 0, minimizedMs: 0, idleMs: 0 };
  const parallel = new Map();
  let open = null;
  for (const ev of events) {
    counts[ev.name] = (counts[ev.name] || 0) + 1;
    if (DURATION[ev.name]) { const [k, f] = DURATION[ev.name]; durations[k] += ev.data[f] || 0; }
    const isParallel = ev.name === 'PARALLEL_PAGE';
    const closes = isParallel ? (ev.data.trigger === 'activated' || (open !== null && ev.tabId === open.tabId)) : CLOSERS.has(ev.name);
    if (closes && open !== null) { open.entry.focusedMs += ev.t - open.at; open = null; }
    if (!isParallel) continue;
    const entry = parallel.get(ev.data.url) || { url: ev.data.url, title: '', incognito: Boolean(ev.data.incognito), visits: 0, focusedMs: 0 };
    entry.visits += 1;
    if (ev.data.title) entry.title = ev.data.title;
    parallel.set(ev.data.url, entry);
    if (closes) open = { entry, at: ev.t, tabId: ev.tabId };
  }
  return { counts, durations, parallel: [...parallel.values()].sort((a, b) => b.focusedMs - a.focusedMs) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/counters.test.js`
Expected: `# pass 2`, `# fail 0`.

- [ ] **Step 5: Commit (do not run unless authorised)**

```bash
git add src/core/counters.js tests/unit/counters.test.js
git commit -m "feat(core): event tally with away durations and parallel-page focus time"
```

---

### Task 12: Fake chrome and adapters

**Files:**
- Create: `tests/unit/fake-chrome.js`
- Create: `src/adapters/storage.js`, `src/adapters/alarms.js`, `src/adapters/capture.js`, `src/adapters/downloads.js`, `src/adapters/scripting.js`, `src/adapters/tabs.js`, `src/adapters/windows.js`
- Test: `tests/unit/adapters.test.js`

**Interfaces:**
- Consumes: `prefixToMatchPattern` (Task 2).
- Produces: `installFakeChrome(): chrome` (test only; must be called before importing any adapter or `sw.js`). Adapters:
  - `storage.js`: `get(keys)`, `set(obj)`, `remove(keys)`, `patchMeta(patch)` (read-merge-write of the `meta` key).
  - `alarms.js`: `setPeriodic(name, periodInMinutes)`, `setAt(name, when)`, `clear(name)`.
  - `capture.js`: `captureJpeg(windowId): Promise<string>` (base64 body only).
  - `downloads.js`: `suppressUi()`, `writeFile(filename, url): Promise<number>`, `eraseOwnCompleted()` (registers the `onChanged` listener).
  - `scripting.js`: `registerExamScript(resolvedCfg)`.
  - `tabs.js`: `getTab(id): Promise<tab|null>`, `queryAllTabs(): Promise<tab[]>`.
  - `windows.js`: `getWindow(id): Promise<window|null>`, `getAllWindows()`, `focusedWindowId(): Promise<number>` (−1 when no window is focused).

- [ ] **Step 1: Write the fake chrome**

`tests/unit/fake-chrome.js`:
```js
function evt() {
  const ls = [];
  return { addListener: (f) => ls.push(f), emit: async (...a) => { for (const f of ls) await f(...a); } };
}

export function installFakeChrome() {
  const store = {};
  const c = {
    runtime: { id: 'fake-ext-id', onStartup: evt(), onInstalled: evt(), onMessage: evt() },
    storage: {
      local: {
        async get(keys) {
          const ks = keys == null ? Object.keys(store) : [].concat(keys);
          const o = {};
          for (const k of ks) if (k in store) o[k] = structuredClone(store[k]);
          return o;
        },
        async set(obj) {
          const changes = {};
          for (const [k, v] of Object.entries(obj)) { changes[k] = { oldValue: store[k], newValue: structuredClone(v) }; store[k] = structuredClone(v); }
          await c.storage.onChanged.emit(changes, 'local');
        },
        async remove(keys) { for (const k of [].concat(keys)) delete store[k]; },
      },
      onChanged: evt(),
    },
    alarms: { alarms: {}, async create(name, info) { c.alarms.alarms[name] = info; }, async clear(name) { delete c.alarms.alarms[name]; return true; }, onAlarm: evt() },
    tabs: {
      list: [],
      async query() { return c.tabs.list; },
      async get(id) { const t = c.tabs.list.find(t => t.id === id); if (!t) throw new Error('No tab with id: ' + id); return t; },
      captureVisibleTab: async () => 'data:image/jpeg;base64,/9j/FAKE',
      onActivated: evt(), onRemoved: evt(), onUpdated: evt(),
    },
    windows: {
      WINDOW_ID_NONE: -1, list: [],
      async get(id) { const w = c.windows.list.find(w => w.id === id); if (!w) throw new Error('No window with id: ' + id); return w; },
      async getAll() { return c.windows.list; },
      async getLastFocused() { return c.windows.list.find(w => w.focused) || c.windows.list[0] || { id: -1, focused: false }; },
      onFocusChanged: evt(), onCreated: evt(), onRemoved: evt(),
    },
    webNavigation: { onCommitted: evt() },
    idle: { async setDetectionInterval() {}, onStateChanged: evt() },
    downloads: {
      calls: [], items: [], erased: [], nextId: 1, failWhen: null, uiOptions: null,
      async download(opts) {
        if (c.downloads.failWhen?.(opts)) throw new Error('Download rejected by fake');
        c.downloads.calls.push(opts);
        return c.downloads.nextId++;
      },
      async search(q) { return c.downloads.items.filter(i => q.id === undefined || i.id === q.id); },
      async erase(q) { c.downloads.erased.push(q.id); return [q.id]; },
      async setUiOptions(o) { c.downloads.uiOptions = o; },
      onCreated: evt(), onChanged: evt(),
    },
    scripting: {
      registered: [],
      async registerContentScripts(list) { c.scripting.registered.push(...list); },
      async unregisterContentScripts() { if (!c.scripting.registered.length) throw new Error('Nonexistent script ID'); c.scripting.registered = []; },
    },
  };
  globalThis.chrome = c;
  return c;
}
```

- [ ] **Step 2: Write the failing adapter test**

`tests/unit/adapters.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome } from './fake-chrome.js';

const chrome = installFakeChrome();
const storage = await import('../../src/adapters/storage.js');
const alarms = await import('../../src/adapters/alarms.js');
const { captureJpeg } = await import('../../src/adapters/capture.js');
const dl = await import('../../src/adapters/downloads.js');
const { registerExamScript } = await import('../../src/adapters/scripting.js');
const tabs = await import('../../src/adapters/tabs.js');
const windows = await import('../../src/adapters/windows.js');

test('storage.patchMeta merges', async () => {
  await storage.set({ meta: { a: 1 } });
  await storage.patchMeta({ b: 2 });
  assert.deepEqual((await storage.get('meta')).meta, { a: 1, b: 2 });
});

test('alarms', async () => {
  await alarms.setPeriodic('tick', 0.5);
  await alarms.setAt('abandon', 123);
  assert.deepEqual(chrome.alarms.alarms, { tick: { periodInMinutes: 0.5 }, abandon: { when: 123 } });
  await alarms.clear('abandon');
  assert.deepEqual(Object.keys(chrome.alarms.alarms), ['tick']);
});

test('captureJpeg strips the data: prefix', async () => {
  assert.equal(await captureJpeg(3), '/9j/FAKE');
});

test('downloads: writeFile options, suppressUi, erase own completed items only', async () => {
  const id = await dl.writeFile('ExamEye/S/log.txt', 'data:text/plain;base64,YQ==');
  assert.deepEqual(chrome.downloads.calls[0], { url: 'data:text/plain;base64,YQ==', filename: 'ExamEye/S/log.txt', conflictAction: 'overwrite', saveAs: false });
  await dl.suppressUi();
  assert.deepEqual(chrome.downloads.uiOptions, { enabled: false });
  dl.eraseOwnCompleted();
  chrome.downloads.items = [{ id, byExtensionId: 'fake-ext-id' }, { id: 99, byExtensionId: 'other' }];
  await chrome.downloads.onChanged.emit({ id, state: { current: 'complete' } });
  await chrome.downloads.onChanged.emit({ id: 99, state: { current: 'complete' } });
  await chrome.downloads.onChanged.emit({ id, state: { current: 'in_progress' } });
  assert.deepEqual(chrome.downloads.erased, [id]);
});

test('registerExamScript registers deduplicated match patterns', async () => {
  const cfg = { startPrefix: 'https://e.x/start?x=1', examPrefix: 'https://e.x/' };
  await registerExamScript(cfg);
  await registerExamScript({ startPrefix: 'https://e.x/', examPrefix: 'https://e.x/' });
  assert.equal(chrome.scripting.registered.length, 1);
  assert.deepEqual(chrome.scripting.registered[0], { id: 'exam', js: ['src/content.js'], matches: ['https://e.x/*'], runAt: 'document_start', allFrames: false, persistAcrossSessions: true });
});

test('tabs and windows return null instead of throwing', async () => {
  chrome.tabs.list = [{ id: 1, windowId: 3, url: 'u' }];
  chrome.windows.list = [{ id: 3, focused: false, state: 'normal' }];
  assert.equal((await tabs.getTab(1)).id, 1);
  assert.equal(await tabs.getTab(2), null);
  assert.equal((await tabs.queryAllTabs()).length, 1);
  assert.equal((await windows.getWindow(3)).state, 'normal');
  assert.equal(await windows.getWindow(4), null);
  assert.equal(await windows.focusedWindowId(), -1);
  assert.equal(await windows.lastFocusedWindowId(), 3);
  chrome.windows.list[0].focused = true;
  assert.equal(await windows.focusedWindowId(), 3);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/adapters.test.js`
Expected: FAIL — `Cannot find module .../src/adapters/storage.js`.

- [ ] **Step 4: Write the adapters**

`src/adapters/storage.js`:
```js
export const get = (keys) => chrome.storage.local.get(keys);
export const set = (obj) => chrome.storage.local.set(obj);
export const remove = (keys) => chrome.storage.local.remove(keys);

export async function patchMeta(patch) {
  const { meta = {} } = await get('meta');
  await set({ meta: { ...meta, ...patch } });
}
```

`src/adapters/alarms.js`:
```js
export const setPeriodic = (name, periodInMinutes) => chrome.alarms.create(name, { periodInMinutes });
export const setAt = (name, when) => chrome.alarms.create(name, { when });
export const clear = (name) => chrome.alarms.clear(name);
```

`src/adapters/capture.js`:
```js
export async function captureJpeg(windowId) {
  const url = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 50 });
  return url.slice(url.indexOf(',') + 1);
}
```

`src/adapters/downloads.js`:
```js
export async function suppressUi() {
  try { await chrome.downloads.setUiOptions({ enabled: false }); } catch { /* browser without downloads.ui support (some Edge builds): flyout stays visible, nothing else breaks */ }
}

export function writeFile(filename, url) {
  return chrome.downloads.download({ url, filename, conflictAction: 'overwrite', saveAs: false });
}

export function eraseOwnCompleted() {
  chrome.downloads.onChanged.addListener(async (delta) => {
    if (delta.state?.current !== 'complete') return;
    const [item] = await chrome.downloads.search({ id: delta.id });
    if (item?.byExtensionId === chrome.runtime.id) await chrome.downloads.erase({ id: delta.id });
  });
}
```

`src/adapters/scripting.js`:
```js
import { prefixToMatchPattern } from '../core/urlmatch.js';

export async function registerExamScript(cfg) {
  const matches = [...new Set([prefixToMatchPattern(cfg.startPrefix), prefixToMatchPattern(cfg.examPrefix)])];
  await chrome.scripting.unregisterContentScripts({ ids: ['exam'] }).catch(() => { /* first registration: nothing to remove */ });
  await chrome.scripting.registerContentScripts([{ id: 'exam', js: ['src/content.js'], matches, runAt: 'document_start', allFrames: false, persistAcrossSessions: true }]);
}
```

`src/adapters/tabs.js`:
```js
export const getTab = (id) => chrome.tabs.get(id).catch(() => null);
export const queryAllTabs = () => chrome.tabs.query({});
```

`src/adapters/windows.js`:
```js
export const getWindow = (id) => chrome.windows.get(id).catch(() => null);
export const getAllWindows = () => chrome.windows.getAll({});

export async function focusedWindowId() {
  const w = await chrome.windows.getLastFocused().catch(() => null);
  return w && w.focused ? w.id : -1;
}

export async function lastFocusedWindowId() {
  const w = await chrome.windows.getLastFocused().catch(() => null);
  return w ? w.id : -1;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/adapters.test.js`
Expected: `# pass 6`, `# fail 0`.

- [ ] **Step 6: Commit (do not run unless authorised)**

```bash
git add tests/unit/fake-chrome.js tests/unit/adapters.test.js src/adapters/
git commit -m "feat(adapters): thin chrome.* wrappers with in-memory fake for tests"
```

---

### Task 13: Service worker, part 1 — config, dispatch, persistence of events and chained lines, alarm effects

**Files:**
- Create: `src/sw.js`
- Test: `tests/unit/sw-dispatch.test.js`

**Interfaces:**
- Consumes: adapters (Task 12), `normalize/validate/resolved` (Task 3), `initial/reduce` (Task 8–9), `headerLine/formatLine/chainLine` (Task 6), `GENESIS/shortHash` (Task 5).
- Produces (exported from `src/sw.js`, used by later tasks and tests): `applyConfig()`, `dispatch(input): Promise<void>` (serialised through one promise queue; never call `dispatch` from inside code that runs within the queue — use `setTimeout(fn, 0)`), `probe()`, `settled(): Promise` (resolves when the queue drains). Storage keys written: `session`, `events`, `lines`, `lastHash`, `shots`, `meta.configErrors`, `meta.lastSeenAt`.

- [ ] **Step 1: Write the failing test**

`tests/unit/sw-dispatch.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome } from './fake-chrome.js';
import { verify } from '../../src/core/hashchain.js';

const chrome = installFakeChrome();
const config = { startPrefix: 'https://e.x/start', examPrefix: '', resultPrefix: 'https://e.x/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10 };
const sw = await import('../../src/sw.js');
const get = (k) => chrome.storage.local.get(k);

test('invalid config: applyConfig records errors and dispatch is a no-op', async () => {
  await chrome.storage.local.set({ config: { ...config, seat: '' } });
  await sw.applyConfig();
  assert.equal((await get('meta')).meta.configErrors[0].field, 'seat');
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/start', at: 1000 });
  assert.equal((await get('session')).session, undefined);
});

test('valid config registers the content script and the periodic alarm', async () => {
  await chrome.storage.local.set({ config });
  await sw.applyConfig();
  assert.deepEqual((await get('meta')).meta.configErrors, []);
  assert.deepEqual(chrome.scripting.registered[0].matches, ['https://e.x/start*', 'https://e.x/*']);
  assert.deepEqual(chrome.alarms.alarms.periodic, { periodInMinutes: 10 });
});

test('dispatch arms, writes header + chained lines, events carry hashes', async () => {
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/start?c=1', at: 1000 });
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/q/1', at: 2000 });
  const { session, events, lines, lastHash, meta } = await get(null);
  assert.equal(session.state, 'ARMED');
  assert.equal(events.length, 2);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^# ExamEye session /);
  assert.equal((await verify(lines)).ok, true);
  assert.equal(events[1].hash, lastHash);
  assert.equal(meta.lastSeenAt, 2000);
});

test('a gap longer than 90 s is recorded before the next input', async () => {
  await sw.dispatch({ kind: 'PERIODIC', at: 102000 });
  const { events } = await get('events');
  assert.deepEqual(events.slice(-2).map(e => e.name), ['EXTENSION_GAP', 'PERIODIC']);
  assert.equal(events.at(-2).data.gapMs, 100000);
  assert.equal(events.at(-2).data.reason, 'sw-restart');
});

test('abandon effects create and clear the alarm', async () => {
  await sw.dispatch({ kind: 'TAB_REMOVED', tabId: 1, at: 200000 });
  assert.deepEqual(chrome.alarms.alarms.abandon, { when: 800000 });
  await sw.dispatch({ kind: 'NAV', tabId: 2, windowId: 3, url: 'https://e.x/q/2', at: 200500 });
  assert.equal(chrome.alarms.alarms.abandon, undefined);
});

test('probe dispatches FOCUS and WINDOW_STATE for the exam window', async () => {
  chrome.windows.list = [{ id: 3, focused: false, state: 'minimized' }];
  await sw.probe();
  const { events } = await get('events');
  assert.deepEqual(events.slice(-2).map(e => e.name), ['FOCUS_LEFT_CHROME', 'WINDOW_MINIMIZED']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/sw-dispatch.test.js`
Expected: FAIL — `Cannot find module .../src/sw.js`.

- [ ] **Step 3: Write the service worker**

`src/sw.js`:
```js
import * as store from './adapters/storage.js';
import * as alarms from './adapters/alarms.js';
import { registerExamScript } from './adapters/scripting.js';
import { getWindow, focusedWindowId } from './adapters/windows.js';
import { normalize, validate, resolved } from './core/config.js';
import { initial, reduce } from './core/session.js';
import { headerLine, formatLine, chainLine } from './core/logline.js';
import { GENESIS, shortHash } from './core/hashchain.js';

const GAP_MS = 90000;
const now = () => Date.now();

let queue = Promise.resolve();
const enqueue = (fn) => { queue = queue.catch(() => {}).then(fn); return queue; };
export const settled = () => queue;

async function loadConfig() {
  const { config } = await store.get('config');
  const cfg = normalize(config);
  return validate(cfg).length ? null : resolved(cfg);
}

export async function applyConfig() {
  const { config } = await store.get('config');
  const cfg = normalize(config);
  const errors = validate(cfg);
  await store.patchMeta({ configErrors: errors });
  if (errors.length) return;
  await registerExamScript(resolved(cfg));
  await alarms.setPeriodic('periodic', cfg.shotIntervalMin);
}

export function dispatch(input) {
  return enqueue(async () => {
    const cfg = await loadConfig();
    if (!cfg) return;
    const st = await store.get(['session', 'events', 'lines', 'lastHash', 'meta']);
    let session = st.session || initial();
    let { events = [], lines = [], lastHash = GENESIS } = st;
    const meta = st.meta || {};
    const newEvents = [];
    if (session.state === 'ARMED' && meta.lastSeenAt && input.at - meta.lastSeenAt > GAP_MS) {
      const g = reduce(session, { kind: 'GAP', at: input.at, lastSeenAt: meta.lastSeenAt, reason: input.kind === 'STARTUP' ? 'browser-restart' : 'sw-restart' }, cfg);
      session = g.session;
      newEvents.push(...g.events);
    }
    const r = reduce(session, input, cfg);
    newEvents.push(...r.events);
    if (r.session.state === 'ARMED' && session.state === 'IDLE') {
      const h = headerLine(r.session);
      events = []; lines = [h]; lastHash = await shortHash(h);
      await store.set({ shots: {} });
    }
    for (const ev of newEvents) {
      const line = chainLine(formatLine(ev), lastHash);
      ev.hash = lastHash = await shortHash(line);
      lines.push(line);
      events.push(ev);
    }
    await store.set({ session: r.session, events, lines, lastHash });
    await store.patchMeta({ lastSeenAt: input.at });
    await runEffects(r.effects, cfg);
  });
}

async function runEffects(effects, cfg) {
  for (const e of effects) {
    if (e.type === 'ABANDON_ALARM_SET') await alarms.setAt('abandon', e.when);
    else if (e.type === 'ABANDON_ALARM_CLEAR') await alarms.clear('abandon');
    else if (e.type === 'PROBE') setTimeout(probe, 0);
  }
}

async function probeWindow() {
  const { session } = await store.get('session');
  if (session?.state !== 'ARMED') return;
  const w = await getWindow(session.examWindowId);
  if (w) await dispatch({ kind: 'WINDOW_STATE', windowId: w.id, state: w.state, at: now() });
}

export async function probe() {
  await dispatch({ kind: 'FOCUS', windowId: await focusedWindowId(), at: now() });
  await probeWindow();
}

async function boot() {
  await applyConfig();
  await alarms.setPeriodic('tick', 0.5);
  await chrome.idle.setDetectionInterval(60);
}

chrome.runtime.onInstalled.addListener(boot);
chrome.runtime.onStartup.addListener(boot);
chrome.storage.onChanged.addListener((changes) => { if (changes.config) applyConfig(); });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/sw-dispatch.test.js`
Expected: `# pass 6`, `# fail 0`.

- [ ] **Step 5: Commit (do not run unless authorised)**

```bash
git add src/sw.js tests/unit/sw-dispatch.test.js
git commit -m "feat(sw): serialised dispatch with hash-chained persistence and alarm effects"
```

---

### Task 14: Service worker, part 2 — chrome listeners, screenshots, tick, startup recovery

**Files:**
- Modify: `src/sw.js`
- Test: `tests/unit/sw-listeners.test.js`

**Interfaces:**
- Consumes: `captureJpeg` (Task 12), `getTab/queryAllTabs/getAllWindows`, `needsShot` (Task 7), `shotFile` (Task 4), `classify` (Task 2).
- Produces: `takeShots(events): Promise<Array<{file, b64}>>` (module-private, called inside `dispatch`); exported `tick()`, `recover()`; all chrome listeners of spec §5/§10. Storage: `shots[file] = b64`, `meta.lastShot = {at, file}`.

- [ ] **Step 1: Write the failing test**

`tests/unit/sw-listeners.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome } from './fake-chrome.js';

const chrome = installFakeChrome();
const config = { startPrefix: 'https://e.x/start', examPrefix: '', resultPrefix: 'https://e.x/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10 };
await chrome.storage.local.set({ config });
const sw = await import('../../src/sw.js');
chrome.tabs.list = [
  { id: 1, windowId: 3, url: 'https://e.x/start', title: 'Exam', incognito: false },
  { id: 2, windowId: 3, url: 'https://g.x/', title: 'G', incognito: false },
];
chrome.windows.list = [{ id: 3, focused: true, state: 'normal' }];
const get = (k) => chrome.storage.local.get(k);
const names = async () => (await get('events')).events.map(e => e.name);

test('onCommitted: subframes ignored, main frame arms and takes a screenshot', async () => {
  await chrome.webNavigation.onCommitted.emit({ tabId: 1, frameId: 7, url: 'https://e.x/start' });
  await sw.settled();
  assert.equal((await get('session')).session, undefined);
  await chrome.webNavigation.onCommitted.emit({ tabId: 1, frameId: 0, url: 'https://e.x/start?c=1' });
  await sw.settled();
  const { session, events, shots } = await get(null);
  assert.equal(session.state, 'ARMED');
  assert.match(events[0].shot, /^screenshots\/\d{8}-\d{6}_SESSION_ARMED\.jpg$/);
  assert.equal(shots[events[0].shot], '/9j/FAKE');
  assert.match((await get('lines')).lines[1], /shot="screenshots\//);
});

test('onActivated within 2 s reuses the previous screenshot file', async () => {
  await chrome.tabs.onActivated.emit({ tabId: 2, windowId: 3 });
  await sw.settled();
  const { events } = await get('events');
  assert.deepEqual(events.slice(-2).map(e => e.name), ['TAB_SWITCH', 'PARALLEL_PAGE']);
  assert.equal(events.at(-2).shot, events[0].shot);
  assert.equal(events.at(-2).data.toTitle, 'G');
});

test('onMessage: only the exam tab is heard', async () => {
  await chrome.runtime.onMessage.emit({ type: 'cs', name: 'COPY', data: { len: 3 } }, { tab: { id: 2, windowId: 3 } });
  await chrome.runtime.onMessage.emit({ type: 'cs', name: 'COPY', data: { len: 3 } }, { tab: { id: 1, windowId: 3 } });
  await sw.settled();
  assert.equal((await names()).filter(n => n === 'COPY').length, 1);
});

test('capture failure is recorded on the event, not thrown', async () => {
  chrome.tabs.captureVisibleTab = async () => { throw new Error('Cannot access contents'); };
  await sw.dispatch({ kind: 'PERIODIC', at: Date.now() + 5000 });
  const ev = (await get('events')).events.at(-1);
  assert.equal(ev.shot, null);
  assert.equal(ev.data.shotError, 'Cannot access contents');
  chrome.tabs.captureVisibleTab = async () => 'data:image/jpeg;base64,/9j/FAKE';
});

test('focus change, idle, downloads by others, windows', async () => {
  await chrome.windows.onFocusChanged.emit(-1);
  await chrome.idle.onStateChanged.emit('locked');
  await chrome.downloads.onCreated.emit({ id: 5, byExtensionId: 'fake-ext-id', url: 'x', filename: 'x', mime: 'x' });
  await chrome.downloads.onCreated.emit({ id: 6, url: 'https://f.x/a.pdf', filename: '/dl/a.pdf', mime: 'application/pdf' });
  await chrome.windows.onCreated.emit({ id: 8, incognito: true });
  await sw.settled();
  const n = await names();
  for (const x of ['FOCUS_LEFT_CHROME', 'IDLE_START', 'DOWNLOAD_STARTED', 'INCOGNITO_WINDOW_OPENED']) assert.ok(n.includes(x), x);
  assert.equal(n.filter(x => x === 'DOWNLOAD_STARTED').length, 1);
});

test('tick alarm reconciles state and updates lastSeenAt', async () => {
  chrome.windows.list = [{ id: 3, focused: false, state: 'minimized' }];
  const before = (await get('meta')).meta.lastSeenAt;
  await chrome.alarms.onAlarm.emit({ name: 'tick' });
  await sw.settled();
  assert.ok((await names()).includes('WINDOW_MINIMIZED'));
  assert.ok((await get('meta')).meta.lastSeenAt >= before);
});

test('recover on startup re-adopts the exam tab by URL', async () => {
  chrome.tabs.list = [{ id: 44, windowId: 9, url: 'https://e.x/q/7', title: 'Q7', incognito: false }];
  await chrome.runtime.onStartup.emit();
  await sw.settled();
  const { session } = await get('session');
  assert.equal(session.examTabId, 44);
  assert.equal(session.examWindowId, 9);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/sw-listeners.test.js`
Expected: FAIL — first test: `session` is undefined after the main-frame commit (no listener registered).

- [ ] **Step 3: Add imports, screenshots, listeners, tick and recover**

In `src/sw.js`, replace the import block's windows/adapters lines and add the new imports so the top reads:
```js
import * as store from './adapters/storage.js';
import * as alarms from './adapters/alarms.js';
import { registerExamScript } from './adapters/scripting.js';
import { getWindow, getAllWindows, focusedWindowId, lastFocusedWindowId } from './adapters/windows.js';
import { getTab, queryAllTabs } from './adapters/tabs.js';
import { captureJpeg } from './adapters/capture.js';
import { normalize, validate, resolved } from './core/config.js';
import { initial, reduce } from './core/session.js';
import { headerLine, formatLine, chainLine } from './core/logline.js';
import { GENESIS, shortHash } from './core/hashchain.js';
import { needsShot } from './core/events.js';
import { shotFile } from './core/ids.js';
import { classify } from './core/urlmatch.js';

const GAP_MS = 90000;
const SHOT_GAP_MS = 2000;
```

In `dispatch`, replace the line `for (const ev of newEvents) {` and the preceding blank with:
```js
    const added = await takeShots(newEvents);
    for (const ev of newEvents) {
```
(`added` is consumed by Task 18; until then it is only assigned.)

Add after `runEffects`:
```js
async function takeShots(events) {
  const { meta = {}, shots = {} } = await store.get(['meta', 'shots']);
  let last = meta.lastShot || { at: 0, file: null };
  const added = [];
  for (const ev of events) {
    if (!needsShot(ev)) continue;
    if (last.file && ev.t - last.at < SHOT_GAP_MS) { ev.shot = last.file; continue; }
    try {
      const windowId = ev.windowId >= 0 ? ev.windowId : await lastFocusedWindowId();
      const b64 = await captureJpeg(windowId);
      const file = shotFile(ev.t, ev.name);
      shots[file] = b64;
      added.push({ file, b64 });
      ev.shot = file;
      last = { at: ev.t, file };
    } catch (e) {
      ev.data.shotError = String(e?.message || e);
    }
  }
  if (added.length) { await store.set({ shots }); await store.patchMeta({ lastShot: last }); }
  return added;
}

export async function tick() {
  const { session } = await store.get('session');
  const windows = (await getAllWindows()).map(w => ({ id: w.id, state: w.state }));
  const examTabPresent = session?.state === 'ARMED' && (await getTab(session.examTabId)) !== null;
  await dispatch({ kind: 'TICK', at: now(), windows, examTabPresent });
}

export async function recover() {
  const cfg = await loadConfig();
  const { session } = await store.get('session');
  if (!cfg || session?.state !== 'ARMED') return;
  const examTabs = (await queryAllTabs()).filter(t => classify(t.url, cfg)).map(t => ({ tabId: t.id, windowId: t.windowId, url: t.url }));
  await dispatch({ kind: 'STARTUP', at: now(), examTabs });
}
```

Replace the three listener lines at the bottom with:
```js
chrome.runtime.onInstalled.addListener(boot);
chrome.runtime.onStartup.addListener(async () => { await boot(); await recover(); });
chrome.storage.onChanged.addListener((changes) => { if (changes.config) applyConfig(); });
chrome.webNavigation.onCommitted.addListener(async (d) => {
  if (d.frameId !== 0) return;
  const tab = await getTab(d.tabId);
  dispatch({ kind: 'NAV', tabId: d.tabId, windowId: tab?.windowId ?? -1, url: d.url, incognito: Boolean(tab?.incognito), at: now() });
});
chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  const tab = await getTab(tabId);
  dispatch({ kind: 'TAB_ACTIVATED', tabId, windowId, url: tab?.url || '', title: tab?.title || '', incognito: Boolean(tab?.incognito), at: now() });
});
chrome.tabs.onRemoved.addListener((tabId) => dispatch({ kind: 'TAB_REMOVED', tabId, at: now() }));
chrome.windows.onFocusChanged.addListener((windowId) => { dispatch({ kind: 'FOCUS', windowId, at: now() }); setTimeout(probeWindow, 0); });
chrome.windows.onCreated.addListener((w) => dispatch({ kind: 'WINDOW_CREATED', windowId: w.id, incognito: Boolean(w.incognito), at: now() }));
chrome.windows.onRemoved.addListener((windowId) => dispatch({ kind: 'WINDOW_REMOVED', windowId, at: now() }));
chrome.idle.onStateChanged.addListener((state) => dispatch({ kind: 'IDLE', state, at: now() }));
chrome.downloads.onCreated.addListener((item) => {
  if (item.byExtensionId === chrome.runtime.id) return;
  dispatch({ kind: 'DOWNLOAD', url: item.url, filename: item.filename, mime: item.mime, at: now() });
});
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== 'cs' || !sender.tab) return;
  dispatch({ kind: 'CS', name: msg.name, data: msg.data, tabId: sender.tab.id, windowId: sender.tab.windowId, at: now() });
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'tick') tick();
  else if (a.name === 'periodic') dispatch({ kind: 'PERIODIC', at: now() });
  else if (a.name === 'abandon') dispatch({ kind: 'ABANDON_TIMER', at: now() });
});
```

- [ ] **Step 4: Run both service-worker tests to verify they pass**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/sw-dispatch.test.js tests/unit/sw-listeners.test.js`
Expected: `# pass 13`, `# fail 0`.

- [ ] **Step 5: Commit (do not run unless authorised)**

```bash
git add src/sw.js tests/unit/sw-listeners.test.js
git commit -m "feat(sw): chrome listeners, coalesced screenshots, tick and startup recovery"
```

---

### Task 15: Content script (`src/content.js`)

**Files:**
- Create: `src/content.js` (classic script: no `import`/`export`)
- Test: `tests/unit/content.test.js`

**Interfaces:**
- Produces: messages `{ type:'cs', name, data }` via `chrome.runtime.sendMessage(msg, cb)` with names `COPY|CUT|PASTE {len}`, `CONTEXTMENU {tag}`, `PRINT {}`, `FULLSCREEN_EXIT {}`, `DEVTOOLS {dw, dh}`, `VISIBILITY {hidden}`, `BLUR {}`, `FOCUS {}` (spec §5). Consumed by the `onMessage` listener (Task 14).

- [ ] **Step 1: Write the failing test**

`tests/unit/content.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

const L = {};
globalThis.document = { addEventListener: (n, f) => { L['doc:' + n] = f; }, hidden: false, fullscreenElement: null };
globalThis.window = { addEventListener: (n, f) => { L['win:' + n] = f; }, outerWidth: 1000, innerWidth: 1000, outerHeight: 800, innerHeight: 700 };
globalThis.getSelection = () => 'abc';
const sent = [];
globalThis.chrome = { runtime: { sendMessage: (m, cb) => { sent.push(m); cb(); }, lastError: undefined } };
await import('../../src/content.js');
const last = () => sent.at(-1);

test('clipboard events report lengths only', () => {
  L['doc:copy']({});
  assert.deepEqual(last(), { type: 'cs', name: 'COPY', data: { len: 3 } });
  L['doc:cut']({});
  assert.equal(last().name, 'CUT');
  L['doc:paste']({ clipboardData: { getData: () => 'hello world' } });
  assert.deepEqual(last(), { type: 'cs', name: 'PASTE', data: { len: 11 } });
});

test('contextmenu, print, visibility, blur, focus', () => {
  L['doc:contextmenu']({ target: { tagName: 'TEXTAREA' } });
  assert.deepEqual(last(), { type: 'cs', name: 'CONTEXTMENU', data: { tag: 'TEXTAREA' } });
  L['win:beforeprint']();
  assert.equal(last().name, 'PRINT');
  document.hidden = true; L['doc:visibilitychange']();
  assert.deepEqual(last(), { type: 'cs', name: 'VISIBILITY', data: { hidden: true } });
  L['win:blur'](); assert.equal(last().name, 'BLUR');
  L['win:focus'](); assert.equal(last().name, 'FOCUS');
});

test('fullscreen exit only after having been fullscreen', () => {
  const n = sent.length;
  L['doc:fullscreenchange']();
  assert.equal(sent.length, n);
  document.fullscreenElement = {}; L['doc:fullscreenchange']();
  document.fullscreenElement = null; L['doc:fullscreenchange']();
  assert.equal(last().name, 'FULLSCREEN_EXIT');
  assert.equal(sent.length, n + 1);
});

test('devtools heuristic fires once per opening', () => {
  const n = sent.length;
  window.outerWidth = 1300; L['win:resize']();
  assert.deepEqual(last(), { type: 'cs', name: 'DEVTOOLS', data: { dw: 300, dh: 100 } });
  L['win:resize']();
  assert.equal(sent.length, n + 1);
  window.outerWidth = 1000; L['win:resize']();
  window.outerWidth = 1300; L['win:resize']();
  assert.equal(sent.length, n + 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/content.test.js`
Expected: FAIL — `Cannot find module .../src/content.js`.

- [ ] **Step 3: Write the content script**

`src/content.js`:
```js
(() => {
  const send = (name, data) => chrome.runtime.sendMessage({ type: 'cs', name, data }, () => chrome.runtime.lastError);
  const clip = (name) => (e) => send(name, { len: name === 'PASTE' ? (e.clipboardData?.getData('text') || '').length : String(getSelection() || '').length });
  document.addEventListener('copy', clip('COPY'), true);
  document.addEventListener('cut', clip('CUT'), true);
  document.addEventListener('paste', clip('PASTE'), true);
  document.addEventListener('contextmenu', (e) => send('CONTEXTMENU', { tag: e.target?.tagName || '' }), true);
  window.addEventListener('beforeprint', () => send('PRINT', {}));
  let wasFullscreen = false;
  document.addEventListener('fullscreenchange', () => {
    const isFullscreen = Boolean(document.fullscreenElement);
    if (wasFullscreen && !isFullscreen) send('FULLSCREEN_EXIT', {});
    wasFullscreen = isFullscreen;
  });
  document.addEventListener('visibilitychange', () => send('VISIBILITY', { hidden: document.hidden }));
  window.addEventListener('blur', () => send('BLUR', {}));
  window.addEventListener('focus', () => send('FOCUS', {}));
  let devtoolsOpen = false;
  const checkDevtools = () => {
    const dw = window.outerWidth - window.innerWidth, dh = window.outerHeight - window.innerHeight;
    const open = dw >= 160 || dh >= 160;
    if (open && !devtoolsOpen) send('DEVTOOLS', { dw, dh });
    devtoolsOpen = open;
  };
  window.addEventListener('resize', checkDevtools);
  checkDevtools();
})();
```

- [ ] **Step 4: Run test and syntax check**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/content.test.js && node --check src/content.js`
Expected: `# pass 4`, `# fail 0`; `node --check` prints nothing.

- [ ] **Step 5: Commit (do not run unless authorised)**

```bash
git add src/content.js tests/unit/content.test.js
git commit -m "feat: exam-page content script reporting page-level events"
```

---

### Task 16: Options page

**Files:**
- Create: `src/options/options.html`, `src/options/options.js`
- Test: `tests/unit/options.test.js`

**Interfaces:**
- Consumes: `DEFAULTS`, `normalize`, `validate` (Task 3).
- Produces: writes `config` (normalized) to `chrome.storage.local`; the SW's `storage.onChanged` listener (Task 13) re-applies it.

- [ ] **Step 1: Write the failing test**

`tests/unit/options.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULTS } from '../../src/core/config.js';

test('options form has one field per config key and a module script', async () => {
  const html = await readFile(new URL('../../src/options/options.html', import.meta.url), 'utf8');
  for (const k of Object.keys(DEFAULTS)) assert.match(html, new RegExp(`name="${k}"`), k);
  assert.match(html, /<script type="module" src="options.js"><\/script>/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/options.test.js`
Expected: FAIL — `ENOENT ... options.html`.

- [ ] **Step 3: Write the page**

`src/options/options.html`:
```html
<!doctype html>
<meta charset="utf-8">
<title>ExamEye options</title>
<style>
  body { font: 14px system-ui; margin: 24px; max-width: 640px; }
  label { display: block; margin: 12px 0 4px; font-weight: 600; }
  input { width: 100%; padding: 6px; box-sizing: border-box; }
  button { margin-top: 16px; padding: 8px 16px; }
  #status { white-space: pre-line; margin-top: 12px; color: #a00; }
</style>
<h1>ExamEye configuration</h1>
<form id="form">
  <label>Exam start URL prefix<input name="startPrefix" placeholder="https://exam.example.com/start"></label>
  <label>Exam in-progress URL prefix (optional; blank = start page origin)<input name="examPrefix"></label>
  <label>Result URL prefix<input name="resultPrefix" placeholder="https://exam.example.com/result"></label>
  <label>Seat / Centre ID<input name="seat"></label>
  <label>Output subfolder under Downloads<input name="subfolder"></label>
  <label>Periodic screenshot interval (minutes)<input name="shotIntervalMin" type="number" min="1" max="60"></label>
  <label>Abandon session after exam tab gone (minutes)<input name="abandonMin" type="number" min="1" max="120"></label>
  <button type="submit">Save</button>
</form>
<div id="status"></div>
<script type="module" src="options.js"></script>
```

`src/options/options.js`:
```js
import { DEFAULTS, normalize, validate } from '../core/config.js';

const form = document.getElementById('form');
const status = document.getElementById('status');
const fields = Object.keys(DEFAULTS);

async function load() {
  const { config } = await chrome.storage.local.get('config');
  const cfg = normalize(config);
  for (const k of fields) form.elements[k].value = cfg[k];
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const cfg = normalize(Object.fromEntries(fields.map(k => [k, form.elements[k].value])));
  const errors = validate(cfg);
  if (errors.length) { status.textContent = errors.map(er => `${er.field}: ${er.message}`).join('\n'); return; }
  await chrome.storage.local.set({ config: cfg });
  status.textContent = 'Saved.';
});

load();
```

- [ ] **Step 4: Run test and syntax check**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/options.test.js && node --check src/options/options.js`
Expected: `# pass 1`, `# fail 0`; `node --check` prints nothing.

- [ ] **Step 5: Commit (do not run unless authorised)**

```bash
git add src/options/ tests/unit/options.test.js
git commit -m "feat: options page writing validated config to storage.local"
```

---

### Task 17: Popup

**Files:**
- Create: `src/popup/popup.html`, `src/popup/popup.js`
- Test: `tests/unit/popup.test.js`

**Interfaces:**
- Consumes: `tally` (Task 11); storage keys `session`, `events`, `meta` (Tasks 13–14, 18).
- Produces: live read-only view; re-renders on `chrome.storage.onChanged`.

- [ ] **Step 1: Write the failing test**

`tests/unit/popup.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('popup has the live-state slots and a module script', async () => {
  const html = await readFile(new URL('../../src/popup/popup.html', import.meta.url), 'utf8');
  for (const id of ['state', 'session', 'flush', 'errors', 'counts']) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /<script type="module" src="popup.js"><\/script>/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/popup.test.js`
Expected: FAIL — `ENOENT ... popup.html`.

- [ ] **Step 3: Write the popup**

`src/popup/popup.html`:
```html
<!doctype html>
<meta charset="utf-8">
<title>ExamEye</title>
<style>
  body { font: 13px system-ui; margin: 12px; width: 320px; }
  dt { font-weight: 600; margin-top: 8px; }
  dd { margin: 2px 0 0; white-space: pre-line; }
  #errors { color: #a00; }
</style>
<h2>ExamEye</h2>
<dl>
  <dt>State</dt><dd id="state"></dd>
  <dt>Session</dt><dd id="session"></dd>
  <dt>Last flush</dt><dd id="flush"></dd>
  <dt>Errors</dt><dd id="errors"></dd>
  <dt>Counters</dt><dd id="counts"></dd>
</dl>
<script type="module" src="popup.js"></script>
```

`src/popup/popup.js`:
```js
import { tally } from '../core/counters.js';

const $ = (id) => document.getElementById(id);

async function render() {
  const { session = { state: 'IDLE' }, events = [], meta = {} } = await chrome.storage.local.get(['session', 'events', 'meta']);
  $('state').textContent = session.state;
  $('session').textContent = session.id || '-';
  $('flush').textContent = meta.lastFlushAt ? new Date(meta.lastFlushAt).toLocaleTimeString() : 'never';
  const errors = (meta.configErrors || []).map(e => `${e.field}: ${e.message}`);
  if (meta.lastFlushError) errors.push(`flush: ${meta.lastFlushError}`);
  $('errors').textContent = errors.join('\n') || '-';
  const { counts } = tally(events);
  $('counts').textContent = Object.keys(counts).sort().map(n => `${n}: ${counts[n]}`).join('\n') || '(no events)';
}

chrome.storage.onChanged.addListener(render);
render();
```

- [ ] **Step 4: Run test and the full syntax check**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/popup.test.js && npm run check`
Expected: `# pass 1`, `# fail 0`; `npm run check` exits 0 with no diagnostics.

- [ ] **Step 5: Commit (do not run unless authorised)**

```bash
git add src/popup/ tests/unit/popup.test.js
git commit -m "feat: popup with live session state, counters and errors"
```

---

### Task 18: Persistence sink — flush loop, UI suppression, replay

**Files:**
- Modify: `src/sw.js`
- Test: `tests/unit/sw-flush.test.js`

**Interfaces:**
- Consumes: `putText/putBase64/remove/dataUrl` (Task 10), `writeFile/suppressUi/eraseOwnCompleted` (Task 12), `added` from `takeShots` (Task 14).
- Produces: exported `flush(): Promise<void>`; storage `pending{}`, `meta.lastFlushAt`, `meta.lastFlushError`. File paths: `<subfolder>/<sessionId>/log.txt` and `<subfolder>/<sessionId>/<shotFile>`.

- [ ] **Step 1: Write the failing test**

`tests/unit/sw-flush.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome } from './fake-chrome.js';

const chrome = installFakeChrome();
const config = { startPrefix: 'https://e.x/start', examPrefix: '', resultPrefix: 'https://e.x/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10 };
await chrome.storage.local.set({ config });
const sw = await import('../../src/sw.js');
chrome.windows.list = [{ id: 3, focused: true, state: 'normal' }];
const get = (k) => chrome.storage.local.get(k);
const decode = (url) => Buffer.from(url.split(',')[1], 'base64').toString('utf8');

test('boot suppresses the download UI and erases own completed downloads', async () => {
  await chrome.runtime.onInstalled.emit();
  assert.deepEqual(chrome.downloads.uiOptions, { enabled: false });
  chrome.downloads.items = [{ id: 1, byExtensionId: 'fake-ext-id' }];
  await chrome.downloads.onChanged.emit({ id: 1, state: { current: 'complete' } });
  assert.deepEqual(chrome.downloads.erased, [1]);
});

test('every event flushes log.txt and new screenshots under <subfolder>/<sessionId>/', async () => {
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/start', at: 1000 });
  const { session, pending, meta } = await get(null);
  const names = chrome.downloads.calls.map(c => c.filename);
  assert.deepEqual(names, [`ExamEye/${session.id}/log.txt`, `ExamEye/${session.id}/screenshots/${session.id.slice(0, 15)}_SESSION_ARMED.jpg`]);
  assert.match(decode(chrome.downloads.calls[0].url), /^# ExamEye session .*\n.* SESSION_ARMED .*\n$/);
  assert.equal(chrome.downloads.calls[1].url, 'data:image/jpeg;base64,/9j/FAKE');
  assert.deepEqual(pending, {});
  assert.equal(typeof meta.lastFlushAt, 'number');
  assert.equal(meta.lastFlushError, null);
});

test('a failed write stays pending and is replayed on the next flush', async () => {
  chrome.downloads.failWhen = (o) => o.filename.endsWith('log.txt');
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/q/1', at: 2000 });
  let { pending, meta } = await get(null);
  assert.deepEqual(Object.keys(pending).map(p => p.split('/').pop()), ['log.txt']);
  assert.match(meta.lastFlushError, /log\.txt/);
  chrome.downloads.failWhen = null;
  const n = chrome.downloads.calls.length;
  await sw.flush();
  ({ pending, meta } = await get(null));
  assert.deepEqual(pending, {});
  assert.equal(meta.lastFlushError, null);
  assert.equal(chrome.downloads.calls.length, n + 1);
  assert.match(decode(chrome.downloads.calls.at(-1).url), /EXAM_NAV/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/sw-flush.test.js`
Expected: FAIL — first test: `uiOptions` is `null`.

- [ ] **Step 3: Wire the sink into sw.js**

Add imports after the existing adapter imports:
```js
import { suppressUi, writeFile, eraseOwnCompleted } from './adapters/downloads.js';
import { putText, putBase64, remove, dataUrl } from './core/sink.js';
```

In `dispatch`, replace
```js
    await store.set({ session: r.session, events, lines, lastHash });
    await store.patchMeta({ lastSeenAt: input.at });
    await runEffects(r.effects, cfg);
```
with
```js
    if (newEvents.length) {
      const base = `${cfg.subfolder}/${(r.session.state === 'ARMED' ? r.session : session).id}`;
      let { pending = {} } = await store.get('pending');
      pending = putText(pending, `${base}/log.txt`, 'text/plain', lines.join('\n') + '\n');
      for (const s of added) pending = putBase64(pending, `${base}/${s.file}`, 'image/jpeg', s.b64);
      await store.set({ pending });
    }
    await store.set({ session: r.session, events, lines, lastHash });
    await store.patchMeta({ lastSeenAt: input.at });
    await runEffects(r.effects, cfg);
    if (newEvents.length) await flush();
```

Add after `takeShots`:
```js
let flushing = false, flushAgain = false;

export async function flush() {
  if (flushing) { flushAgain = true; return; }
  flushing = true;
  try {
    do {
      flushAgain = false;
      let { pending = {} } = await store.get('pending');
      let error = null;
      for (const [path, f] of Object.entries(pending)) {
        try {
          await writeFile(path, dataUrl(f.mime, f.b64));
          pending = remove(pending, path);
        } catch (e) {
          error = `${path}: ${e?.message || e}`;
        }
      }
      await store.set({ pending });
      await store.patchMeta({ lastFlushAt: now(), lastFlushError: error });
    } while (flushAgain);
  } finally {
    flushing = false;
  }
}
```

In `tick`, append after the `dispatch({ kind: 'TICK', ... })` line:
```js
  await flush();
```

In `boot`, add as the first line:
```js
  await suppressUi();
```
and add at module top level, just before `chrome.runtime.onInstalled.addListener(boot);`:
```js
eraseOwnCompleted();
```

- [ ] **Step 4: Run all service-worker tests**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/sw-dispatch.test.js tests/unit/sw-listeners.test.js tests/unit/sw-flush.test.js`
Expected: `# pass 16`, `# fail 0`.

- [ ] **Step 5: Commit (do not run unless authorised)**

```bash
git add src/sw.js tests/unit/sw-flush.test.js
git commit -m "feat(sw): chrome.downloads sink with pending replay and download UI suppression"
```

---

### Task 19: summary.txt renderer (`src/core/summary-text.js`)

**Files:**
- Create: `src/core/summary-text.js`
- Test: `tests/unit/summary-text.test.js`

**Interfaces:**
- Consumes: `fmtDuration`, `fmtLocal`, `tzOffset` (Task 4).
- Produces: `renderSummaryText(ctx): string` with `ctx = { session: {id, seat, startedAt}, outcome, endedAt, events, tally, integrity: {ok, firstBad, lines} }` (spec §8).

- [ ] **Step 1: Write the failing test**

`tests/unit/summary-text.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSummaryText } from '../../src/core/summary-text.js';
import { tally } from '../../src/core/counters.js';

const started = new Date(2026, 8, 12, 9, 15, 2).getTime();
const events = [
  { seq: 1, t: started, name: 'SESSION_ARMED', data: {}, shot: 'screenshots/a.jpg' },
  { seq: 2, t: started + 1000, name: 'PARALLEL_PAGE', data: { url: 'https://g.x/', title: 'G', trigger: 'activated', incognito: true }, shot: 'screenshots/a.jpg', tabId: 2 },
  { seq: 3, t: started + 4000, name: 'TAB_RETURN', data: { awayMs: 3000 }, shot: null },
];
const ctx = { session: { id: '20260912-091502_A17', seat: 'A17', startedAt: started }, outcome: 'RESULT', endedAt: started + 3723000, events, tally: tally(events), integrity: { ok: true, firstBad: -1, lines: 4 } };

test('summary.txt layout', () => {
  const txt = renderSummaryText(ctx);
  const lines = txt.split('\n');
  assert.equal(lines[0], 'ExamEye summary');
  assert.equal(lines[1], 'Session:   20260912-091502_A17   Seat: A17');
  assert.match(lines[2], /^Started:   2026-09-12 09:15:02 \([+-]\d\d:\d\d\)   Ended: 2026-09-12 10:17:05   Outcome: RESULT$/);
  assert.equal(lines[3], 'Duration:  01:02:03');
  assert.equal(lines[4], 'Log chain: OK (4 lines)');
  assert.ok(lines.includes('  PARALLEL_PAGE .......... 1'));
  assert.ok(lines.includes('  Tab away ......... 00:00:03'));
  assert.ok(lines.includes('  00:00:03  1  https://g.x/  "G"  [incognito]'));
  assert.ok(lines.includes('Screenshots: 1 (screenshots/)'));
  assert.ok(txt.endsWith('\n'));
});

test('broken chain is reported', () => {
  assert.match(renderSummaryText({ ...ctx, integrity: { ok: false, firstBad: 2, lines: 4 } }), /Log chain: BROKEN at line 2 \(4 lines\)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/summary-text.test.js`
Expected: FAIL — `Cannot find module .../src/core/summary-text.js`.

- [ ] **Step 3: Write the renderer**

`src/core/summary-text.js`:
```js
import { fmtDuration, fmtLocal, tzOffset } from './ids.js';

const dots = (label, width) => (label + ' ').padEnd(width, '.');

export function renderSummaryText({ session, outcome, endedAt, events, tally, integrity }) {
  const shots = new Set(events.filter(e => e.shot).map(e => e.shot)).size;
  const d = tally.durations;
  const L = [
    'ExamEye summary',
    `Session:   ${session.id}   Seat: ${session.seat}`,
    `Started:   ${fmtLocal(session.startedAt)} (${tzOffset(session.startedAt)})   Ended: ${fmtLocal(endedAt)}   Outcome: ${outcome}`,
    `Duration:  ${fmtDuration(endedAt - session.startedAt)}`,
    `Log chain: ${integrity.ok ? 'OK' : `BROKEN at line ${integrity.firstBad}`} (${integrity.lines} lines)`,
    '', 'Counts',
  ];
  for (const n of Object.keys(tally.counts).sort()) L.push(`  ${dots(n, 24)} ${tally.counts[n]}`);
  L.push('', 'Time away',
    `  ${dots('Tab away', 18)} ${fmtDuration(d.tabAwayMs)}`,
    `  ${dots('Focus left', 18)} ${fmtDuration(d.focusLeftMs)}`,
    `  ${dots('Minimized', 18)} ${fmtDuration(d.minimizedMs)}`,
    `  ${dots('Idle', 18)} ${fmtDuration(d.idleMs)}`,
    '', 'Parallel pages (focused time, visits)');
  for (const p of tally.parallel) L.push(`  ${fmtDuration(p.focusedMs)}  ${p.visits}  ${p.url}  ${JSON.stringify(p.title)}${p.incognito ? '  [incognito]' : ''}`);
  L.push('', `Screenshots: ${shots} (screenshots/)`, '');
  return L.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/summary-text.test.js`
Expected: `# pass 2`, `# fail 0`.

- [ ] **Step 5: Commit (do not run unless authorised)**

```bash
git add src/core/summary-text.js tests/unit/summary-text.test.js
git commit -m "feat(core): summary.txt renderer"
```

---

### Task 20: summary.html renderer (`src/core/summary-html.js`)

**Files:**
- Create: `src/core/summary-html.js`
- Test: `tests/unit/summary-html.test.js`

**Interfaces:**
- Consumes: Task 4 formatters.
- Produces: `escapeHtml(s): string`; `renderSummaryHtml(ctx & { shots: {[file]: b64}, inlineShots: boolean }): string` — self-contained page, no scripts, no external resources; inline variant embeds `data:image/jpeg;base64,…`, linked variant uses `src="screenshots/<name>.jpg"` (spec §8).

- [ ] **Step 1: Write the failing test**

`tests/unit/summary-html.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, renderSummaryHtml } from '../../src/core/summary-html.js';
import { tally } from '../../src/core/counters.js';

const started = new Date(2026, 8, 12, 9, 15, 2).getTime();
const events = [
  { seq: 1, t: started, name: 'SESSION_ARMED', data: { url: 'https://e.x/start?a=1&b=<x>' }, shot: 'screenshots/s1.jpg' },
  { seq: 2, t: started + 1000, name: 'PARALLEL_PAGE', data: { url: 'https://g.x/', title: '<b>G</b>', trigger: 'activated', incognito: false }, shot: 'screenshots/s1.jpg', tabId: 2 },
];
const ctx = { session: { id: 'S1', seat: 'A17', startedAt: started }, outcome: 'RESULT', endedAt: started + 60000, events, tally: tally(events), integrity: { ok: true, firstBad: -1, lines: 3 }, shots: { 'screenshots/s1.jpg': '/9j/AAA' } };

test('escapeHtml', () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
});

test('inline variant embeds data URIs, escapes user text, has no scripts', () => {
  const html = renderSummaryHtml({ ...ctx, inlineShots: true });
  assert.ok(html.includes('<img src="data:image/jpeg;base64,/9j/AAA"'));
  assert.ok(html.includes('&lt;b&gt;G&lt;/b&gt;'));
  assert.ok(!html.includes('<b>G</b>'));
  assert.ok(!/<script/i.test(html));
  assert.ok(html.includes('Screenshots (1)'));
  assert.ok(html.includes('<td>SESSION_ARMED</td>'));
});

test('linked variant references files relative to the session folder', () => {
  const html = renderSummaryHtml({ ...ctx, inlineShots: false });
  assert.ok(html.includes('<img src="screenshots/s1.jpg"'));
  assert.ok(!html.includes('data:image/jpeg'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/summary-html.test.js`
Expected: FAIL — `Cannot find module .../src/core/summary-html.js`.

- [ ] **Step 3: Write the renderer**

`src/core/summary-html.js`:
```js
import { fmtDuration, fmtLocal, tzOffset } from './ids.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

const row = (cells) => `<tr>${cells.map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`;
const table = (head, rows) => `<table>${head ? `<tr>${head.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr>` : ''}${rows.join('')}</table>`;

export function renderSummaryHtml({ session, outcome, endedAt, events, tally, integrity, shots, inlineShots }) {
  const files = [...new Set(events.filter(e => e.shot).map(e => e.shot))];
  const src = (file) => inlineShots ? `data:image/jpeg;base64,${shots[file] || ''}` : file;
  const d = tally.durations;
  return `<!doctype html>
<meta charset="utf-8">
<title>ExamEye ${escapeHtml(session.id)}</title>
<style>body{font:14px system-ui;margin:24px}table{border-collapse:collapse;margin:8px 0 20px}td,th{border:1px solid #ccc;padding:4px 8px;text-align:left;vertical-align:top}img{max-width:480px;display:block;margin:4px 0 16px}</style>
<h1>ExamEye summary - ${escapeHtml(session.id)}</h1>
${table(null, [row(['Seat', session.seat]), row(['Started', `${fmtLocal(session.startedAt)} (${tzOffset(session.startedAt)})`]), row(['Ended', fmtLocal(endedAt)]), row(['Outcome', outcome]), row(['Duration', fmtDuration(endedAt - session.startedAt)]), row(['Log chain', integrity.ok ? `OK (${integrity.lines} lines)` : `BROKEN at line ${integrity.firstBad} (${integrity.lines} lines)`])])}
<h2>Counts</h2>
${table(['Event', 'Count'], Object.keys(tally.counts).sort().map(n => row([n, tally.counts[n]])))}
<h2>Time away</h2>
${table(null, [row(['Tab away', fmtDuration(d.tabAwayMs)]), row(['Focus left', fmtDuration(d.focusLeftMs)]), row(['Minimized', fmtDuration(d.minimizedMs)]), row(['Idle', fmtDuration(d.idleMs)])])}
<h2>Parallel pages</h2>
${table(['Focused', 'Visits', 'URL', 'Title', 'Incognito'], tally.parallel.map(p => row([fmtDuration(p.focusedMs), p.visits, p.url, p.title, p.incognito ? 'yes' : 'no'])))}
<h2>Timeline</h2>
${table(['#', 'Time', 'Event', 'Details', 'Shot'], events.map(e => `<tr><td>${e.seq}</td><td>${escapeHtml(fmtLocal(e.t))}</td><td>${escapeHtml(e.name)}</td><td>${escapeHtml(JSON.stringify(e.data))}</td><td>${e.shot ? `<a href="#${escapeHtml(e.shot)}">view</a>` : ''}</td></tr>`))}
<h2>Screenshots (${files.length})</h2>
${files.map(f => `<h3 id="${escapeHtml(f)}">${escapeHtml(f)}</h3><img src="${escapeHtml(src(f))}" alt="${escapeHtml(f)}">`).join('\n')}
`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/summary-html.test.js`
Expected: `# pass 3`, `# fail 0`.

- [ ] **Step 5: Commit (do not run unless authorised)**

```bash
git add src/core/summary-html.js tests/unit/summary-html.test.js
git commit -m "feat(core): self-contained summary.html renderer with inline or linked screenshots"
```

---

### Task 21: Session end — summaries, events.jsonl, fallback, storage reset

**Files:**
- Modify: `src/sw.js`
- Test: `tests/unit/sw-end.test.js`

**Interfaces:**
- Consumes: `renderSummaryText` (Task 19), `renderSummaryHtml` (Task 20), `tally` (Task 11), `verify` (Task 5), `toBase64` (Task 10), `END` effect `{outcome, session}` (Task 8).
- Produces: `endSession(effect, cfg)` (module-private) — spec §4 "Session end".

- [ ] **Step 1: Write the failing test**

`tests/unit/sw-end.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome } from './fake-chrome.js';

const chrome = installFakeChrome();
const config = { startPrefix: 'https://e.x/start', examPrefix: '', resultPrefix: 'https://e.x/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10 };
await chrome.storage.local.set({ config });
const sw = await import('../../src/sw.js');
chrome.windows.list = [{ id: 3, focused: true, state: 'normal' }];
const get = (k) => chrome.storage.local.get(k);
const decode = (url) => Buffer.from(url.split(',')[1], 'base64').toString('utf8');
const byName = (n) => chrome.downloads.calls.filter(c => c.filename.endsWith(n));

test('result navigation writes all files, then clears the session', async () => {
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/start', at: 1000 });
  const { session: armed } = await get('session');
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/result', at: 61000 });
  const base = `ExamEye/${armed.id}/`;
  for (const f of ['log.txt', 'events.jsonl', 'summary.txt', 'summary.html']) assert.ok(byName(f).some(c => c.filename === base + f), f);
  const jsonl = decode(byName('events.jsonl').at(-1).url).trimEnd().split('\n').map(l => JSON.parse(l));
  assert.deepEqual(jsonl.map(e => e.name), ['SESSION_ARMED', 'SESSION_DISARMED']);
  assert.equal(typeof jsonl[1].hash, 'string');
  assert.match(decode(byName('summary.txt').at(-1).url), /Outcome: RESULT[\s\S]*Log chain: OK \(3 lines\)/);
  assert.ok(decode(byName('summary.html').at(-1).url).includes('data:image/jpeg;base64,/9j/FAKE'));
  const { session, events, lines, shots, pending } = await get(null);
  assert.deepEqual(session, { state: 'IDLE' });
  assert.deepEqual([events, lines, shots, pending], [[], [], {}, {}]);
});

test('if the inline summary.html is rejected, the linked variant is written instead', async () => {
  let n = 0;
  chrome.downloads.failWhen = (o) => o.filename.endsWith('summary.html') && n++ === 0;
  await sw.dispatch({ kind: 'NAV', tabId: 5, windowId: 3, url: 'https://e.x/start', at: 100000 });
  await sw.dispatch({ kind: 'NAV', tabId: 5, windowId: 3, url: 'https://e.x/result', at: 100500 });
  chrome.downloads.failWhen = null;
  const htmls = byName('summary.html').slice(-2).map(c => decode(c.url));
  assert.ok(htmls[1].includes('<img src="screenshots/'));
  assert.ok(!htmls[1].includes('data:image/jpeg'));
  assert.deepEqual((await get('pending')).pending, {});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && node --test tests/unit/sw-end.test.js`
Expected: FAIL — `events.jsonl` not among download calls.

- [ ] **Step 3: Wire endSession**

Add imports to `src/sw.js`:
```js
import { tally } from './core/counters.js';
import { verify } from './core/hashchain.js';
import { renderSummaryText } from './core/summary-text.js';
import { renderSummaryHtml } from './core/summary-html.js';
import { toBase64 } from './core/sink.js';
```
(merge `toBase64` into the existing `./core/sink.js` import line and `verify` into the `./core/hashchain.js` line.)

In `runEffects`, add a branch:
```js
    else if (e.type === 'END') await endSession(e, cfg);
```

Add after `flush`:
```js
async function endSession(e, cfg) {
  const { events = [], lines = [], shots = {}, pending: p0 = {} } = await store.get(['events', 'lines', 'shots', 'pending']);
  const base = `${cfg.subfolder}/${e.session.id}`;
  const ctx = { session: e.session, outcome: e.outcome, endedAt: now(), events, tally: tally(events), integrity: { ...(await verify(lines)), lines: lines.length } };
  let pending = putText(p0, `${base}/log.txt`, 'text/plain', lines.join('\n') + '\n');
  pending = putText(pending, `${base}/events.jsonl`, 'application/json', events.map(ev => JSON.stringify(ev)).join('\n') + '\n');
  pending = putText(pending, `${base}/summary.txt`, 'text/plain', renderSummaryText(ctx));
  await store.set({ pending, session: initial(), events: [], lines: [], shots: {} });
  await flush();
  try {
    await writeFile(`${base}/summary.html`, dataUrl('text/html', toBase64(renderSummaryHtml({ ...ctx, shots, inlineShots: true }))));
  } catch {
    const { pending: p1 = {} } = await store.get('pending');
    await store.set({ pending: putText(p1, `${base}/summary.html`, 'text/html', renderSummaryHtml({ ...ctx, shots, inlineShots: false })) });
    await flush();
  }
}
```
The inline `summary.html` is written directly rather than via `pending` because a rejected multi-megabyte data: URL must fall back to the linked variant instead of being replayed forever.

- [ ] **Step 4: Run the whole unit suite**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && npm test`
Expected: all files pass; `# fail 0`.

- [ ] **Step 5: Commit (do not run unless authorised)**

```bash
git add src/sw.js tests/unit/sw-end.test.js
git commit -m "feat(sw): session end writes summaries and events.jsonl with linked-screenshot fallback"
```

---

### Task 22: Playwright integration harness

**Files:**
- Create: `tests/integration/harness.js`, `tests/integration/session.test.js`
- Create: `tests/integration/site/exam/start.html`, `tests/integration/site/exam/q1.html`, `tests/integration/site/exam/result.html`, `tests/integration/site/other.html`
- Modify: `package.json` (devDependency)

**Interfaces:**
- Consumes: the whole extension; `verify` (Task 5).
- Produces: `startSite()`, `launch(config)`, `storage(worker, keys)`, `waitFor(fn, ms)`.

- [ ] **Step 1: Install Playwright and its Chromium (foreground; ask the owner first if the machine is offline)**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && npm install --save-dev playwright@latest && npx playwright install chromium`
Expected: `package.json` gains `"devDependencies": { "playwright": "^1.x" }`; Chromium present under `~/Library/Caches/ms-playwright`.

- [ ] **Step 2: Write the fake exam site**

`tests/integration/site/exam/start.html`:
```html
<!doctype html><meta charset="utf-8"><title>Exam start</title><h1>Exam start</h1><a id="begin" href="q1.html">Begin</a>
```
`tests/integration/site/exam/q1.html`:
```html
<!doctype html><meta charset="utf-8"><title>Question 1</title><h1>Question 1</h1><textarea id="answer"></textarea><a id="finish" href="result.html">Finish</a>
```
`tests/integration/site/exam/result.html`:
```html
<!doctype html><meta charset="utf-8"><title>Result</title><h1>Result</h1>
```
`tests/integration/site/other.html`:
```html
<!doctype html><meta charset="utf-8"><title>Other page</title><h1>Not the exam</h1>
```

- [ ] **Step 3: Write the harness**

`tests/integration/harness.js`:
```js
import { createServer } from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SITE = path.join(import.meta.dirname, 'site');

export async function startSite() {
  const server = createServer(async (req, res) => {
    try {
      res.setHeader('content-type', 'text/html');
      res.end(await readFile(path.join(SITE, req.url.split('?')[0])));
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

export async function launch(config) {
  const profile = await mkdtemp(path.join(tmpdir(), 'exameye-profile-'));
  const downloads = await mkdtemp(path.join(tmpdir(), 'exameye-dl-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: false,
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = context.pages()[0] || await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });
  await worker.evaluate((cfg) => chrome.storage.local.set({ config: cfg }), config);
  return { context, worker, page, downloads, close: () => context.close() };
}

export const storage = (worker, keys) => worker.evaluate((k) => chrome.storage.local.get(k), keys);

export async function waitFor(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('waitFor timed out');
}
```

- [ ] **Step 4: Write the scenario test**

`tests/integration/session.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { startSite, launch, storage, waitFor } from './harness.js';
import { verify } from '../../src/core/hashchain.js';

test('arm on start page, record a tab switch, disarm on result, files on disk', async () => {
  const site = await startSite();
  const config = { startPrefix: `${site.origin}/exam/start.html`, examPrefix: '', resultPrefix: `${site.origin}/exam/result.html`, seat: 'T1', subfolder: 'ExamEyeTest', shotIntervalMin: 10, abandonMin: 10 };
  const b = await launch(config);
  try {
    await b.page.goto(`${site.origin}/exam/start.html?c=1`);
    await waitFor(async () => (await storage(b.worker, 'session')).session?.state === 'ARMED');
    const other = await b.context.newPage();
    await other.goto(`${site.origin}/other.html`);
    await other.bringToFront();
    await waitFor(async () => ((await storage(b.worker, 'events')).events || []).some(e => e.name === 'TAB_SWITCH'));
    await b.page.bringToFront();
    await b.page.evaluate(() => document.execCommand('copy'));
    await b.page.goto(`${site.origin}/exam/result.html`);
    await waitFor(async () => (await storage(b.worker, 'session')).session?.state === 'IDLE');
    await waitFor(async () => Object.keys((await storage(b.worker, 'pending')).pending || {}).length === 0);
    const [sessionDir] = await readdir(path.join(b.downloads, 'ExamEyeTest'));
    const dir = path.join(b.downloads, 'ExamEyeTest', sessionDir);
    const names = await readdir(dir);
    for (const f of ['log.txt', 'events.jsonl', 'summary.txt', 'summary.html', 'screenshots']) assert.ok(names.includes(f), f);
    const lines = (await readFile(path.join(dir, 'log.txt'), 'utf8')).trimEnd().split('\n');
    assert.deepEqual(await verify(lines), { ok: true, firstBad: -1 });
    const shots = await readdir(path.join(dir, 'screenshots'));
    assert.ok(shots.some(f => f.endsWith('_TAB_SWITCH.jpg')), shots.join(','));
    assert.match(await readFile(path.join(dir, 'summary.txt'), 'utf8'), /Outcome: RESULT/);
  } finally {
    await b.close();
    site.server.close();
  }
});
```

- [ ] **Step 5: Run the integration suite (foreground; it opens a Chromium window for ~20 s)**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && npm run test:integration`
Expected: `# pass 1`, `# fail 0`. If the assertion on `readdir(.../ExamEyeTest)` fails with ENOENT while `pending` is empty, the `Browser.setDownloadBehavior` override did not take (spec §14 risk 8): change the harness to locate files via `worker.evaluate(() => chrome.downloads.search({}))` and read each `item.filename` instead of assuming the folder; keep the same assertions on content.

- [ ] **Step 6: Commit (do not run unless authorised)**

```bash
git add package.json package-lock.json tests/integration/
git commit -m "test: Playwright integration harness with fake exam site"
```

---

### Task 23: Manual centre setup checklist

**Files:**
- Create: `docs/centre-setup.md`

**Interfaces:**
- Consumes: spec §3, §9, §11, §13.

- [ ] **Step 1: Write the checklist**

`docs/centre-setup.md`:
```markdown
# ExamEye - centre setup checklist

Do this once per machine. After step 6 the extension needs no clicks on browser start or exam start.

## 1. Install
- Chrome: `chrome://extensions` -> Developer mode -> Load unpacked -> select the ExamEye folder (or install from the Web Store listing when published).
- Edge: `edge://extensions` -> Developer mode -> Load unpacked (or Edge Add-ons listing).
- Managed fleet: push the extension id via the `ExtensionInstallForcelist` policy (same policy name on Chrome and Edge).

## 2. Allow in Incognito / InPrivate (one time)
- Chrome: `chrome://extensions` -> ExamEye -> Details -> "Allow in Incognito" ON.
- Edge: `edge://extensions` -> ExamEye -> Details -> "Allow in InPrivate" ON.
- Without this, incognito windows are invisible to ExamEye and INCOGNITO_WINDOW_OPENED is never recorded. Managed fleet: prefer `IncognitoModeAvailability = 1` (disabled) instead.

## 3. Downloads
- Browser Settings -> Downloads: "Ask where to save each file before downloading" OFF.
- Note the download location; ExamEye writes to `<Downloads>/<subfolder>/<sessionId>/`.
- Managed fleet: `DownloadDirectory` and `PromptForDownloadLocation = false` policies.

## 4. Configure (extension Options page)
| Field | Value |
|---|---|
| Exam start URL prefix | the URL every candidate lands on first, up to but excluding the per-candidate tail |
| Exam in-progress URL prefix | leave blank unless the paper runs on a different path/host than the start page |
| Result URL prefix | the URL shown when the paper is submitted |
| Seat / Centre ID | e.g. `C12-S07` |
| Output subfolder | `ExamEye` (default) |
| Screenshot interval | 10 minutes (default) |
| Abandon after | 10 minutes (default) |
Click Save. The status line must read `Saved.`; any red text names a field to fix.

## 5. Tab sleeping
- Chrome: Settings -> Performance -> Memory Saver: add the exam site to "Always keep these sites active".
- Edge: Settings -> System and performance -> "Never put these sites to sleep": add the exam site.

## 6. Dry run (5 minutes)
1. Open the exam start URL in a new tab. Click the ExamEye toolbar icon: State must show `ARMED` and a session id.
2. Open a second tab to any site, then return. Popup counters must show `TAB_SWITCH: 1`.
3. Minimise and restore the window. Counters must show `WINDOW_MINIMIZED: 1`.
4. Navigate the exam tab to the result URL. State returns to `IDLE`.
5. Check `<Downloads>/ExamEye/<sessionId>/` contains `log.txt`, `events.jsonl`, `summary.txt`, `summary.html`, `screenshots/` with at least 3 JPEGs. Open `summary.html` and confirm the screenshots display.
6. The download shelf/flyout must not have shown any ExamEye files. If it did on Edge, that build lacks `downloads.setUiOptions`; recording is unaffected.

## 7. Unmanaged machines - what is and is not enforced
- Nothing prevents a candidate from disabling the extension. A re-enable shows up as EXTENSION_GAP; a session with missing files is itself evidence.
- ExamEye only records "focus left Chrome"; it does not name other applications and takes no desktop screenshots.
```

- [ ] **Step 2: Verify the file renders and the suite is still green**

Run: `cd /Users/pawank/DiskAlpha/Development/exameye && test -s docs/centre-setup.md && npm test`
Expected: exit 0 and `# fail 0`.

- [ ] **Step 3: Commit (do not run unless authorised)**

```bash
git add docs/centre-setup.md
git commit -m "docs: centre setup checklist"
```

---

## Self-review (done while writing; kept for the executor)

- **Spec coverage:** §2 architecture → Tasks 12–17; §3 config → Task 3/16; §4 state machine incl. gap rule and END → Tasks 8, 9, 13, 21; §5 catalogue → Tasks 7, 9, 14, 15; §6 screenshots → Task 14; §7 persistence → Tasks 10, 12, 18, 21; §8 formats → Tasks 6, 19, 20, 21; §9 manifest/registration → Tasks 1, 12; §10 alarms → Tasks 13, 14; §11 Edge → Task 12 (`suppressUi` try/catch) and Task 23; §12 testing → every task plus Task 22; §13/§14 → Task 23 and the harness fallback note.
- **Type consistency:** `reduce(session, input, cfg)` returns `{session, events, effects}` everywhere; `END` effect carries `{outcome, session}`; `takeShots` returns `[{file, b64}]` consumed as `added`; `pending` is `{[path]: {mime, b64}}`; `integrity` is `{ok, firstBad, lines}` in both renderers; `meta.lastSeenAt` (not `lastTickAt`) in sw and spec.
- **Placeholder scan:** no TBD/TODO; every step has code and an exact command.



---

## Addendum A — screensaver / lock attribution (owner requirement added 2026-09-12 during execution)

Spec §5a is the authority. Affects Task 11 (counters), Task 17 (popup), Task 19 (summary.txt), Task 20 (summary.html), Task 23 (centre-setup dry-run step). No reducer, log-format, or SW change.

**Task 11 additions** — `tally(events)` also returns:
- `counts.SCREENSAVER`: number of `IDLE_START` events with `data.state === 'locked'` (in addition to the normal `IDLE_START` count).
- `attribution: { screensaver: n, idle: n, user: n }` over `FOCUS_LEFT_CHROME` events, classified per spec §5a (window `[t0 - 3000, t1]`, `t1` = matching `FOCUS_RETURNED` time or the last event's time if none).
- `durations.focusLeftMs` counts **user-attributed** intervals only; `durations.screensaverMs` = sum of `idleMs` of `IDLE_END` events whose matching `IDLE_START` had `state:'locked'`; `durations.idleMs` = the same for `state:'idle'`. Empty input: `durations` gains `screensaverMs: 0`, `attribution: { screensaver: 0, idle: 0, user: 0 }`, `counts` unchanged.
- Tests to add (TDD): (1) focus lost at T, `IDLE_START{locked}` at T+800, `IDLE_END{idleMs}` , `FOCUS_RETURNED` → attribution.screensaver 1, focusLeftMs 0, screensaverMs = idleMs, counts.SCREENSAVER 1; (2) `IDLE_START{locked}` 2 s **before** focus loss → still screensaver; (3) `IDLE_START{idle}` inside the window → idle; (4) no idle event → user, focusLeftMs counted; (5) the existing Task 11 test's expectations updated for the new keys only.

**Task 19 / 20** — summary.txt "Time away" block and summary.html time-away table use the exact lines shown in spec §8 (Focus left annotated with the screensaver/idle counts; new "Screensaver/lock" row). Counts block lists `SCREENSAVER` like any other count.

**Task 17** — popup shows `SCREENSAVER` in the counters list (no special UI).

**Task 23** — dry-run step: trigger the real screensaver (hot corner or idle timeout), resume, and confirm the popup shows SCREENSAVER 1 and the log has `IDLE_START state=locked`; if the platform never reports `locked`, note that the `idle` fallback classification applies.
