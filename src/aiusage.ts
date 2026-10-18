import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { transaction } from "./db.ts";

// App-wide AI limits and usage records, in SQLite so they survive restarts
// (docs/ai.md). One shared budget for the whole app, whoever asks:
//   - requests per UTC day
//   - model calls running at once
//   - tokens per UTC day (each call reserves its maximum up front, then the
//     real count from the provider replaces the reservation)
// The check and the reservation happen in one `begin immediate` transaction,
// so two simultaneous requests can't both take the last slot. A call that
// never finishes (a crash, a killed machine) holds its slot only until its
// lease ends, a little after the request timeout.

export type AiLimits = { perDay: number; concurrent: number; tokensPerDay: number; leaseMs: number };
export type AiPrices = { inputPerMTok: number | null; outputPerMTok: number | null };
export type Reservation = { id: string; finish(result: { status: "ok" | "error" | "cancelled"; errorKind?: string; inputTokens?: number | null; outputTokens?: number | null }): { costUsd: number | null } };

export const LIMIT_MESSAGE = "AI planning is temporarily unavailable because the usage limit has been reached. Everything else still works.";
export const BUSY_MESSAGE = "The AI is busy with other requests. Try again in a moment.";

export class AiLimitError extends Error {
  status: number;
  code: "daily_requests" | "daily_tokens" | "concurrent";
  constructor(code: AiLimitError["code"]) {
    super(code === "concurrent" ? BUSY_MESSAGE : LIMIT_MESSAGE);
    this.status = code === "concurrent" ? 429 : 503;
    this.code = code;
  }
}

const num = (v: string | undefined, fallback: number) => (Number(v) > 0 ? Number(v) : fallback);
const price = (v: string | undefined) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null);

export function limitsFromEnv(env: NodeJS.ProcessEnv = process.env, timeoutMs = 45_000): AiLimits {
  return {
    perDay: Math.floor(num(env.WAYLINE_AI_DAILY_LIMIT, 100)),
    concurrent: Math.floor(num(env.WAYLINE_AI_CONCURRENT, 3)),
    tokensPerDay: Math.floor(num(env.WAYLINE_AI_DAILY_TOKENS, 400_000)),
    leaseMs: timeoutMs + 30_000,
  };
}

// USD per million tokens, from env; unset means "cost unknown", never a guess.
export const pricesFromEnv = (env: NodeJS.ProcessEnv = process.env): AiPrices => ({
  inputPerMTok: price(env.WAYLINE_AI_PRICE_INPUT_PER_MTOK),
  outputPerMTok: price(env.WAYLINE_AI_PRICE_OUTPUT_PER_MTOK),
});

export function createAiUsage(db: DatabaseSync, limits: AiLimits, prices: AiPrices, now = () => Date.now()) {
  const q = (sql: string) => db.prepare(sql);
  const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);
  // a finished call counts its real tokens; a running one its reservation
  const tokensSql = "coalesce(sum(case when status = 'running' then reserved_tokens else coalesce(input_tokens, 0) + coalesce(output_tokens, 0) end), 0)";

  function cost(input: number | null | undefined, output: number | null | undefined): number | null {
    if (prices.inputPerMTok === null || prices.outputPerMTok === null || input == null || output == null) return null;
    return Math.round(((input * prices.inputPerMTok + output * prices.outputPerMTok) / 1e6) * 1e6) / 1e6;
  }

  return {
    limits,

    // Takes a slot and a token reservation, or throws AiLimitError without
    // writing anything. Called before the provider is.
    reserve(opts: { userId: string | null; tripId: string | null; feature: string; model: string; maxTokens: number }): Reservation {
      const t = now();
      const day = dayOf(t);
      const id = randomUUID();
      transaction(db, () => {
        // expired leases are calls that never came back; close them so they stop counting
        q("update ai_usage set status = 'error', error_kind = 'abandoned', finished_at = ? where status = 'running' and lease_until <= ?").run(t, t);
        const today = q(`select count(*) as n, ${tokensSql} as tokens from ai_usage where day = ?`).get(day) as { n: number; tokens: number };
        if (Number(today.n) >= limits.perDay) throw new AiLimitError("daily_requests");
        if (Number(today.tokens) + opts.maxTokens > limits.tokensPerDay) throw new AiLimitError("daily_tokens");
        const running = q("select count(*) as n from ai_usage where status = 'running'").get() as { n: number };
        if (Number(running.n) >= limits.concurrent) throw new AiLimitError("concurrent");
        q(
          "insert into ai_usage (id, user_id, trip_id, feature, model, status, day, started_at, lease_until, reserved_tokens) values (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?)",
        ).run(id, opts.userId, opts.tripId, opts.feature, opts.model, day, t, t + limits.leaseMs, opts.maxTokens);
      });
      let done = false;
      return {
        id,
        finish({ status, errorKind, inputTokens, outputTokens }) {
          const c = cost(inputTokens, outputTokens);
          if (done) return { costUsd: c };
          done = true;
          // an error with no count (it never reached the model) still used its request, not its tokens
          q("update ai_usage set status = ?, error_kind = ?, finished_at = ?, input_tokens = ?, output_tokens = ?, cost_usd = ? where id = ?").run(
            status,
            errorKind ?? null,
            now(),
            inputTokens ?? (status === "ok" ? null : 0),
            outputTokens ?? (status === "ok" ? null : 0),
            c,
            id,
          );
          return { costUsd: c };
        },
      };
    },

    // For the developer: today's totals and the last 30 days, by feature.
    summary() {
      const t = now();
      const day = dayOf(t);
      const today = q(
        `select count(*) as requests, sum(status = 'ok') as ok, sum(status = 'error') as errors, sum(status = 'running' and lease_until > ?) as running,
                ${tokensSql} as tokens, coalesce(sum(input_tokens), 0) as input_tokens, coalesce(sum(output_tokens), 0) as output_tokens,
                sum(cost_usd) as cost_usd from ai_usage where day = ?`,
      ).get(t, day) as Record<string, number | null>;
      const recent = q(
        `select day, feature, model, count(*) as requests, coalesce(sum(input_tokens), 0) as input_tokens, coalesce(sum(output_tokens), 0) as output_tokens, sum(cost_usd) as cost_usd
           from ai_usage where day >= ? group by day, feature, model order by day desc, feature`,
      ).all(dayOf(t - 29 * 86_400_000));
      return {
        day,
        limits: { requestsPerDay: limits.perDay, concurrent: limits.concurrent, tokensPerDay: limits.tokensPerDay },
        today: {
          requests: Number(today.requests ?? 0),
          ok: Number(today.ok ?? 0),
          errors: Number(today.errors ?? 0),
          running: Number(today.running ?? 0),
          tokensCounted: Number(today.tokens ?? 0),
          inputTokens: Number(today.input_tokens ?? 0),
          outputTokens: Number(today.output_tokens ?? 0),
          estimatedCostUsd: today.cost_usd === null ? null : Number(today.cost_usd),
        },
        pricesConfigured: prices.inputPerMTok !== null && prices.outputPerMTok !== null,
        last30Days: recent,
      };
    },
  };
}

export type AiUsage = ReturnType<typeof createAiUsage>;

// Every model call goes through here: a slot is reserved (or the call is
// refused before the provider is contacted), one call is made with no
// automatic retry, and the outcome, tokens and estimated cost are recorded.
// The user id is recorded for the log only; it isn't a quota.
export async function guardedCall<T>(
  usage: AiUsage,
  provider: import("./ai.ts").AiProvider,
  opts: { userId: string | null; tripId: string | null; feature: string; maxTokens: number; request: Omit<import("./ai.ts").AiRequest, "maxTokens">; log?: (level: "info" | "warn", event: string, fields: Record<string, unknown>) => void },
  use: (json: unknown) => T,
): Promise<T> {
  const maxTokens = Math.min(opts.maxTokens, provider.maxTokens);
  let r: Reservation;
  try {
    r = usage.reserve({ userId: opts.userId, tripId: opts.tripId, feature: opts.feature, model: provider.model, maxTokens });
  } catch (err) {
    if (err instanceof AiLimitError) opts.log?.("warn", "AI_LIMIT_REACHED", { tripId: opts.tripId, action: opts.feature, status: "denied", errorCode: err.code.toUpperCase(), message: err.message });
    throw err;
  }
  const started = Date.now();
  try {
    const { json, usage: count } = await provider.complete({ ...opts.request, maxTokens });
    const out = use(json); // validation can still refuse the answer
    const { costUsd } = r.finish({ status: "ok", inputTokens: count.inputTokens, outputTokens: count.outputTokens });
    opts.log?.("info", "AI_REQUEST_COMPLETED", { tripId: opts.tripId, action: opts.feature, status: "success", message: "AI call finished", model: provider.model, inputTokens: count.inputTokens, outputTokens: count.outputTokens, estimatedCostUsd: costUsd, durationMs: Date.now() - started });
    return out;
  } catch (err) {
    const kind = (err as { kind?: string }).kind ?? "provider";
    const count = (err as { usage?: { inputTokens: number | null; outputTokens: number | null } | null }).usage ?? null;
    const { costUsd } = r.finish({ status: kind === "cancelled" ? "cancelled" : "error", errorKind: kind, inputTokens: count?.inputTokens, outputTokens: count?.outputTokens });
    opts.log?.("warn", "AI_REQUEST_FAILED", { tripId: opts.tripId, action: opts.feature, status: "failure", errorCode: `AI_${kind.toUpperCase()}`, message: "AI call failed", model: provider.model, inputTokens: count?.inputTokens ?? null, outputTokens: count?.outputTokens ?? null, estimatedCostUsd: costUsd, durationMs: Date.now() - started });
    throw err;
  }
}
