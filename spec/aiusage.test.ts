import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AiLimitError, createAiUsage, limitsFromEnv } from "../src/aiusage.ts";
import { openDb } from "../src/db.ts";

// The app-wide AI budget (docs/ai.md): one limit for everyone, kept in
// SQLite so it survives a restart, and checked and reserved in one
// transaction so simultaneous requests can't overrun it.
const fresh = () => mkdtempSync(join(tmpdir(), "wayline-aiusage-"));
const NO_PRICE = { inputPerMTok: null, outputPerMTok: null };
const call = { userId: null, tripId: null, feature: "test", model: "m", maxTokens: 1000 };

describe("app-wide AI limits", () => {
  it("defaults to 100 a day and 3 at once, and reads overrides from the environment", () => {
    expect(limitsFromEnv({}, 45_000)).toMatchObject({ perDay: 100, concurrent: 3, tokensPerDay: 400_000 });
    expect(limitsFromEnv({ WAYLINE_AI_DAILY_LIMIT: "7", WAYLINE_AI_CONCURRENT: "1", WAYLINE_AI_DAILY_TOKENS: "5000" }, 10_000)).toEqual({ perDay: 7, concurrent: 1, tokensPerDay: 5000, leaseMs: 40_000 });
  });

  it("caps the day's requests for everyone together, and the cap survives a restart", () => {
    const dir = fresh();
    const t = Date.parse("2026-10-19T03:00:00Z");
    let u = createAiUsage(openDb(dir), { perDay: 2, concurrent: 5, tokensPerDay: 1e9, leaseMs: 60_000 }, NO_PRICE, () => t);
    u.reserve({ ...call, userId: "a" }).finish({ status: "ok", inputTokens: 10, outputTokens: 10 });
    u.reserve({ ...call, userId: "b" }).finish({ status: "error", errorKind: "provider" }); // failures count too
    // a restart: a new store over the same file
    u = createAiUsage(openDb(dir), { perDay: 2, concurrent: 5, tokensPerDay: 1e9, leaseMs: 60_000 }, NO_PRICE, () => t);
    expect(() => u.reserve({ ...call, userId: "c" })).toThrow(AiLimitError);
    // the next UTC day starts fresh
    const next = createAiUsage(openDb(dir), { perDay: 2, concurrent: 5, tokensPerDay: 1e9, leaseMs: 60_000 }, NO_PRICE, () => t + 86_400_000);
    expect(() => next.reserve(call)).not.toThrow();
  });

  it("lets only N run at once, and a crashed call frees its slot when its lease ends", () => {
    let t = Date.parse("2026-10-19T03:00:00Z");
    const u = createAiUsage(openDb(fresh()), { perDay: 100, concurrent: 2, tokensPerDay: 1e9, leaseMs: 60_000 }, NO_PRICE, () => t);
    const a = u.reserve(call);
    u.reserve(call); // never finished: the machine "died"
    expect(() => u.reserve(call)).toThrow(expect.objectContaining({ code: "concurrent", status: 429 }));
    a.finish({ status: "ok", inputTokens: 1, outputTokens: 1 });
    u.reserve(call); // a's slot is free again
    expect(() => u.reserve(call)).toThrow(expect.objectContaining({ code: "concurrent" }));
    t += 61_000; // both open leases have ended
    expect(() => u.reserve(call)).not.toThrow();
    expect(u.summary().today.errors).toBe(2); // the abandoned ones are closed as errors
  });

  it("can't be overrun by requests on separate connections at the same moment", () => {
    const dir = fresh();
    const t = Date.parse("2026-10-19T03:00:00Z");
    // six connections to one file, as if six requests (or processes) raced
    const stores = Array.from({ length: 6 }, () => createAiUsage(openDb(dir), { perDay: 100, concurrent: 3, tokensPerDay: 1e9, leaseMs: 60_000 }, NO_PRICE, () => t));
    const results = stores.map((u) => {
      try {
        u.reserve(call);
        return "ok";
      } catch (err) {
        return (err as AiLimitError).code;
      }
    });
    expect(results.filter((r) => r === "ok")).toHaveLength(3);
    expect(results.filter((r) => r === "concurrent")).toHaveLength(3);
  });

  it("reserves each call's maximum tokens, then keeps the real count", () => {
    const t = Date.parse("2026-10-19T03:00:00Z");
    const u = createAiUsage(openDb(fresh()), { perDay: 100, concurrent: 5, tokensPerDay: 2500, leaseMs: 60_000 }, { inputPerMTok: 1, outputPerMTok: 5 }, () => t);
    const a = u.reserve(call);
    u.reserve(call);
    expect(() => u.reserve(call)).toThrow(expect.objectContaining({ code: "daily_tokens", status: 503 })); // 3 × 1000 > 2500
    expect(a.finish({ status: "ok", inputTokens: 200, outputTokens: 100 })).toEqual({ costUsd: 0.0007 });
    u.reserve(call); // 300 + 1000 + 1000 fits
    expect(u.summary().today).toMatchObject({ requests: 3, inputTokens: 200, outputTokens: 100, tokensCounted: 2300, estimatedCostUsd: 0.0007 });
  });
});
