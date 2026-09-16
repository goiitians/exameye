export const EMPTY_TAIL = { count: 0, lastHash: null, lastAt: 0 };

export function decide(tail = EMPTY_TAIL, { hash, at }, { minGapMs = 3000, cap = 60 } = {}) {
  const t = tail ?? EMPTY_TAIL;
  const keep = t.count < cap && hash !== t.lastHash && (t.lastHash === null || at < t.lastAt || at - t.lastAt >= minGapMs);
  if (!keep) return { keep, tail: t };
  return { keep, tail: { count: t.count + 1, lastHash: hash, lastAt: at } };
}
