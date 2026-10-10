/** Split `text` around the first occurrence of `excerpt` (whitespace-insensitive fallback). */
export function splitAroundExcerpt(text: string, excerpt: string): { before: string; match: string; after: string } | null {
  if (!excerpt) return null;
  let i = text.indexOf(excerpt);
  if (i >= 0) return { before: text.slice(0, i), match: excerpt, after: text.slice(i + excerpt.length) };
  // whitespace-insensitive: build a regex from the excerpt's words
  const words = excerpt.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length || words.join("").length < 8) return null;
  const re = new RegExp(words.join("\\s+"));
  const m = re.exec(text);
  if (!m) return null;
  i = m.index;
  return { before: text.slice(0, i), match: m[0], after: text.slice(i + m[0].length) };
}
