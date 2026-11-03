import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { APPLICATION_FILTERS } from "./filters";

describe("grants application status filters (UAT Phase 1B: /grants/applications render crash)", () => {
  it("is a real array that z.enum accepts, so the Server Component page can validate ?status=", () => {
    const statusParam = z.enum(APPLICATION_FILTERS);
    expect(statusParam.safeParse("under_review").success).toBe(true);
    expect(statusParam.safeParse("pending").success).toBe(false);
  });

  it("is not exported from a \"use client\" module (a client reference on the server is not an array)", () => {
    const src = readFileSync(join(__dirname, "filters.ts"), "utf8");
    expect(src).not.toMatch(/^\s*["']use client["']/m);
    const page = readFileSync(join(__dirname, "page.tsx"), "utf8");
    expect(page).toMatch(/import \{ APPLICATION_FILTERS \} from "\.\/filters"/);
    expect(page).not.toMatch(/APPLICATION_FILTERS[^\n]*from "\.\/FilterButton"/);
  });
});
