export function matchesPrefix(url, prefix) {
  return Boolean(prefix) && typeof url === 'string' && url.startsWith(prefix);
}

export function originOf(prefix) {
  const u = new URL(prefix);
  return `${u.protocol}//${u.host}/`;
}

// a paper prefix narrower than the site: a paper page then identifies the paper, so seeing one while IDLE
// (missed start page, extension reload mid-paper) may start a session; the whole site would arm on the login page
export function paperPrefixIsSpecific(cfg) {
  return cfg.examPrefix !== originOf(cfg.startPrefix);
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
