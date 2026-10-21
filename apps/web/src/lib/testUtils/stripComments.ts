/**
 * Source text with `/* block *\/` and `// line` comments removed, so a guard test scans only code.
 *
 * A small scanner, NOT a chain of `.replace()` calls. Pattern-replacing comment delimiters has two
 * faults: it cuts code that merely LOOKS like a comment (`"x//y"`, `href="//cdn"`, a template
 * literal, a regex such as `/^https?:\/\//`, a string holding `/*`), and removing a delimiter can
 * splice the text around it into a NEW delimiter (incomplete multi-character sanitisation).
 *
 * What it understands, outside of comments: single- and double-quoted strings (with escapes; an
 * unterminated one ends at the line break instead of swallowing the file), template literals
 * including nested `${ ... }` expressions that themselves hold strings, templates and comments, and
 * regular-expression literals (told apart from division by the preceding token, with `[...]`
 * classes and escapes). Strings, templates and regex literals are copied through untouched.
 *
 * What it does not: JSX text is not tokenised. A `//` directly after a colon is therefore kept as
 * text (so `<a>https://example.test</a>` survives), and an apostrophe in JSX text starts a "string"
 * that runs to the end of its line, which only means a comment on that same line is kept. An
 * unterminated block comment is KEPT, with everything after it: a guard test reads the result to
 * look for violations, so when the scanner cannot tell where a comment ends it must leave the code
 * in view (a false alarm is visible) rather than drop it (a missed violation is not).
 */

/** Words after which a `/` begins a regular expression rather than dividing. */
const REGEX_AFTER_WORD = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await",
]);

/** Punctuation after which a `/` begins a regular expression (an operand is expected). */
const REGEX_AFTER_PUNCT = "(,=:[!&|?{;+-*%<>~^";

const isWordChar = (c: string): boolean => /[A-Za-z0-9_$]/.test(c);

export function stripComments(src: string): string {
  const n = src.length;
  let out = "";

  /** A quoted string starting at `i` (the quote). Returns the index just past it. Never crosses a line break. */
  function scanString(i: number): number {
    const quote = src[i]!;
    let j = i + 1;
    while (j < n) {
      const ch = src[j]!;
      if (ch === "\\") {
        j += 2;
        continue;
      }
      if (ch === quote) {
        j += 1;
        break;
      }
      if (ch === "\n") break;
      j += 1;
    }
    j = Math.min(j, n);
    out += src.slice(i, j);
    return j;
  }

  /** A regular-expression literal starting at `i` (the slash), or `-1` when it is not one. */
  function regexEnd(i: number): number {
    let j = i + 1;
    let inClass = false;
    while (j < n) {
      const ch = src[j]!;
      if (ch === "\n") return -1;
      if (ch === "\\") {
        j += 2;
        continue;
      }
      if (inClass) {
        if (ch === "]") inClass = false;
      } else if (ch === "[") {
        inClass = true;
      } else if (ch === "/") {
        j += 1;
        while (j < n && /[a-z]/.test(src[j]!)) j += 1; // flags
        return j;
      }
      j += 1;
    }
    return -1;
  }

  /** A template literal starting at `i` (the backtick). Returns the index just past the closing backtick. */
  function scanTemplate(i: number): number {
    out += "`";
    let j = i + 1;
    while (j < n) {
      const ch = src[j]!;
      if (ch === "\\") {
        out += src.slice(j, j + 2);
        j += 2;
        continue;
      }
      if (ch === "`") {
        out += "`";
        return j + 1;
      }
      if (ch === "$" && src[j + 1] === "{") {
        out += "${";
        j = scanCode(j + 2, true);
        if (j < n) {
          out += "}";
          j += 1;
        }
        continue;
      }
      out += ch;
      j += 1;
    }
    return n;
  }

  /**
   * Code from `i`. With `untilBrace`, stops at the `}` that closes the enclosing `${` (not consumed) and
   * returns its index; otherwise runs to the end of the source.
   */
  function scanCode(i: number, untilBrace: boolean): number {
    let depth = 0;
    let prev = ""; // last significant character, or "w" after a word
    let prevWord = "";
    let j = i;
    while (j < n) {
      const c = src[j]!;
      const next = src[j + 1];

      if (c === "/" && next === "*") {
        const end = src.indexOf("*/", j + 2);
        if (end === -1) {
          out += src.slice(j); // unterminated: keep it and the rest, never silently drop code
          j = n;
        } else {
          j = end + 2;
        }
        continue;
      }
      if (c === "/" && next === "/" && src[j - 1] !== ":") {
        const end = src.indexOf("\n", j);
        j = end === -1 ? n : end;
        continue;
      }
      if (c === "'" || c === '"') {
        j = scanString(j);
        prev = c;
        continue;
      }
      if (c === "`") {
        j = scanTemplate(j);
        prev = "`";
        continue;
      }
      if (c === "/") {
        // `</tag>` and `/>` are JSX, never a regex; otherwise the previous token decides.
        const regexAllowed =
          next !== ">" &&
          src[j - 1] !== "<" &&
          (prev === "" || (prev === "w" ? REGEX_AFTER_WORD.has(prevWord) : REGEX_AFTER_PUNCT.includes(prev)));
        const end = regexAllowed ? regexEnd(j) : -1;
        if (end !== -1) {
          out += src.slice(j, end);
          j = end;
          prev = ")"; // a value: a following `/` divides
          continue;
        }
        out += c;
        prev = c;
        j += 1;
        continue;
      }
      if (isWordChar(c)) {
        let k = j;
        while (k < n && isWordChar(src[k]!)) k += 1;
        prevWord = src.slice(j, k);
        out += prevWord;
        prev = "w";
        j = k;
        continue;
      }
      if (c === "{") depth += 1;
      if (c === "}") {
        if (untilBrace && depth === 0) return j;
        depth -= 1;
      }
      out += c;
      if (!/\s/.test(c)) prev = c;
      j += 1;
    }
    return n;
  }

  scanCode(0, false);
  return out;
}
