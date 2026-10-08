// A small seam between Wayline and a language model. The copilot asks for
// JSON matching a schema and gets parsed JSON back; which provider answers is
// decided here, from server-side environment variables only. With no key
// configured there is no provider, and the app says so rather than
// pretending.
//
// The Anthropic provider uses the Messages API over fetch rather than the
// official SDK because the project adds no runtime dependencies (CLAUDE.md).

export type AiRequest = { system: string; user: string; schema: Record<string, unknown> };

export type AiProvider = {
  name: string;
  model: string;
  completeJson(req: AiRequest): Promise<unknown>;
};

export class AiError extends Error {}

export function aiProvider(env: NodeJS.ProcessEnv = process.env): AiProvider | null {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const base = (env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
  const model = env.WAYLINE_AI_MODEL || "claude-opus-5-5";
  // The refusal fallback is a feature of Anthropic's own API; a proxy in
  // front of it may not accept the extra field, so it's only sent direct.
  const direct = base === "https://api.anthropic.com";

  return {
    name: "anthropic",
    model,
    async completeJson({ system, user, schema }) {
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
            max_tokens: 4000,
            system,
            messages: [{ role: "user", content: user }],
            output_config: { effort: "low", format: { type: "json_schema", schema } },
            ...(direct ? { fallbacks: "default" } : {}),
          }),
          signal: AbortSignal.timeout(60_000),
        });
      } catch {
        throw new AiError("The AI provider couldn't be reached.");
      }
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new AiError(`The AI provider returned an error (HTTP ${res.status}).`);
      if (data.stop_reason === "refusal") throw new AiError("The model declined to answer this request.");
      if (data.stop_reason === "max_tokens") throw new AiError("The model's answer was cut off.");
      const textBlock = (Array.isArray(data.content) ? data.content : []).find((b: any) => b?.type === "text");
      try {
        return JSON.parse(textBlock?.text ?? "");
      } catch {
        throw new AiError("The model's answer wasn't valid JSON.");
      }
    },
  };
}
