import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RFQDetail } from "@civitasone/types";
import { computeL1 } from "./computeL1";

type Resp = RFQDetail["responses"][number];
const resp = (over: Partial<Resp>): Resp => ({ responseId: "r", vendorId: "v", vendorName: "V", status: "submitted", sealed: false, lineRates: [], submittedAt: "2026-10-01T00:00:00Z", ...over });

describe("computeL1 (UAT Phase 1B: /procurement/rfq/[id] render crash)", () => {
  it("picks the lowest in-the-running unsealed total, compared in integer paise", () => {
    const l1 = computeL1([
      resp({ responseId: "a", totalAmountMinor: "1000000" }),
      resp({ responseId: "b", totalAmountMinor: "999999" }),
      resp({ responseId: "c", totalAmountMinor: "1", status: "withdrawn" }),
      resp({ responseId: "d", totalAmountMinor: "5", status: "rejected" }),
      resp({ responseId: "e", totalAmountMinor: undefined, sealed: true }),
    ]);
    expect(l1?.responseId).toBe("b");
  });

  it("is null while every response is sealed (no amounts)", () => {
    expect(computeL1([resp({ sealed: true }), resp({ sealed: true })])).toBeNull();
  });

  it("lives outside the \"use client\" ComparativeStatement module so the Server Component page can call it", () => {
    const src = readFileSync(join(__dirname, "computeL1.ts"), "utf8");
    expect(src).not.toMatch(/^\s*["']use client["']/m);
    const page = readFileSync(join(__dirname, "page.tsx"), "utf8");
    expect(page).toMatch(/import \{ computeL1 \} from "\.\/computeL1"/);
  });
});
