import "server-only";

// Fixed-window limit per key, in process memory (like the rest of lib/db.ts — demo only;
// production needs a shared store such as Redis/KV). Used by public forms whose every
// request starts a costly n8n workflow.

type Window = { startedAt: number; count: number };

const globalForLimits = globalThis as unknown as { leadDeskRateLimits?: Map<string, Window> };
const windows = (globalForLimits.leadDeskRateLimits ??= new Map());

export function takeRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const current = windows.get(key);
  if (!current || now - current.startedAt >= windowMs) {
    windows.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= limit) return false;
  current.count++;
  return true;
}
