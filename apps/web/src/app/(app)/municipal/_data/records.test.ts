import { describe, it, expect } from "vitest";
import { getMunicipalService } from "./services";
import { parseListPayload, pickField, toMunicipalRecordRow } from "./records";

describe("municipal record parsing", () => {
  const trade = getMunicipalService("trade")!;

  it("extracts title and reference from application row", () => {
    const row = toMunicipalRecordRow(
      {
        id: "a1",
        applicationNumber: "TL-2026-0001",
        businessName: "Acme Traders",
        status: "under_review",
        updatedAt: "2026-08-09T10:00:00Z",
      },
      trade,
    );
    expect(row).toEqual({
      id: "a1",
      reference: "TL-2026-0001",
      title: "Acme Traders",
      status: "under_review",
      updatedAt: "2026-08-09T10:00:00Z",
    });
  });

  it("parses paginated list payload", () => {
    const parsed = parseListPayload(
      {
        data: [
          { id: "1", applicationNumber: "TL-1", businessName: "Shop A", status: "draft", updatedAt: "x" },
        ],
        meta: { page: 1, pageSize: 20, total: 1 },
      },
      trade,
    );
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.meta.total).toBe(1);
  });

  it("formats nested address objects as title fallback", () => {
    const title = pickField(
      { siteAddress: { line1: "12 MG Road", city: "Pune" } },
      ["architectName", "siteAddress"],
    );
    expect(title).toContain("MG Road");
  });
});
