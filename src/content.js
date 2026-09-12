(() => {
  const send = (name, data) => {
    try {
      chrome.runtime.sendMessage({ type: 'cs', name, data }, () => chrome.runtime.lastError);
    } catch (e) {}
  };
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
