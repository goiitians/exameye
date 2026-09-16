// Writes docs/deck/ExamEye-guide.html and prints it to docs/deck/ExamEye-guide.pdf (A4) with
// Chromium. Uses the same screenshots as the slide deck. Run after tools/deck-shots.mjs and
// tools/deck-illustrations.mjs: node tools/deck-pdf.mjs
import { writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_HTML = path.join(ROOT, 'docs/deck/ExamEye-guide.html');
const OUT_PDF = path.join(ROOT, 'docs/deck/ExamEye-guide.pdf');

const sample = JSON.parse(await readFile(path.join(ROOT, 'docs/deck/img/files.json'), 'utf8'));
const verifyLine = execFileSync('node', [path.join(ROOT, 'tools/verify.mjs'), path.join(ROOT, 'docs/deck/sample-session/ExamEye', sample.id)], { encoding: 'utf8' }).trim().replace(/^OK \S+\//, 'OK ');
const fig = (file, caption, cls = '') => `<figure class="${cls}"><img src="img/${file}" alt="${caption}"><figcaption>${caption}</figcaption></figure>`;
const icon = (name, color = 'blue') => `<img class="ic" src="img/icons/${name}-${color}.png" alt="">`;

const html = `<!doctype html>
<html lang="en"><meta charset="utf-8"><title>ExamEye guide</title>
<style>
  @page { size: A4; margin: 18mm 16mm 20mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 11pt/1.5 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #0b0b0b; }
  h1 { font-size: 30pt; margin: 0 0 4pt; color: #0f2a4a; }
  h2 { font-size: 17pt; color: #0f2a4a; margin: 22pt 0 8pt; page-break-after: avoid; }
  h3 { font-size: 12.5pt; color: #0f2a4a; margin: 14pt 0 4pt; page-break-after: avoid; }
  p, li { margin: 0 0 6pt; }
  ul { padding-left: 16pt; margin: 0 0 8pt; }
  .lede { font-size: 13pt; color: #52514e; margin: 0 0 14pt; }
  .cover { background: #0f2a4a; color: #fff; padding: 28mm 16mm; margin: -18mm -16mm 12mm; height: 120mm; }
  .cover h1 { color: #fff; font-size: 40pt; }
  .cover p { color: #cadcfc; font-size: 14pt; max-width: 120mm; }
  .cover img { width: 22mm; margin-bottom: 8mm; }
  figure { margin: 8pt 0 12pt; page-break-inside: avoid; }
  figure img { max-width: 100%; border: 1px solid #e6e4df; border-radius: 6px; }
  figcaption { font-size: 9pt; color: #898781; margin-top: 4pt; }
  .pair { display: flex; gap: 4%; align-items: flex-start; page-break-inside: avoid; }
  .pair figure { flex: 1; min-width: 0; margin-top: 0; }
  figure.tall img { max-height: 190mm; width: auto; display: block; }
  .two { display: flex; gap: 8mm; }
  .two > div { flex: 1; }
  .card { background: #f6f5f2; border: 1px solid #e6e4df; border-radius: 8px; padding: 10pt 12pt; margin: 0 0 8pt; page-break-inside: avoid; }
  .card.blue { background: #eef3fb; } .card.red { background: #fdf0f0; } .card.amber { background: #fff4e5; border-color: #f0b25a; }
  .ic { width: 16pt; height: 16pt; vertical-align: -3pt; margin-right: 5pt; }
  table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 10pt; page-break-inside: avoid; }
  th, td { text-align: left; padding: 5pt 8pt; border-top: 1px solid #e6e4df; vertical-align: top; }
  th { background: #f4f3ef; font-size: 9pt; text-transform: uppercase; letter-spacing: .04em; color: #52514e; }
  .sev { display: inline-block; width: 9pt; height: 9pt; border-radius: 50%; vertical-align: -1pt; margin-right: 4pt; }
  .critical { background: #d03b3b; } .serious { background: #ec835a; } .warning { background: #fab219; }
  .steps { counter-reset: s; }
  .step { display: flex; gap: 8pt; margin: 0 0 8pt; page-break-inside: avoid; }
  .step .n { flex: 0 0 22pt; height: 22pt; border-radius: 50%; background: #0f2a4a; color: #fff; font-weight: 700; text-align: center; line-height: 22pt; }
  code { font-family: Menlo, Consolas, monospace; font-size: 9.5pt; background: #f4f3ef; padding: 1pt 4pt; border-radius: 3px; }
  pre { background: #0f2a4a; color: #cadcfc; padding: 8pt 10pt; border-radius: 6px; font-size: 9.5pt; }
  .pb { page-break-before: always; }
  .small { font-size: 9.5pt; color: #52514e; }
</style>
<body>

<div class="cover">
  <img src="img/icons/eye-blue.png" alt="">
  <h1>ExamEye</h1>
  <p>A silent witness for online exams.</p>
  <p>What it does, how to set it up in five steps, and how to read what it records. Written for exam-centre staff and invigilators; no technical background needed.</p>
</div>

<h2>1. What ExamEye is</h2>
<p class="lede">ExamEye is a small add-on for the Chrome browser. While a candidate sits an online paper, it writes down what happens in the browser and saves the record, with screenshots, to a folder on the same machine. It is a recorder, not a gatekeeper: it never blocks anything.</p>
<div class="two">
  <div class="card blue"><h3>${icon('check', 'green')}It does</h3><ul>
    <li>Starts and stops on its own when the exam website opens and when the paper is submitted.</li>
    <li>Writes one line for every notable event, with the time.</li>
    <li>Takes a screenshot of the exam tab when something happens, and every few minutes regardless.</li>
    <li>Can photograph the whole screen while the candidate is away from Chrome.</li>
    <li>Produces a readable report with all screenshots at the end of every paper.</li></ul></div>
  <div class="card red"><h3>${icon('stop', 'red')}It never does</h3><ul>
    <li>Block a page, a key, or the candidate. Nothing is prevented, only recorded.</li>
    <li>Read or change the candidate's answers.</li>
    <li>Name other applications. It records that Chrome lost focus, not what was opened.</li>
    <li>Send anything anywhere. Every file stays on the exam machine.</li>
    <li>Need anyone to click anything during the paper, except one screen-share prompt for the candidate.</li></ul></div>
</div>

<h2>2. How it works</h2>
<div class="steps">
  <div class="step"><div class="n">1</div><div><b>The paper opens.</b> The candidate lands on the exam start page.</div></div>
  <div class="step"><div class="n">2</div><div><b>Recording starts.</b> ExamEye recognises the address and arms itself. The toolbar icon shows a red 0.</div></div>
  <div class="step"><div class="n">3</div><div><b>Events and screenshots.</b> A tab switch, a copy, Chrome losing focus: each becomes a log line and, in most cases, a picture.</div></div>
  <div class="step"><div class="n">4</div><div><b>The paper is submitted.</b> The submit button, the result page, or a phrase on the "submitted" screen ends the recording. The last few minutes are still watched.</div></div>
  <div class="step"><div class="n">5</div><div><b>The folder is written.</b> Log, screenshots and a report land in Chrome's Downloads folder under <code>ExamEye</code>.</div></div>
</div>
<p class="small">A paper that is never submitted still ends: after the maximum length set in the settings, or once the exam tab has been gone for a while.</p>

<h2>3. What gets recorded</h2>
<table>
  <tr><th>Event</th><th>What it means</th><th>Screenshot</th></tr>
  <tr><td>Other tabs and pages</td><td>Switching to another tab, and which page it was</td><td>yes</td></tr>
  <tr><td>Leaving Chrome</td><td>Another application came in front, and for how long</td><td>yes, plus a whole-screen frame when capture is on</td></tr>
  <tr><td>Copy, cut, paste, print, drag out</td><td>Clipboard and print use on the exam page, with the length of the text</td><td>yes</td></tr>
  <tr><td>Downloads</td><td>Any file the candidate downloads</td><td>yes</td></tr>
  <tr><td>Window changes</td><td>Minimised, restored, full-screen left</td><td>on full-screen exit</td></tr>
  <tr><td>Screen lock or idle</td><td>The screensaver, the lock screen, long inactivity</td><td>no</td></tr>
  <tr><td>Developer tools</td><td>The browser's inspection panel being opened</td><td>yes</td></tr>
  <tr><td>Settings changed mid-paper</td><td>Which ExamEye fields were changed</td><td>yes</td></tr>
  <tr><td>Clock set back</td><td>The computer clock jumping backwards</td><td>no</td></tr>
  <tr><td>Second monitor</td><td>More than one screen attached when capture starts</td><td>no</td></tr>
  <tr><td>Routine</td><td>A picture of the exam tab at a fixed interval (10 minutes by default)</td><td>yes</td></tr>
</table>

<h2 class="pb">4. Setup: five steps, once per machine</h2>
<p class="lede">About twenty minutes including the dry run. After that there is nothing to click on exam day. On managed fleets IT can push ExamEye and its settings by policy instead of steps 1 to 3; ask before doing them by hand. The full checklist is <code>docs/centre-setup.md</code> in the ExamEye folder.</p>

<h3>Step 1: Install</h3>
<ul>
  <li>Copy the ExamEye folder somewhere permanent, for example <code>C:\\ExamEye</code>. Moving or deleting it later switches the extension off.</li>
  <li>In Chrome open <code>chrome://extensions</code> and switch <b>Developer mode</b> on (top right). Three buttons appear.</li>
  <li>Click <b>Load unpacked</b> and choose the ExamEye folder. ExamEye appears in the list with its toggle on.</li>
  <li>Leave Developer mode on. If Chrome ever shows a "Disable developer mode extensions" bubble, click Cancel: its Disable button would switch ExamEye off.</li>
  <li>Microsoft Edge works the same way at <code>edge://extensions</code>.</li>
</ul>
${fig('chrome-extensions-devmode.png', 'chrome://extensions with Developer mode on: Load unpacked is the first button.')}
${fig('chrome-extensions.png', 'ExamEye loaded and enabled.')}

<h3>Step 2: Allow in Incognito</h3>
<p><code>chrome://extensions</code> → ExamEye → Details → <b>Allow in Incognito</b>: on. Without this a private window is invisible to ExamEye, and an incognito window opened during the paper is never recorded.</p>

<h3>Step 3: Chrome must not ask where to save</h3>
<p>Chrome Settings → Downloads → "Ask where to save each file before downloading": <b>off</b>. Otherwise every screenshot and log file would pop up a save dialog. Note the download location shown there: the recordings go into an <code>ExamEye</code> folder inside it.</p>
<div class="card amber"><b>macOS only.</b> System Settings → Privacy &amp; Security → Screen Recording → enable Chrome, then quit and reopen Chrome. Without it, whole-screen pictures come out black and nothing warns you. Windows needs nothing here.</div>
<p class="small">Also add the exam site to Chrome's "Always keep these sites active" list (Settings → Performance), so a sleeping tab does not look like the candidate left.</p>

<h3>Step 4: Configure</h3>
<p>Right-click the ExamEye icon in the toolbar and choose <b>Options</b>. The page has five short sections; every field has a one-line explanation under it. The values for a given exam platform are usually worked out once and copied to every machine.</p>
<table>
  <tr><th>Section</th><th>What goes there</th></tr>
  <tr><td>1. Exam website</td><td>The start page address, and the result page address if the platform has one.</td></tr>
  <tr><td>2. How the paper starts and ends</td><td>The text of the submit button (use the confirm button's text if the platform asks "Are you sure?"), or a phrase that appears only on the "submitted" screen. The maximum paper length is a backstop.</td></tr>
  <tr><td>3. This machine</td><td>A seat or centre ID that goes into every folder name, and the folder name under Downloads.</td></tr>
  <tr><td>4. Recording</td><td>How often to take a routine screenshot, and how long to wait before giving up on a paper whose tab has disappeared. The defaults are fine.</td></tr>
  <tr><td>5. Screen capture</td><td>Whole-screen pictures on or off, and how often to ask again if the candidate refuses to share.</td></tr>
</table>
<div class="pair">${fig('options-part1.png', 'Sections 1 and 2: the exam website and how the paper starts and ends.')}${fig('options-part2.png', 'Sections 3 to 5: this machine, recording, screen capture, and the Save bar.')}</div>

<h3>The page tells you what to fix</h3>
<p>A problem is shown in red directly under the field it belongs to. Nothing is saved until every problem is cleared; the Save bar counts the fields still to fix, and a green "Saved." confirms the settings are stored.</p>
${fig('options-error.png', 'An address without http(s) is refused under the field itself.')}
<p>If a paper is being recorded on the machine, an orange notice appears at the top. Any change saved then is written into that paper's log with the names of the fields changed, and the folder for the paper in progress does not move. A settings change during a paper can never be silent.</p>
${fig('options-recording.png', 'The notice shown while a paper is being recorded.')}

<h3>Step 5: Dry run</h3>
<p>Ten minutes with a throw-away test login. Do it on the day, on every machine.</p>
<table>
  <tr><th>Do</th><th>Expect</th></tr>
  <tr><td>Open the exam start page</td><td>The ExamEye icon shows a red 0. Click it: the popup says <b>ARMED</b> with a session id.</td></tr>
  <tr><td>Open another tab, then come back</td><td>The popup's Counters show <code>TAB_SWITCH: 1</code>; the badge shows 1.</td></tr>
  <tr><td>Minimise the window and restore it</td><td>Counters show <code>WINDOW_MINIMIZED: 1</code>.</td></tr>
  <tr><td>Lock the screen or wait for the screensaver, then unlock</td><td>Counters show <code>SCREENSAVER: 1</code>.</td></tr>
  <tr><td>Submit the test paper, or open the result page</td><td>State returns to <b>IDLE</b> and the badge disappears (after the post-submit minutes, if set).</td></tr>
  <tr><td>Look in Downloads → ExamEye</td><td>One folder named with the date, time and seat ID, containing <code>log.txt</code>, <code>summary.html</code> and a <code>screenshots</code> folder.</td></tr>
</table>
${fig('popup-anchored.png', 'The popup during the dry run: State ARMED, the session id, and the live counters.')}

<h2>5. On exam day</h2>
<p class="lede">Nothing to start. Glance at the toolbar icon; click it for detail.</p>
${fig('toolbar-badge.png', 'The red number on the icon is the count of flagged events so far. A red 0 means recording is on and nothing has been flagged.')}
<table>
  <tr><th>Popup line</th><th>Meaning</th></tr>
  <tr><td>State</td><td><b>ARMED</b>: recording. <b>CLOSING</b>: the paper was submitted and the last minutes are still being watched. <b>IDLE</b>: no paper is open.</td></tr>
  <tr><td>Session</td><td>The date, time and seat ID that name the output folder.</td></tr>
  <tr><td>Desktop capture</td><td>Whether whole-screen pictures are being taken, since when, and how many.</td></tr>
  <tr><td>Flags</td><td>The same number as the badge.</td></tr>
  <tr><td>Last flush</td><td>When files were last written to disk; it updates every 30 seconds while recording.</td></tr>
  <tr><td>Errors</td><td>Normally a dash. Anything else names the setting or file that failed; a link opens the setup page.</td></tr>
  <tr><td>Counters</td><td>Every event type seen so far, with its count.</td></tr>
</table>

<h3>Screen capture: the one thing the candidate does</h3>
<p>When the start page opens, a small "ExamEye screen capture" window appears and Chrome shows its share dialog. The candidate clicks the screen preview, then <b>Share</b> (Chrome only enables Share after the preview is clicked). The small window then minimises itself. It must stay open: closing it stops capture, and that is logged.</p>
<div class="pair">${fig('share-dialog.png', 'Chrome\'s share dialog (illustration): click the preview, then Share.')}${fig('holder.png', 'The small ExamEye window that keeps the capture alive.')}</div>
<p>Whole-screen pictures are taken while Chrome is not the active window and at each routine screenshot. If the candidate cancels, that is logged and the question is asked again after five minutes (adjustable). With two screens only the shared one is captured and the paper is flagged <code>MULTI_MONITOR</code>. On macOS the pictures are black unless Chrome has the Screen Recording permission (step 3); check one during the dry run.</p>

<h2>6. What you get</h2>
<p class="lede">One folder per paper under Downloads → ExamEye, named with the date, time and seat ID. Open <code>summary.html</code> in any browser; it is self-contained, with the screenshots embedded, so the single file can be copied or emailed on its own.</p>
<table>
  <tr><th>File</th><th>What it is</th></tr>
  <tr><td><code>summary.html</code></td><td>The report: outcome, flags, time away, parallel pages, the full timeline, every screenshot.</td></tr>
  <tr><td><code>summary.txt</code></td><td>The same report as plain text.</td></tr>
  <tr><td><code>log.txt</code></td><td>One line per event, each carrying a fingerprint of the line before it.</td></tr>
  <tr><td><code>events.jsonl</code></td><td>The same events in a form other software can read.</td></tr>
  <tr><td><code>screenshots/</code></td><td>Exam-tab pictures, named by time and event.</td></tr>
  <tr><td><code>screenshots/desktop/</code></td><td>Whole-screen pictures, when capture is on.</td></tr>
</table>
${fig('summary-top.png', 'The top of summary.html: outcome, log chain, flags with severity colours, time away.')}

<h3>Reading the report</h3>
<ul>
  <li><b>Outcome and log chain.</b> RESULT, SUBMITTED, AUTO_SUBMITTED, TIMED_OUT or ABANDONED. "Log chain OK" means no line of the log was altered afterwards.</li>
  <li><b>Flags.</b> Each flagged event type with its count and a colour: red critical, orange serious, yellow warning.</li>
  <li><b>Time away.</b> How long the exam tab was not in front, Chrome was not the active application, the window was minimised, the screen was locked.</li>
  <li><b>Parallel pages.</b> Every other page visited during the paper, with focused time and visits.</li>
  <li><b>Timeline and screenshots.</b> Every event in order; the "tab" and "desktop" links open the picture taken at that moment.</li>
</ul>
<p>For a dispute, start with the flags, then use the timeline links to see the screenshot at each flagged moment.</p>
${fig('summary-timeline.png', 'The timeline: every event in order, with a link to the picture taken at that moment.')}

<h2 class="pb">7. Flags and what they mean</h2>
<p>The same list drives the red badge, the popup and the report. Severity is a reading aid, not a verdict: one tab switch can be innocent; five parallel pages during a closed-book paper usually are not.</p>
<table>
  <tr><th>Flag</th><th>Meaning</th><th>Severity</th></tr>
  <tr><td>Parallel pages</td><td>Another web page was used</td><td><span class="sev critical"></span>critical</td></tr>
  <tr><td>Incognito windows</td><td>A private window was opened</td><td><span class="sev critical"></span>critical</td></tr>
  <tr><td>DevTools</td><td>The browser inspector was opened</td><td><span class="sev critical"></span>critical</td></tr>
  <tr><td>Config changed</td><td>ExamEye settings were changed mid-paper</td><td><span class="sev critical"></span>critical</td></tr>
  <tr><td>Clock set back</td><td>The computer clock jumped backwards</td><td><span class="sev critical"></span>critical</td></tr>
  <tr><td>Copy, Cut, Paste</td><td>Clipboard use on the exam page</td><td><span class="sev serious"></span>serious</td></tr>
  <tr><td>Print</td><td>The print dialog was opened</td><td><span class="sev serious"></span>serious</td></tr>
  <tr><td>Drag out</td><td>Content dragged out of the exam page</td><td><span class="sev serious"></span>serious</td></tr>
  <tr><td>Downloads</td><td>A file was downloaded</td><td><span class="sev serious"></span>serious</td></tr>
  <tr><td>Recording gaps</td><td>ExamEye was not running for a while</td><td><span class="sev serious"></span>serious</td></tr>
  <tr><td>Tab switches</td><td>Another tab came in front</td><td><span class="sev warning"></span>warning</td></tr>
  <tr><td>Left Chrome</td><td>Another application came in front</td><td><span class="sev warning"></span>warning</td></tr>
  <tr><td>Window minimised</td><td>The exam window was minimised</td><td><span class="sev warning"></span>warning</td></tr>
  <tr><td>Fullscreen exits</td><td>The paper left full-screen mode</td><td><span class="sev warning"></span>warning</td></tr>
  <tr><td>Screensaver / lock</td><td>The screen locked or the screensaver ran</td><td><span class="sev warning"></span>warning</td></tr>
  <tr><td>Multiple screens</td><td>More than one monitor was attached</td><td><span class="sev warning"></span>warning</td></tr>
</table>

<h2>8. Can the record be trusted?</h2>
<p>Every log line carries a fingerprint of the line before it. Change one line and everything after it breaks. The report's "Log chain OK" badge shows the log is intact from first line to last; a period when ExamEye was switched off shows as a Recording gap with its length; and every screenshot named in the log must be present in the folder. It cannot prove who was at the keyboard. That is the invigilator's job.</p>
<p>IT can re-check any folder later, independently of the report, with one command run from the ExamEye folder (it needs Node.js on that machine):</p>
<pre>node tools/verify.mjs "&lt;folder&gt;"

${verifyLine}</pre>
<p>A modified copy reports <code>BROKEN</code> and names the first bad line or the missing picture.</p>

<h2>9. Limits and privacy</h2>
<div class="card"><b>${icon('warning', 'amber')}A candidate can switch the extension off.</b> On an unmanaged machine nothing prevents it. The switch-off appears as a Recording gap, and a paper with missing files is itself evidence. Managed machines can lock it by policy.</div>
<div class="card"><b>${icon('eye', 'blue')}It sees only the browser.</b> Phones, paper notes and a second computer are invisible. Whole-screen capture shows other applications only while Chrome is not in front, and only if the candidate accepted the share.</div>
<div class="card"><b>${icon('gear', 'blue')}The settings page is open to anyone at the machine.</b> That is why every change during a paper is logged with a screenshot, and why the output folder is fixed when the paper starts.</div>
<div class="card"><b>${icon('shield', 'navy')}Nothing leaves the machine.</b> ExamEye has no server. Files are written to the local Downloads folder and stay there until the centre collects them. Candidates should be told they are being recorded; a notice template is in the setup checklist.</div>

<h2>10. Exam-day checklist</h2>
<ul>
  <li>ExamEye shows as enabled at <code>chrome://extensions</code>.</li>
  <li>Chrome does not ask where to save downloads.</li>
  <li>Settings saved for today's paper; the seat ID is this desk.</li>
  <li>Dry run done on this machine today.</li>
  <li>Extra monitors disconnected; the screen-share prompt explained to candidates.</li>
  <li>After the paper: copy the session folder from Downloads → ExamEye.</li>
</ul>
</body></html>
`;

await writeFile(OUT_HTML, html);
const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage();
await page.goto('file://' + OUT_HTML);
await page.pdf({ path: OUT_PDF, format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: '<div style="width:100%;font-size:8pt;color:#898781;padding:0 16mm;display:flex;justify-content:space-between"><span>ExamEye guide</span><span class="pageNumber"></span></div>' });
await browser.close();
console.log('wrote', OUT_HTML, 'and', OUT_PDF);
