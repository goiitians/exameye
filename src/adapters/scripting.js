import { prefixToMatchPattern } from '../core/urlmatch.js';

export async function registerExamScript(cfg) {
  const matches = [...new Set([prefixToMatchPattern(cfg.startPrefix), prefixToMatchPattern(cfg.examPrefix)])];
  await chrome.scripting.unregisterContentScripts({ ids: ['exam'] }).catch(() => { /* first registration: nothing to remove */ });
  await chrome.scripting.registerContentScripts([{ id: 'exam', js: ['src/content.js'], matches, runAt: 'document_start', allFrames: false, persistAcrossSessions: true }]);
}
