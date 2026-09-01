/**
 * Simple localStorage-based run cache.
 * Keys are derived from (tab, agent?, query) so the same query in QA and Playground
 * are stored independently.
 */

const CACHE_VERSION = 'v1';
const MAX_ENTRIES   = 50; // prevent unbounded growth
const INDEX_KEY     = `agentrouter_${CACHE_VERSION}_index`;

type CacheIndex = string[]; // list of cache keys, oldest first

function getIndex(): CacheIndex {
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]');
  } catch { return []; }
}

function saveIndex(idx: CacheIndex) {
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(idx)); } catch { /* quota */ }
}

export function cacheKey(tab: 'qa' | 'playground', query: string, agent?: string): string {
  const norm = query.trim().toLowerCase();
  // Simple djb2-ish hash to keep keys short
  let h = 5381;
  for (let i = 0; i < norm.length; i++) h = (h * 33) ^ norm.charCodeAt(i);
  const hash = (h >>> 0).toString(36);
  return `agentrouter_${CACHE_VERSION}_${tab}${agent ? `_${agent}` : ''}_${hash}`;
}

export function getCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch { return null; }
}

export function setCache<T>(key: string, value: T): void {
  try {
    const idx = getIndex().filter((k) => k !== key); // dedup
    idx.push(key);
    // Evict oldest if over limit
    while (idx.length > MAX_ENTRIES) {
      const old = idx.shift()!;
      localStorage.removeItem(old);
    }
    localStorage.setItem(key, JSON.stringify(value));
    saveIndex(idx);
  } catch { /* quota */ }
}

export function clearAllCache(): void {
  const idx = getIndex();
  idx.forEach((k) => localStorage.removeItem(k));
  localStorage.removeItem(INDEX_KEY);
}
