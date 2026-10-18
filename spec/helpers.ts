import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createServer as httpServer, type Server } from "node:http";
import { type AddressInfo, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A signed-in person talking to the app over HTTP, cookie and all.
export type Client = {
  userId: string;
  cookie: string;
  get(path: string): Promise<{ status: number; data: any }>;
  send(method: string, path: string, body?: unknown): Promise<{ status: number; data: any }>;
};

let seq = 0;
export const uniqueName = (prefix = "spec") =>
  `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 8)}`.slice(0, 32);

export async function signUp(baseUrl: string, name = uniqueName()): Promise<Client> {
  const res = await fetch(new URL("/api/auth/signup", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: name, password: "correct horse battery", displayName: name }),
  });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${await res.text()}`);
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  const { user } = (await res.json()) as { user: { id: string } };
  return client(baseUrl, cookie, user.id);
}

export async function logIn(baseUrl: string, username: string, password = "correct horse battery"): Promise<Client> {
  const res = await fetch(new URL("/api/auth/login", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  const { user } = (await res.json()) as { user: { id: string } };
  return client(baseUrl, cookie, user.id);
}

export function client(baseUrl: string, cookie: string, userId: string): Client {
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(new URL(path, baseUrl), {
      method,
      headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return { userId, cookie, get: (p) => call("GET", p), send: call };
}

export const anon = (baseUrl: string) => client(baseUrl, "", "");

export async function newTrip(c: Client, over: Record<string, unknown> = {}) {
  const res = await c.send("POST", "/api/trips", {
    title: "Spec trip",
    destination: "Sydney",
    startDate: "2026-12-01",
    endDate: "2026-12-03",
    timezone: "Australia/Sydney",
    ...over,
  });
  if (res.status !== 201) throw new Error(`create trip failed: ${res.status} ${JSON.stringify(res.data)}`);
  return res.data;
}

export async function addActivity(c: Client, trip: any, over: Record<string, unknown> = {}) {
  return c.send("POST", `/api/trips/${trip.id}/activities`, {
    clientId: `spec-${Math.random().toString(36).slice(2)}`,
    dayId: trip.days[0].id,
    title: "Somewhere",
    kind: "custom",
    startMin: 9 * 60,
    durationMin: 60,
    ...over,
  });
}

// Adds a collaborator the way people do: the owner makes a link, the guest
// asks to join through it, the owner approves.
export async function share(owner: Client, guest: Client, tripId: string) {
  const { data } = await owner.send("POST", `/api/trips/${tripId}/invite`, {});
  await requestAndApprove(owner, guest, tripId, data.token);
  return data.token as string;
}

export async function requestAndApprove(owner: Client, guest: Client, tripId: string, token: string) {
  const asked = await guest.send("POST", `/api/invites/${token}/request`, {});
  if (asked.status !== 201 && asked.status !== 200) throw new Error(`join request failed: ${asked.status} ${JSON.stringify(asked.data)}`);
  const ok = await owner.send("POST", `/api/trips/${tripId}/requests/${asked.data.requestId}/approve`, {});
  if (ok.status !== 200) throw new Error(`approve failed: ${ok.status} ${JSON.stringify(ok.data)}`);
  return asked.data.requestId as string;
}

// Reads a trip's event stream (or, with tripId null, the person's own
// stream) and resolves when an event matches.
export function watchEvents(baseUrl: string, c: Client, tripId: string | null, session?: string) {
  const ac = new AbortController();
  const events: { event: string; data: any; at: number }[] = [];
  const waiters: { test: (e: { event: string; data: any }) => boolean; resolve: (e: any) => void }[] = [];
  const path = tripId === null ? "/api/me/events" : `/api/trips/${tripId}/events${session ? `?session=${session}` : ""}`;
  const ready = (async () => {
    const res = await fetch(new URL(path, baseUrl), { headers: { cookie: c.cookie }, signal: ac.signal });
    if (!res.ok || !res.body) throw new Error(`events: ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf("\n\n")) !== -1) {
            const chunk = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const event = /^event: (.*)$/m.exec(chunk)?.[1];
            const data = /^data: (.*)$/m.exec(chunk)?.[1];
            if (!event || data === undefined) continue;
            const e = { event, data: JSON.parse(data), at: Date.now() };
            events.push(e);
            for (const w of [...waiters]) if (w.test(e)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(e); }
          }
        }
      } catch {
        // aborted
      }
    })();
    return res.status;
  })();
  return {
    ready,
    events,
    next(test: (e: { event: string; data: any }) => boolean, timeoutMs = 3000): Promise<{ event: string; data: any; at: number }> {
      const hit = events.find(test);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("no matching event in time")), timeoutMs);
        waiters.push({ test, resolve: (e) => { clearTimeout(t); resolve(e); } });
      });
    },
    close: () => ac.abort(),
  };
}

// A second, private copy of the app on its own port and database, for what
// the shared app under test can't show: a restart, or a particular config.
// A port the OS says is free, so parallel test files never collide.
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

export async function startApp(env: Record<string, string> = {}, dataDir = mkdtempSync(join(tmpdir(), "wayline-spec-"))) {
  const port = await freePort();
  const proc: ChildProcess = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/server.ts"], {
    env: {
      PATH: process.env.PATH ?? "",
      PORT: String(port),
      DATA_DIR: dataDir,
      GOOGLE_MAPS_SERVER_KEY: "",
      GOOGLE_MAPS_BROWSER_KEY: "",
      OPENAI_API_KEY: "",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const url = `http://127.0.0.1:${port}`;
  let output = "";
  proc.stdout?.on("data", (d) => (output += d));
  proc.stderr?.on("data", (d) => (output += d));
  let exited = false;
  proc.once("exit", () => (exited = true));
  for (let i = 0; ; i++) {
    if (exited) throw new Error(`the app on port ${port} exited before answering`);
    try {
      await fetch(url);
      break;
    } catch {
      if (i > 100) throw new Error(`the app on port ${port} never answered`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return {
    url,
    dataDir,
    // everything the app has printed so far (stdout and stderr)
    output: () => output,
    stop: () =>
      new Promise<void>((resolve) => {
        if (exited) return resolve();
        proc.once("exit", () => resolve());
        proc.kill("SIGTERM");
      }),
  };
}

// A stand-in for the model provider's Messages API, on a local port: the
// app's real request, parsing and limits code runs, and no model is called.
export type Reply = (body: any) => { status?: number; body: unknown; delayMs?: number };
export function stubProvider(): Promise<{ url: string; seen: { headers: any; body: any; url: string }[]; reply: { fn: Reply }; server: Server }> {
  const seen: { headers: any; body: any; url: string }[] = [];
  const reply: { fn: Reply } = { fn: () => ({ status: 500, body: {} }) }; // each test sets its reply
  const server = httpServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const body = JSON.parse(raw);
    seen.push({ headers: req.headers, body, url: req.url ?? "" });
    const r = reply.fn(body);
    if (r.delayMs) await new Promise((x) => setTimeout(x, r.delayMs));
    res.writeHead(r.status ?? 200, { "content-type": "application/json" });
    res.end(JSON.stringify(r.body));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen, reply, server })));
}
// Replies in the Responses API's shape (what the official SDK parses).
export const response = (over: Record<string, unknown> = {}, outputText: string | null = null, usage = { input_tokens: 100, output_tokens: 50 }) => ({
  id: "resp_test",
  object: "response",
  created_at: 0,
  model: "test-model",
  status: "completed",
  incomplete_details: null,
  error: null,
  output: outputText === null ? [] : [{ id: "msg_test", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: outputText, annotations: [] }] }],
  usage: { input_tokens: usage.input_tokens, input_tokens_details: { cached_tokens: 0 }, output_tokens: usage.output_tokens, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: usage.input_tokens + usage.output_tokens },
  ...over,
});
export const text = (obj: unknown, usage?: { input_tokens: number; output_tokens: number }) => ({ body: response({}, JSON.stringify(obj), usage) });
export const rawText = (s: string) => ({ body: response({}, s) });
export const refusal = () => ({ body: response({ output: [{ id: "msg_r", type: "message", role: "assistant", status: "completed", content: [{ type: "refusal", refusal: "I can't help with that." }] }] }) });
export const truncated = () => ({ body: response({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }, '{"summary": "cut') });
