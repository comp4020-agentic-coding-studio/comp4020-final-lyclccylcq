import OpenAI from "openai";

// A small seam between Wayline and a language model. The copilot and the
// planner ask for JSON matching a schema and get parsed JSON back, plus the
// provider's token count; which provider answers is decided here, from
// server-side environment variables only. With no key configured there is no
// provider, and the app says so rather than pretending.
//
// The provider is OpenAI, through the official SDK's Responses API with
// Structured Outputs (a strict JSON schema). This is the only file that talks
// to the provider, so a gateway could replace it later (docs/ai.md).

export type AiRequest = { system: string; user: string; schema: Record<string, unknown>; signal?: AbortSignal; maxTokens?: number };
export type AiUsageCount = { inputTokens: number | null; outputTokens: number | null };

export type AiProvider = {
  name: string;
  model: string;
  timeoutMs: number;
  maxTokens: number;
  // the parsed JSON answer, and the provider's own token count
  complete(req: AiRequest): Promise<{ json: unknown; usage: AiUsageCount }>;
  completeJson(req: AiRequest): Promise<unknown>;
};

// No automatic retries: a failed call is reported, and the person can try
// again (each try counts against the app's limits). The SDK retries twice by
// default; it's given this value instead.
export const AI_RETRIES = 0;

export const DEFAULT_MODEL = "gpt-6.1-sol";

// kind says what went wrong in terms the server can turn into a plain
// message; the provider's own error text never reaches a user.
export type AiErrorKind = "unreachable" | "timeout" | "cancelled" | "auth" | "rate_limited" | "overloaded" | "bad_request" | "refusal" | "truncated" | "invalid" | "provider";

export class AiError extends Error {
  kind: AiErrorKind;
  usage: AiUsageCount | null;
  constructor(kind: AiErrorKind, message: string, usage: AiUsageCount | null = null) {
    super(message);
    this.kind = kind;
    this.usage = usage;
  }
}

const usageOf = (u: OpenAI.Responses.ResponseUsage | null | undefined): AiUsageCount => ({
  // input_tokens already includes cached input; output_tokens includes reasoning
  inputTokens: typeof u?.input_tokens === "number" ? u.input_tokens : null,
  outputTokens: typeof u?.output_tokens === "number" ? u.output_tokens : null,
});

// The SDK's errors, as Wayline's kinds. Only the status and a fixed message
// are kept: never the provider's own text, which can echo request details.
function asAiError(err: unknown, signal: AbortSignal | undefined): AiError {
  if (err instanceof AiError) return err;
  if (err instanceof OpenAI.APIUserAbortError || signal?.aborted) return new AiError("cancelled", "The request was cancelled.");
  if (err instanceof OpenAI.APIConnectionTimeoutError) return new AiError("timeout", "The AI provider took too long to answer.");
  if (err instanceof OpenAI.APIConnectionError) return new AiError("unreachable", "The AI provider couldn't be reached.");
  if (err instanceof OpenAI.APIError) {
    const s = err.status ?? 0;
    if (s === 401 || s === 403) return new AiError("auth", `The AI provider refused the credentials (HTTP ${s}).`);
    if (s === 429) return new AiError("rate_limited", "The AI provider is rate limiting requests (HTTP 429).");
    if (s === 503 || s === 529) return new AiError("overloaded", `The AI provider is overloaded (HTTP ${s}).`);
    if (s === 400 || s === 404 || s === 413 || s === 422) return new AiError("bad_request", `The AI provider rejected the request (HTTP ${s}).`);
    return new AiError("provider", `The AI provider returned an error (HTTP ${s}).`);
  }
  return new AiError("provider", "The AI provider returned an error.");
}

export function aiProvider(env: NodeJS.ProcessEnv = process.env): AiProvider | null {
  const key = env.OPENAI_API_KEY;
  if (!key) return null;
  const model = env.OPENAI_MODEL || DEFAULT_MODEL;
  const timeoutMs = Number(env.WAYLINE_AI_TIMEOUT_MS) > 0 ? Number(env.WAYLINE_AI_TIMEOUT_MS) : 45_000;
  // the most any one call may produce (reasoning included); each feature may ask for less
  const maxTokens = Number(env.WAYLINE_AI_MAX_OUTPUT_TOKENS) > 0 ? Math.floor(Number(env.WAYLINE_AI_MAX_OUTPUT_TOKENS)) : 3000;
  // OPENAI_BASE_URL is for a compatible proxy, or the tests' stand-in
  const client = new OpenAI({ apiKey: key, baseURL: env.OPENAI_BASE_URL || undefined, maxRetries: AI_RETRIES, timeout: timeoutMs });

  const provider: AiProvider = {
    name: "openai",
    model,
    timeoutMs,
    maxTokens,
    completeJson: async (req) => (await provider.complete(req)).json,
    async complete({ system, user, schema, signal, maxTokens: wanted }) {
      let res: OpenAI.Responses.Response;
      try {
        res = await client.responses.create(
          {
            model,
            instructions: system,
            input: user,
            max_output_tokens: Math.min(maxTokens, wanted ?? maxTokens),
            text: { format: { type: "json_schema", name: "wayline_answer", schema, strict: true } },
            // nothing is kept on the provider's side for later turns: the copilot sends its own history
            store: false,
          },
          { signal },
        );
      } catch (err) {
        throw asAiError(err, signal);
      }
      const usage = usageOf(res.usage);
      if (res.status === "incomplete") {
        throw res.incomplete_details?.reason === "content_filter" ? new AiError("refusal", "The model declined to answer this request.", usage) : new AiError("truncated", "The model's answer was cut off.", usage);
      }
      const refused = res.output.some((o) => o.type === "message" && o.content.some((c) => c.type === "refusal"));
      if (refused) throw new AiError("refusal", "The model declined to answer this request.", usage);
      try {
        return { json: JSON.parse(res.output_text), usage };
      } catch {
        throw new AiError("invalid", "The model's answer wasn't valid JSON.", usage);
      }
    },
  };
  return provider;
}
