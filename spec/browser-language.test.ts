import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { chromePath, inPage, launch, signUpIn } from "./browser.ts";
import { uniqueName } from "./helpers.ts";

// The site in English or Chinese (November 2026): chosen beside Sign in as a
// visitor, in the account menu when signed in, saved to the account, and
// followed by curated content. English is the default.
const baseUrl = inject("baseUrl");
let browser: NonNullable<Awaited<ReturnType<typeof launch>>>;
beforeAll(async () => {
  if (chromePath) browser = (await launch())!;
});
afterAll(() => browser?.close());

describe.skipIf(!chromePath)("choosing the site's language", () => {
  it("defaults to English, switches as a visitor, and keeps the choice in the account", async () => {
    const page = await browser.newPage();
    await page.viewport(1440, 900);
    await page.goto(new URL("/", baseUrl).href);
    await page.waitFor(`document.querySelector('.topbar .lang-switch')`, 8000);
    expect(await page.eval(`document.documentElement.lang`)).toBe("en-AU");
    expect(await page.eval<string>(`document.querySelector('.topbar').textContent`)).toContain("Sign in");

    // a visitor: beside Sign in, at once, and curated content follows
    await page.eval(`document.querySelector('.topbar .lang-switch').click()`);
    await page.waitFor(`document.documentElement.lang === 'zh-CN' && document.querySelector('.topbar').textContent.includes('登录')`, 8000);
    // the page's own requests ask in Chinese now; a plain request still gets English
    const title = await page.eval<string>(`import('/ui.js').then(m => m.api('/api/itineraries/tpl-kyoto-shrines-gion')).then(t => t.title)`);
    expect(title).toMatch(/[一-鿿]/);
    expect((await inPage(page, "GET", "/api/itineraries/tpl-kyoto-shrines-gion")).title).toBe("Kyoto: Shrines, Bamboo & Gion");

    // signing up carries the choice into the new account
    const name = uniqueName("lang");
    await page.eval(`fetch('/api/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: ${JSON.stringify(name)}, password: 'correct horse battery', displayName: ${JSON.stringify(name)}, lang: 'zh' }) })`);
    expect((await inPage(page, "GET", "/api/me/profile")).profile.lang).toBe("zh");

    // signed in: the account menu holds the profile and the language
    await page.goto(new URL("/", baseUrl).href);
    await page.waitFor(`document.querySelector('[data-me="menu"]')`, 8000);
    expect(await page.eval(`document.querySelector('.topbar .lang-switch')`)).toBe(null);
    await page.eval(`document.querySelector('[data-me="menu"]').click()`);
    await page.waitFor(`!document.querySelector('.me-menu').hidden`);
    expect(await page.eval(`document.querySelector('[data-me="menu"]').getAttribute('aria-expanded')`)).toBe("true");
    expect(await page.eval(`document.querySelector('.me-menu [data-lang="zh"]').getAttribute('aria-checked')`)).toBe("true");
    expect(await page.eval(`Boolean(document.querySelector('.me-menu a[href="/profile"]'))`)).toBe(true);
    // Escape closes it
    await page.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    await page.waitFor(`document.querySelector('.me-menu').hidden`);

    // English, from the menu: the page and the account both change
    await page.eval(`document.querySelector('[data-me="menu"]').click()`);
    await page.eval(`document.querySelector('.me-menu [data-lang="en"]').click()`);
    await page.waitFor(`document.documentElement.lang === 'en-AU' && document.querySelector('.topbar').textContent.includes('My Trips')`, 8000);
    await page.waitFor(`fetch('/api/me/profile').then(r => r.json()).then(j => j.profile.lang === 'en')`, 6000);

    // another device: a fresh browser that signs in gets the account's language
    await inPage(page, "PATCH", "/api/me/profile", { lang: "zh" });
    const other = await browser.newPage();
    await other.viewport(390, 844, true);
    await other.goto(new URL("/login", baseUrl).href);
    await other.waitFor(`document.querySelector('.auth-form [name=username]')`, 8000);
    await other.eval(`fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: ${JSON.stringify(name)}, password: 'correct horse battery' }) })`);
    await other.goto(new URL("/", baseUrl).href);
    await other.waitFor(`document.documentElement.lang === 'zh-CN' && document.querySelector('[data-me="menu"]')`, 8000);
    expect(await other.eval(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);

    // a bad value is refused and changes nothing
    expect((await inPage(page, "PATCH", "/api/me/profile", { lang: "fr" })).error).toBeTruthy();
    expect((await inPage(page, "GET", "/api/me/profile")).profile.lang).toBe("zh");
  }, 40_000);

  it("names the account menu's items in the chosen language", async () => {
    const page = await browser.newPage();
    await page.viewport(1280, 900);
    await signUpIn(page, baseUrl, uniqueName("lm"));
    await inPage(page, "PATCH", "/api/me/profile", { lang: "zh" });
    await page.goto(new URL("/", baseUrl).href);
    await page.waitFor(`document.documentElement.lang === 'zh-CN' && document.querySelector('[data-me="menu"]')`, 8000);
    await page.eval(`document.querySelector('[data-me="menu"]').click()`);
    const menu = await page.eval<string>(`document.querySelector('.me-menu').textContent`);
    expect(menu).toContain("个人信息");
    expect(menu).toContain("语言");
    expect(menu).toContain("退出登录");
    // the profile item leads to the profile
    await page.eval(`document.querySelector('.me-menu a[href="/profile"]').click()`);
    await page.waitFor(`location.pathname === '/profile' && document.querySelector('.pf-name')`, 8000);
  }, 30_000);
});
