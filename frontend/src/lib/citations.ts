import type { Parent, Root, Text } from "mdast";
import { visit } from "unist-util-visit";

export const CITATION_RE = /\[\s*(S\d+(?:\s*[,;]\s*S\d+)*)\s*\]/g;

/** Split "S1, S2" into labels. */
export function splitLabels(group: string): string[] {
  return group.split(/[,;]/).map((s) => s.trim());
}

/**
 * Remark plugin: turns [S1] / [S1, S2] inside *text nodes only* into <cite-chip labels="S1,S2"> elements.
 * Tokens whose labels are all unknown are left as plain text. No raw HTML is ever produced.
 */
export function remarkCitations(known: Set<string>) {
  return () => (tree: Root) => {
    visit(tree, "text", (node: Text, index, parent: Parent | undefined) => {
      if (!parent || index === undefined) return;
      const value = node.value;
      CITATION_RE.lastIndex = 0;
      const parts: Array<Text | { type: "citation"; data: { hName: string; hProperties: { labels: string } } }> = [];
      let last = 0;
      let m: RegExpExecArray | null;
      let changed = false;
      while ((m = CITATION_RE.exec(value))) {
        const labels = splitLabels(m[1]).filter((l) => known.has(l));
        if (!labels.length) continue;
        changed = true;
        if (m.index > last) parts.push({ type: "text", value: value.slice(last, m.index) });
        parts.push({ type: "citation", data: { hName: "cite-chip", hProperties: { labels: labels.join(",") } } });
        last = m.index + m[0].length;
      }
      if (!changed) return;
      if (last < value.length) parts.push({ type: "text", value: value.slice(last) });
      parent.children.splice(index, 1, ...(parts as never[]));
      return index + parts.length;
    });
  };
}

const KINDS: Array<[RegExp, string]> = [
  [/^interpretation:?/i, "interpretation"],
  [/^insufficient evidence:?/i, "insufficient"],
];

/** Remark plugin: tag paragraphs/list items that start with a bold "Interpretation:" / "Insufficient evidence:" label. */
export function remarkEvidenceKinds() {
  return (tree: Root) => {
    visit(tree, (node) => {
      if (node.type !== "paragraph") return;
      const first = (node as Parent).children[0];
      if (first?.type !== "strong") return;
      const text = (first as Parent).children.map((c) => ("value" in c ? String(c.value) : "")).join("");
      for (const [re, kind] of KINDS) {
        if (re.test(text.trim())) {
          const n = node as unknown as { data?: Record<string, unknown> };
          n.data = { ...(n.data ?? {}), hProperties: { "data-kind": kind } };
        }
      }
    });
  };
}

export function isSafeHref(href: string | undefined): boolean {
  if (!href) return false;
  return /^(https?:|mailto:)/i.test(href.trim());
}
