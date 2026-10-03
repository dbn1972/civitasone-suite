import { describe, it, expect } from "vitest";
import { qrMatrix, createQrSvg } from "./qr";

describe("qr (GAP-ASSETS-DETAIL-03)", () => {
  it("encodes a code into a square module matrix with the three finder patterns", () => {
    const m = qrMatrix("AST-1");
    const n = m.length;
    expect(n).toBeGreaterThanOrEqual(21);
    expect(m.every((row) => row.length === n)).toBe(true);
    // the 7x7 finder pattern: solid top-left corner of each of the three finders
    expect(m[0]!.slice(0, 7).every(Boolean)).toBe(true);
    expect(m[0]!.slice(n - 7).every(Boolean)).toBe(true);
    expect(m[n - 7]!.slice(0, 7).every(Boolean)).toBe(true);
  });

  it("is deterministic and differs per input", () => {
    expect(JSON.stringify(qrMatrix("AST-1"))).toBe(JSON.stringify(qrMatrix("AST-1")));
    expect(JSON.stringify(qrMatrix("AST-1"))).not.toBe(JSON.stringify(qrMatrix("AST-2")));
  });

  it("never turns hostile text into elements: the svg holds only a rect and an integer path", () => {
    const svg = createQrSvg(document, "<img src=x onerror=alert(1)>");
    expect(svg.querySelectorAll("*").length).toBe(2);
    expect(svg.querySelector("img")).toBeNull();
    expect(svg.querySelector("path")!.getAttribute("d")).toMatch(/^(M\d+ \d+h1v1h-1z)+$/);
    expect(svg.getAttribute("role")).toBe("img");
  });
});
