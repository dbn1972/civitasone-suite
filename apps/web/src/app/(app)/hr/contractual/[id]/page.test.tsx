import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const dataTableProps = vi.fn();
vi.mock("../../../../_components/ds", async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  return { ...actual, DataTable: (props: unknown) => { dataTableProps(props); return null; } };
});
vi.mock("./ContractActions", () => ({ ContractActions: () => null }));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => ["hr_admin"] }));
vi.mock("@/lib/entityAdapters/employee", () => ({ resolveEmployees: async () => [{ id: "e1", label: "Asha" }] }));
const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));

import ContractDetailPage from "./page";

const contract = {
  id: "c1", employeeId: "e1", contractNo: "C-1", startDate: "2026-01-01", endDate: "2026-12-31",
  status: "active", renewalCount: 0, version: 2, terms: { role: "Analyst", compensationMinor: "9900000" },
};
const history = [
  { id: "c0", contractNo: "C-0", startDate: "2025-01-01", endDate: "2025-12-31", status: "renewed", terms: { compensationMinor: "8800000" }, createdBy: "u1" },
];

// Review finding: history rows carry the terms JSONB (compensation).
describe("ContractDetailPage (GAP-HR-CONTRACTUAL-05)", () => {
  beforeEach(() => {
    dataTableProps.mockReset();
    fetchJsonMock.mockReset();
    fetchJsonMock.mockImplementation((url: string) =>
      Promise.resolve(String(url).includes("/history") ? { data: history, source: "api" } : { data: contract, source: "api" }));
  });

  it("never sends terms/compensation to the client DataTable", async () => {
    const ui = await ContractDetailPage({ params: { id: "c1" } });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
    const rows = dataTableProps.mock.calls[0]![0].rows as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!).sort()).toEqual(["contractNo", "endDate", "id", "startDate", "status"]);
    expect(JSON.stringify(rows)).not.toMatch(/terms|compensation/);
  });
});
