import type { IncomingMessage } from "node:http";
import { HttpError } from "./errors.ts";

// A fixed-window counter per key, in memory (one machine). Guards the public
// endpoints that spend Google quota, so an anonymous visitor can't run up
// the bill.
export function createLimiter(max: number, windowMs: number, now = () => Date.now()) {
  const hits = new Map<string, { count: number; reset: number }>();
  return (key: string): void => {
    const t = now();
    const h = hits.get(key);
    if (!h || h.reset <= t) {
      hits.set(key, { count: 1, reset: t + windowMs });
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset <= t) hits.delete(k);
      return;
    }
    if (++h.count > max) throw new HttpError(429, "Too many requests. Wait a moment and try again.");
  };
}

// Fly's proxy puts the visitor's address in Fly-Client-IP.
export function clientIp(req: IncomingMessage): string {
  const fly = req.headers["fly-client-ip"];
  if (typeof fly === "string" && fly) return fly;
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}
