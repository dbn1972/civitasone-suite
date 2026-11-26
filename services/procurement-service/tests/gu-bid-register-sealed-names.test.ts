/**
 * Sealed-bid vendor-name omission on the cross-tender bid-evaluation register
 * (GET /v1/procurement/bid-evaluations). Pure: the repo is mocked, so this
 * proves the suppression logic without a database.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const listMock = vi.fn();
const bidsMock = vi.fn();
vi.mock("../src/modules/tender/repo.js", () => ({
  listBidEvaluationsByTenant: (...a: unknown[]) => listMock(...a),
  findBidsByTender: (...a: unknown[]) => bidsMock(...a),
}));
vi.mock("../src/modules/tender/docs-repo.js", () => ({}));

import { listBidEvaluations as listFull, bidderSeqMap, bidderLabelFor } from "../src/modules/tender/queries.js";

const listBidEvaluations = async (...a: Parameters<typeof listFull>) => (await listFull(...a)).rows;

const T_SEALED = "7d1c0000-0000-4000-8000-000000000001";
const T_OPEN = "7d1c0000-0000-4000-8000-000000000002";
const row = (bidId: string, tenderId: string, tenderStatus: string, vendorName: string) => ({
  bidId, tenderNo: "NIT/PWD/2026/041", tenderId, tenderStatus, vendorName,
  technicalScore: 82, financialScore: 70, financialOpened: false, rank: 1, status: "technically_qualified",
});

beforeEach(() => {
  listMock.mockReset(); bidsMock.mockReset();
  listMock.mockResolvedValue([
    row("b2", T_SEALED, "published", "Shree Balaji Infratech Pvt Ltd"),
    row("b9", T_OPEN, "technical_evaluation", "Konark Electricals & Co"),
  ]);
  bidsMock.mockImplementation(async (tenderId: string) =>
    tenderId === T_SEALED
      ? [
          { id: "b1", status: "submitted", createdAt: new Date("2026-11-01T10:00:00Z") },
          { id: "b2", status: "submitted", createdAt: new Date("2026-11-02T10:00:00Z") },
        ]
      : [{ id: "b9", status: "technically_qualified", createdAt: new Date("2026-11-01T10:00:00Z") }]);
});

describe("bid-evaluation register vendor-name suppression", () => {
  it("replaces the vendor name with a stable submission-order handle while the tender is sealed", async () => {
    const out = await listBidEvaluations("tenant", 50, 0);
    const sealed = out.find((r) => r.tenderId === T_SEALED)!;
    expect(sealed.bidder).toBe("Bidder 2");
    expect(JSON.stringify(sealed)).not.toContain("Balaji");
  });

  it("reveals names normally once the tender is past opening", async () => {
    const out = await listBidEvaluations("tenant", 50, 0);
    expect(out.find((r) => r.tenderId === T_OPEN)!.bidder).toBe("Konark Electricals & Co");
  });

  it("shows real names to the bid-opening committee even while sealed", async () => {
    const out = await listBidEvaluations("tenant", 50, 0, { isCommittee: true });
    expect(out.find((r) => r.tenderId === T_SEALED)!.bidder).toBe("Shree Balaji Infratech Pvt Ltd");
  });
});

describe("committee reveal audit + numbering parity", () => {
  it("reports each tender whose sealed identities the committee was shown, and none otherwise", async () => {
    const committee = await listFull("tenant", 50, 0, { isCommittee: true });
    expect(committee.sealedReveals).toEqual([{ tenderId: T_SEALED, bidCount: 2 }]);
    const other = await listFull("tenant", 50, 0);
    expect(other.sealedReveals).toEqual([]);
  });

  it("register handle equals the shared numbering used by the detail/evaluation views", () => {
    const bids = [
      { id: "b2", createdAt: new Date("2026-11-02T10:00:00Z") },
      { id: "b1", createdAt: new Date("2026-11-01T10:00:00Z") },
      { id: "b3", createdAt: new Date("2026-11-02T10:00:00Z") },
    ];
    const seq = bidderSeqMap(bids);
    for (const b of bids) expect(bidderLabelFor(b, bids)).toBe(`Bidder ${seq.get(b.id)}`);
    expect(seq.get("b1")).toBe(1);
    expect(seq.get("b3")).toBe(3);
  });
});
