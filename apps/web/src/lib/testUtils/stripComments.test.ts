import { describe, it, expect } from "vitest";
import { stripComments } from "./stripComments";

describe("stripComments: comments", () => {
  it("removes block comments, including multi-line ones", () => {
    expect(stripComments("a /* one */ b /* two\nlines */ c")).toBe("a  b  c");
  });

  it("removes a line comment up to (not including) the newline", () => {
    expect(stripComments("code // note\nnext")).toBe("code \nnext");
  });

  it("handles a comment at the very start and at the very end", () => {
    expect(stripComments("// head\ncode /* tail */")).toBe("\ncode ");
  });

  // A guard test scans the result for violations, so an unterminated comment must leave the code IN VIEW (a false
  // alarm is noticed) and not drop it (a missed violation is not).
  it("keeps an unterminated block comment and everything after it, and never throws", () => {
    expect(stripComments("keep /* never closed\nmore")).toBe("keep /* never closed\nmore");
    expect(stripComments("keep /*")).toBe("keep /*");
    expect(stripComments("a /* closed */ b /* open\nconst bad = '#fff';")).toBe("a  b /* open\nconst bad = '#fff';");
  });

  it("does not splice the text around a removed comment into a NEW delimiter", () => {
    // A replace-based stripper would leave "a" + "/" ... "*b" glued; a scan never re-reads what it emitted.
    expect(stripComments("a /* c */ / * b")).toBe("a  / * b");
    expect(stripComments("a/* c */*b")).toBe("a*b");
    expect(stripComments("x /* one */ /* two */ y")).not.toContain("/*");
  });

  it("returns code without comments untouched", () => {
    const code = "const a = 1;\nexport const b = a + 2;\n";
    expect(stripComments(code)).toBe(code);
  });
});

describe("stripComments: code that merely LOOKS like a comment is kept", () => {
  it("a // inside a double-quoted string", () => {
    expect(stripComments('const s = "x//y"; // gone')).toBe('const s = "x//y"; ');
  });

  it("a // inside a single-quoted string", () => {
    expect(stripComments("const s = 'x//y'; // gone")).toBe("const s = 'x//y'; ");
  });

  it("a protocol-relative attribute value: href=\"//cdn\"", () => {
    expect(stripComments('<a href="//cdn.example.test/x.js">go</a> // gone')).toBe('<a href="//cdn.example.test/x.js">go</a> ');
  });

  it("a string that holds /* ... */", () => {
    expect(stripComments('const g = "src/**/*.tsx"; const s = "/* not a comment */"; /* real */')).toBe(
      'const g = "src/**/*.tsx"; const s = "/* not a comment */"; ',
    );
  });

  it("escaped quotes do not end a string early", () => {
    expect(stripComments('const s = "say \\"hi\\" // still inside"; // gone')).toBe('const s = "say \\"hi\\" // still inside"; ');
    expect(stripComments("const s = 'it\\'s // fine'; // gone")).toBe("const s = 'it\\'s // fine'; ");
  });

  it("a template literal, with // and /* between its ${} expressions", () => {
    expect(stripComments("const t = `${a}//${b} and /* x */`; // gone")).toBe("const t = `${a}//${b} and /* x */`; ");
  });

  it("a template literal that spans lines", () => {
    const src = "const t = `line one // kept\nline two /* kept */`; // gone";
    expect(stripComments(src)).toBe("const t = `line one // kept\nline two /* kept */`; ");
  });

  it("comments and strings INSIDE a ${} expression, and nested templates", () => {
    const src = "const t = `a ${ `b ${c} // kept` /* removed */ + \"d//e\" } f`; // gone";
    expect(stripComments(src)).toBe('const t = `a ${ `b ${c} // kept`  + "d//e" } f`; ');
  });

  it("object braces inside a ${} expression do not end it early", () => {
    expect(stripComments("const t = `${ fn({ a: 1 }) } // kept`; // gone")).toBe("const t = `${ fn({ a: 1 }) } // kept`; ");
  });

  it("a regular expression literal that contains escaped slashes: /^https?:\\/\\//", () => {
    expect(stripComments("const re = /^https?:\\/\\//; // gone")).toBe("const re = /^https?:\\/\\//; ");
    expect(stripComments("if (/^https?:\\/\\//.test(u)) go(); /* gone */")).toBe("if (/^https?:\\/\\//.test(u)) go(); ");
  });

  it("a regular expression with a character class holding a slash, and with flags", () => {
    expect(stripComments("const re = /[/*]+/gi; // gone")).toBe("const re = /[/*]+/gi; ");
  });

  it("a regular expression after return / in an argument list", () => {
    expect(stripComments("function f() { return /\\/\\*/g; } // gone")).toBe("function f() { return /\\/\\*/g; } ");
    expect(stripComments("s.replace(/a\\/\\/b/g, x); // gone")).toBe("s.replace(/a\\/\\/b/g, x); ");
  });

  it("division is not a regular expression", () => {
    expect(stripComments("const q = a / b; // gone")).toBe("const q = a / b; ");
    expect(stripComments("const q = (a + b) / 2 / c; /* gone */ const r = 1;")).toBe("const q = (a + b) / 2 / c;  const r = 1;");
    expect(stripComments("const q = x[0] / y; // gone")).toBe("const q = x[0] / y; ");
  });

  it("JSX closing and self-closing tags are not regular expressions", () => {
    expect(stripComments("<b>x</b> // gone\n<Foo a=\"1\" /> // gone too")).toBe('<b>x</b> \n<Foo a="1" /> ');
    expect(stripComments("<Foo {...p} /> // gone")).toBe("<Foo {...p} /> ");
  });

  it("a // right after a colon is kept as text (a URL in JSX text)", () => {
    expect(stripComments("<a>https://example.test/x</a>")).toBe("<a>https://example.test/x</a>");
  });

  it("an unterminated string ends at the line break instead of swallowing the next line", () => {
    expect(stripComments("const s = \"oops\nconst x = 1; // gone")).toBe('const s = "oops\nconst x = 1; ');
  });

  it("an apostrophe in JSX text only protects the rest of its own line", () => {
    expect(stripComments("<p>Don't</p>\nconst x = 1; // gone")).toBe("<p>Don't</p>\nconst x = 1; ");
  });
});
