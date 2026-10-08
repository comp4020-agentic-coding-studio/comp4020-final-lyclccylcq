import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Drives a real headless Chrome over the DevTools protocol, with no extra
// dependency: jsdom can't lay a page out, and "usable at 390px" or "the
// other person sees it" need a real browser. Each page gets its own browser
// context, so two pages are two people with separate cookies. GitHub's ubuntu
// runners ship Chrome; set CHROME_PATH if yours lives elsewhere.
export const chromePath = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].find((p) => p && existsSync(p));

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type Page = {
  goto(url: string): Promise<void>;
  viewport(width: number, height: number, mobile?: boolean): Promise<void>;
  eval<T = unknown>(expression: string): Promise<T>;
  waitFor(expression: string, timeoutMs?: number): Promise<number>;
  click(selector: string): Promise<void>;
  screenshot(path: string): Promise<void>;
};

export async function launch() {
  if (!chromePath) return null;
  const port = 9300 + Math.floor(Math.random() * 600);
  const chrome: ChildProcess = spawn(
    chromePath,
    ["--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "wayline-chrome-"))}`, "about:blank"],
    { stdio: "ignore" },
  );
  let wsUrl = "";
  for (let i = 0; i < 100 && !wsUrl; i++) {
    try {
      wsUrl = ((await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as { webSocketDebuggerUrl: string }).webSocketDebuggerUrl;
    } catch {
      await sleep(100);
    }
  }
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => (ws.onopen = r));
  const pending = new Map<number, (v: any) => void>();
  let id = 0;
  ws.onmessage = (m) => {
    const d = JSON.parse(String(m.data));
    if (d.id !== undefined) {
      pending.get(d.id)?.(d);
      pending.delete(d.id);
    }
  };
  const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, (d) => (d.error ? reject(new Error(`${method}: ${d.error.message}`)) : resolve(d.result)));
      ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

  async function newPage(): Promise<Page> {
    const { browserContextId } = await send("Target.createBrowserContext");
    const { targetId } = await send("Target.createTarget", { url: "about:blank", browserContextId });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const s = (m: string, p: Record<string, unknown> = {}) => send(m, p, sessionId);
    await s("Page.enable");
    await s("Runtime.enable");
    const page: Page = {
      async goto(url) {
        await s("Page.navigate", { url });
        await page.waitFor("document.readyState === 'complete'");
      },
      async viewport(width, height, mobile = false) {
        await s("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
      },
      async eval<T>(expression: string) {
        const r = await s("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error(`page threw: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
        return r.result.value as T;
      },
      async waitFor(expression, timeoutMs = 5000) {
        const start = Date.now();
        for (;;) {
          if (await page.eval<boolean>(`Boolean(${expression})`).catch(() => false)) return Date.now() - start;
          if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for: ${expression}`);
          await sleep(25);
        }
      },
      async click(selector) {
        const ok = await page.eval<boolean>(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
        if (!ok) throw new Error(`nothing to click at ${selector}`);
      },
      async screenshot(path) {
        const { data } = await s("Page.captureScreenshot", { format: "png" });
        writeFileSync(path, Buffer.from(data, "base64"));
      },
    };
    return page;
  }

  return {
    newPage,
    close() {
      ws.close();
      chrome.kill();
    },
  };
}

// Signs up inside the page, so the session cookie lands in that page's context.
export async function signUpIn(page: Page, baseUrl: string, name: string) {
  await page.goto(new URL("/readme/", baseUrl).href);
  return page.eval<{ id: string }>(
    `fetch("/api/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: ${JSON.stringify(name)}, password: "correct horse battery", displayName: ${JSON.stringify(name)} }) }).then(r => r.json()).then(d => d.user)`,
  );
}

export const inPage = (page: Page, method: string, path: string, body?: unknown) =>
  page.eval<any>(
    `fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, headers: { "content-type": "application/json" }${body === undefined ? "" : `, body: ${JSON.stringify(JSON.stringify(body))}`} }).then(r => r.json())`,
  );
