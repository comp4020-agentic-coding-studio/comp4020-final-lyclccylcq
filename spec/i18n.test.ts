import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Every string the page passes to t() / tn() has a Chinese entry, so
// switching to 中文 never leaves English behind by accident; and no entry
// is orphaned or mangles a {placeholder}. Reads the source files: the
// dictionaries are plain modules.
const PUBLIC = join(import.meta.dirname, "..", "public");
const files = readdirSync(PUBLIC).filter((f) => f.endsWith(".js") && f !== "i18n.js");

async function dictionary(): Promise<Record<string, string>> {
  const all: Record<string, string> = {};
  for (const f of readdirSync(join(PUBLIC, "i18n"))) {
    const mod = await import(join(PUBLIC, "i18n", f));
    Object.assign(all, mod.ZH);
  }
  return all;
}

// t("…"), t('…'), tn(n, "…", "…") with literal strings only
function keys(): Map<string, string> {
  const out = new Map<string, string>();
  const lit = `"((?:[^"\\\\]|\\\\.)*)"`;
  const reT = new RegExp(`\\bt\\(\\s*${lit}`, "g");
  const reTn = new RegExp(`\\btn\\([^,]+,\\s*${lit}\\s*,\\s*${lit}`, "g");
  for (const f of files) {
    const src = readFileSync(join(PUBLIC, f), "utf8");
    for (const m of src.matchAll(reT)) out.set(JSON.parse(`"${m[1]}"`), f);
    for (const m of src.matchAll(reTn)) {
      out.set(JSON.parse(`"${m[1]}"`), f);
      out.set(JSON.parse(`"${m[2]}"`), f);
    }
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("the Chinese translation", () => {
  it("has an entry for every string the page translates", async () => {
    const zh = await dictionary();
    const missing = [...keys()].filter(([k]) => zh[k] === undefined).map(([k, f]) => `${f}: ${k}`);
    expect(missing).toEqual([]);
  });

  it("keeps each entry's {placeholders}, and isn't left in English", async () => {
    const zh = await dictionary();
    const broken = Object.entries(zh).filter(([en, cn]) => placeholders(en).join() !== placeholders(cn).join()).map(([en]) => en);
    expect(broken).toEqual([]);
    const untranslated = Object.entries(zh).filter(([en, cn]) => /[a-z]{3,}/i.test(en) && cn === en).map(([en]) => en);
    expect(untranslated).toEqual([]);
  });
});
