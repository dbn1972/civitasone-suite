import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { roles, loaders } = vi.hoisted(() => ({
  roles: { current: [] as string[] },
  loaders: {
    getRequestBreachReport: vi.fn(),
    getCatalogueOfferings: vi.fn(),
  },
}));

vi.mock("@/lib/auth/roleGuard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/roleGuard")>("@/lib/auth/roleGuard");
  return { ...actual, getSessionRoles: () => roles.current };
});
vi.mock("../../../../_data/loaders", () => ({ ...loaders }));

import Page from "./page";

const report = {
  data: [{
    id: "11111111-aaaa-4000-8000-000000000001", offeringId: "off-1", ticketId: null, requestedBy: "u-1",
    status: "pending_fulfilment", currentStage: "provision", slaStatus: "breached",
    responseDeadline: null, resolutionDeadline: "2026-10-01T00:00:00.000Z", breachEscalatedAt: null,
    formData: {}, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
  }],
  summary: { breached: 1, atRisk: 0, escalated: 0, total: 1 },
};

beforeEach(() => {
  vi.clearAllMocks();
  loaders.getRequestBreachReport.mockResolvedValue({ data: report, source: "api" });
  loaders.getCatalogueOfferings.mockResolvedValue({ data: [{ id: "off-1", name: "Laptop Request" }], source: "api" });
});

describe("helpdesk catalogue breaches page access", () => {
  it("a plain helpdesk_user gets PermissionDenied: no rows rendered and no breach data fetched", async () => {
    roles.current = ["helpdesk_user"];
    render(await Page());
    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
    expect(screen.queryByText("Laptop Request")).not.toBeInTheDocument();
    expect(screen.queryByText(/Requests breached or at risk/i)).not.toBeInTheDocument();
    expect(loaders.getRequestBreachReport).not.toHaveBeenCalled();
  });

  it("a helpdesk_admin sees the report rows", async () => {
    roles.current = ["helpdesk_admin"];
    render(await Page());
    expect(screen.queryByText(/access restricted/i)).not.toBeInTheDocument();
    expect(screen.getByText("Laptop Request")).toBeInTheDocument();
    expect(loaders.getRequestBreachReport).toHaveBeenCalledTimes(1);
  });
});
