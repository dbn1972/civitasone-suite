import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("../../../../_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

const mockRoles = vi.fn<() => string[]>();
vi.mock("@/lib/auth/roleGuard", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth/roleGuard")>();
  return { ...actual, getSessionRoles: () => mockRoles() };
});

vi.mock("../../../../_components/DataSourceBadge", () => ({
  DataSourceBadge: () => <div data-testid="badge" />,
}));
vi.mock("./ServiceRequestActions", () => ({
  ServiceRequestActions: () => <div data-testid="actions" />,
}));

import Page from "./page";

const base = {
  id: "sr-1",
  referenceNo: "SRQ/2026/ABC123",
  citizenName: "Asha Rao",
  citizenPhone: "9876543210",
  citizenEmail: "asha.rao@example.gov.in",
  serviceType: "Birth Certificate",
  subject: "Certificate correction",
  priority: "normal",
  version: 1,
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
};

function mockDetail(extra: Record<string, unknown>) {
  fetchJsonMock.mockResolvedValue({ data: { ...base, ...extra }, source: "api" });
}

beforeEach(() => {
  fetchJsonMock.mockReset();
  mockRoles.mockReset();
  mockRoles.mockReturnValue(["crm_admin"]);
});

describe("ServiceRequestDetailPage — DETAIL-01 (status note vs resolution)", () => {
  it("a pending request shows a 'Waiting on' card and NO Resolution card / 'Resolved —'", async () => {
    mockDetail({ status: "pending", statusNote: "Awaiting citizen documents" });
    render(await Page({ params: { id: "sr-1" } }));
    expect(screen.getByText("Waiting on")).toBeInTheDocument();
    expect(screen.getByText("Awaiting citizen documents")).toBeInTheDocument();
    expect(screen.queryByText("Resolution")).not.toBeInTheDocument();
    expect(screen.queryByText(/Resolved —/)).not.toBeInTheDocument();
  });

  it("a resolved request shows the Resolution card with a real resolved time", async () => {
    mockDetail({ status: "resolved", resolution: "Certificate issued", resolvedAt: "2026-09-05T09:00:00.000Z" });
    render(await Page({ params: { id: "sr-1" } }));
    expect(screen.getByText("Resolution")).toBeInTheDocument();
    expect(screen.getByText("Certificate issued")).toBeInTheDocument();
    expect(screen.getByText(/^Resolved /)).toBeInTheDocument();
    expect(screen.queryByText(/Resolved —/)).not.toBeInTheDocument();
  });

  it("a closed request keeps its resolution and shows closing remarks separately", async () => {
    mockDetail({
      status: "closed",
      resolution: "Certificate issued",
      resolvedAt: "2026-09-05T09:00:00.000Z",
      statusNote: "Closed after citizen confirmation",
    });
    render(await Page({ params: { id: "sr-1" } }));
    expect(screen.getByText("Certificate issued")).toBeInTheDocument();
    expect(screen.getByText("Closed after citizen confirmation")).toBeInTheDocument();
  });
});

describe("ServiceRequestDetailPage — DETAIL-02 (PII masking, DPDP)", () => {
  it("masks phone and email for a non-privileged crm_user", async () => {
    mockRoles.mockReturnValue(["crm_user"]);
    mockDetail({ status: "open" });
    render(await Page({ params: { id: "sr-1" } }));
    expect(screen.queryByText("9876543210")).not.toBeInTheDocument();
    expect(screen.queryByText("asha.rao@example.gov.in")).not.toBeInTheDocument();
    // masked forms present
    expect(screen.getByText(/98••••••10/)).toBeInTheDocument();
    expect(screen.getByText(/masked under the DPDP Act/i)).toBeInTheDocument();
  });

  it("reveals phone and email in clear for a privileged crm_admin", async () => {
    mockRoles.mockReturnValue(["crm_admin"]);
    mockDetail({ status: "open" });
    render(await Page({ params: { id: "sr-1" } }));
    expect(screen.getByText("9876543210")).toBeInTheDocument();
    expect(screen.getByText("asha.rao@example.gov.in")).toBeInTheDocument();
  });
});

describe("ServiceRequestDetailPage — DETAIL-05 (owner + overdue)", () => {
  const past = "2000-01-01T00:00:00.000Z";
  const future = "2999-01-01T00:00:00.000Z";

  it("shows an Overdue indicator when an open request's due date has passed", async () => {
    mockDetail({ status: "open", dueAt: past });
    render(await Page({ params: { id: "sr-1" } }));
    expect(screen.getByText(/Overdue/)).toBeInTheDocument();
  });

  it("does NOT show Overdue for a resolved request with a past due date", async () => {
    mockDetail({ status: "resolved", resolution: "done", resolvedAt: past, dueAt: past });
    render(await Page({ params: { id: "sr-1" } }));
    expect(screen.queryByText(/Overdue/)).not.toBeInTheDocument();
  });

  it("does NOT show Overdue when the due date is in the future", async () => {
    mockDetail({ status: "open", dueAt: future });
    render(await Page({ params: { id: "sr-1" } }));
    expect(screen.queryByText(/Overdue/)).not.toBeInTheDocument();
  });

  it("shows an 'Assigned to' field with Unassigned when there is no owner", async () => {
    mockDetail({ status: "open", assignedTo: null });
    render(await Page({ params: { id: "sr-1" } }));
    expect(screen.getByText("Assigned to")).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });
});
