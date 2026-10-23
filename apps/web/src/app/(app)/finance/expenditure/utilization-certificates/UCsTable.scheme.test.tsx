import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));
import { useSeededResource } from "@/lib/sync/resource";
import { UCsTable } from "./UCsTable";

const mockedHook = vi.mocked(useSeededResource);
const uc = (ucNo: string, grantRef: string, schemeCode?: string) => ({ id: ucNo, ucNo, grantRef, grantee: grantRef, schemeCode, amount: "1000", periodFrom: "2026-04-01", periodTo: "2026-06-30", submittedDate: "2026-07-01", status: "submitted" });
const renderTable = (scheme?: React.ComponentProps<typeof UCsTable>["scheme"]) =>
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

  // The scheme is stored on the certificate as a code, independent of the grant reference typed beside it.
  it("narrows by the stored scheme code, including a certificate whose grant reference is something else", () => {
    mockedHook.mockReturnValue({
      data: [uc("UC-A", "SAN/2026/77", "PMAY"), uc("UC-B", "Housing Scheme", "MGN"), uc("UC-C", "Housing Scheme")],
      offline: false, cachedAt: null, provenance: "live",
    } as never);
    renderTable({ code: "PMAY", name: "Housing Scheme" });
    expect(screen.getByText("UC-A")).toBeInTheDocument();
    // recorded against another scheme, so a matching name does not pull it in
    expect(screen.queryByText("UC-B")).not.toBeInTheDocument();
    // an older, code-less certificate is still found by the scheme name
    expect(screen.getByText("UC-C")).toBeInTheDocument();
  });
});
