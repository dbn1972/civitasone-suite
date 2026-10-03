import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));
import { useSeededResource } from "@/lib/sync/resource";
import { UCsTable } from "./UCsTable";

const mockedHook = vi.mocked(useSeededResource);
const uc = (ucNo: string, grantRef: string) => ({ id: ucNo, ucNo, grantRef, grantee: grantRef, amount: "1000", periodFrom: "2026-04-01", periodTo: "2026-06-30", submittedDate: "2026-07-01", status: "submitted" });
const renderTable = (scheme?: string) =>
  render(<NextIntlClientProvider locale="en" messages={enMessages}><UCsTable ucs={[]} source="api" scheme={scheme} /></NextIntlClientProvider>);

describe("UCsTable scheme filter (GAP-FINANCE-EXPENDITURE-SCHEME-TRACKING-DETAIL-05)", () => {
  beforeEach(() => {
    mockedHook.mockReset();
    mockedHook.mockReturnValue({ data: [uc("UC-1", "Samagra Shiksha"), uc("UC-2", "Other Scheme")], offline: false, cachedAt: null, provenance: "live" } as never);
  });
  it("shows every UC when no scheme is given", () => {
    renderTable();
    expect(screen.getByText("UC-1")).toBeInTheDocument();
    expect(screen.getByText("UC-2")).toBeInTheDocument();
  });
  it("narrows to the scheme's UCs, case-insensitively", () => {
    renderTable("samagra shiksha");
    expect(screen.getByText("UC-1")).toBeInTheDocument();
    expect(screen.queryByText("UC-2")).not.toBeInTheDocument();
  });
});
