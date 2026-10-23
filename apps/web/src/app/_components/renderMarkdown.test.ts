import { describe, it, expect } from "vitest";
import { renderMarkdown } from "./renderMarkdown";

/** Parse the rendered HTML and return every attribute name on every element. */
function attrNames(html: string): string[] {
  const host = document.createElement("div");
  host.innerHTML = html;
  return Array.from(host.querySelectorAll("*")).flatMap((el) => el.getAttributeNames());
}

describe("renderMarkdown link safety (CLOS2-S3-01)", () => {
  const payloads = [
    '[click](https://a.gov.in/" onmouseover="alert(document.cookie)',
    '[x](https://a.gov.in/" autofocus onfocus="alert(1)" x=")',
    "[x](https://a.gov.in/' onclick='alert(1)",
    "[x](https://a.gov.in/` onclick=`alert(1)",
    '[x](https://a.gov.in/**" onmouseover="alert(1)**)',
  ];

  for (const payload of payloads) {
    it(`injects no event-handler attribute: ${payload}`, () => {
      const html = renderMarkdown(payload);
      expect(html).not.toMatch(/onmouseover=|onfocus=|onclick=/i);
      const names = attrNames(html);
      expect(names.filter((n) => n.startsWith("on"))).toEqual([]);
      expect(names).not.toContain("autofocus");
    });
  }

  it("keeps a clean https link", () => {
    const html = renderMarkdown("[home](https://a.gov.in/path?x=1&y=2)");
    const host = document.createElement("div");
    host.innerHTML = html;
    const a = host.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://a.gov.in/path?x=1&y=2");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a.textContent).toBe("home");
  });

  it("neutralises non-http(s) schemes", () => {
    const host = document.createElement("div");
    host.innerHTML = renderMarkdown("[x](javascript:alert(1))");
    expect(host.querySelector("a")?.getAttribute("href")).toBe("#");
  });
});
