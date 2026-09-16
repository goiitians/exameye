import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_DESKTOP, shouldPrompt, onHolder, describeDesktop } from '../../src/core/desktop.js';

const T0 = 1789530302117;

test('shouldPrompt: off/stopped/error yes, prompting/on no', () => {
  const at = T0;
  assert.equal(shouldPrompt({ ...EMPTY_DESKTOP, state: 'off' }, { at, repromptMin: 5 }), true);
  assert.equal(shouldPrompt({ ...EMPTY_DESKTOP, state: 'stopped' }, { at, repromptMin: 5 }), true);
  assert.equal(shouldPrompt({ ...EMPTY_DESKTOP, state: 'error' }, { at, repromptMin: 5 }), true);
  assert.equal(shouldPrompt({ ...EMPTY_DESKTOP, state: 'prompting' }, { at, repromptMin: 5 }), false);
  assert.equal(shouldPrompt({ ...EMPTY_DESKTOP, state: 'on' }, { at, repromptMin: 5 }), false);
  assert.equal(shouldPrompt(undefined, { at, repromptMin: 5 }), true);
});

test('declined re-asks only after the interval and only when repromptMin > 0', () => {
  const declined = { ...EMPTY_DESKTOP, state: 'declined', at: T0 };
  assert.equal(shouldPrompt(declined, { at: T0 + 4 * 60000, repromptMin: 5 }), false);
  assert.equal(shouldPrompt(declined, { at: T0 + 5 * 60000, repromptMin: 5 }), true);
  assert.equal(shouldPrompt(declined, { at: T0 + 600000, repromptMin: 0 }), false);
});

test('started → on with MINIMIZE and alarm clear', () => {
  const prompting = { ...EMPTY_DESKTOP, state: 'prompting', at: T0, asks: 1 };
  const r = onHolder(prompting, { name: 'started', width: 1920, height: 1080, pickMs: 400 }, { at: T0 + 1000, repromptMin: 5 });
  assert.equal(r.desktop.state, 'on');
  assert.equal(r.desktop.since, T0 + 1000);
  assert.equal(r.desktop.at, T0 + 1000);
  assert.equal(r.desktop.error, null);
  assert.equal(r.desktop.nextAskAt, null);
  assert.equal(r.desktop.width, 1920);
  assert.equal(r.desktop.height, 1080);
  assert.deepEqual(r.input, { kind: 'DESKTOP', name: 'STARTED', data: { width: 1920, height: 1080, pickMs: 400, screens: null }, at: T0 + 1000 });
  assert.deepEqual(r.effects, [{ type: 'MINIMIZE' }, { type: 'ASK_ALARM_CLEAR' }]);
});

test('cancelled → declined with the alarm when repromptMin > 0', () => {
  const prompting = { ...EMPTY_DESKTOP, state: 'prompting', at: T0, asks: 2 };
  const r = onHolder(prompting, { name: 'cancelled', pickMs: 300 }, { at: T0 + 1000, repromptMin: 5 });
  assert.equal(r.desktop.state, 'declined');
  assert.equal(r.desktop.nextAskAt, T0 + 1000 + 300000);
  assert.deepEqual(r.input, { kind: 'DESKTOP', name: 'DECLINED', data: { asks: 2 }, at: T0 + 1000 });
  assert.deepEqual(r.effects, [{ type: 'ASK_ALARM_SET', when: T0 + 1000 + 300000 }]);

  const r2 = onHolder(prompting, { name: 'cancelled', pickMs: 300 }, { at: T0 + 1000, repromptMin: 0 });
  assert.equal(r2.desktop.nextAskAt, null);
  assert.deepEqual(r2.effects, []);
});

test('failed → error', () => {
  const prompting = { ...EMPTY_DESKTOP, state: 'prompting', at: T0, asks: 1 };
  const r = onHolder(prompting, { name: 'failed', error: 'NotAllowedError' }, { at: T0 + 1000, repromptMin: 5 });
  assert.equal(r.desktop.state, 'error');
  assert.equal(r.desktop.error, 'NotAllowedError');
  assert.deepEqual(r.input, { kind: 'DESKTOP', name: 'FAILED', data: { error: 'NotAllowedError' }, at: T0 + 1000 });
  assert.deepEqual(r.effects, [{ type: 'ASK_ALARM_SET', when: T0 + 1000 + 300000 }]);
});

test('ended → stopped with REASK', () => {
  const on = { ...EMPTY_DESKTOP, state: 'on', at: T0, since: T0 };
  const r = onHolder(on, { name: 'ended' }, { at: T0 + 2000, repromptMin: 5 });
  assert.equal(r.desktop.state, 'stopped');
  assert.equal(r.desktop.since, null);
  assert.deepEqual(r.input, { kind: 'DESKTOP', name: 'STOPPED', data: { reason: 'stop-sharing' }, at: T0 + 2000 });
  assert.deepEqual(r.effects, [{ type: 'REASK' }]);
});

test('closed while on / while prompting / after SW close', () => {
  const on = { ...EMPTY_DESKTOP, state: 'on', at: T0, since: T0, holderWindowId: 7, asks: 1 };
  const r1 = onHolder(on, { name: 'closed' }, { at: T0 + 500, repromptMin: 5 });
  assert.equal(r1.desktop.state, 'stopped');
  assert.equal(r1.desktop.holderWindowId, null);
  assert.deepEqual(r1.input, { kind: 'DESKTOP', name: 'STOPPED', data: { reason: 'window-closed' }, at: T0 + 500 });
  assert.deepEqual(r1.effects, [{ type: 'REASK' }]);

  const prompting = { ...EMPTY_DESKTOP, state: 'prompting', at: T0, holderWindowId: 7, asks: 1 };
  const r2 = onHolder(prompting, { name: 'closed' }, { at: T0 + 500, repromptMin: 5 });
  assert.equal(r2.desktop.state, 'declined');
  assert.equal(r2.desktop.holderWindowId, null);
  assert.deepEqual(r2.input, { kind: 'DESKTOP', name: 'DECLINED', data: { asks: 1 }, at: T0 + 500 });

  const off = { ...EMPTY_DESKTOP, state: 'off', holderWindowId: null };
  const r3 = onHolder(off, { name: 'closed' }, { at: T0 + 500, repromptMin: 5 });
  assert.equal(r3.desktop.state, 'off');
  assert.equal(r3.input, null);
  assert.deepEqual(r3.effects, []);
});

test('dead only matters while on', () => {
  const on = { ...EMPTY_DESKTOP, state: 'on', at: T0, since: T0 };
  const r1 = onHolder(on, { name: 'dead', error: 'no answer' }, { at: T0 + 500, repromptMin: 5 });
  assert.equal(r1.desktop.state, 'stopped');
  assert.deepEqual(r1.input, { kind: 'DESKTOP', name: 'STOPPED', data: { reason: 'error', error: 'no answer' }, at: T0 + 500 });
  assert.deepEqual(r1.effects, [{ type: 'REASK' }]);

  const declined = { ...EMPTY_DESKTOP, state: 'declined', at: T0 };
  const r2 = onHolder(declined, { name: 'dead', error: 'no answer' }, { at: T0 + 500, repromptMin: 5 });
  assert.equal(r2.desktop, declined);
  assert.equal(r2.input, null);
  assert.deepEqual(r2.effects, []);
});

test('describeDesktop renders every state', () => {
  assert.equal(describeDesktop({ ...EMPTY_DESKTOP, state: 'on', since: T0 }, 3), `on since ${new Date(T0).toTimeString().slice(0, 8)} (3 frames)`);
  assert.equal(describeDesktop({ ...EMPTY_DESKTOP, state: 'prompting' }, 0), 'asking…');
  assert.equal(describeDesktop({ ...EMPTY_DESKTOP, state: 'declined', asks: 2, nextAskAt: T0 }, 0), `off — declined 2x, next ask ${new Date(T0).toTimeString().slice(0, 8)}`);
  assert.equal(describeDesktop({ ...EMPTY_DESKTOP, state: 'declined', asks: 2, nextAskAt: null }, 0), 'off — declined 2x');
  assert.equal(describeDesktop({ ...EMPTY_DESKTOP, state: 'stopped', at: T0 }, 0), `stopped at ${new Date(T0).toTimeString().slice(0, 8)}`);
  assert.equal(describeDesktop({ ...EMPTY_DESKTOP, state: 'error', error: 'NotAllowedError' }, 0), 'error: NotAllowedError');
  assert.equal(describeDesktop({ ...EMPTY_DESKTOP, state: 'off' }, 0), 'off');
});

test('closed clears holderTabId as well as holderWindowId', () => {
  const on = { ...EMPTY_DESKTOP, state: 'on', at: T0, since: T0, holderWindowId: 7, holderTabId: 9, asks: 1 };
  const r = onHolder(on, { name: 'closed' }, { at: T0 + 1, repromptMin: 5 });
  assert.equal(r.desktop.holderWindowId, null);
  assert.equal(r.desktop.holderTabId, null);
  assert.equal(EMPTY_DESKTOP.holderTabId, null);
});

test('onHolder does not mutate its input', () => {
  const on = { ...EMPTY_DESKTOP, state: 'on', at: T0, since: T0 };
  const before = structuredClone(on);
  onHolder(on, { name: 'ended' }, { at: T0 + 1000, repromptMin: 5 });
  assert.deepEqual(on, before);
});

test('started copies screens into the desktop state and the input; EMPTY_DESKTOP.screens is null', () => {
  const r = onHolder(EMPTY_DESKTOP, { name: 'started', width: 1, height: 1, pickMs: 5, screens: 2 }, { at: T0, repromptMin: 5 });
  assert.equal(r.desktop.screens, 2);
  assert.equal(r.input.data.screens, 2);
  assert.equal(EMPTY_DESKTOP.screens, null);
  assert.equal(onHolder(EMPTY_DESKTOP, { name: 'started', width: 1, height: 1, pickMs: 5 }, { at: T0, repromptMin: 5 }).desktop.screens, null);
});
