export const FLAGS = [
  ['PARALLEL_PAGE', 'Parallel pages', 'critical'],
  ['TAB_SWITCH', 'Tab switches', 'warning'],
  ['FOCUS_LEFT_CHROME', 'Left Chrome', 'warning'],
  ['INCOGNITO_WINDOW_OPENED', 'Incognito windows', 'critical'],
  ['DEVTOOLS_OPENED', 'DevTools', 'critical'],
  ['COPY', 'Copy', 'serious'],
  ['CUT', 'Cut', 'serious'],
  ['PASTE', 'Paste', 'serious'],
  ['PRINT', 'Print', 'serious'],
  ['DRAG', 'Drag out', 'serious'],
  ['DOWNLOAD_STARTED', 'Downloads', 'serious'],
  ['WINDOW_MINIMIZED', 'Window minimised', 'warning'],
  ['FULLSCREEN_EXIT', 'Fullscreen exits', 'warning'],
  ['SCREENSAVER', 'Screensaver / lock', 'warning'],
  ['EXTENSION_GAP', 'Recording gaps', 'serious'],
  ['CONFIG_CHANGED', 'Config changed', 'critical'],
  ['CLOCK_BACKWARDS', 'Clock set back', 'critical'],
];

export const flagCount = (counts) => FLAGS.reduce((n, [name]) => n + (counts[name] || 0), 0);
