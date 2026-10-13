// Small in-memory TTL cache. Keeps repeat clicks from re-running the same paid
// API search; keep the TTL short because fares and room rates move quickly.
export function createCache({ ttlMs, maxEntries = 500, now = Date.now }) {
  const entries = new Map();

  return {
    async getOrSet(key, load) {
      const hit = entries.get(key);
      if (hit && hit.expires > now()) return hit.value;

      const value = await load();
      if (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
      entries.set(key, { value, expires: now() + ttlMs });
      return value;
    },
  };
}

// Fixed-window request limiter keyed by client (IP). Live searches spend API
// quota, so a public deployment shouldn't let one visitor burn through it.
export function createRateLimiter({ limit, windowMs, now = Date.now }) {
  const windows = new Map();

  return function allow(key) {
    const t = now();
    const current = windows.get(key);
    if (!current || current.resetAt <= t) {
      if (windows.size > 10_000) windows.clear();
      windows.set(key, { count: 1, resetAt: t + windowMs });
      return true;
    }
    current.count += 1;
    return current.count <= limit;
  };
}
