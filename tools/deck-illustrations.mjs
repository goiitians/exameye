// Renders the drawn illustrations for docs/deck (things Chrome will not let us screenshot: the
// toolbar badge, its own share dialog) and a small icon set, as PNGs under docs/deck/img.
// Run: node tools/deck-illustrations.mjs
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'docs/deck/img');
await mkdir(path.join(OUT, 'icons'), { recursive: true });
const icon32 = 'data:image/png;base64,' + (await readFile(path.join(ROOT, 'icons/icon128.png'))).toString('base64');
const popup = 'data:image/png;base64,' + (await readFile(path.join(OUT, 'popup-armed.png'))).toString('base64');

const CSS = `
  * { box-sizing: border-box; } body { margin: 0; background: #fff; font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #0b0b0b; }
  .toolbar { width: 760px; background: #f1f3f4; border: 1px solid #dadce0; border-radius: 12px 12px 0 0; padding: 10px 12px; display: flex; align-items: center; gap: 10px; }
  .nav { color: #5f6368; font-size: 18px; letter-spacing: 6px; }
  .omni { flex: 1; background: #fff; border-radius: 20px; padding: 7px 14px; color: #3c4043; }
  .ext { position: relative; width: 28px; height: 28px; }
  .ext img { width: 28px; height: 28px; border-radius: 6px; }
  .badge { position: absolute; right: -8px; bottom: -4px; background: #d03b3b; color: #fff; font-size: 11px; font-weight: 700; padding: 1px 5px; border-radius: 8px; border: 2px solid #f1f3f4; }
  .page { width: 760px; height: 60px; background: #fff; border: 1px solid #dadce0; border-top: 0; }
  .callout { position: absolute; background: #0f2a4a; color: #fff; padding: 8px 12px; border-radius: 8px; font-weight: 600; }
  .callout::after { content: ""; position: absolute; top: -8px; right: 24px; border: 8px solid transparent; border-top: 0; border-bottom-color: #0f2a4a; }
  .dialog { width: 640px; background: #fff; border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,.25); padding: 20px 24px; }
  .dialog h3 { margin: 0 0 4px; font-size: 18px; } .dialog p { margin: 0 0 14px; color: #5f6368; }
  .tabs { display: flex; gap: 24px; border-bottom: 1px solid #dadce0; margin-bottom: 14px; }
  .tabs span { padding: 8px 2px; color: #5f6368; } .tabs .on { color: #1a73e8; border-bottom: 2px solid #1a73e8; font-weight: 600; }
  .preview { width: 300px; height: 170px; margin: 0 auto 8px; border: 3px solid #1a73e8; border-radius: 6px; background: linear-gradient(#0f2a4a 0 26px, #eef1f5 26px); position: relative; }
  .preview::after { content: "Exam paper"; position: absolute; left: 14px; top: 40px; color: #52514e; }
  .cap { text-align: center; color: #5f6368; margin-bottom: 16px; }
  .btns { display: flex; justify-content: flex-end; gap: 10px; }
  .btn { padding: 8px 18px; border-radius: 6px; border: 1px solid #dadce0; color: #1a73e8; font-weight: 600; }
  .btn.p { background: #1a73e8; color: #fff; border-color: #1a73e8; }
  .popupwrap { position: relative; width: 760px; }
  .popupwrap img.pop { position: absolute; right: 8px; top: 52px; width: 344px; border: 1px solid #dadce0; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.2); }
  .icon { width: 256px; height: 256px; display: grid; place-items: center; border-radius: 48px; }
  .icon svg { width: 150px; height: 150px; fill: none; stroke: #fff; stroke-width: 12; stroke-linecap: round; stroke-linejoin: round; }
`;

const ICONS = {
  eye: '<path d="M20 128s40-64 108-64 108 64 108 64-40 64-108 64S20 128 20 128z"/><circle cx="128" cy="128" r="30"/>',
  camera: '<rect x="28" y="72" width="200" height="130" rx="18"/><path d="M92 72l16-28h40l16 28"/><circle cx="128" cy="137" r="34"/>',
  folder: '<path d="M28 72h64l24 24h112v104H28z"/>',
  tabs: '<rect x="28" y="60" width="200" height="140" rx="12"/><path d="M28 100h200M76 60v40M132 60v40"/>',
  clipboard: '<rect x="56" y="48" width="144" height="180" rx="14"/><rect x="96" y="32" width="64" height="32" rx="8"/><path d="M88 120h80M88 160h56"/>',
  lock: '<rect x="56" y="112" width="144" height="112" rx="14"/><path d="M84 112V80a44 44 0 0 1 88 0v32"/>',
  clock: '<circle cx="128" cy="128" r="90"/><path d="M128 72v60l40 24"/>',
  monitor: '<rect x="24" y="52" width="208" height="128" rx="12"/><path d="M96 220h64M128 180v40"/>',
  warning: '<path d="M128 36 232 220H24z"/><path d="M128 104v56M128 188v4"/>',
  check: '<circle cx="128" cy="128" r="92"/><path d="M80 132l32 32 64-72"/>',
  download: '<path d="M128 40v120M80 112l48 48 48-48M44 200h168"/>',
  gear: '<circle cx="128" cy="128" r="34"/><path d="M128 28v30M128 198v30M28 128h30M198 128h30M57 57l21 21M178 178l21 21M57 199l21-21M178 78l21-21"/>',
  flag: '<path d="M64 232V36M64 44h132l-28 40 28 40H64"/>',
  play: '<circle cx="128" cy="128" r="92"/><path d="M104 88l64 40-64 40z"/>',
  stop: '<circle cx="128" cy="128" r="92"/><rect x="96" y="96" width="64" height="64" rx="8"/>',
  doc: '<path d="M64 32h88l48 48v144H64z"/><path d="M152 32v48h48M92 140h72M92 176h48"/>',
  user: '<circle cx="128" cy="92" r="44"/><path d="M40 224c8-52 44-76 88-76s80 24 88 76"/>',
  shield: '<path d="M128 28l84 32v64c0 52-36 88-84 104-48-16-84-52-84-104V60z"/><path d="M92 128l24 24 48-48"/>',
};
const COLORS = { navy: '#0f2a4a', blue: '#2f63c9', red: '#d03b3b', green: '#0ca30c', amber: '#c98a12' };

const scenes = {
  'toolbar-badge': `
    <div class="toolbar"><span class="nav">&#8592;&#8594;&#8635;</span><div class="omni">exam.example.com/paper/section-2</div>
      <div class="ext"><img src="${icon32}"><span class="badge">3</span></div></div>
    <div class="page"></div>
    <div class="callout" style="right:0;top:60px">Red number = flagged events so far</div>`,
  'share-dialog': `
    <div class="dialog"><h3>Choose what to share</h3><p>Chrome will share the contents of your screen with ExamEye.</p>
      <div class="tabs"><span>Chrome Tab</span><span>Window</span><span class="on">Entire Screen</span></div>
      <div class="preview"></div><div class="cap">1. Click the screen preview &nbsp; 2. Click Share</div>
      <div class="btns"><span class="btn">Cancel</span><span class="btn p">Share</span></div></div>`,
  'popup-anchored': `
    <div class="popupwrap"><div class="toolbar"><span class="nav">&#8592;&#8594;&#8635;</span><div class="omni">exam.example.com/paper/section-2</div>
      <div class="ext"><img src="${icon32}"><span class="badge">6</span></div></div>
    <div class="page" style="height:470px"></div><img class="pop" src="${popup}"></div>`,
};

const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage({ deviceScaleFactor: 2 });
for (const [name, html] of Object.entries(scenes)) {
  await page.setContent(`<style>${CSS}</style><div id="s" style="display:inline-block;padding:16px;position:relative">${html}</div>`);
  await page.locator('#s').screenshot({ path: path.join(OUT, `${name}.png`), omitBackground: false });
}
for (const [name, svg] of Object.entries(ICONS)) {
  for (const [cname, color] of Object.entries(COLORS)) {
    await page.setContent(`<style>${CSS}</style><div id="s" class="icon" style="background:${color}"><svg viewBox="0 0 256 256">${svg}</svg></div>`);
    await page.locator('#s').screenshot({ path: path.join(OUT, 'icons', `${name}-${cname}.png`), omitBackground: true });
  }
}
await browser.close();
console.log('illustrations and icons written to', OUT);
