import { describe, it, expect } from "vitest";
import { getMunicipalService } from "./services";
import { parseListPayload, pickField, toMunicipalRecordRow, countInProgress, isInProgressStatus, detailEntries } from "./records";

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

  it("counts only non-terminal, known statuses as in progress (SERVICEKEY-02)", () => {
    expect(isInProgressStatus("submitted")).toBe(true);
    expect(isInProgressStatus("under_review")).toBe(true);
    expect(isInProgressStatus("approved")).toBe(false);
    expect(isInProgressStatus("rejected")).toBe(false);
    expect(isInProgressStatus("cancelled")).toBe(false);
    expect(isInProgressStatus("expired")).toBe(false);
    expect(isInProgressStatus("—")).toBe(false);
    const rows = [
      { id: "1", reference: "r", title: "t", status: "submitted", updatedAt: "x" },
      { id: "2", reference: "r", title: "t", status: "rejected", updatedAt: "x" },
      { id: "3", reference: "r", title: "t", status: "approved", updatedAt: "x" },
      { id: "4", reference: "r", title: "t", status: "scrutiny", updatedAt: "x" },
    ];
    expect(countInProgress(rows)).toBe(2);
  });

  it("detailEntries: skips id, orders by fieldOrder, flags PII, formats dates, flattens nested (DETAIL-01/03)", () => {
    const entries = detailEntries(
      {
        id: "abc-123",
        tenantId: "t1",
        ownerName: "Asha Rao",
        ownerMobile: "9876543210",
        businessName: "Acme Traders",
        status: "submitted",
        applicationNumber: "TL-1",
        createdAt: "2026-03-04T10:00:00Z",
        siteAddress: { line1: "12 MG Road", city: "Pune" },
      },
      trade,
    );
    const byKey = Object.fromEntries(entries.map((e) => [e.key, e]));

    // id and tenantId never render.
    expect(byKey.id).toBeUndefined();
    expect(byKey.tenantId).toBeUndefined();

    // fieldOrder leads: status, applicationNumber, businessName, ownerName first.
    expect(entries.slice(0, 4).map((e) => e.key)).toEqual([
      "status",
      "applicationNumber",
      "businessName",
      "ownerName",
    ]);

    // ownerMobile is PII with the phone mask kind.
    expect(byKey.ownerMobile.kind).toBe("pii");
    expect(byKey.ownerMobile.piiKind).toBe("phone");
    expect(byKey.ownerMobile.rawValue).toBe("9876543210");

    // ISO timestamp is formatted (not the raw ISO string).
    expect(byKey.createdAt.value).not.toContain("T10:00:00Z");
    expect(byKey.createdAt.value).toMatch(/2026/);

    // Nested object becomes a readable key/value block, not raw JSON braces.
    expect(byKey.siteAddress.kind).toBe("nested");
    expect(byKey.siteAddress.value).not.toContain("{");
    expect(byKey.siteAddress.value).toContain("MG Road");
  });
});
