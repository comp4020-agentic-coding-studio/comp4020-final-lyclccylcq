import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

// "It works on a phone" and "labels stay readable" are README promises that
// broke once already in the first build (inputs squeezed until the numbers were
// cut off; name tags spilling into the next zone). jsdom can't lay a page out,
// so this drives a real headless Chrome over the DevTools protocol, with no
// extra dependency. GitHub's ubuntu runners ship Chrome; set CHROME_PATH if
// yours lives elsewhere.
const baseUrl = inject("baseUrl");
const chromePath = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].find((p) => p && existsSync(p));

const VIEWPORTS = [
  { name: "desktop 1920×1080", width: 1920, height: 1080, mobile: false },
  { name: "phone 390×844", width: 390, height: 844, mobile: true },
];

type Send = (method: string, params?: Record<string, unknown>) => Promise<{ result?: any }>;
let chrome: ChildProcess;
let ws: WebSocket;
let send: Send;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const passes: string[] = [];

async function post(path: string, body: unknown, pass?: string) {
  const res = await fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", ...(pass ? { authorization: `Bearer ${pass}` } : {}) },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function evaluate<T>(expression: string): Promise<T> {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return r.result.result.value as T;
}

async function open(path: string, vp: (typeof VIEWPORTS)[number], pass?: string) {
  await send("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile });
  await send("Page.navigate", { url: new URL(path, baseUrl).href });
  await sleep(500);
  if (pass) {
    await evaluate(`localStorage.setItem("same-gym.pass", ${JSON.stringify(pass)})`);
    await send("Page.reload");
  }
  await sleep(900);
}

beforeAll(async () => {
  if (!chromePath) return;
  const port = 9400 + Math.floor(Math.random() * 500);
  chrome = spawn(chromePath, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), "gym-chrome-"))}`,
    "about:blank",
  ], { stdio: "ignore" });
  let targets: { type: string; webSocketDebuggerUrl: string }[] = [];
  for (let i = 0; i < 100 && !targets.length; i++) {
    try {
      targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((t: { type: string }) => t.type === "page");
    } catch {
      await sleep(100);
    }
  }
  ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  const pending = new Map<number, (v: unknown) => void>();
  let id = 0;
  ws.onmessage = (m) => {
    const d = JSON.parse(String(m.data));
    pending.get(d.id)?.(d);
    pending.delete(d.id);
  };
  send = (method, params = {}) =>
    new Promise((resolve) => {
      pending.set(++id, resolve as (v: unknown) => void);
      ws.send(JSON.stringify({ id, method, params }));
    });
}, 30_000);

afterAll(async () => {
  for (const pass of passes) await post("/api/leave", {}, pass);
  ws?.close();
  chrome?.kill();
});

describe.skipIf(!chromePath)("a returning browser", () => {
  it("joins through the door, and after a reload is the same person, with only the pass stored locally", async () => {
    await open("/", VIEWPORTS[0]);
    await evaluate(`localStorage.clear()`);
    await send("Page.reload");
    await sleep(900);
    await evaluate(`(() => {
      document.querySelector('#join-form input[name=name]').value = 'Spec Returner';
      document.querySelector('#join-form').requestSubmit();
    })()`);
    await sleep(800);
    const pass = await evaluate<string>(`localStorage.getItem("same-gym.pass")`);
    expect(pass, "joining stored no pass").toBeTruthy();
    passes.push(pass);

    await send("Page.reload");
    await sleep(1200);
    const after = await evaluate<{ door: boolean; you: string | null; keys: string[] }>(`({
      door: !document.querySelector('#door').hidden,
      you: document.querySelector('.person.is-you .tag b')?.textContent ?? null,
      keys: Object.keys(localStorage),
    })`);
    expect(after.door, "a returning browser was sent back to the door").toBe(false);
    expect(after.you).toContain("Spec Returner");
    expect(after.keys, "the browser should keep the pass and nothing else").toEqual(["same-gym.pass"]);

    const res = await fetch(new URL("/api/me", baseUrl), { headers: { authorization: `Bearer ${pass}` } });
    expect((await res.json()).user.name).toBe("Spec Returner");
  }, 30_000);
});

describe.skipIf(!chromePath)("the gym at the marking viewports", () => {
  for (const vp of VIEWPORTS) {
    it(`${vp.name}: the floor fits, labels stay in their zones, logging is usable`, async () => {
      // two people at the cardio station, one of them you, resting with a set
      const other = await post("/api/identity", { name: "Spec Rower", colour: "#ffb703" });
      const you = await post("/api/identity", { name: "Spec Viewport", colour: "#4d7cfe" });
      passes.push(other.pass, you.pass);
      await post("/api/sets", { exercise: "Rower", amount: 12 }, other.pass);
      await post("/api/sets", { exercise: "Bike", amount: 20 }, you.pass);

      await open("/", vp, you.pass);
      await evaluate(`document.querySelector('[data-station="cardio"] .zone-hit').click()`);
      await sleep(300);

      const page = await evaluate<{
        overflow: number;
        mine: boolean;
        tags: { name: string; inside: boolean; font: number }[];
      }>(`(() => {
        const box = (el) => el.getBoundingClientRect();
        const zone = document.querySelector('[data-station="cardio"]');
        const z = box(zone);
        const tags = [...zone.querySelectorAll(".person")].map((p) => {
          const t = box(p.querySelector(".tag"));
          return {
            name: p.querySelector(".tag b").textContent,
            inside: t.left >= z.left - 1 && t.right <= z.right + 1 && t.top >= z.top - 1 && t.bottom <= z.bottom + 1,
            font: parseFloat(getComputedStyle(p.querySelector(".tag")).fontSize),
          };
        });
        return { overflow: document.documentElement.scrollWidth - innerWidth, mine: !!zone.querySelector(".person.is-you"), tags };
      })()`);

      // a weighted station puts weight and reps side by side, which is where
      // the inputs got squeezed
      await evaluate(`document.querySelector('[data-station="pull"] .zone-hit').click()`);
      await sleep(200);
      await evaluate(`document.querySelector('[data-exercise="Lat Pulldown"]').click()`);
      await sleep(600);
      const form = await evaluate<{
        button: { left: number; right: number; height: number } | null;
        inputs: { clipped: boolean; width: number }[];
      }>(`(() => {
        const box = (el) => el.getBoundingClientRect();
        const b = document.querySelector("#set-form .primary");
        return {
          button: b && { left: box(b).left, right: box(b).right, height: box(b).height },
          inputs: [...document.querySelectorAll("#set-form input")].map((i) => ({ clipped: i.scrollWidth > i.clientWidth, width: box(i).width })),
        };
      })()`);

      expect(page.overflow, "the page scrolls sideways").toBeLessThanOrEqual(0);
      expect(page.mine, "you aren't standing at the station you're training at").toBe(true);
      for (const t of page.tags) {
        expect(t.inside, `${t.name}'s label spills out of the cardio zone`).toBe(true);
        expect(t.font, `${t.name}'s label is too small to read`).toBeGreaterThanOrEqual(10);
      }
      expect(form.button, "no Finish set button").not.toBeNull();
      expect(form.button!.left).toBeGreaterThanOrEqual(0);
      expect(form.button!.right).toBeLessThanOrEqual(vp.width);
      expect(form.button!.height, "Finish set is too small to tap").toBeGreaterThanOrEqual(40);
      expect(form.inputs.length, "weight and reps should both be there").toBe(2);
      for (const input of form.inputs) {
        expect(input.clipped, "a set input is too narrow to show its value").toBe(false);
        expect(input.width).toBeGreaterThanOrEqual(60);
      }
    }, 30_000);

    it(`${vp.name}: /readme/ reads without sideways scrolling`, async () => {
      await open("/readme/", vp);
      expect(await evaluate<number>("document.documentElement.scrollWidth - innerWidth")).toBeLessThanOrEqual(0);
    }, 30_000);
  }
});
