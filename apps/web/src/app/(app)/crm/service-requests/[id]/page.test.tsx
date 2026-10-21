import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@/test-utils/intl-render";

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

describe("ServiceRequestDetailPage — related account (GAP-CRM-HEALTH-ACCOUNTID-03)", () => {
  it("links an account follow-up to its account", async () => {
    mockDetail({ serviceType: "Account Health Follow-up", relatedAccountId: "11111111-1111-4111-8111-111111111111", status: "open" });
    render(await Page({ params: { id: "sr-1" } }));
    expect(screen.getByText("Related account")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View account" })).toHaveAttribute(
      "href",
      "/crm/accounts/11111111-1111-4111-8111-111111111111",
    );
  });

  it("shows no related-account field on an ordinary citizen request", async () => {
    mockDetail({ relatedAccountId: null, status: "open" });
    render(await Page({ params: { id: "sr-1" } }));
    expect(screen.queryByText("Related account")).not.toBeInTheDocument();
  });
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

describe("ServiceRequestDetailPage — DETAIL-02 / F1-04 + F1-06 (masked by default, audited reveal, DPDP)", () => {
  // The page asks for masked values for EVERY viewer (?maskPii=true), so the server sends
  // the masked form even to a PII-read role; only the audited reveal yields the clear value.
  const MASKED = { citizenPhone: "******3210", citizenEmail: "a***@example.gov.in" };

  afterEach(() => vi.restoreAllMocks());

  it("requests the detail with ?maskPii=true so no viewer is sent the clear value", async () => {
    mockRoles.mockReturnValue(["crm_admin"]);
    mockDetail({ status: "open", ...MASKED });
    await Page({ params: { id: "sr-1" } });
    expect(fetchJsonMock.mock.calls[0]![0]).toBe("/api/v1/crm/service-requests/sr-1?maskPii=true");
  });

  it("renders the server-masked phone and email for a non-privileged crm_user, with NO Reveal control", async () => {
    mockRoles.mockReturnValue(["crm_user"]);
    mockDetail({ status: "open", ...MASKED });
    render(await Page({ params: { id: "sr-1" } }));
    expect(screen.queryByText("9876543210")).not.toBeInTheDocument();
    expect(screen.queryByText("asha.rao@example.gov.in")).not.toBeInTheDocument();
    expect(screen.getByText("******3210")).toBeInTheDocument();
    expect(screen.getByText("a***@example.gov.in")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reveal" })).not.toBeInTheDocument();
    expect(screen.getByText(/masked under the DPDP Act/i)).toBeInTheDocument();
    expect(screen.getByText(/Ask a CRM administrator/i)).toBeInTheDocument();
  });

  it("a privileged crm_admin also sees the masked values first, with a Reveal control for each and never the clear value", async () => {
    mockRoles.mockReturnValue(["crm_admin"]);
    mockDetail({ status: "open", ...MASKED });
    const { container } = render(await Page({ params: { id: "sr-1" } }));
    expect(screen.getByText("******3210")).toBeInTheDocument();
    expect(screen.getByText("a***@example.gov.in")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Reveal" })).toHaveLength(2);
    expect(container.textContent).not.toContain("9876543210");
    expect(container.textContent).not.toContain("asha.rao@example.gov.in");
    expect(screen.getByText(/a reason is required and the access is recorded in the audit log/i)).toBeInTheDocument();
    expect(screen.queryByText(/Ask a CRM administrator/i)).not.toBeInTheDocument();
  });

  it("Reveal on the phone asks for a reason, calls the audited endpoint for this service request, then shows the clear number", async () => {
    mockRoles.mockReturnValue(["crm_admin"]);
    mockDetail({ status: "open", ...MASKED });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ data: { value: "9876543210" } }), { status: 200 }));
    render(await Page({ params: { id: "sr-1" } }));

    fireEvent.click(screen.getAllByRole("button", { name: "Reveal" })[0]!);
    expect(fetchSpy).not.toHaveBeenCalled();
    fireEvent.change(await screen.findByLabelText(/Reason for revealing/i), { target: { value: "Citizen asked for a call back" } });
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Reveal" }));

    expect(await screen.findByText("9876543210")).toBeInTheDocument();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/crm/pii/reveal");
    expect(JSON.parse(init.body as string)).toEqual({
      resourceType: "service_request",
      resourceId: "sr-1",
      field: "citizenPhone",
      reason: "Citizen asked for a call back",
    });
    // The email stays masked until it is revealed on its own.
    expect(screen.getByText("a***@example.gov.in")).toBeInTheDocument();
  });

  it("a refused reveal (403) leaves the value masked", async () => {
    mockRoles.mockReturnValue(["crm_admin"]);
    mockDetail({ status: "open", ...MASKED });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "FORBIDDEN" }), { status: 403 }));
    const { container } = render(await Page({ params: { id: "sr-1" } }));
    fireEvent.click(screen.getAllByRole("button", { name: "Reveal" })[0]!);
    fireEvent.change(await screen.findByLabelText(/Reason for revealing/i), { target: { value: "Citizen asked for a call back" } });
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Reveal" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(container.textContent).not.toContain("9876543210");
    expect(screen.getByText("******3210")).toBeInTheDocument();
  });

  it("shows a dash and no Reveal control when the citizen left no phone or email", async () => {
    mockRoles.mockReturnValue(["crm_admin"]);
    mockDetail({ status: "open", citizenPhone: undefined, citizenEmail: undefined });
    render(await Page({ params: { id: "sr-1" } }));
    expect(screen.queryByRole("button", { name: "Reveal" })).not.toBeInTheDocument();
    expect(screen.queryByText(/masked under the DPDP Act/i)).not.toBeInTheDocument();
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
