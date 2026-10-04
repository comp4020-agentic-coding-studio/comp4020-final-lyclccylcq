import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

// "The gym is the main view", "it works on a phone" and "what you do moves
// your character" are README promises that only a real browser can check; the
// first build already broke one of them once (inputs squeezed until the
// numbers were cut off). jsdom can't lay a page out,
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
    it(`${vp.name}: a room larger than the screen, where choosing an exercise puts you on its machine`, async () => {
      // two people on the bikes, one of them you, resting after a set
      const other = await post("/api/identity", { name: "Spec Cyclist", colour: "#ffb703" });
      const you = await post("/api/identity", { name: "Spec Viewport", colour: "#4d7cfe" });
      passes.push(other.pass, you.pass);
      await post("/api/activity", { exercise: "Bike" }, other.pass);
      await post("/api/sets", { exercise: "Bike", amount: 20 }, you.pass);
      await open("/", vp, you.pass);

      // the part of the gym you can actually see: not under the panel
      const lookAt = `(() => {
        const box = (el) => el.getBoundingClientRect();
        const view = box(document.querySelector("#world-scroll"));
        const panel = box(document.querySelector("#panel"));
        const visible = { left: view.left, top: view.top, right: ${vp.mobile} ? view.right : panel.left, bottom: ${vp.mobile} ? panel.top : view.bottom };
        return [...document.querySelectorAll(".person")].map((p) => {
          const t = box(p.querySelector(".tag"));
          return {
            name: p.querySelector(".tag b").textContent,
            you: p.classList.contains("is-you"),
            mode: p.dataset.mode,
            station: p.dataset.station,
            tag: { left: t.left, right: t.right, top: t.top, bottom: t.bottom },
            inView: t.left >= visible.left && t.right <= visible.right && t.top >= visible.top && t.bottom <= visible.bottom,
            font: parseFloat(getComputedStyle(p.querySelector(".tag")).fontSize),
          };
        });
      })()`;
      type Seen = { name: string; you: boolean; mode: string; station: string; tag: { left: number; right: number; top: number; bottom: number }; inView: boolean; font: number };

      const room = await evaluate<{ overflow: number; larger: boolean; pixelated: string; scale: number }>(`(() => {
        const scroller = document.querySelector("#world-scroll");
        const canvas = document.querySelector("#world-canvas");
        return {
          overflow: document.documentElement.scrollWidth - innerWidth,
          larger: scroller.scrollWidth > scroller.clientWidth && scroller.scrollHeight > scroller.clientHeight,
          pixelated: getComputedStyle(canvas).imageRendering,
          scale: canvas.getBoundingClientRect().width / canvas.width,
        };
      })()`);
      expect(room.overflow, "the page scrolls sideways").toBeLessThanOrEqual(0);
      expect(room.larger, "the gym should be a room you look around, not shrunk to fit").toBe(true);
      expect(room.pixelated, "pixel art must not be smoothed").toBe("pixelated");
      expect(room.scale, "the pixel world is shrunk too small to read").toBeGreaterThanOrEqual(2);

      const bikes = (await evaluate<Seen[]>(lookAt)).filter((p) => p.station === "bike");
      const me = bikes.find((p) => p.you);
      expect(me, "you aren't at the bikes you're resting on").toBeDefined();
      expect(me!.mode).toBe("rest");
      expect(me!.inView, "the camera didn't bring you into view").toBe(true);
      const [a, b] = bikes;
      const overlap = a.tag.left < b.tag.right && b.tag.left < a.tag.right && a.tag.top < b.tag.bottom && b.tag.top < a.tag.bottom;
      expect(overlap, "two neighbours' name tags overlap").toBe(false);
      for (const p of bikes) expect(p.font, `${p.name}'s name tag is too small to read`).toBeGreaterThanOrEqual(10);

      // tap the lat pulldown: you walk over, sit down and start pulling
      await evaluate(`document.querySelector('.hotspot[data-station="pulldown"]').click()`);
      await evaluate(`new Promise((done) => {
        const t0 = performance.now();
        (function check() {
          const p = document.querySelector(".person.is-you");
          if ((p.dataset.mode === "use" && p.dataset.station === "pulldown") || performance.now() - t0 > 6000) done();
          else setTimeout(check, 100);
        })();
      })`);
      await sleep(400);
      const there = (await evaluate<Seen[]>(lookAt)).find((p) => p.you)!;
      expect(there.station).toBe("pulldown");
      expect(there.mode, "you reached the pulldown but aren't using it").toBe("use");
      expect(there.inView, "the camera didn't follow you to the machine").toBe(true);

      // the machine under your name tag changes from frame to frame
      const frames = new Set<string>();
      for (let i = 0; i < 4; i++) {
        frames.add(
          await evaluate<string>(`(() => {
            const canvas = document.querySelector("#world-canvas");
            const c = canvas.getBoundingClientRect();
            const t = document.querySelector(".person.is-you .tag").getBoundingClientRect();
            const s = c.width / canvas.width;
            const x = Math.round(((t.left + t.right) / 2 - c.left) / s) - 24;
            const y = Math.round((t.bottom - c.top) / s);
            return Array.from(canvas.getContext("2d").getImageData(x, y, 48, 48).data).join(",");
          })()`),
        );
        await sleep(350);
      }
      expect(frames.size, "you're on the machine but not moving").toBeGreaterThan(1);

      // a weighted station puts weight and reps side by side, which is where
      // the inputs once got squeezed
      const form = await evaluate<{
        button: { left: number; right: number; bottom: number; height: number } | null;
        inputs: { clipped: boolean; width: number }[];
      }>(`(() => {
        const box = (el) => el.getBoundingClientRect();
        const b = document.querySelector("#set-form .primary");
        b?.scrollIntoView({ block: "nearest" });
        return {
          button: b && { left: box(b).left, right: box(b).right, bottom: box(b).bottom, height: box(b).height },
          inputs: [...document.querySelectorAll("#set-form input")].map((i) => ({ clipped: i.scrollWidth > i.clientWidth, width: box(i).width })),
        };
      })()`);
      expect(form.button, "no Finish set button").not.toBeNull();
      expect(form.button!.left).toBeGreaterThanOrEqual(0);
      expect(form.button!.right).toBeLessThanOrEqual(vp.width);
      expect(form.button!.bottom).toBeLessThanOrEqual(vp.height);
      expect(form.button!.height, "Finish set is too small to tap").toBeGreaterThanOrEqual(40);
      expect(form.inputs.length, "weight and reps should both be there").toBe(2);
      for (const input of form.inputs) {
        expect(input.clipped, "a set input is too narrow to show its value").toBe(false);
        expect(input.width).toBeGreaterThanOrEqual(60);
      }

      // finishing the set leaves you resting beside the machine
      await evaluate(`document.querySelector("#set-form").requestSubmit()`);
      await sleep(800);
      const after = (await evaluate<Seen[]>(lookAt)).find((p) => p.you)!;
      expect(after).toMatchObject({ station: "pulldown", mode: "rest" });
    }, 40_000);

    it(`${vp.name}: /readme/ reads without sideways scrolling`, async () => {
      await open("/readme/", vp);
      expect(await evaluate<number>("document.documentElement.scrollWidth - innerWidth")).toBeLessThanOrEqual(0);
    }, 30_000);
  }
});
