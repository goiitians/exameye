export function matchesPrefix(url, prefix) {
  return Boolean(prefix) && typeof url === 'string' && url.startsWith(prefix);
}

export function originOf(prefix) {
  const u = new URL(prefix);
  return `${u.protocol}//${u.host}/`;
}

export function prefixToMatchPattern(prefix) {
  const u = new URL(prefix);
  return `${u.protocol}//${u.host}${u.pathname}*`;
}

export function classify(url, cfg) {
  if (matchesPrefix(url, cfg.resultPrefix)) return 'result';
  if (matchesPrefix(url, cfg.startPrefix)) return 'start';
  if (matchesPrefix(url, cfg.examPrefix)) return 'exam';
  return null;
}
