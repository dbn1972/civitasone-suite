import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Owner decision sheet 2026-11-26. Static source guards for the decisions that are "keep as is": they fail
// loudly if someone later adds the path the owner decided against.
const read = (rel: string) => readFileSync(resolve(__dirname, "..", rel), "utf8");

describe("C21 PAYROLL-TAX-CONFIG-03/04: tax slab config stays read-only informational", () => {
  it("tax routes register no write method for /v1/payroll/tax/slab-config", () => {
    const src = read("src/modules/tax/routes.ts");
    expect(src).toMatch(/app\.get\("\/v1\/payroll\/tax\/slab-config"/);
    expect(src).not.toMatch(/app\.(put|post|patch|delete)\("\/v1\/payroll\/tax\/slab-config/);
  });
});

describe("B14 PAYROLL-STATUTORY-PERQUISITE-04: payroll sees a masked PAN on Form 12BA", () => {
  it("the 12BA PDF prints the PAN masked and payroll-service has no PAN reveal route", () => {
    expect(read("src/modules/form16-pdf/form12ba-pdf-route.ts")).toContain("maskPanForPrint(m.employee.pan)");
    for (const f of ["src/modules/form16-pdf/routes.ts", "src/modules/form16-pdf/form12ba-pdf-route.ts", "src/modules/statutory-returns/routes.ts"]) {
      expect(read(f)).not.toMatch(/reveal-pan|revealPan/i);
    }
  });
});
