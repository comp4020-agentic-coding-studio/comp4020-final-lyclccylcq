// The site's two languages (November 2026): English, the default and the
// source of every string, and Simplified Chinese. A person picks one in the
// header (the profile menu, or beside Sign in); signed in, it's saved to
// their account (PATCH /api/me/profile { lang }), otherwise in this browser.
//
// t("English text", { name: value }) returns the Chinese for that exact text
// when Chinese is on and a translation exists, else the English, with
// {name} placeholders filled in either way. The English is the key, so a
// string without a translation still reads correctly. Dictionaries live in
// /i18n/*.js, one per part of the site; spec/i18n.test.ts checks that every
// t("…") in public/ has an entry.
//
// Messages that come from the server (errors, review notes, Google's own
// messages) are English on the wire: a trip snapshot goes to every member,
// whatever their language. tServer() translates them here, exact text first,
// then the patterns for messages with numbers or names in them.
// What people write (titles, notes, names) is never translated.

import { ZH as APP } from "/i18n/app.js";
import { ZH as EDITOR } from "/i18n/editor.js";
import { ZH as HOME } from "/i18n/home.js";
import { ZH as PAGES } from "/i18n/pages.js";
import { ZH as PLACES } from "/i18n/places.js";
import { PATTERNS, ZH as SERVER } from "/i18n/server.js";

const DICT = { ...SERVER, ...APP, ...HOME, ...PAGES, ...PLACES, ...EDITOR };
const KEY = "wayline.lang";

let lang = initial();

function initial() {
  try {
    return localStorage.getItem(KEY) === "zh" ? "zh" : "en";
  } catch {
    return "en";
  }
}

export const getLang = () => lang;

// Sets the language for this page (and remembers it in this browser). The
// caller re-renders; saving it to the account is app.js's job.
export function setLang(next) {
  lang = next === "zh" ? "zh" : "en";
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // private mode: this page still switches
  }
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en-AU";
  document.title = lang === "zh" ? "Wayline · 一起规划旅行" : "Wayline · plan trips together";
}

const fillIn = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k]))) : s);

export function t(en, vars) {
  if (lang === "zh") {
    const zh = DICT[en];
    if (zh !== undefined) return fillIn(zh, vars);
  }
  return fillIn(en, vars);
}

// English or Chinese by count: tn(n, "{n} stop", "{n} stops"); Chinese has
// one form, the plural's entry
export const tn = (n, one, many, vars = {}) => t(n === 1 ? one : many, { n, ...vars });

// A message from the server, in the reader's language when we know it
export function tServer(msg) {
  if (lang !== "zh" || typeof msg !== "string" || !msg) return msg;
  if (DICT[msg] !== undefined) return DICT[msg];
  for (const [re, zh] of PATTERNS) {
    const m = re.exec(msg);
    if (m) return typeof zh === "function" ? zh(...m.slice(1)) : zh.replace(/\$(\d)/g, (_, i) => m[Number(i)] ?? "");
  }
  return msg;
}

// Dates and numbers in the reader's language
export const locale = () => (lang === "zh" ? "zh-CN" : "en-AU");

if (typeof document !== "undefined") document.documentElement.lang = lang === "zh" ? "zh-CN" : "en-AU";
