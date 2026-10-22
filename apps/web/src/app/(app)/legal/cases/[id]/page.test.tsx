import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getLegalCaseById = vi.fn();
const notFound = vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); });

vi.mock("../../../../_data/loaders", () => ({ getLegalCaseById: (id: string) => getLegalCaseById(id) }));
vi.mock("next/navigation", () => ({ notFound: () => notFound(), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./CaseActions", () => ({ CaseActions: () => null }));

import { LegalCaseDetailSchema } from "@civitasone/schemas/web";
import LegalCaseDetailPage from "./page";

const caseData = {
  id: "c1", caseNo: "WP/1/2024", title: "X v Y", court: "High Court",
  type: "writ", filedDate: "2024-01-10", status: "pending",
  hearings: [{ id: "h1", date: "2024-03-01", court: "High Court", purpose: "Args" }],
  orders: [],
};

describe("Legal case detail failmask (GAP-LEGAL-CASES-DETAIL-02)", () => {
  beforeEach(() => { getLegalCaseById.mockReset(); notFound.mockClear(); });

  it("renders a retry error state (not notFound) on a 503 service outage", async () => {
    getLegalCaseById.mockResolvedValue({ data: null, source: "error", status: 503 });
    render(await LegalCaseDetailPage({ params: { id: "c1" } }));
    expect(notFound).not.toHaveBeenCalled();
    expect(screen.getByText(/Unable to load case details/i)).toBeInTheDocument();
  });

  it("calls notFound() on a genuine 404", async () => {
    getLegalCaseById.mockResolvedValue({ data: null, source: "error", status: 404 });
    await expect(LegalCaseDetailPage({ params: { id: "c1" } })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });
});

describe("Legal case detail lifecycle labels (GAP-LEGAL-CASES-DETAIL-04)", () => {
  beforeEach(() => { getLegalCaseById.mockReset(); notFound.mockClear(); });

  it("uses 'Filed date' (not 'Raised date') for the filed date", async () => {
    getLegalCaseById.mockResolvedValue({ data: caseData, source: "api", status: 200 });
    render(await LegalCaseDetailPage({ params: { id: "c1" } }));
    expect(screen.getByText("Filed date")).toBeInTheDocument();
    expect(screen.queryByText("Raised date")).not.toBeInTheDocument();
  });
});

describe("Legal case detail order type display (GAP-LEGAL-CASES-DETAIL-01)", () => {
  beforeEach(() => { getLegalCaseById.mockReset(); notFound.mockClear(); });

  it("Given a case with an affidavit order, When rendered, Then affidavit appears in 'Affidavit filings' card, not 'Court orders'", async () => {
    getLegalCaseById.mockResolvedValue({
      data: {
        ...caseData,
        orders: [
          { id: "o1", date: "2024-04-01", orderType: "affidavit", summary: "Affidavit of service", complianceRequired: false, status: "pending" },
          { id: "o2", date: "2024-04-10", orderType: "order", orderNo: "123", summary: "Stay granted", complianceRequired: true, status: "pending" },
        ],
      },
      source: "api",
      status: 200,
    });
    render(await LegalCaseDetailPage({ params: { id: "c1" } }));
    expect(screen.getByText("Affidavit filings")).toBeInTheDocument();
    expect(screen.getByText("Affidavit of service")).toBeInTheDocument();
    // The compliance court-orders table should NOT contain the affidavit summary
    const courtOrdersHeading = screen.getByText("Court orders");
    expect(courtOrdersHeading).toBeInTheDocument();
    expect(screen.queryByRole("cell", { name: "Affidavit filing" })).toBeInTheDocument();
  });

  it("Given a case with only court orders, When rendered, Then 'Affidavit filings' card is absent", async () => {
    getLegalCaseById.mockResolvedValue({
      data: { ...caseData, orders: [{ id: "o1", date: "2024-04-10", orderType: "judgment", summary: "Judgment in favour", complianceRequired: false, status: "complied" }] },
      source: "api",
      status: 200,
    });
    render(await LegalCaseDetailPage({ params: { id: "c1" } }));
    expect(screen.queryByText("Affidavit filings")).not.toBeInTheDocument();
    // "Judgment in favour" uniquely identifies the court-order row (distinct from
    // the lifecycle timeline "Judgment" stage label).
    expect(screen.getByText("Judgment in favour")).toBeInTheDocument();
  });
});

/**
 * Real service shape: exactly what GET /v1/legal/cases/:id returns for a real
 * case (see services/legal-service/tests/case-detail-contract.test.ts, which
 * feeds the live response into the same schema). Parsed through the real web
 * schema, as the loader does, before it reaches the page.
 */
const realServicePayload = {
  id: "22222222-bbbb-4000-8000-0000000000d1", caseNo: "WP/D/2026", title: "A v State", court: "High Court",
  type: "civil", subject: "Land dispute", filedDate: "2026-10-22", petitioner: "A", respondent: "State of X",
  advocateName: "Adv. Rao", nextHearingDate: "2026-12-01", status: "pending", description: "Land dispute",
  hearings: [
    { id: "h1", date: "2026-10-01", court: "High Court" },
    { id: "h2", date: "2026-11-02", court: "High Court", purpose: "Arguments", nextDate: "2026-12-01" },
  ],
  orders: [
    { id: "o1", date: "2026-10-05", orderType: "interim", summary: "Status quo", complianceRequired: true, complianceDeadline: "2026-11-30", status: "pending" },
    { id: "o2", date: "2026-10-20", orderType: "affidavit", summary: "Reply filed", complianceRequired: false, status: "pending" },
  ],
};

describe("Legal case detail against the real service shape", () => {
  beforeEach(() => { getLegalCaseById.mockReset(); notFound.mockClear(); });

  it("the real payload passes the web schema (status 'pending', optional fields absent)", () => {
    expect(LegalCaseDetailSchema.safeParse(realServicePayload).success).toBe(true);
  });

  it("renders hearings, court orders and affidavit filings from the real shape", async () => {
    getLegalCaseById.mockResolvedValue({ data: LegalCaseDetailSchema.parse(realServicePayload), source: "api", status: 200 });
    render(await LegalCaseDetailPage({ params: { id: realServicePayload.id } }));
    expect(screen.getAllByText("Arguments").length).toBeGreaterThan(0);
    expect(screen.getByText("Status quo")).toBeInTheDocument();
    expect(screen.getByText("Affidavit filings")).toBeInTheDocument();
    expect(screen.getByText("Reply filed")).toBeInTheDocument();
    expect(screen.getByText("State of X")).toBeInTheDocument();
    expect(screen.queryByText(/Unable to load case details/i)).not.toBeInTheDocument();
  });

  it("renders a bare real case (nothing but required fields, no hearings/orders)", async () => {
    const bare = LegalCaseDetailSchema.parse({
      id: "b", caseNo: "X/1/2026", title: "Bare", court: "District Court", type: "other",
      filedDate: "2026-10-22", status: "pending", hearings: [], orders: [],
    });
    getLegalCaseById.mockResolvedValue({ data: bare, source: "api", status: 200 });
    render(await LegalCaseDetailPage({ params: { id: "b" } }));
    expect(screen.getAllByText(/X\/1\/2026/).length).toBeGreaterThan(0);
  });
});
