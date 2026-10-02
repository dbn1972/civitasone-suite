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
    render(await AuditLogPage());
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(screen.queryByText("Loaded events")).not.toBeInTheDocument();
    expect(screen.queryByText(/No audit events/)).not.toBeInTheDocument();
  });

  it("500 -> retry state (not 'Access restricted'), still no zeroed stats", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error", status: 500 });
    render(await AuditLogPage());
    expect(screen.queryByRole("heading", { name: "Access restricted" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText("Loaded events")).not.toBeInTheDocument();
  });

  it("200 with no rows -> 'No audit events yet' (not 'match')", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api", status: 200 });
    render(await AuditLogPage());
    expect(screen.getByText("No audit events yet")).toBeInTheDocument();
    expect(screen.queryByText("No audit events match")).not.toBeInTheDocument();
  });
});
