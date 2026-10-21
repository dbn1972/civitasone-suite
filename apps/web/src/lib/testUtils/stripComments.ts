/**
 * Source text with `/* block *\/` and `// line` comments removed, so a scan sees only code.
 *
 * A character scan, not a chain of `.replace()` calls: pattern-replacing a comment delimiter can
 * splice the surrounding text into a NEW delimiter (`/*` + `/**\/` + `*`), which is the classic
 * incomplete multi-character sanitisation. A `//` directly after `:` is kept (a URL such as
 * `https://example.test`). Strings are not parsed: a `//` inside a string literal is treated as a
 * comment, which is fine for the guard tests that use this on component source.
 */
export function stripComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const here = src[i];
    const next = src[i + 1];
    if (here === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (here === "/" && next === "/" && src[i - 1] !== ":") {
      const end = src.indexOf("\n", i);
      i = end === -1 ? src.length : end;
      continue;
    }
    out += here;
    i += 1;
  }
  return out;
}
