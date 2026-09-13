export const normalizeLabel = s => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

export const parseLabels = csv => String(csv ?? '').split(',').map(normalizeLabel).filter(Boolean);

export const matchLabel = (text, labels) => labels.includes(normalizeLabel(text));

export const LABEL_VECTORS = [
  ['  Submit \n  Answers ', 'submit answers'],
  ['Finish', 'finish'],
  [' Confirm   submission ', 'confirm submission'],
  ['', ''],
];
