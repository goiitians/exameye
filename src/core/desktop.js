import { fmtLocal } from './ids.js';

export const EMPTY_DESKTOP = Object.freeze({
  state: 'off', at: 0, since: null, holderWindowId: null, holderTabId: null, asks: 0,
  width: null, height: null, error: null, nextAskAt: null, screens: null,
});

export function shouldPrompt(desktop, { at, repromptSec }) {
  const d = desktop || EMPTY_DESKTOP;
  if (d.state === 'prompting' || d.state === 'on') return false;
  if (d.state === 'declined') return repromptSec > 0 && at - d.at >= repromptSec * 1000;
  return d.state === 'off' || d.state === 'stopped' || d.state === 'error';
}

function decline(d, name, at, repromptSec, extra = {}) {
  const nextAskAt = repromptSec > 0 ? at + repromptSec * 1000 : null;
  const data = name === 'FAILED' ? { error: extra.error } : { asks: d.asks };
  return {
    desktop: { ...d, state: name === 'FAILED' ? 'error' : 'declined', at, nextAskAt, ...extra },
    input: { kind: 'DESKTOP', name, data, at },
    effects: nextAskAt !== null ? [{ type: 'ASK_ALARM_SET', when: nextAskAt }] : [],
  };
}

export function onHolder(desktop, msg, { at, repromptSec }) {
  const d = desktop || EMPTY_DESKTOP;
  if (msg.name === 'started') {
    const screens = msg.screens ?? null;
    return {
      desktop: { ...d, state: 'on', at, since: at, error: null, nextAskAt: null, width: msg.width, height: msg.height, screens },
      input: { kind: 'DESKTOP', name: 'STARTED', data: { width: msg.width, height: msg.height, pickMs: msg.pickMs, screens }, at },
      effects: [{ type: 'MINIMIZE' }, { type: 'ASK_ALARM_CLEAR' }],
    };
  }
  if (msg.name === 'cancelled') return decline(d, 'DECLINED', at, repromptSec);
  if (msg.name === 'failed') return decline(d, 'FAILED', at, repromptSec, { error: msg.error });
  if (msg.name === 'ended') {
    return {
      desktop: { ...d, state: 'stopped', at, since: null },
      input: { kind: 'DESKTOP', name: 'STOPPED', data: { reason: 'stop-sharing' }, at },
      effects: [{ type: 'REASK' }],
    };
  }
  if (msg.name === 'closed') {
    if (d.state === 'on') {
      return {
        desktop: { ...d, state: 'stopped', at, since: null, holderWindowId: null, holderTabId: null },
        input: { kind: 'DESKTOP', name: 'STOPPED', data: { reason: 'window-closed' }, at },
        effects: [{ type: 'REASK' }],
      };
    }
    if (d.state === 'prompting') {
      const r = decline(d, 'DECLINED', at, repromptSec);
      return { ...r, desktop: { ...r.desktop, holderWindowId: null, holderTabId: null } };
    }
    return { desktop: { ...d, holderWindowId: null, holderTabId: null, at }, input: null, effects: [] };
  }
  if (msg.name === 'dead') {
    if (d.state === 'on') {
      return {
        desktop: { ...d, state: 'stopped', at, since: null },
        input: { kind: 'DESKTOP', name: 'STOPPED', data: { reason: 'error', error: msg.error }, at },
        effects: [{ type: 'REASK' }],
      };
    }
    return { desktop: d, input: null, effects: [] };
  }
  return { desktop: d, input: null, effects: [] };
}

export function describeDesktop(desktop, frames) {
  const d = desktop || EMPTY_DESKTOP;
  if (d.state === 'on') return `on since ${fmtLocal(d.since).slice(11)} (${frames} frames)`;
  if (d.state === 'prompting') return 'asking…';
  if (d.state === 'declined') {
    return d.nextAskAt != null
      ? `off — declined ${d.asks}x, next ask ${fmtLocal(d.nextAskAt).slice(11)}`
      : `off — declined ${d.asks}x`;
  }
  if (d.state === 'stopped') return `stopped at ${fmtLocal(d.at).slice(11)}`;
  if (d.state === 'error') return `error: ${d.error}`;
  return 'off';
}
