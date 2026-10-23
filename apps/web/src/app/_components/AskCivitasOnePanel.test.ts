import { describe, it, expect } from "vitest";
import { renderMarkdown } from "./AskCivitasOnePanel";

function hrefOf(html: string): string | null {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host.querySelector("a")?.getAttribute("href") ?? null;
}

describe("renderMarkdown links (CLOS2-S3-08)", () => {
  it("keeps * inside a link target literal (no <em> inside the href)", () => {
    const html = renderMarkdown("[x](https://a.in/p?q=*1*)");
    expect(html).not.toContain("<em>");
    expect(hrefOf(html)).toBe("https://a.in/p?q=*1*");
  });

  it("keeps backticks inside a link target literal (no <code> inside the href)", () => {
    const html = renderMarkdown("[x](https://a.in/p?q=`1`)");
    expect(html).not.toMatch(/href="[^"]*<code>/);
    expect(hrefOf(html)).toBe("https://a.in/p?q=`1`");
  });

  it("cannot break out of the href attribute with a quote", () => {
    const html = renderMarkdown('[x](https://a.in/" onfocus="x)');
    const host = document.createElement("div");
    host.innerHTML = html;
    const a = host.querySelector("a")!;
    expect(a.hasAttribute("onfocus")).toBe(false);
    expect(a.getAttributeNames().sort()).toEqual(["href", "rel", "target"]);
  });

  it("rewrites a non-http(s) scheme to #", () => {
    expect(hrefOf(renderMarkdown("[x](javascript:alert)"))).toBe("#");
  });

  it("still renders bold, italic and code outside links", () => {
    const html = renderMarkdown("**b** *i* `c`");
    expect(html).toContain("<strong>b</strong>");
    expect(html).toContain("<em>i</em>");
    expect(html).toContain("<code>c</code>");
  });
});
