import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
const notFoundMock = vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); });
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => notFoundMock(),
}));
let sessionRoles: string[] = ["audit_officer"];
vi.mock("@/lib/auth/roleGuard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/roleGuard")>("@/lib/auth/roleGuard");
  return { ...actual, getSessionRoles: () => sessionRoles };
});

import AuditObservationDetailPage from "./page";

const detail = (over: Record<string, unknown> = {}) => ({
  id: "3d5f9c1a-0000-4444-8888-000000000001", observationNo: "OBS-7", title: "Unreconciled advances",
  type: "internal", severity: "major", department: "Finance Wing", raisedDate: "2026-09-01",
  status: "open", replies: [], ...over,
});

describe("AuditObservationDetailPage (GAP-AUDIT-OBSERVATIONS-DETAIL-01 / 03 / 04 / 06)", () => {
  beforeEach(() => { fetchJsonMock.mockReset(); notFoundMock.mockClear(); sessionRoles = ["audit_officer"]; });

  it("DETAIL-03: a 404 renders the not-found page", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error", status: 404 });
    await expect(AuditObservationDetailPage({ params: Promise.resolve({ id: "x" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
  });

  it("DETAIL-03: a 500 renders the retry error state, not not-found", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error", status: 500 });
    render(await AuditObservationDetailPage({ params: Promise.resolve({ id: "x" }) }));
    expect(screen.getByText("We couldn't load this observation.")).toBeInTheDocument();
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("DETAIL-03: a 403 renders the access-restricted copy, not the generic retry error", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error", status: 403 });
    render(await AuditObservationDetailPage({ params: Promise.resolve({ id: "x" }) }));
    expect(screen.queryByText("We couldn't load this observation.")).not.toBeInTheDocument();
    expect(screen.getAllByText(/access|permission/i).length).toBeGreaterThan(0);
  });

  it("DETAIL-04: shows the shared status and risk pills (major -> High)", async () => {
    fetchJsonMock.mockResolvedValue({ data: detail({ status: "replied" }), source: "api" });
    const { container } = render(await AuditObservationDetailPage({ params: Promise.resolve({ id: "x" }) }));
    expect(container.querySelector(".fld .pill")).not.toBeNull();
    expect(screen.getByText("High")).toBeInTheDocument();
  });

  it("DETAIL-04: an unknown status renders its raw text in a neutral pill, not blank", async () => {
    fetchJsonMock.mockResolvedValue({ data: detail({ status: "on_hold" }), source: "api" });
    const { container } = render(await AuditObservationDetailPage({ params: Promise.resolve({ id: "x" }) }));
    expect(screen.getAllByText(/on_hold|On hold/i).length).toBeGreaterThan(0);
    expect(container.querySelector(".pill.mut")).not.toBeNull();
  });

  it("DETAIL-06: a payload without replies renders 'No replies yet' and does not throw", async () => {
    const d = detail();
    delete (d as Record<string, unknown>).replies;
    fetchJsonMock.mockResolvedValue({ data: d, source: "api" });
    render(await AuditObservationDetailPage({ params: Promise.resolve({ id: "x" }) }));
    expect(screen.getByText("No replies yet")).toBeInTheDocument();
  });

  it("DETAIL-01: a closed observation shows every workflow step done (Closure is not stuck on todo)", async () => {
    fetchJsonMock.mockResolvedValue({ data: detail({ status: "closed", replies: [{ id: "r1" }] }), source: "api" });
    const { container } = render(await AuditObservationDetailPage({ params: Promise.resolve({ id: "x" }) }));
    const steps = Array.from(container.querySelectorAll("ul.tl > li"));
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every((li) => li.classList.contains("done"))).toBe(true);
  });

  it("DASHBOARD-03: the breadcrumb 'Audit' link goes to /audit and 'Observations' to the list", async () => {
    fetchJsonMock.mockResolvedValue({ data: detail(), source: "api" });
    render(await AuditObservationDetailPage({ params: Promise.resolve({ id: "x" }) }));
    expect(screen.getByRole("link", { name: "Audit" })).toHaveAttribute("href", "/audit");
    expect(screen.getByRole("link", { name: "Observations" })).toHaveAttribute("href", "/audit/observations");
  });
});
