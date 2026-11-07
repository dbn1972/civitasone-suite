/**
 * CodeQL js/polynomial-redos on stripInlineMarkdown: officer-authored minutes Markdown reached regexes that are
 * polynomial on crafted input. The inline reducer, the heading and the table-separator test are now linear scans.
 * (1) the adversarial inputs finish fast and still return sensible text; (2) the output equals the previous
 * regex implementation (kept below as the oracle) on fixed samples and on a seeded random sweep of small inputs.
 */
import { describe, expect, it } from "vitest";
import { parseMarkdown, stripInlineMarkdown } from "./markdown.js";

/** The implementation before the fix, verbatim. Only ever run on SHORT inputs here. */
function oracleStrip(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]*)\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?!\w)/g, "$1$2")
    .replace(/(^|[^\w])_(?=\S)([^_]*?\S)_(?!\w)/g, "$1$2")
    .replace(/\\([\\`*_{}[\]()#+\-.!|])/g, "$1")
    .trim();
}
const ORACLE_TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const ORACLE_HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

const N = 50_000;
const timed = <T>(f: () => T): { out: T; ms: number } => {
  const t = performance.now();
  const out = f();
  return { out, ms: performance.now() - t };
};

describe("stripInlineMarkdown is linear on adversarial input", () => {
  const cases: Array<[string, string]> = [
    ["** then spaces, no closing marker", "**" + " ".repeat(N)],
    ["** then a's, no closing marker", "**" + "a".repeat(N)],
    ["__ then a's, no closing marker", "__" + "a".repeat(N)],
    ["many ** openers, no closer", "** a ".repeat(N / 5)],
    ["![]( repeated without a closing parenthesis", "![](".repeat(N / 4)],
    ["![ repeated", "![".repeat(N / 2)],
    ["[x]( repeated without a closing parenthesis", "[x](".repeat(N / 4)],
    ["[ repeated then one ]", "[".repeat(N) + "]"],
    ["backticks, odd count", "`a".repeat(N / 2) + "`"],
    ["* a repeated, no closer", "* a".repeat(N / 3)],
    ["_ a repeated, no closer", "_ a".repeat(N / 3)],
    ["*a with no closer", "*" + "a ".repeat(N / 2)],
    ["*a* followed by a word char", "*a*b ".repeat(N / 5)],
    ["escapes", "\\*".repeat(N / 2)],
  ];
  it.each(cases)("%s", (_name, input) => {
    const { out, ms } = timed(() => stripInlineMarkdown(input));
    expect(ms).toBeLessThan(1000);
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });

  it("returns sensible text for the described attacks", () => {
    expect(stripInlineMarkdown("**" + " ".repeat(1000) + "end")).toBe("**" + " ".repeat(1000) + "end");
    expect(stripInlineMarkdown("**" + "a".repeat(1000))).toBe("**" + "a".repeat(1000));
    expect(stripInlineMarkdown("see [the agenda](https://example.gov.in/a) and **decided** to _defer_")).toBe("see the agenda and decided to defer");
  });
});

describe("table separator and headings are linear on adversarial input", () => {
  const sepJunk = "| - | - ".repeat(N / 8) + "x";
  const wsRuns = "|" + " -- ".repeat(N / 4) + "|" + " ".repeat(N) + "x";
  const hashRuns = "# title " + " # ".repeat(N / 3) + "x";

  it("a long '| - | - |...' line with trailing junk is not a separator and returns quickly", () => {
    for (const line of [sepJunk, wsRuns]) {
      const { out, ms } = timed(() => parseMarkdown(`| a | b |\n${line}\n| 1 | 2 |`));
      expect(ms).toBeLessThan(1000);
      expect(out.some((b) => b.kind === "table")).toBe(false);
      expect(out.length).toBeGreaterThan(0);
    }
  });

  it("a long valid separator row still makes a table", () => {
    const cols = 2000;
    const head = "|" + " h |".repeat(cols);
    const sep = "|" + " :--: |".repeat(cols);
    const { out, ms } = timed(() => parseMarkdown(`${head}\n${sep}\n${head}`));
    expect(ms).toBeLessThan(1000);
    const t = out.find((b) => b.kind === "table");
    expect(t && t.kind === "table" ? t.rows.length : 0).toBe(2);
  });

  it("a heading with a long run of hashes and spaces returns quickly", () => {
    const { out, ms } = timed(() => parseMarkdown(hashRuns));
    expect(ms).toBeLessThan(1000);
    expect(out[0]?.kind).toBe("heading");
  });
});

describe("same output as the previous regex implementation", () => {
  const samples = [
    "**bold** and __bold__ and *it* and _it_ and `code`",
    "***strong em*** text", "*a*b *c* d", "snake_case_name and _x_", "a*b*c", "2 * 3 * 4",
    "[link](http://x.gov.in) ![alt](img.png) [empty]() []() [](x)",
    "[a[b](u) ![a]](u) ![x](unclosed", "\\*not em\\* and \\_x\\_ and \\\\", "`` and ` and `a` `b`",
    "**a** **b", "**  a**", "__ a__ b__", "*a **b** c*", "_a *b* c_", "(*a*) [*b*](u)", "*a*_b_*c*",
  ];
  it.each(samples)("%s", (s) => { expect(stripInlineMarkdown(s)).toBe(oracleStrip(s)); });

  it("seeded sweep of 40,000 short inputs over the Markdown alphabet", () => {
    const alphabet = ["*", "_", "`", "[", "]", "(", ")", "!", "\\", " ", "a", "b", "1", "#", "|", "-", ":"];
    let seed = 20261107;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
    const bad: string[] = [];
    for (let n = 0; n < 40_000; n++) {
      const len = 1 + Math.floor(rnd() * 14);
      let s = "";
      for (let i = 0; i < len; i++) s += alphabet[Math.floor(rnd() * alphabet.length)];
      if (stripInlineMarkdown(s) !== oracleStrip(s)) bad.push(JSON.stringify(s));
      if (bad.length >= 5) break;
    }
    expect(bad).toEqual([]);
  });

  it("table separators and headings match the previous regexes", () => {
    const alphabet = ["|", "-", ":", " ", "a", "#", "\t"];
    let seed = 7;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
    const bad: string[] = [];
    for (let n = 0; n < 40_000; n++) {
      const len = 1 + Math.floor(rnd() * 12);
      let s = "";
      for (let i = 0; i < len; i++) s += alphabet[Math.floor(rnd() * alphabet.length)];
      const viaParser = parseMarkdown(`| h |\n${s}`).some((b) => b.kind === "table");
      const viaOracle = ORACLE_TABLE_SEP.test(s);
      if (viaParser !== viaOracle) bad.push("sep " + JSON.stringify(s));
      const t = s.trim();
      const h = ORACLE_HEADING.exec(t);
      const first = parseMarkdown(t)[0];
      if (h && t) {
        const want = stripInlineMarkdown(h[2] ?? "");
        if (!(first?.kind === "heading" && first.text === want && first.level === Math.min((h[1] ?? "#").length, 3))) bad.push("head " + JSON.stringify(t));
      } else if (first?.kind === "heading") bad.push("head? " + JSON.stringify(t));
      if (bad.length >= 5) break;
    }
    expect(bad).toEqual([]);
  });

  it("the documented block forms still parse", () => {
    const blocks = parseMarkdown("# Minutes\n\n- item **one**\n1. first\n\n| Item | Owner |\n| --- | :--: |\n| Budget | _Finance_ |\n\n---\nplain *text*");
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "item", "item", "table", "rule", "para"]);
    expect(blocks[1]).toMatchObject({ text: "item one" });
    expect(blocks[3]).toMatchObject({ rows: [["Item", "Owner"], ["Budget", "Finance"]] });
  });
});
