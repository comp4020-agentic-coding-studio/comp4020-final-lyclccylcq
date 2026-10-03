// Just enough Markdown for README.md at /readme/: headings, paragraphs, lists,
// blockquotes, fenced code, links, images, emphasis and inline code. Rendered
// on the server so the page is complete before any script runs.
const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(text: string): string {
  const codes: string[] = [];
  let out = esc(text).replace(/`([^`]+)`/g, (_, c: string) => `\u0000${codes.push(c) - 1}\u0000`);
  out = out
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1" loading="lazy">')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])[*_]([^*_]+)[*_](?![*\w])/g, "$1<em>$2</em>");
  return out.replace(/\u0000(\d+)\u0000/g, (_, i: string) => `<code>${codes[Number(i)]}</code>`);
}

export function renderMarkdown(md: string): string {
  const lines = md.replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/);
  const html: string[] = [];
  let para: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;
  let quote: string[] = [];

  const flush = (): void => {
    if (para.length) html.push(`<p>${inline(para.join(" "))}</p>`);
    if (list) html.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`);
    if (quote.length) html.push(`<blockquote>${renderMarkdown(quote.join("\n"))}</blockquote>`);
    para = [];
    list = null;
    quote = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^ {0,3}(```|~~~)/.test(line)) {
      flush();
      const code: string[] = [];
      while (++i < lines.length && !/^ {0,3}(```|~~~)/.test(lines[i])) code.push(lines[i]);
      html.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
      continue;
    }
    const heading = line.match(/^ {0,3}(#{1,6})\s+(.*?)(\s+#+)?\s*$/);
    const item = line.match(/^\s*(?:([-*+])|\d+[.)])\s+(.*)$/);
    const quoted = line.match(/^\s*>\s?(.*)$/);
    if (heading) {
      flush();
      html.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
    } else if (quoted) {
      if (!quote.length) flush();
      quote.push(quoted[1]);
    } else if (item) {
      const tag = item[1] ? "ul" : "ol";
      if (!list || list.tag !== tag) flush();
      list ??= { tag, items: [] };
      list.items.push(item[2]);
    } else if (!line.trim()) {
      flush();
    } else if (list && /^\s+/.test(line)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else {
      if (list || quote.length) flush();
      para.push(line.trim());
    }
  }
  flush();
  return html.join("\n");
}
