import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join } from "node:path";
import { openDb } from "./db.ts";
import { createGym, InputError } from "./gym.ts";
import { renderMarkdown } from "./markdown.ts";

const db = openDb();
const gym = createGym(db);
const port = Number(process.env.PORT ?? 8080);

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
};

function send(res: ServerResponse, status: number, body: string | Buffer, type: string): void {
  res.writeHead(status, { "content-type": type, "cache-control": "no-cache" });
  res.end(body);
}

const json = (res: ServerResponse, status: number, data: unknown): void =>
  send(res, status, JSON.stringify(data), "application/json; charset=utf-8");

// Files only by a plain name (no slashes, no dots up front), so nothing
// outside the folder can be asked for.
function serveFile(res: ServerResponse, dir: string, name: string): boolean {
  if (!/^[\w-][\w.-]*$/.test(name)) return false;
  const path = join(dir, name);
  if (!existsSync(path)) return false;
  send(res, 200, readFileSync(path), TYPES[extname(name)] ?? "application/octet-stream");
  return true;
}

// README.md, rendered fresh each time so the page never drifts from the file.
// Its images are linked relatively (docs/x.png), which from /readme/ resolves
// to /readme/docs/x.png.
function readmePage(): string {
  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>About · Same Gym</title>
<link rel="icon" href="/favicon.svg">
<link rel="stylesheet" href="/styles.css">
</head>
<body class="readme-page">
<header class="top"><a class="brand" href="/"><span class="brand-mark" aria-hidden="true"></span>Same Gym</a><nav><a href="/">Back to the floor</a></nav></header>
<main class="readme">
${renderMarkdown(readFileSync("README.md", "utf8"))}
</main>
</body>
</html>`;
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw new InputError("That request is too large.");
  }
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new InputError("Send a JSON object.");
}

async function api(req: IncomingMessage, res: ServerResponse, route: string): Promise<void> {
  if (route === "GET /api/floor") return json(res, 200, gym.floor());

  if (route === "POST /api/identity") {
    const { name, colour } = await body(req);
    const { user } = gym.createIdentity(name, colour);
    return json(res, 201, gym.enter(user.id)); // carries the new pass
  }

  // Everything else acts as someone: the browser sends the pass it was given.
  const user = gym.userByPass(req.headers.authorization?.replace(/^Bearer\s+/i, ""));
  if (!user) return json(res, 401, { error: "No gym pass, or one this gym doesn't know." });

  switch (route) {
    case "GET /api/me":
      return json(res, 200, gym.me(user.id));
    case "POST /api/enter":
      return json(res, 200, gym.enter(user.id));
    case "POST /api/activity":
      return json(res, 200, gym.choose(user.id, (await body(req)).exercise));
    case "POST /api/sets":
      return json(res, 201, gym.logSet(user.id, await body(req)));
    case "POST /api/leave":
      return json(res, 200, gym.leave(user.id));
  }
  json(res, 404, { error: "No such endpoint." });
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  try {
    if (pathname.startsWith("/api/")) return await api(req, res, `${req.method} ${pathname}`);
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed", "text/plain");
    if (pathname === "/readme") {
      res.writeHead(301, { location: "/readme/" });
      return res.end();
    }
    if (pathname === "/readme/") return send(res, 200, readmePage(), TYPES[".html"]);
    if (pathname.startsWith("/readme/docs/") && serveFile(res, "docs", pathname.slice(13))) return;
    if (serveFile(res, "public", pathname === "/" ? "index.html" : pathname.slice(1))) return;
    send(res, 404, "Not found", "text/plain; charset=utf-8");
  } catch (err) {
    if (err instanceof InputError) return json(res, err.status, { error: err.message });
    console.error(err);
    json(res, 500, { error: "Something went wrong on our side." });
  }
});

server.listen(port, "0.0.0.0", () => console.log(`gym open on http://localhost:${port}`));

// Fly stops the machine when nobody's around; close the database cleanly.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    db.close();
    process.exit(0);
  });
}
