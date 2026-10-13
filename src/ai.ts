// A small seam between Wayline and a language model. The copilot asks for
// JSON matching a schema and gets parsed JSON back; which provider answers is
// decided here, from server-side environment variables only. With no key
// configured there is no provider, and the app says so rather than
// pretending.
//
// The Anthropic provider uses the Messages API over fetch rather than the
// official SDK because the project adds no runtime dependencies (CLAUDE.md).

export type AiRequest = { system: string; user: string; schema: Record<string, unknown>; signal?: AbortSignal };

export type AiProvider = {
  name: string;
  model: string;
  completeJson(req: AiRequest): Promise<unknown>;
};

// kind says what went wrong in terms the server can turn into a plain
// message; the provider's own error text never reaches a user.
export type AiErrorKind = "unreachable" | "timeout" | "cancelled" | "auth" | "rate_limited" | "overloaded" | "bad_request" | "refusal" | "truncated" | "invalid" | "provider";

export class AiError extends Error {
  kind: AiErrorKind;
  constructor(kind: AiErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export function aiProvider(env: NodeJS.ProcessEnv = process.env): AiProvider | null {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const base = (env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
  const model = env.WAYLINE_AI_MODEL || "claude-opus-5-5";
  const timeoutMs = Number(env.WAYLINE_AI_TIMEOUT_MS) > 0 ? Number(env.WAYLINE_AI_TIMEOUT_MS) : 45_000;
  // The refusal fallback is a feature of Anthropic's own API; a proxy in
  // front of it may not accept the extra field, so it's only sent direct.
  const direct = base === "https://api.anthropic.com";

  return {
    name: "anthropic",
    model,
    async completeJson({ system, user, schema, signal }) {
      const timeout = AbortSignal.timeout(timeoutMs);
      let res: Response;
      try {
        res = await fetch(`${base}/v1/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            ...(direct ? { "anthropic-beta": "server-side-fallback-2026-07-01" } : {}),
          },
          body: JSON.stringify({
            model,
            // thinking counts toward this; the answer itself is capped far lower by validation
            max_tokens: 3000,
            system,
            messages: [{ role: "user", content: user }],
            output_config: { effort: "low", format: { type: "json_schema", schema } },
            ...(direct ? { fallbacks: "default" } : {}),
          }),
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
      } catch {
        if (signal?.aborted) throw new AiError("cancelled", "The request was cancelled.");
        if (timeout.aborted) throw new AiError("timeout", "The AI provider took too long to answer.");
        throw new AiError("unreachable", "The AI provider couldn't be reached.");
      }
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) {
        const s = res.status;
        if (s === 401 || s === 403) throw new AiError("auth", `The AI provider refused the credentials (HTTP ${s}).`);
        if (s === 429) throw new AiError("rate_limited", "The AI provider is rate limiting requests (HTTP 429).");
        if (s === 529 || s === 503) throw new AiError("overloaded", `The AI provider is overloaded (HTTP ${s}).`);
        if (s === 400 || s === 404 || s === 413 || s === 422) throw new AiError("bad_request", `The AI provider rejected the request (HTTP ${s}).`);
        throw new AiError("provider", `The AI provider returned an error (HTTP ${s}).`);
      }
      if (data.stop_reason === "refusal") throw new AiError("refusal", "The model declined to answer this request.");
      if (data.stop_reason === "max_tokens") throw new AiError("truncated", "The model's answer was cut off.");
      const textBlock = (Array.isArray(data.content) ? data.content : []).find((b: any) => b?.type === "text");
      try {
        return JSON.parse(textBlock?.text ?? "");
      } catch {
        throw new AiError("invalid", "The model's answer wasn't valid JSON.");
      }
    },
  };
}
