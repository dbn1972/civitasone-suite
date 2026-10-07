import { describe, it, expect } from "vitest";
import { mapLegalOpinionSummaries } from "./apiMappers";

/**
 * GAP-LEGAL-OPINIONS-04 / OPINIONS-05: the real legal-service returns
 * `{ items: [...] }` of opinions.legal_opinions rows (soughtBy / counselName,
 * status sought|drafted|issued|pending_approval). The old loader used a bare
 * array schema and rejected every real response. This mapper normalises the
 * envelope, field names and status vocabulary onto the web shape.
 */
describe("mapLegalOpinionSummaries", () => {
  it("unwraps the { items } envelope and maps backend field names", () => {
    const payload = {
      items: [
        {
          id: "op-1",
          opinionNo: "OPN/2026/0001",
          subject: "Tender dispute",
          soughtBy: "Jane Officer",
          counselName: "Sr. Counsel",
          status: "sought",
          soughtAt: "2026-09-01T10:00:00.000Z",
        },
      ],
    };
    const out = mapLegalOpinionSummaries(payload);
    expect(out).toHaveLength(1);
    const o = out![0];
    expect(o.id).toBe("op-1");
    expect(o.opinionNo).toBe("OPN/2026/0001");
    // soughtBy -> requestedBy, counselName -> advisorName
    expect(o.requestedBy).toBe("Jane Officer");
    expect(o.advisorName).toBe("Sr. Counsel");
    // sought -> pending (still open)
    expect(o.status).toBe("pending");
    expect(o.requestDate).toBe("2026-09-01T10:00:00.000Z");
  });

  it("maps status drafted->draft, issued->issued, pending_approval->pending", () => {
    const out = mapLegalOpinionSummaries({
      items: [
        { id: "a", opinionNo: "A", subject: "s", status: "drafted" },
        { id: "b", opinionNo: "B", subject: "s", status: "issued", issuedAt: "2026-09-10" },
        { id: "c", opinionNo: "C", subject: "s", status: "pending_approval" },
      ],
    });
    expect(out!.map((o) => o.status)).toEqual(["draft", "issued", "pending"]);
    expect(out!.find((o) => o.id === "b")!.issuedDate).toBe("2026-09-10");
  });

  it("leaves advisorName undefined when there is no counsel (so the UI can show Unassigned)", () => {
    const out = mapLegalOpinionSummaries({ items: [{ id: "a", opinionNo: "A", subject: "s", status: "sought" }] });
    expect(out![0].advisorName).toBeUndefined();
  });

  it("accepts a bare array too and skips rows missing id/opinionNo/subject", () => {
    const out = mapLegalOpinionSummaries([
      { id: "a", opinionNo: "A", subject: "s", status: "issued" },
      { id: "b", subject: "no opinion no but id falls back to id" , status: "sought" },
      { opinionNo: "C" }, // no id -> skipped
    ]);
    // row b: opinionNo falls back to id "b"; row c skipped (no id)
    expect(out!.map((o) => o.id)).toEqual(["a", "b"]);
  });

  it("returns null for a non-array/non-items payload", () => {
    expect(mapLegalOpinionSummaries({ nope: true })).toBeNull();
  });
});
