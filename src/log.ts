import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";

// Structured logs: one JSON object per line on stdout (INFO) or stderr (WARN,
// ERROR), which is what `flyctl logs` shows. No files, no external service.
// See docs/logging.md for the fields and events.

export type Level = "INFO" | "WARN" | "ERROR";
export type Status = "success" | "failure" | "denied";
export type Fields = Record<string, unknown> & {
  userId?: string | null;
  username?: string | null;
  tripId?: string | null;
  action?: string;
  status?: Status;
  message?: string;
  requestId?: string;
  connectionId?: string;
  durationMs?: number;
  errorCode?: string;
};

// What a request knows about itself: set when it starts, filled in once the
// session cookie has been resolved, and read by every log line written while
// it runs (including the broadcast that follows a change).
type Context = { requestId: string; userId: string | null; username: string | null; notes: Fields; after: (() => void)[] };
const store = new AsyncLocalStorage<Context>();

export const shortId = (prefix: string): string => `${prefix}_${randomBytes(4).toString("hex")}`;

export function withRequest<T>(requestId: string, fn: () => T): T {
  return store.run({ requestId, userId: null, username: null, notes: {}, after: [] }, fn);
}

// Lines that follow from the request's business event (the broadcast of a
// change) wait until that event is written, so the log reads in cause-then-
// effect order. Outside a request they're written at once.
export function afterEvent(fn: () => void): void {
  const c = store.getStore();
  if (c) c.after.push(fn);
  else fn();
}

export function flushAfter(): void {
  const c = store.getStore();
  if (!c) return;
  for (const fn of c.after.splice(0)) fn();
}

// The user comes from the server's session lookup, never from a request body.
export function setUser(user: { id: string; username: string } | null): void {
  const c = store.getStore();
  if (c && user) {
    c.userId = user.id;
    c.username = user.username;
  }
}

// Extra detail for the request's one business event (which activity, which
// fields), or an override of the event name.
export function note(fields: Fields): void {
  const c = store.getStore();
  if (c) Object.assign(c.notes, fields);
}

export const notes = (): Fields => store.getStore()?.notes ?? {};

// Field names that may hold a secret are dropped. Counts of model tokens
// (inputTokens, outputTokens, tokensCounted) are usage numbers, not secrets.
const USAGE_KEY = /^(input|output|reserved)Tokens$|^tokens(Counted|PerDay)$/;
const SECRET_KEY = /pass(word)?|token|secret|cookie|authorization|api_?key|credential|sdp|candidate/i;
const SECRET_TEXT: [RegExp, string][] = [
  [/AIza[0-9A-Za-z_-]{20,}/g, "[redacted-key]"],
  [/sk-[A-Za-z0-9_-]{16,}/g, "[redacted-key]"],
  [/Bearer\s+[^\s"',]+/gi, "Bearer [redacted]"],
  [/\b(key|token|secret|password|cookie|session)=[^\s&"',;]+/gi, "$1=[redacted]"],
  [/[A-Za-z0-9_-]{40,}/g, "[redacted]"],
];

// Error text can carry a URL with a key in it or a provider's raw reply.
export function sanitize(text: unknown, max = 300): string {
  let s = text instanceof Error ? `${text.name}: ${text.message}` : String(text ?? "");
  for (const [re, to] of SECRET_TEXT) s = s.replace(re, to);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function write(level: Level, event: string, fields: Fields): void {
  try {
    const c = store.getStore();
    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      event,
      userId: fields.userId !== undefined ? fields.userId : (c?.userId ?? null),
      username: fields.username !== undefined ? fields.username : (c?.username ?? null),
      tripId: fields.tripId ?? null,
      action: fields.action ?? null,
      status: fields.status ?? null,
      message: sanitize(fields.message ?? ""),
    };
    if (c) entry.requestId = c.requestId;
    for (const [k, v] of Object.entries(fields)) {
      if (k in entry && k !== "requestId") continue;
      if (v === undefined || (SECRET_KEY.test(k) && !USAGE_KEY.test(k))) continue;
      entry[k] = v;
    }
    const line = `${JSON.stringify(entry)}\n`;
    if (level === "INFO") process.stdout.write(line);
    else process.stderr.write(line);
  } catch {
    // a log line must never take a request down with it
  }
}

export const log = {
  info: (event: string, fields: Fields = {}) => write("INFO", event, fields),
  warn: (event: string, fields: Fields = {}) => write("WARN", event, fields),
  error: (event: string, fields: Fields = {}) => write("ERROR", event, fields),
};
