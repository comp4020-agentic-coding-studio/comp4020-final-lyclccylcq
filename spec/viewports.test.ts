import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

// "The gym is the main view", "you start a set from the machine", "it works
// on a phone" and "what you do moves your character" are README promises that only a real browser can check; the
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
    const res0 = await fetch(new URL("/api/me", baseUrl), { headers: { authorization: `Bearer ${pass}` } });
    const { locker } = await res0.json();
    expect(await evaluate<string>(`document.querySelector(".locker-spot.is-mine")?.dataset.locker`), "the same locker isn't marked yours").toBe(String(locker));
    expect(after.keys, "the browser should keep the pass and nothing else").toEqual(["same-gym.pass"]);

    const res = await fetch(new URL("/api/me", baseUrl), { headers: { authorization: `Bearer ${pass}` } });
    expect((await res.json()).user.name).toBe("Spec Returner");

    // a refresh mid-set keeps you on the machine; opening the gym afresh
    // (a new tab: no session) starts you at the entrance, the set unrecorded
    await post("/api/start", { machine: "dbbench-b", exercise: "Dumbbell Bench Press", weightKg: 16, amount: 10 }, pass);
    await send("Page.reload");
    await sleep(1400);
    expect(await evaluate<string>(`(() => { const p = document.querySelector(".person.is-you"); return p.dataset.kind + "/" + p.dataset.mode; })()`)).toBe("dbbench/use");
    await evaluate(`sessionStorage.clear()`);
    await send("Page.reload");
    await sleep(1600);
    expect(await evaluate<string>(`document.querySelector(".person.is-you").dataset.kind`), "a new visit didn't start at the entrance").toBe("entrance");
    const fresh = await (await fetch(new URL("/api/me", baseUrl), { headers: { authorization: `Bearer ${pass}` } })).json();
    expect(fresh.presence).toMatchObject({ state: "idle", spot: "entrance", machine: null });
    expect(fresh.session?.sets ?? [], "the unfinished set was recorded").toEqual([]);
  }, 30_000);
});

describe.skipIf(!chromePath)("the gym at the marking viewports", () => {
  for (const vp of VIEWPORTS) {
    it(`${vp.name}: you start at the entrance, walk to a machine before setting it up, and can change every set`, async () => {
      // two people on neighbouring bikes; you have just walked in
      const busy = await post("/api/identity", { name: "Spec Cyclist", colour: "#ffb703" });
      const resting = await post("/api/identity", { name: "Spec Rester", colour: "#2ec4b6" });
      const you = await post("/api/identity", { name: "Spec Viewport", colour: "#4d7cfe" });
      passes.push(busy.pass, resting.pass, you.pass);
      await post("/api/start", { machine: "bike-a", exercise: "Exercise Bike", amount: 20 }, busy.pass);
      await post("/api/start", { machine: "bike-b", exercise: "Exercise Bike", amount: 20 }, resting.pass);
      await post("/api/finish", {}, resting.pass);
      await open("/", vp, you.pass);

      // the part of the gym you can actually see: not under the panel
      const lookAt = `(() => {
        const box = (el) => el.getBoundingClientRect();
        const view = box(document.querySelector("#world-scroll"));
        const p = document.querySelector("#panel");
        const panel = p.hidden ? null : box(p);
        const visible = { left: view.left, top: view.top, right: panel && !${vp.mobile} ? panel.left : view.right, bottom: panel && ${vp.mobile} ? panel.top : view.bottom };
        return [...document.querySelectorAll(".person")].map((p) => {
          const t = box(p.querySelector(".tag"));
          return {
            name: p.querySelector(".tag b").textContent,
            you: p.classList.contains("is-you"),
            mode: p.dataset.mode,
            kind: p.dataset.kind,
            machine: p.dataset.machine,
            tag: { left: t.left, right: t.right, top: t.top, bottom: t.bottom },
            inView: t.left >= visible.left && t.right <= visible.right && t.top >= visible.top && t.bottom <= visible.bottom,
            font: parseFloat(getComputedStyle(p.querySelector(".tag")).fontSize),
          };
        });
      })()`;
      type Seen = { name: string; you: boolean; mode: string; kind: string; machine: string; tag: { left: number; right: number; top: number; bottom: number }; inView: boolean; font: number };
      const mine = async () => (await evaluate<Seen[]>(lookAt)).find((p) => p.you)!;
      const panel = () => evaluate<{ hidden: boolean; view: string }>(`({ hidden: document.querySelector("#panel").hidden, view: document.querySelector("#panel").dataset.view })`);
      const until = (cond: string) =>
        evaluate(`new Promise((done) => {
          const t0 = performance.now();
          (function check() { if ((${cond}) || performance.now() - t0 > 6000) done(); else setTimeout(check, 100); })();
        })`);
      const fill = (form: string, values: Record<string, string>) =>
        evaluate(`(() => { const f = document.querySelector("${form}"); for (const [k, v] of Object.entries(${JSON.stringify(values)})) f.elements[k].value = v; f.requestSubmit(); })()`);
      const me = async () => (await fetch(new URL("/api/me", baseUrl), { headers: { authorization: `Bearer ${you.pass}` } })).json();

      const room = await evaluate<{ overflow: number; larger: boolean; pixelated: string; scale: number; hotspots: number }>(`(() => {
        const scroller = document.querySelector("#world-scroll");
        const canvas = document.querySelector("#world-canvas");
        return {
          overflow: document.documentElement.scrollWidth - innerWidth,
          larger: scroller.scrollWidth > scroller.clientWidth && scroller.scrollHeight > scroller.clientHeight,
          pixelated: getComputedStyle(canvas).imageRendering,
          scale: canvas.getBoundingClientRect().width / canvas.width,
          hotspots: document.querySelectorAll(".hotspot[data-machine][aria-label]").length,
        };
      })()`);
      const { machines } = await (await fetch(new URL("/api/floor", baseUrl))).json();
      expect(room.overflow, "the page scrolls sideways").toBeLessThanOrEqual(0);
      expect(room.larger, "the gym should be a room you look around, not shrunk to fit").toBe(true);
      expect(room.pixelated, "pixel art must not be smoothed").toBe("pixelated");
      expect(room.scale, "the pixel world is shrunk too small to read").toBeGreaterThanOrEqual(2);
      expect(room.hotspots, "every machine should be something you can tap").toBe(machines.length);

      expect(await mine(), "you should start at the entrance").toMatchObject({ kind: "entrance", mode: "idle", inView: true });
      const bikes = (await evaluate<Seen[]>(lookAt)).filter((p) => p.machine.startsWith("bike"));
      expect(bikes.map((p) => p.mode).sort()).toEqual(["rest", "use"]);
      const [a, b] = bikes;
      const overlap = a.tag.left < b.tag.right && b.tag.left < a.tag.right && a.tag.top < b.tag.bottom && b.tag.top < a.tag.bottom;
      expect(overlap, "two neighbours' name tags overlap").toBe(false);
      for (const p of bikes) expect(p.font, `${p.name}'s name tag is too small to read`).toBeGreaterThanOrEqual(10);

      // tapping the lat pulldown walks you there first; the setup waits for you to arrive
      await evaluate(`document.querySelector('.hotspot[data-machine="pulldown-a"]').click()`);
      await sleep(250);
      expect((await panel()).hidden, "the setup opened before you walked over").toBe(true);
      expect((await mine()).mode).toBe("walk");
      await until(`!document.querySelector("#panel").hidden`);
      expect(await panel()).toMatchObject({ hidden: false, view: "setup" });
      expect(await mine()).toMatchObject({ kind: "pulldown", mode: "idle" });

      // the setup form fits and can be used; weight and reps sit side by
      // side, which is where the inputs once got squeezed
      const form = await evaluate<{
        button: { left: number; right: number; bottom: number; height: number } | null;
        inputs: { clipped: boolean; width: number }[];
      }>(`(() => {
        const box = (el) => el.getBoundingClientRect();
        const b = document.querySelector("#start-form .primary");
        b?.scrollIntoView({ block: "nearest" });
        return {
          button: b && { left: box(b).left, right: box(b).right, bottom: box(b).bottom, height: box(b).height },
          inputs: [...document.querySelectorAll("#start-form input")].map((i) => ({ clipped: i.scrollWidth > i.clientWidth, width: box(i).width })),
        };
      })()`);
      expect(form.button, "no Start set button").not.toBeNull();
      expect(form.button!.left).toBeGreaterThanOrEqual(0);
      expect(form.button!.right).toBeLessThanOrEqual(vp.width);
      expect(form.button!.bottom).toBeLessThanOrEqual(vp.height);
      expect(form.button!.height, "Start set is too small to tap").toBeGreaterThanOrEqual(40);
      expect(form.inputs.length, "weight and reps should both be there").toBe(2);
      for (const input of form.inputs) {
        expect(input.clipped, "a set input is too narrow to show its value").toBe(false);
        expect(input.width).toBeGreaterThanOrEqual(60);
      }

      // Start set 1: you sit down and start pulling
      await fill("#start-form", { weightKg: "20", amount: "10" });
      await until(`document.querySelector(".person.is-you")?.dataset.mode === "use"`);
      await sleep(400);
      expect(await mine()).toMatchObject({ kind: "pulldown", mode: "use", inView: true });
      expect((await panel()).view).toBe("training");

      // the machine under your name tag changes from frame to frame; samples
      // at uneven gaps so no animation speed can land on the same frame
      const frames = new Set<string>();
      for (const gap of [0, 130, 280, 310]) {
        await sleep(gap);
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
      }
      expect(frames.size, "you're on the machine but not moving").toBeGreaterThan(1);

      // closing the panel mid-set only hides it; the small button brings it back
      await evaluate(`document.querySelector('#panel [data-act="hide-panel"]').click()`);
      expect((await panel()).hidden).toBe(true);
      expect((await me()).presence.state, "closing the panel changed what you're doing").toBe("training");
      expect(await evaluate<string>(`document.querySelector("#activity-button").hidden ? "" : document.querySelector("#activity-button").textContent`)).toMatch(/set in progress/i);
      await evaluate(`document.querySelector("#activity-button").click()`);
      expect(await panel()).toMatchObject({ hidden: false, view: "training" });

      // Finish set 1 with the reps you actually managed, then a heavier set 2
      await fill("#finish-form", { amount: "9" });
      await until(`document.querySelector(".person.is-you")?.dataset.mode === "rest"`);
      expect(await panel()).toMatchObject({ view: "resting" });
      expect(await evaluate<string>(`document.querySelector("#start-form .primary").textContent`)).toMatch(/set 2/i);
      await fill("#start-form", { weightKg: "25", amount: "6" });
      await until(`document.querySelector("#panel").dataset.view === "training"`);
      await evaluate(`document.querySelector("#finish-form").requestSubmit()`);
      await until(`document.querySelector("#panel").dataset.view === "resting"`);
      const after = await me();
      expect(after.session.sets.map((s: { weightKg: number; amount: number }) => `${s.weightKg}x${s.amount}`)).toEqual(["20x9", "25x6"]);

      // your locker: tap it in the room and the sets are in there, readable,
      // in a panel that fits; closing it puts you back in the gym
      await evaluate(`document.querySelector(".locker-spot.is-mine").click()`);
      await until(`document.querySelector("#panel .locker-visit")`);
      const locker = await evaluate<{ view: string; text: string; panel: { bottom: number; right: number }; smallest: number; overflow: number }>(`(() => {
        const p = document.querySelector("#panel");
        const r = p.getBoundingClientRect();
        const sizes = [...p.querySelectorAll(".locker-visit li, .locker-visit .sets span, .bests li")].map((el) => parseFloat(getComputedStyle(el).fontSize));
        return { view: p.dataset.view, text: p.innerText, panel: { bottom: r.bottom, right: r.right }, smallest: Math.min(...sizes), overflow: document.documentElement.scrollWidth - innerWidth };
      })()`);
      expect(locker.view).toBe("locker");
      expect(locker.text).toMatch(/Lat Pulldown/);
      expect(locker.text).toMatch(/20 kg × 9/);
      expect(locker.text).toMatch(/25 kg × 6/);
      expect(locker.panel.bottom, "the locker panel runs off the screen").toBeLessThanOrEqual(vp.height);
      expect(locker.panel.right).toBeLessThanOrEqual(vp.width);
      expect(locker.smallest, "locker entries are too small to read").toBeGreaterThanOrEqual(12);
      expect(locker.overflow).toBeLessThanOrEqual(0);
      await evaluate(`document.querySelector('#panel [data-act="close-locker"]').click()`);
      expect((await panel()).view).toBe("resting");

      // free the machines for the next viewport's run
      for (const p of [busy, resting, you]) await post("/api/leave", {}, p.pass);
    }, 45_000);

    it(`${vp.name}: /readme/ reads without sideways scrolling`, async () => {
      await open("/readme/", vp);
      expect(await evaluate<number>("document.documentElement.scrollWidth - innerWidth")).toBeLessThanOrEqual(0);
    }, 30_000);
  }
});
