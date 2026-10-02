import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));

import AuditLogPage from "./page";

// GAP-ADMIN-AUDIT-LOG-01: forbidden, failed and empty used to look identical.
describe("AuditLogPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("403 -> Access restricted, with no zeroed stat cards and no empty-table text", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error", status: 403, errorMessage: "requires one of: audit_officer" });
    render(await AuditLogPage({}));
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(screen.queryByText("Loaded events")).not.toBeInTheDocument();
    expect(screen.queryByText(/No audit events/)).not.toBeInTheDocument();
  });

  it("500 -> retry state (not 'Access restricted'), still no zeroed stats", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error", status: 500 });
    render(await AuditLogPage({}));
    expect(screen.queryByRole("heading", { name: "Access restricted" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText("Loaded events")).not.toBeInTheDocument();
  });

  it("200 with no rows -> 'No audit events yet' (not 'match')", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api", status: 200 });
    render(await AuditLogPage({}));
    expect(screen.getByText("No audit events yet")).toBeInTheDocument();
    expect(screen.queryByText("No audit events match")).not.toBeInTheDocument();
  });

  // GAP-ADMIN-AUDIT-LOG-02: a full page must say it is capped and link to older events.
  it("a full page discloses the cap and links to older events", async () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ id: `e${i}`, actor: "a", action: "x", resource: "", outcome: "success", timestamp: "2026-09-01T00:00:00Z" }));
    fetchJsonMock.mockResolvedValue({ data: rows, source: "api", status: 200 });
    render(await AuditLogPage({}));
    expect(screen.getByTestId("audit-log-window")).toHaveTextContent("Showing events 1–200, newest first");
    expect(screen.getByRole("link", { name: "Show older events" })).toHaveAttribute("href", "/admin/audit-log?offset=200");
    expect(screen.getByText("Events on this page")).toBeInTheDocument();
    expect(screen.queryByText("Loaded events")).not.toBeInTheDocument();
  });

  it("forwards the offset to the loader and offers a way back to newer events", async () => {
    fetchJsonMock.mockResolvedValue({ data: [{ id: "e1", actor: "a", action: "x", resource: "", outcome: "success", timestamp: "2026-09-01T00:00:00Z" }], source: "api", status: 200 });
    render(await AuditLogPage({ searchParams: { offset: "200" } }));
    expect(String(fetchJsonMock.mock.calls[0]![0])).toContain("limit=200&offset=200");
    expect(screen.getByRole("link", { name: "Show newer events" })).toHaveAttribute("href", "/admin/audit-log");
    expect(screen.queryByRole("link", { name: "Show older events" })).not.toBeInTheDocument();
  });

  it("ignores a junk offset", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api", status: 200 });
    render(await AuditLogPage({ searchParams: { offset: "-5x" } }));
    expect(String(fetchJsonMock.mock.calls[0]![0])).toContain("offset=0");
  });
});
