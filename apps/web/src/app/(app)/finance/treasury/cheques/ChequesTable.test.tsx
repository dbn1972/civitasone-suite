import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));
import { useSeededResource } from "@/lib/sync/resource";

const mockedHook = vi.mocked(useSeededResource);
function seed(data: unknown) {
  mockedHook.mockReturnValue({ data: data as never, fromCache: false, offline: false, cachedAt: null, provenance: "live" } as never);
}
import { ChequesTable } from "./ChequesTable";

const C = {
  id: "c1", instrumentType: "cheque", instrumentNo: "000123", bankAccountId: "b1", bankName: "SBI", accountNoLast4: "9012",
  payee: "P", amountMinor: "100", currency: "INR", issueDate: "2026-09-01", status: "issued",
  presentedAt: null, clearedAt: null, bouncedAt: null, cancelledAt: null, bounceReason: null,
};

describe("ChequesTable", () => {
  beforeEach(() => mockedHook.mockReset());

  it("formats Issued and shows a dash for an uncleared cheque (CHEQUES-02)", () => {
    seed([C]);
    const { container } = render(<ChequesTable cheques={[]} source="api" />);
    expect(container.textContent).toMatch(/01 Sep 2026/);
    expect(container.textContent).not.toContain("2026-09-01");
    const cells = Array.from(container.querySelectorAll("tbody tr td")).map((td) => td.textContent ?? "");
    expect(cells).toContain("—");
  });

  it("tells two accounts at one bank apart by masked last four, never the full number (CHEQUES-05)", () => {
    seed([C, { ...C, id: "c2", accountNoLast4: "7788" }]);
    const { container } = render(<ChequesTable cheques={[]} source="api" />);
    expect(container.textContent).toContain("SBI •••• 9012");
    expect(container.textContent).toContain("SBI •••• 7788");
  });
});
