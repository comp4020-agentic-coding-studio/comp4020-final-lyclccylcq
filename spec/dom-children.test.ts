import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// h() and fill() in public/ui.js skip false/null/undefined children, but the
// DOM's own replaceChildren()/append()/prepend() write them out as the text
// "false" or "undefined". So `cond && h(...)` may only go through h() or fill().

function args(src: string, start: number): string[] {
  const out: string[] = [];
  let depth = 1, cur = "", quote: string | null = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      cur += c;
      if (c === "\\") cur += src[++i];
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c) && --depth === 0) break;
    else if (c === "," && depth === 1) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  return [...out, cur];
}

function topLevel(arg: string): string {
  let out = "", depth = 0, quote: string | null = null;
  for (let i = 0; i < arg.length; i++) {
    const c = arg[i];
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (depth === 0) out += c;
  }
  return out;
}

describe("client rendering", () => {
  it("never passes a maybe-false child to the DOM's own replaceChildren/append/prepend", () => {
    const offenders: string[] = [];
    for (const file of readdirSync("public").filter((f) => f.endsWith(".js"))) {
      const src = readFileSync(`public/${file}`, "utf8");
      for (const m of src.matchAll(/\.(replaceChildren|append|prepend)\(/g)) {
        for (const a of args(src, m.index! + m[0].length)) {
          const top = topLevel(a);
          if (/&&|\|\|/.test(top) && !top.includes("?")) {
            offenders.push(`public/${file}:${src.slice(0, m.index).split("\n").length} ${m[1]}(${a.trim().split("\n")[0].slice(0, 60)}…)`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
