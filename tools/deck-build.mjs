// Builds docs/deck/ExamEye-overview.pptx from the screenshots in docs/deck/img.
// Run: node tools/deck-shots.mjs && node tools/deck-illustrations.mjs && node tools/deck-build.mjs
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pptxgen = require('pptxgenjs');

const ROOT = path.resolve(import.meta.dirname, '..');
const IMG = (f) => path.join(ROOT, 'docs/deck/img', f);
const ICON = (name, color = 'blue') => IMG(`icons/${name}-${color}.png`);

const NAVY = '0F2A4A', BLUE = '2F63C9', RED = 'D03B3B', GREEN = '0CA30C', AMBER = 'C98A12', INK = '0B0B0B', INK2 = '52514E', MUTED = '898781', LINE = 'E6E4DF', CARD = 'F6F5F2', WHITE = 'FFFFFF';
const FONT = 'Calibri';
const W = 10, H = 5.625, M = 0.5;

const sample = JSON.parse(readFileSync(path.join(ROOT, 'docs/deck/img/files.json'), 'utf8'));
const verifyLine = execFileSync('node', [path.join(ROOT, 'tools/verify.mjs'), path.join(ROOT, 'docs/deck/sample-session/ExamEye', sample.id)], { encoding: 'utf8' }).trim().replace(/^OK \S+\//, 'OK ').replace(': ', ':\n');
const pres = new pptxgen();
pres.layout = 'LAYOUT_16x9';
pres.author = 'ExamEye';
pres.title = 'ExamEye overview';

const text = (slide, t, o) => slide.addText(t, { fontFace: FONT, color: INK, isTextBox: true, margin: 0, valign: 'top', ...o });
const title = (slide, t, sub) => {
  text(slide, t, { x: M, y: 0.38, w: W - 2 * M, h: 0.6, fontSize: 28, bold: true, color: NAVY });
  if (sub) text(slide, sub, { x: M, y: 0.98, w: W - 2 * M, h: 0.4, fontSize: 14, color: INK2 });
};
const card = (slide, x, y, w, h, fill = CARD) => slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, fill: { color: fill }, line: { color: LINE, width: 0.75 }, rectRadius: 0.08 });
const framed = (slide, file, x, y, w, h) => {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, fill: { color: WHITE }, line: { color: LINE, width: 0.75 }, rectRadius: 0.06, shadow: { type: 'outer', blur: 6, offset: 2, angle: 90, color: '000000', opacity: 0.18 } });
  slide.addImage({ path: file, x: x + 0.06, y: y + 0.06, w: w - 0.12, h: h - 0.12, sizing: { type: 'contain', w: w - 0.12, h: h - 0.12 } });
};
const bullets = (slide, items, o) => text(slide, items.map((t, i) => ({ text: t, options: { bullet: { indent: 14 }, breakLine: i < items.length - 1, paraSpaceAfter: 6 } })), { fontSize: 14, ...o });
const iconRow = (slide, x, y, w, icon, head, body, color = 'blue') => {
  slide.addImage({ path: ICON(icon, color), x, y, w: 0.42, h: 0.42 });
  text(slide, head, { x: x + 0.55, y, w: w - 0.55, h: 0.26, fontSize: 14, bold: true, color: NAVY });
  text(slide, body, { x: x + 0.55, y: y + 0.26, w: w - 0.55, h: 0.6, fontSize: 11.5, color: INK2 });
};
const notes = (slide, t) => slide.addNotes(t);
const footer = (slide, n) => text(slide, `ExamEye  ·  ${n}`, { x: M, y: H - 0.35, w: 3, h: 0.25, fontSize: 9, color: MUTED });
let n = 0;
const slide = () => { const s = pres.addSlide(); s.background = { color: WHITE }; n += 1; if (n > 1) footer(s, n); return s; };

// 1 title
{
  const s = slide(); s.background = { color: NAVY };
  s.addImage({ path: ICON('eye', 'blue'), x: M, y: 1.2, w: 0.9, h: 0.9 });
  text(s, 'ExamEye', { x: M, y: 2.2, w: 8, h: 0.9, fontSize: 44, bold: true, color: WHITE });
  text(s, 'A silent witness for online exams', { x: M, y: 3.05, w: 8, h: 0.5, fontSize: 22, color: 'CADCFC' });
  text(s, 'What it does, how to set it up in five steps, and how to read what it records.\nFor exam-centre staff and invigilators. No technical background needed.', { x: M, y: 3.7, w: 8.5, h: 0.9, fontSize: 14, color: 'CADCFC' });
  notes(s, 'ExamEye is a small add-on for the Chrome browser. It watches what happens in the browser while a candidate sits an online paper and writes a record to a folder on the same machine. It never interferes with the paper.');
}

// 2 what it is / is not
{
  const s = slide();
  title(s, 'What ExamEye is', 'A recorder, not a gatekeeper. It writes down what happened; people decide what it means.');
  card(s, M, 1.55, 4.4, 3.5, 'EEF3FB');
  s.addImage({ path: ICON('check', 'green'), x: M + 0.2, y: 1.72, w: 0.4, h: 0.4 });
  text(s, 'It does', { x: M + 0.7, y: 1.76, w: 3, h: 0.35, fontSize: 18, bold: true, color: NAVY });
  bullets(s, [
    'Starts and stops on its own when the exam website opens and when the paper is submitted',
    'Writes one line for every notable event, with the time',
    'Takes a screenshot of the exam tab when something happens, and every few minutes',
    'Can photograph the whole screen while the candidate is away from Chrome',
    'Produces a readable report with screenshots at the end of every paper',
  ], { x: M + 0.2, y: 2.2, w: 4, h: 2.8, fontSize: 12.5 });
  card(s, 5.1, 1.55, 4.4, 3.5, 'FDF0F0');
  s.addImage({ path: ICON('stop', 'red'), x: 5.3, y: 1.72, w: 0.4, h: 0.4 });
  text(s, 'It never does', { x: 5.8, y: 1.76, w: 3, h: 0.35, fontSize: 18, bold: true, color: NAVY });
  bullets(s, [
    'Blocks a page, a key, or the candidate. Nothing is prevented, only recorded',
    'Reads or changes the candidate\u2019s answers',
    'Names other applications. It records that Chrome lost focus, not what was opened',
    'Sends anything anywhere. Every file stays on the exam machine',
    'Needs the candidate or the invigilator to click anything during the paper (except one screen-share prompt)',
  ], { x: 5.3, y: 2.2, w: 4, h: 2.8, fontSize: 12.5 });
  notes(s, 'The key message for staff: ExamEye cannot stop cheating and does not try to. It gives the centre an evidence trail. The one thing the candidate is asked to do is accept the screen-share prompt once.');
}

// 3 how it works
{
  const s = slide();
  title(s, 'How it works, in one picture', 'Everything happens automatically once the settings are saved.');
  const steps = [
    ['play', 'green', '1. Paper opens', 'The candidate lands on the exam start page.'],
    ['eye', 'blue', '2. Recording starts', 'ExamEye notices the address and arms itself.'],
    ['camera', 'blue', '3. Events and screenshots', 'Tab switches, copy, focus lost\u2026 each gets a log line and a picture.'],
    ['stop', 'navy', '4. Paper submitted', 'The submit button, a result page, or a phrase on screen ends it.'],
    ['folder', 'amber', '5. Folder written', 'Log, screenshots and a report land in the Downloads folder.'],
  ];
  const w = 1.72, gap = 0.1, y = 1.75;
  steps.forEach(([icon, color, head, body], i) => {
    const x = M + i * (w + gap);
    card(s, x, y, w, 2.9);
    s.addImage({ path: ICON(icon, color), x: x + (w - 0.7) / 2, y: y + 0.25, w: 0.7, h: 0.7 });
    text(s, head, { x: x + 0.12, y: y + 1.1, w: w - 0.24, h: 0.5, fontSize: 13, bold: true, color: NAVY, align: 'center' });
    text(s, body, { x: x + 0.12, y: y + 1.6, w: w - 0.24, h: 1.2, fontSize: 11, color: INK2, align: 'center' });
    if (i < steps.length - 1) text(s, '\u203A', { x: x + w - 0.02, y: y + 1.15, w: gap + 0.04, h: 0.5, fontSize: 22, color: MUTED, align: 'center' });
  });
  text(s, 'A paper that is never submitted still ends: after the maximum length you set, or once the exam tab has been gone for a while.', { x: M, y: 4.85, w: 9, h: 0.4, fontSize: 11.5, color: INK2, italic: true });
  notes(s, 'Walk through the five boxes left to right. Stress that no one has to start or stop anything.');
}

// 4 what gets recorded
{
  const s = slide();
  title(s, 'What gets recorded', 'Each of these becomes a line in the log and, in most cases, a screenshot.');
  const items = [
    ['tabs', 'Other tabs and pages', 'Switching to another tab, and which page it was'],
    ['monitor', 'Leaving Chrome', 'Another application in front, and for how long'],
    ['clipboard', 'Copy, cut, paste, print, drag', 'And the length of the text involved'],
    ['download', 'Downloads', 'Any file the candidate downloads'],
    ['warning', 'Window changes', 'Minimised, restored, fullscreen left'],
    ['lock', 'Screen lock or idle', 'The screensaver, the lock screen, long inactivity'],
    ['gear', 'Developer tools', 'The browser\u2019s inspection panel being opened'],
    ['flag', 'Settings changed mid-paper', 'Which fields, and a screenshot of that moment'],
    ['clock', 'Clock set back', 'The computer clock jumping backwards'],
    ['monitor', 'Second monitor', 'More than one screen attached'],
  ];
  const cols = 5, w = 1.76, h = 1.55, gx = 0.05, gy = 0.15;
  items.forEach(([icon, head, body], i) => {
    const x = M + (i % cols) * (w + gx), y = 1.6 + Math.floor(i / cols) * (h + gy);
    card(s, x, y, w, h);
    s.addImage({ path: ICON(icon, i >= 7 ? 'red' : 'blue'), x: x + 0.12, y: y + 0.12, w: 0.4, h: 0.4 });
    text(s, head, { x: x + 0.12, y: y + 0.58, w: w - 0.24, h: 0.42, fontSize: 12, bold: true, color: NAVY });
    text(s, body, { x: x + 0.12, y: y + 1.0, w: w - 0.24, h: 0.55, fontSize: 10.5, color: INK2 });
  });
  text(s, 'Plus a routine screenshot of the exam tab at a fixed interval (10 minutes by default), so a quiet paper still has pictures.', { x: M, y: 5.0, w: 9, h: 0.3, fontSize: 11.5, color: INK2, italic: true });
  notes(s, 'Red icons are the events treated as most serious in the report. The full list with severities is on the flags slide near the end.');
}

// 5 setup overview
{
  const s = slide();
  title(s, 'Setup: five steps, once per machine', 'About 20 minutes including the dry run. After that, nothing to click on exam day.');
  const steps = [
    ['download', 'Install', 'Load the ExamEye folder into Chrome'],
    ['lock', 'Allow in Incognito', 'So private windows are seen too'],
    ['folder', 'Downloads setting', 'Chrome must not ask where to save'],
    ['gear', 'Configure', 'Fill in the five sections and save'],
    ['check', 'Dry run', 'Ten minutes with a test paper'],
  ];
  steps.forEach(([icon, head, body], i) => {
    const x = M + i * 1.82, y = 1.8;
    s.addShape(pres.shapes.OVAL, { x: x + 0.55, y, w: 0.7, h: 0.7, fill: { color: NAVY }, line: { color: NAVY } });
    text(s, String(i + 1), { x: x + 0.55, y, w: 0.7, h: 0.7, fontSize: 22, bold: true, color: WHITE, align: 'center', valign: 'middle' });
    s.addImage({ path: ICON(icon, 'blue'), x: x + 0.65, y: y + 0.95, w: 0.5, h: 0.5 });
    text(s, head, { x, y: y + 1.55, w: 1.8, h: 0.35, fontSize: 14, bold: true, color: NAVY, align: 'center' });
    text(s, body, { x: x + 0.05, y: y + 1.9, w: 1.7, h: 0.8, fontSize: 11, color: INK2, align: 'center' });
  });
  card(s, M, 4.55, 9, 0.6, 'EEF3FB');
  text(s, 'Managed fleets: IT can push ExamEye and its settings by policy instead of steps 1 to 3. Ask before doing them by hand.', { x: M + 0.2, y: 4.67, w: 8.6, h: 0.4, fontSize: 12, color: NAVY });
  notes(s, 'The detailed checklist is docs/centre-setup.md in the ExamEye folder. The next slides show each step.');
}

// 6 install
{
  const s = slide();
  title(s, 'Step 1: Install', 'Chrome loads ExamEye from a folder on the machine.');
  bullets(s, [
    'Copy the ExamEye folder somewhere permanent, for example C:\\ExamEye. Moving or deleting it later switches the extension off.',
    'In Chrome, open chrome://extensions and switch Developer mode on (top right).',
    'Click Load unpacked and choose the ExamEye folder.',
    'ExamEye appears in the list with its toggle on. Leave Developer mode on: Chrome then shows no warning bubble at start-up.',
    'Microsoft Edge works the same way at edge://extensions.',
  ], { x: M, y: 1.6, w: 4.2, h: 3.5, fontSize: 12.5 });
  framed(s, IMG('chrome-extensions-devmode.png'), 4.95, 1.55, 4.55, 1.9);
  framed(s, IMG('chrome-extensions.png'), 4.95, 3.55, 4.55, 1.6);
  notes(s, 'If Chrome shows a "Disable developer mode extensions" bubble, click Cancel. Its Disable button would switch ExamEye off.');
}

// 7 incognito + downloads + macOS
{
  const s = slide();
  title(s, 'Steps 2 and 3: two Chrome settings', 'Both are one-time switches. Without them ExamEye works, but misses things.');
  const cards = [
    ['lock', 'Allow in Incognito', 'chrome://extensions \u2192 ExamEye \u2192 Details \u2192 Allow in Incognito: on.\n\nOtherwise a private window is invisible to ExamEye and an incognito window opened during the paper is never recorded.'],
    ['folder', 'Downloads: do not ask', 'Chrome Settings \u2192 Downloads \u2192 "Ask where to save each file before downloading": off.\n\nOtherwise every screenshot and log file would pop up a save dialog. Note the download location: that is where the recordings go.'],
    ['monitor', 'macOS only: screen recording', 'System Settings \u2192 Privacy & Security \u2192 Screen Recording \u2192 enable Chrome, then quit and reopen Chrome.\n\nWithout it, whole-screen pictures come out black and nothing warns you. Windows needs nothing here.'],
  ];
  cards.forEach(([icon, head, body], i) => {
    const x = M + i * 3.05, y = 1.6, w = 2.9, h = 3.5;
    card(s, x, y, w, h);
    s.addImage({ path: ICON(icon, i === 2 ? 'amber' : 'blue'), x: x + 0.2, y: y + 0.2, w: 0.5, h: 0.5 });
    text(s, head, { x: x + 0.2, y: y + 0.8, w: w - 0.4, h: 0.4, fontSize: 15, bold: true, color: NAVY });
    text(s, body, { x: x + 0.2, y: y + 1.25, w: w - 0.4, h: h - 1.4, fontSize: 11.5, color: INK2 });
  });
  notes(s, 'Also add the exam site to Chrome\u2019s "Always keep these sites active" list under Performance, so a sleeping tab does not look like the candidate left.');
}

// 8 configure
{
  const s = slide();
  title(s, 'Step 4: Configure', 'Right-click the ExamEye icon \u2192 Options. Five short sections, then Save.');
  framed(s, IMG('options-part1.png'), M, 1.5, 3.4, 3.75);
  const sections = [
    ['1', 'Exam website', 'The start page address, and the result page if there is one.'],
    ['2', 'How the paper starts and ends', 'The submit button text or a phrase from the "submitted" screen, plus the maximum length.'],
    ['3', 'This machine', 'A seat or centre ID for the file names, and the folder name.'],
    ['4', 'Recording', 'How often to take a routine screenshot; defaults are fine.'],
    ['5', 'Screen capture', 'Whole-screen pictures on or off, and how often to ask again if the candidate refuses.'],
  ];
  sections.forEach(([num, head, body], i) => {
    const y = 1.5 + i * 0.76;
    s.addShape(pres.shapes.OVAL, { x: 4.2, y: y + 0.02, w: 0.34, h: 0.34, fill: { color: BLUE }, line: { color: BLUE } });
    text(s, num, { x: 4.2, y: y + 0.02, w: 0.34, h: 0.34, fontSize: 12, bold: true, color: WHITE, align: 'center', valign: 'middle' });
    text(s, head, { x: 4.7, y, w: 4.8, h: 0.3, fontSize: 14, bold: true, color: NAVY });
    text(s, body, { x: 4.7, y: y + 0.3, w: 4.8, h: 0.45, fontSize: 11.5, color: INK2 });
  });
  text(s, 'Shown: sections 1 and 2. Every field has a one-line explanation under it; the values for a given exam platform are usually worked out once and copied to every machine.', { x: 4.2, y: 5.3 - 0.35, w: 5.3, h: 0.4, fontSize: 11, color: INK2, italic: true });
  notes(s, 'The exact values for the centre\u2019s exam platform are in the setup checklist table (docs/centre-setup.md, section 4).');
}

// 9 validation + recording banner
{
  const s = slide();
  title(s, 'Step 4: the page tells you what to fix', 'Nothing is saved until every problem is cleared.');
  framed(s, IMG('options-error.png'), M, 1.5, 5.2, 3.2);
  framed(s, IMG('options-recording.png'), M, 4.75 - 0.05, 5.2, 0.55);
  bullets(s, [
    'A problem is shown in red directly under the field it belongs to, in plain words.',
    'The Save bar counts the fields still to fix. The green "Saved." confirms the settings are stored.',
    'If a paper is being recorded on the machine, an orange notice appears at the top. Any change saved then is written into that paper\u2019s log with the names of the fields, and the folder for the paper in progress does not move.',
  ], { x: 6.0, y: 1.55, w: 3.5, h: 3.7, fontSize: 12.5 });
  notes(s, 'The orange banner exists so that a settings change during a paper can never be silent.');
}

// 10 dry run
{
  const s = slide();
  title(s, 'Step 5: Dry run', 'Ten minutes with a throw-away test login. Do it on the day, on every machine.');
  const checks = [
    ['Open the exam start page', 'The icon shows a red 0; the popup says ARMED with a session id.'],
    ['Open another tab, then come back', 'Popup counters show TAB_SWITCH: 1. The badge turns to 1.'],
    ['Minimise the window and restore it', 'Counters show WINDOW_MINIMIZED: 1.'],
    ['Lock the screen or wait for the screensaver, then unlock', 'Counters show SCREENSAVER: 1.'],
    ['Submit the test paper (or open the result page)', 'State returns to IDLE. The badge disappears.'],
    ['Look in Downloads \u2192 ExamEye', 'One folder with log.txt, summary.html and a screenshots folder.'],
  ];
  checks.forEach(([head, body], i) => {
    const y = 1.55 + i * 0.6;
    s.addImage({ path: ICON('check', 'green'), x: M, y: y + 0.02, w: 0.32, h: 0.32 });
    text(s, head, { x: M + 0.45, y, w: 4.6, h: 0.28, fontSize: 12.5, bold: true, color: NAVY });
    text(s, body, { x: M + 0.45, y: y + 0.27, w: 4.6, h: 0.3, fontSize: 11, color: INK2 });
  });
  framed(s, IMG('popup-anchored.png'), 5.7, 1.5, 3.8, 3.7);
  notes(s, 'If a check fails, the setup checklist names the usual cause for each. Screen capture, if on, adds a share prompt at step 1 (next slides).');
}

// 11 exam day
{
  const s = slide();
  title(s, 'On exam day: what you see', 'Nothing to start. Glance at the icon; click it for detail.');
  framed(s, IMG('toolbar-badge.png'), M, 1.5, 5.4, 1.5);
  framed(s, IMG('popup-armed.png'), M, 3.1, 2.3, 2.15);
  iconRow(s, 3.0, 3.2, 2.9, 'flag', 'Red badge = flagged events', 'Tab switches, other pages, copy, focus lost\u2026 counted live. 0 in red means recording with nothing flagged yet.', 'red');
  iconRow(s, 3.0, 4.3, 2.9, 'eye', 'State ARMED = recording', 'CLOSING means the paper was submitted and the last minutes are still being watched. IDLE means no paper is open.');
  iconRow(s, 6.3, 1.6, 3.2, 'doc', 'Session', 'The date, time and seat ID that name the output folder.');
  iconRow(s, 6.3, 2.7, 3.2, 'clock', 'Last flush', 'When files were last written to disk. It updates every 30 seconds while recording.');
  iconRow(s, 6.3, 3.8, 3.2, 'warning', 'Errors', 'Normally a dash. Anything else names the setting or the file that failed; the setup page opens from the link.', 'amber');
  notes(s, 'Invigilators do not need to open the popup at all. The badge alone shows that recording is on and whether anything was flagged.');
}

// 12 screen capture
{
  const s = slide();
  title(s, 'Screen capture: the one thing the candidate does', 'When the start page opens, Chrome asks once to share the screen.');
  framed(s, IMG('share-dialog.png'), M, 1.5, 4.6, 3.0);
  framed(s, IMG('holder.png'), M, 4.6, 4.6, 0.65);
  bullets(s, [
    'A small "ExamEye screen capture" window appears and Chrome shows its share dialog.',
    'The candidate clicks the screen preview, then Share. Chrome only enables Share after the preview is clicked.',
    'The small window minimises itself. It must stay open; closing it stops capture and is logged.',
    'Whole-screen pictures are then taken while Chrome is not the active window and at each routine screenshot.',
    'If the candidate cancels, that is logged and the question is asked again after five minutes (adjustable).',
    'With two screens, only the shared one is captured, and the paper is flagged MULTI_MONITOR.',
  ], { x: 5.4, y: 1.55, w: 4.1, h: 3.8, fontSize: 11.5 });
  notes(s, 'On macOS the pictures are black unless Chrome has the Screen Recording permission (step 3). Check one desktop frame during the dry run.');
}

// 13 what you get
{
  const s = slide();
  title(s, 'What you get: one folder per paper', 'Downloads \u2192 ExamEye \u2192 <date-time_seat>. Open summary.html in any browser.');
  card(s, M, 1.5, 3.9, 3.75);
  const tree = [
    ['folder', 'amber', '20260916-131011_C12-S07/', 'date, time and seat ID'],
    ['doc', 'blue', 'summary.html', 'the report: flags, timeline, every screenshot'],
    ['doc', 'blue', 'summary.txt', 'the same report as plain text'],
    ['doc', 'navy', 'log.txt', 'one line per event, each chained to the previous'],
    ['doc', 'navy', 'events.json', 'the same events for software to read'],
    ['camera', 'blue', 'screenshots/', 'exam-tab pictures, named by time and event'],
    ['camera', 'blue', 'screenshots/desktop/', 'whole-screen pictures, when capture is on'],
  ];
  tree.forEach(([icon, color, name, desc], i) => {
    const y = 1.65 + i * 0.5, x = M + 0.15 + (i === 0 ? 0 : 0.3);
    s.addImage({ path: ICON(icon, color), x, y: y + 0.02, w: 0.3, h: 0.3 });
    text(s, name, { x: x + 0.4, y, w: 3.2, h: 0.24, fontSize: 11.5, bold: true, color: NAVY, fontFace: 'Courier New' });
    text(s, desc, { x: x + 0.4, y: y + 0.23, w: 3.2, h: 0.25, fontSize: 10, color: INK2 });
  });
  framed(s, IMG('summary-top.png'), 4.65, 1.5, 4.85, 3.75);
  notes(s, 'summary.html is self-contained: the screenshots are embedded, so the single file can be copied or emailed on its own.');
}

// 14 reading the report
{
  const s = slide();
  title(s, 'Reading the report', 'Top to bottom: outcome, flags, time away, then the full timeline with pictures.');
  framed(s, IMG('summary-top.png'), M, 1.5, 3.3, 2.0);
  framed(s, IMG('summary-timeline.png'), M, 3.6, 3.3, 1.65);
  const rows = [
    ['check', 'green', 'Outcome and log chain', 'RESULT / SUBMITTED / TIMED OUT / ABANDONED. "Log chain OK" means no line of the log was altered afterwards.'],
    ['flag', 'red', 'Flags', 'Each flagged event type with its count and a colour: red critical, orange serious, yellow warning.'],
    ['clock', 'blue', 'Time away', 'How long the exam tab was not in front, Chrome was not the active app, the window was minimised, the screen was locked.'],
    ['tabs', 'blue', 'Parallel pages', 'Every other page visited during the paper, with focused time and visits.'],
    ['camera', 'blue', 'Timeline and screenshots', 'Every event in order; "tab" and "desktop" links open the picture taken at that moment.'],
  ];
  rows.forEach(([icon, color, head, body], i) => iconRow(s, 4.1, 1.55 + i * 0.74, 5.4, icon, head, body, color));
  notes(s, 'For a dispute, start with the flags, then use the timeline links to see the screenshot at each flagged moment.');
}

// 15 flags
{
  const s = slide();
  title(s, 'Flags and what they mean', 'The same list drives the red badge, the popup and the report.');
  const groups = [
    ['Critical', RED, [['Parallel pages', 'another web page was used'], ['Incognito windows', 'a private window was opened'], ['DevTools', 'the browser inspector was opened'], ['Config changed', 'ExamEye settings were changed mid-paper'], ['Clock set back', 'the computer clock jumped backwards']]],
    ['Serious', 'EC835A', [['Copy / Cut / Paste', 'clipboard use on the exam page'], ['Print', 'the print dialog was opened'], ['Drag out', 'content dragged out of the exam page'], ['Downloads', 'a file was downloaded'], ['Recording gaps', 'ExamEye was not running for a while']]],
    ['Warning', 'FAB219', [['Tab switches', 'another tab came in front'], ['Left Chrome', 'another application came in front'], ['Window minimised', 'the exam window was minimised'], ['Fullscreen exits', 'the paper left full-screen mode'], ['Screensaver / lock', 'the screen locked or the screensaver ran'], ['Multiple screens', 'more than one monitor was attached']]],
  ];
  groups.forEach(([head, color, items], i) => {
    const x = M + i * 3.05, w = 2.9;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 1.5, w, h: 0.42, fill: { color }, line: { color }, rectRadius: 0.06 });
    text(s, head, { x: x + 0.15, y: 1.5, w: w - 0.3, h: 0.42, fontSize: 14, bold: true, color: i === 0 ? WHITE : INK, valign: 'middle' });
    items.forEach(([name, desc], j) => {
      const y = 2.05 + j * 0.53;
      text(s, name, { x: x + 0.1, y, w: w - 0.2, h: 0.24, fontSize: 11.5, bold: true, color: NAVY });
      text(s, desc, { x: x + 0.1, y: y + 0.23, w: w - 0.2, h: 0.28, fontSize: 10, color: INK2 });
    });
  });
  notes(s, 'Severity is a reading aid, not a verdict. A tab switch can be innocent; five parallel pages during a closed-book paper usually are not.');
}

// 16 tamper evidence
{
  const s = slide();
  title(s, 'Can the record be trusted?', 'Every log line carries a fingerprint of the line before it. Change one, and everything after it breaks.');
  card(s, M, 1.55, 4.4, 3.6, 'EEF3FB');
  s.addImage({ path: ICON('shield', 'navy'), x: M + 0.2, y: 1.75, w: 0.5, h: 0.5 });
  text(s, 'What the chain proves', { x: M + 0.85, y: 1.82, w: 3.4, h: 0.4, fontSize: 16, bold: true, color: NAVY });
  bullets(s, [
    'The report\u2019s "Log chain OK" badge shows the log is intact from the first line to the last.',
    'A gap where ExamEye was switched off shows up as a Recording gap flag with its length.',
    'The screenshots named in the log must be present in the folder.',
    'It cannot prove who was at the keyboard. That is the invigilator\u2019s job.',
  ], { x: M + 0.2, y: 2.4, w: 4, h: 2.7, fontSize: 12 });
  card(s, 5.1, 1.55, 4.4, 3.6);
  s.addImage({ path: ICON('doc', 'blue'), x: 5.3, y: 1.75, w: 0.5, h: 0.5 });
  text(s, 'The checker', { x: 5.95, y: 1.82, w: 3.4, h: 0.4, fontSize: 16, bold: true, color: NAVY });
  text(s, 'IT can re-check any folder later, independently of the report, with one command from the ExamEye folder:', { x: 5.3, y: 2.4, w: 4, h: 0.6, fontSize: 12, color: INK2 });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 5.3, y: 3.05, w: 4.0, h: 1.05, fill: { color: NAVY }, line: { color: NAVY }, rectRadius: 0.06 });
  text(s, `node tools/verify.mjs "<folder>"\n\n${verifyLine}`, { x: 5.45, y: 3.13, w: 3.8, h: 0.95, fontSize: 10, color: 'CADCFC', fontFace: 'Courier New' });
  text(s, 'A modified copy reports BROKEN and names the first bad line or the missing picture.', { x: 5.3, y: 4.25, w: 4, h: 0.7, fontSize: 12, color: INK2 });
  notes(s, 'The checker needs Node.js on the machine that runs it, which is why it is described as an IT task.');
}

// 17 limits and privacy
{
  const s = slide();
  title(s, 'Limits and privacy', 'Know these before relying on the record.');
  const rows = [
    ['warning', 'amber', 'A candidate can switch the extension off', 'On an unmanaged machine nothing prevents it. The switch-off appears as a Recording gap, and a paper with missing files is itself evidence. Managed machines can lock it by policy.'],
    ['eye', 'blue', 'It sees only the browser', 'Phones, paper notes and a second computer are invisible. Whole-screen capture shows other applications only while Chrome is not in front, and only if the candidate accepted the share.'],
    ['gear', 'blue', 'The settings page is open to anyone at the machine', 'That is why every change during a paper is logged with a screenshot, and why the output folder is fixed when the paper starts.'],
    ['shield', 'navy', 'Nothing leaves the machine', 'ExamEye has no server. Files are written to the local Downloads folder and stay there until the centre collects them. Candidates should be told they are being recorded.'],
  ];
  rows.forEach(([icon, color, head, body], i) => {
    const y = 1.55 + i * 0.92;
    s.addImage({ path: ICON(icon, color), x: M, y: y + 0.02, w: 0.5, h: 0.5 });
    text(s, head, { x: M + 0.7, y, w: 8.3, h: 0.3, fontSize: 14, bold: true, color: NAVY });
    text(s, body, { x: M + 0.7, y: y + 0.3, w: 8.3, h: 0.6, fontSize: 11.5, color: INK2 });
  });
  notes(s, 'A candidate notice template is in the setup checklist, section 8.');
}

// 18 closing checklist
{
  const s = slide(); s.background = { color: NAVY };
  text(s, 'Exam-day checklist', { x: M, y: 0.6, w: 9, h: 0.7, fontSize: 32, bold: true, color: WHITE });
  const items = ['ExamEye shows as enabled at chrome://extensions', 'Chrome does not ask where to save downloads', 'Settings saved for today\u2019s paper; seat ID is this desk', 'Dry run done on this machine today', 'Extra monitors disconnected; screen-share prompt explained to candidates', 'After the paper: copy the session folder from Downloads \u2192 ExamEye'];
  items.forEach((t, i) => {
    const y = 1.55 + i * 0.58;
    s.addImage({ path: ICON('check', 'green'), x: M, y: y + 0.03, w: 0.38, h: 0.38 });
    text(s, t, { x: M + 0.55, y, w: 8.5, h: 0.45, fontSize: 16, color: WHITE, valign: 'middle' });
  });
  text(s, 'Full checklist: docs/centre-setup.md in the ExamEye folder.', { x: M, y: 5.05, w: 9, h: 0.35, fontSize: 12, color: 'CADCFC' });
}

const out = path.join(ROOT, 'docs/deck/ExamEye-overview.pptx');
await pres.writeFile({ fileName: out });
console.log('wrote', out, `(${n} slides)`);
