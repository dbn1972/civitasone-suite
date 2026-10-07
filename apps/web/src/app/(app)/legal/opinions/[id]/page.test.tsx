import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const getByIdMock = vi.fn();
vi.mock("@/app/_data/loaders", () => ({ getLegalOpinionById: (id: string) => getByIdMock(id) }));
// RaiseEOfficeNote is a client component that fetches estab status; stub it.
vi.mock("@/app/_components/RaiseEOfficeNote", () => ({ RaiseEOfficeNote: () => null }));

import LegalOpinionDetailPage from "./page";

const params = { id: "op-1" };

describe("LegalOpinionDetailPage (GAP-LEGAL-OPINIONS-DETAIL-02 / 04 / 05)", () => {
  beforeEach(() => getByIdMock.mockReset());

  // DETAIL-02: an outage must NOT read as "removed".
  it("500 outage -> retryable error state, not 'Opinion not found'", async () => {
    getByIdMock.mockResolvedValue({ data: null, source: "error", status: 500 });
    render(await LegalOpinionDetailPage({ params }));
    expect(screen.queryByText("Opinion not found")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("404 -> not-found state", async () => {
    getByIdMock.mockResolvedValue({ data: null, source: "error", status: 404 });
    render(await LegalOpinionDetailPage({ params }));
    expect(screen.getByText("Opinion not found")).toBeInTheDocument();
  });

  it("successful null -> not-found state", async () => {
    getByIdMock.mockResolvedValue({ data: null, source: "api", status: 200 });
    render(await LegalOpinionDetailPage({ params }));
    expect(screen.getByText("Opinion not found")).toBeInTheDocument();
  });

  // DETAIL-04: accept both the list and detail field vocabularies.
  it("renders counsel/sought-by from the list vocabulary (advisorName/requestedBy)", async () => {
    getByIdMock.mockResolvedValue({
      data: { opinionNo: "OPN/2026/1", subject: "Dispute", status: "issued", advisorName: "Adv. Rao", requestedBy: "Jane", question: "May we appeal?" },
      source: "api", status: 200,
    });
    render(await LegalOpinionDetailPage({ params }));
    expect(screen.getAllByText("Adv. Rao").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Jane").length).toBeGreaterThanOrEqual(1);
  });

  // DETAIL-04: status shown exactly once (header pill), privilege marker present.
  it("shows status once and marks the question privileged", async () => {
    getByIdMock.mockResolvedValue({
      data: { opinionNo: "OPN/2026/1", subject: "Dispute", status: "issued", counselName: "C", soughtBy: "S", question: "advice text" },
      source: "api", status: 200,
    });
    render(await LegalOpinionDetailPage({ params }));
    // "Issued" appears once (the header pill), not three times
    expect(screen.getAllByText("Issued")).toHaveLength(1);
    expect(screen.getByText(/Privileged/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Status$/)).not.toBeInTheDocument(); // no Status card/row label
  });

  // DETAIL-05: breadcrumbs are next/link (mocked to <a>), focusable client nav.
  it("renders breadcrumb links to Legal and Opinions", async () => {
    getByIdMock.mockResolvedValue({
      data: { opinionNo: "OPN/2026/1", subject: "Dispute", status: "issued" },
      source: "api", status: 200,
    });
    render(await LegalOpinionDetailPage({ params }));
    expect(screen.getByRole("link", { name: "Legal" })).toHaveAttribute("href", "/legal");
    expect(screen.getByRole("link", { name: "Opinions" })).toHaveAttribute("href", "/legal/opinions");
  });
});
