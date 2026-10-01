import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// GAP-PAYROLL-NPS-07: loading.tsx must use the design system, not
// Tailwind slate/min-h-screen markup.
describe("NPS loading skeleton", () => {
  it("uses ds skeletons and no Tailwind slate classes", () => {
    const src = readFileSync(join(__dirname, "loading.tsx"), "utf8");
    expect(src).not.toMatch(/className="[^"]*(bg-slate-|min-h-screen)/);
    expect(src).toMatch(/SkeletonTable/);
  });
});
