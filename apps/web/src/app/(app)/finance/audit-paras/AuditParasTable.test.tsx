import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));
import { useSeededResource } from "@/lib/sync/resource";

const mockedHook = vi.mocked(useSeededResource);
function seed(data: unknown, provenance: "live" | "cached" | "error-no-data") {
  mockedHook.mockReturnValue({
    data: data as never, fromCache: provenance === "cached", offline: false,
    cachedAt: provenance === "cached" ? "2026-09-01T00:00:00.000Z" : null, provenance,
  } as never);
}
import { AuditParasTable } from "./AuditParasTable";

const PARA = (over: Record<string, unknown>) => ({
  id: "p1", paraNo: "1/2025", source: "CAG", dept: "Works", departmentId: null, moneyValueMinor: "100000",
  currency: "INR", status: "open", createdAt: "2026-05-01T00:00:00.000Z", updatedAt: "2026-05-01T00:00:00.000Z", version: 1, ...over,
});

describe("AuditParasTable", () => {
  beforeEach(() => mockedHook.mockReset());

  // GAP-FINANCE-AUDIT-PARAS-02
  it("failed load with no cache shows retry, no zero stat cards, no 'No CAG audit observations found'", () => {
    seed([], "error-no-data");
    render(<AuditParasTable paras={[]} source="error" />);
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
    expect(screen.queryByText("Total Paras")).not.toBeInTheDocument();
    expect(screen.queryByText("No CAG audit observations found.")).not.toBeInTheDocument();
  });

  it("an ok-but-empty register still shows zeros and the empty message", () => {
    seed([], "live");
    render(<AuditParasTable paras={[]} source="api" />);
    expect(screen.getByText("Total Paras")).toBeInTheDocument();
    expect(screen.getByText("No CAG audit observations found.")).toBeInTheDocument();
  });

  // GAP-FINANCE-AUDIT-PARAS-01
  it("renders an open para with a red (bad) pill and escalated also red", () => {
    seed([PARA({}), PARA({ id: "p2", paraNo: "2/2025", status: "escalated" })], "live");
    const { container } = render(<AuditParasTable paras={[]} source="api" />);
    const pills = [...container.querySelectorAll(".pill")];
    const open = pills.find((p) => p.textContent === "Open");
    const escalated = pills.find((p) => p.textContent === "Escalated");
    expect(open?.classList.contains("bad")).toBe(true);
    expect(escalated?.classList.contains("bad")).toBe(true);
  });

  it("cards and rows agree (counts come from the same rows)", () => {
    seed([PARA({}), PARA({ id: "p3", paraNo: "3/2025", status: "settled" })], "cached");
    render(<AuditParasTable paras={[]} source="error" />);
    expect(screen.getByText("Total Paras").closest(".stat")).toHaveTextContent("2");
  });
});
