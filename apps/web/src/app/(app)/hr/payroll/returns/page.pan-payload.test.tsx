/**
 * Review fix (PR #1762, HIGH): DataTable is a client component, so every
 * field on every row is serialised into the RSC payload. The rows used to
 * spread the raw deductee (incl. the full PAN) and only the visible column
 * was masked. Assert no row handed to DataTable carries pan/panFlag and no
 * unmasked PAN appears anywhere in its props.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const dataTableProps: Array<{ rows: Array<Record<string, unknown>> }> = [];
vi.mock("../../../../_components/ds", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../../../../_components/ds");
  return {
    ...actual,
    DataTable: (props: { rows: Array<Record<string, unknown>> }) => {
      dataTableProps.push(props);
      return null;
    },
  };
});
const statusAwareGetMock = vi.fn();
vi.mock("../_lib/statusAwareFetch", () => ({ statusAwareGet: (...a: unknown[]) => statusAwareGetMock(...a) }));
const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/_components/ds/Toast", () => ({ useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }) }));
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => ["payroll_admin"] }));

import ReturnsPage from "./page";

const FULL_PAN_RE = /[A-Z]{5}[0-9]{4}[A-Z]/;

describe("ReturnsPage -- no full PAN in client-component props", () => {
  beforeEach(() => {
    dataTableProps.length = 0;
    statusAwareGetMock.mockResolvedValue({
      kind: "ok", status: 200,
      body: {
        formType: "24Q", fy: "2025-26", quarter: "Q1", deducteeCount: 1,
        deductees: [{ employeeId: "e1", pan: "ABCDE1234F", panFlag: "", name: "Asha", tdsDeductedMinor: 100, tdsDepositedMinor: 100 }],
        reconciliation: { matched: true }, note: "",
      },
    });
    fetchJsonMock.mockResolvedValue({
      data: {
        formType: "26Q", fy: "2025-26", quarter: "Q1", deducteeCount: 1, populated: true, totalTdsDeductedMinor: "100",
        deductees: [{ deducteeRef: "v1", name: "Vendor", pan: "PQRST6789K", panFlag: "", section: "194C", amountPaidMinor: "1000", tdsDeductedMinor: "100", periods: [] }],
        reconciliation: { matched: true }, note: "",
      },
      source: "api",
    });
  });

  it("strips pan/panFlag from every DataTable row (24Q and 26Q)", async () => {
    const ui = await ReturnsPage({ searchParams: { fy: "2025-26", quarter: "Q1" } });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
    expect(dataTableProps.length).toBe(2);
    for (const props of dataTableProps) {
      expect(props.rows.length).toBeGreaterThan(0);
      for (const row of props.rows) {
        expect(row).not.toHaveProperty("pan");
        expect(row).not.toHaveProperty("panFlag");
      }
      expect(JSON.stringify(props)).not.toMatch(FULL_PAN_RE);
    }
    expect(JSON.stringify(dataTableProps)).toContain("ABCDE****F");
  });
});
