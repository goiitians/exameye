const v = document.getElementById('v');
const c = document.getElementById('c');

let stream = null;
let awayInterval = null;

const send = (m) => chrome.runtime.sendMessage({ type: 'desktop', ...m }).catch(() => null);

function grab() {
  if (!stream || !v.videoWidth || !v.videoHeight) return null;
  const scale = Math.min(1, 1280 / v.videoWidth);
  c.width = v.videoWidth * scale;
  c.height = v.videoHeight * scale;
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.5).slice('data:image/jpeg;base64,'.length);
}

function setAway(on) {
  if (awayInterval) { clearInterval(awayInterval); awayInterval = null; }
  if (on && stream) {
    awayInterval = setInterval(() => {
      const b64 = grab();
      if (b64) send({ name: 'frame', b64 });
    }, 10000);
  }
}

function stopStream() {
  if (stream) for (const t of stream.getTracks()) t.stop();
  stream = null;
  setAway(false);
}

function ask() {
  stopStream();
  const t0 = Date.now();
  chrome.desktopCapture.chooseDesktopMedia(['screen'], (streamId) => {
    const pickMs = Date.now() - t0;
    if (!streamId) { send({ name: 'cancelled', pickMs }); return; }
    navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: streamId, maxFrameRate: 2 } },
    }).then(async (s) => {
      stream = s;
      v.srcObject = s;
      await new Promise((resolve) => { v.onloadedmetadata = resolve; });
      const [track] = s.getVideoTracks();
      track.addEventListener('ended', () => { stream = null; setAway(false); send({ name: 'ended' }); });
      send({ name: 'started', width: v.videoWidth, height: v.videoHeight, pickMs });
    }).catch((e) => {
      send({ name: 'failed', error: String(e?.message || e), pickMs });
    });
  });
}

send({ name: 'ready' }).then((r) => {
  if (r?.close) window.close();
  else if (r?.ask) ask();
});

chrome.runtime.onMessage.addListener((m, sender, respond) => {
  if (m?.type !== 'holder') return;
  if (m.name === 'grab') { respond({ b64: grab(), alive: Boolean(stream) }); return; }
  if (m.name === 'away') { setAway(m.on); return; }
  if (m.name === 'ask') { ask(); return; }
});
