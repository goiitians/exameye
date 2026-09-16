(() => {
  // extension reload while this page is still open invalidates chrome.runtime, sync or in the callback
  const send = (name, data) => {
    try {
      chrome.runtime.sendMessage({ type: 'cs', name, data }, () => {
        try { void chrome.runtime.lastError; } catch (e) {}
      });
    } catch (e) {}
  };
  const clip = (name) => (e) => send(name, { len: name === 'PASTE' ? (e.clipboardData?.getData('text') || '').length : String(getSelection() || '').length });
  document.addEventListener('copy', clip('COPY'), true);
  document.addEventListener('cut', clip('CUT'), true);
  document.addEventListener('paste', clip('PASTE'), true);
  document.addEventListener('contextmenu', (e) => send('CONTEXTMENU', { tag: e.target?.tagName || '' }), true);
  // drop fires on an in-page target before the source's dragend; a drag that leaves the page (or is cancelled) ends without one
  let drag = null;
  document.addEventListener('dragstart', (e) => { drag = { len: String(getSelection() || '').length, tag: e.target?.tagName || '' }; }, true);
  document.addEventListener('drop', () => { drag = null; }, true);
  document.addEventListener('dragend', () => { if (drag) send('DRAG', drag); drag = null; }, true);
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

  const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  const parseList = (csv) => String(csv ?? '').split(',').map(norm).filter(Boolean);
  let startLabel = '', endLabels = [], marker = '', markerSent = false;
  const applyConfig = (cfg) => {
    startLabel = norm(cfg?.startButton);
    endLabels = parseList(cfg?.endButton);
    marker = norm(cfg?.endMarker);
    markerSent = false;
    scheduleChange();
  };
  chrome.storage.local.get('config').then(({ config }) => applyConfig(config));
  chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.config) applyConfig(c.config.newValue); });

  document.addEventListener('click', (e) => {
    const control = e.target.closest('button, a, input[type=submit], input[type=button], [role=button]');
    if (!control) return;
    const label = norm(control.innerText || control.value || control.getAttribute?.('aria-label') || '');
    if (!label) return;
    if (startLabel && label === startLabel) send('START_CLICK', { label });
    else if (endLabels.includes(label)) send('END_CLICK', { label });
  }, true);

  const MAX_WAIT_MS = 5000;
  let changeTimer = null, firstPendingAt = null;
  function runChange() {
    changeTimer = null; firstPendingAt = null;
    send('SCREEN_CHANGED', {});
    if (marker && !markerSent && norm(document.body?.innerText).includes(marker)) {
      send('END_MARKER', { marker });
      markerSent = true;
    }
  }
  // trailing debounce with a ceiling: a page clock ticking every second would otherwise reset the timer forever
  function scheduleChange() {
    const at = Date.now();
    if (firstPendingAt === null) firstPendingAt = at;
    clearTimeout(changeTimer);
    changeTimer = setTimeout(runChange, Math.max(0, Math.min(1000, firstPendingAt + MAX_WAIT_MS - at)));
  }
  new MutationObserver(scheduleChange).observe(document.documentElement, { childList: true, characterData: true, subtree: true });
})();
