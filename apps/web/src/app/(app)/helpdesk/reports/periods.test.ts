import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PERIOD_LABELS } from "./periods";

describe("helpdesk report period labels (UAT Phase 1B: headings read '(undefined)')", () => {
  it("has a label for every period", () => {
    expect(PERIOD_LABELS).toEqual({ mtd: "Month-to-date", qtd: "Quarter-to-date", fy: "Financial year" });
  });
  it("is imported by the Server Component page from the plain module, not the client nav", () => {
    expect(readFileSync(join(__dirname, "periods.ts"), "utf8")).not.toMatch(/^\s*["']use client["']/m);
    const page = readFileSync(join(__dirname, "page.tsx"), "utf8");
    expect(page).toMatch(/import \{ PERIOD_LABELS, type ReportPeriod \} from "\.\/periods"/);
  });
});
