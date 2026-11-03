import { AsyncLocalStorage } from "node:async_hooks";

// The site language of the request being handled (November 2026): the
// person's account choice, or a visitor's (the page sends x-wayline-lang).
// Google answers in it, and Wayline's own curated content is served in it.
// Messages in API errors and in trip snapshots stay English on the server:
// a snapshot goes to every member, whatever language each chose, so the
// browser translates them (public/i18n.js).
export type Lang = "en" | "zh";

const current = new AsyncLocalStorage<Lang>();
export const withLang = <T>(lang: Lang, fn: () => T): T => current.run(lang, fn);
export const requestLang = (): Lang => current.getStore() ?? "en";
export const parseLang = (v: unknown): Lang => (v === "zh" ? "zh" : "en");
