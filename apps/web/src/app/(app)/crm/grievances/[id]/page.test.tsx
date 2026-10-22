import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider as __Intl } from "next-intl";
import __enMessages from "@/messages/en.json";
function render(ui: React.ReactElement) {
  return rtlRender(<__Intl locale="en" messages={__enMessages}>{ui}</__Intl>);
}

const fetchJsonMock = vi.fn();
vi.mock("../../../../_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

const rolesMock = vi.fn(() => [] as string[]);
vi.mock("@/lib/auth/roleGuard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/roleGuard")>("@/lib/auth/roleGuard");
  return { ...actual, getSessionRoles: () => rolesMock() };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import GrievanceDetailPage from "./page";
import { formatIndianDateTime } from "@/lib/formatters";

const ID = "8cf7f7eb-1de6-4a31-b48c-1f598ecf33c0";

function grievance(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    referenceNo: "DARPG/2026/000123",
    citizenName: "Ravi Kumar",
    citizenPhone: "9876543210",
    citizenEmail: "ravi@example.com",
    category: "Water Supply",
    subject: "No water for 3 days",
    priority: "high",
    status: "FORWARDED",
    assignedTo: undefined,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    version: 2,
    ...overrides,
  };
}

describe("GrievanceDetailPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    rolesMock.mockReset();
    rolesMock.mockReturnValue(["crm_user"]);
  });

  // GAP-CRM-GRIEVANCES-DETAIL-05 / F1-01 + F1-06 — citizen contact is masked
  // by the SERVER for a base crm_user (no PII-read role); the API returns the
  // already-masked value and the page renders it verbatim (no client masking).
  // The clear value must never reach the DOM.
  it("renders the server-masked citizen phone and email for a role without PII-read rights", async () => {
    fetchJsonMock.mockResolvedValue({
      data: grievance({ citizenPhone: "******3210", citizenEmail: "r***@example.com" }),
      source: "api",
    });
    const ui = await GrievanceDetailPage({ params: { id: ID } });
    render(ui);

    expect(screen.queryByText("9876543210")).not.toBeInTheDocument();
    expect(screen.queryByText("ravi@example.com")).not.toBeInTheDocument();
    expect(screen.getByText("******3210")).toBeInTheDocument();
    expect(screen.getByText("r***@example.com")).toBeInTheDocument();
    expect(screen.getByText(/masked under the DPDP Act/i)).toBeInTheDocument();
  });

  // GAP-CRM-GRIEVANCES-DETAIL-05 — default-masked, audited reveal. Even a PII-read
  // role asks the server for the masked read (`?pii=masked`), so the clear phone and
  // email are never in the page payload; they exist only after an audited reveal.
  it("asks the server to mask for a PII-read role and offers an audited Reveal instead of the clear value", async () => {
    rolesMock.mockReturnValue(["crm_admin"]);
    fetchJsonMock.mockResolvedValue({
      data: grievance({ citizenPhone: "******3210", citizenEmail: "r***@example.com" }),
      source: "api",
    });
    const ui = await GrievanceDetailPage({ params: { id: ID } });
    const { container } = render(ui);

    expect(String(fetchJsonMock.mock.calls[0]![0])).toBe(`/api/v1/crm/grievances/${ID}?pii=masked`);
    expect(screen.getByText("******3210")).toBeInTheDocument();
    expect(screen.getByText("r***@example.com")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Reveal" })).toHaveLength(2);
    expect(container.innerHTML).not.toContain("9876543210");
    expect(container.innerHTML).not.toContain("ravi@example.com");
    expect(screen.getByText(/every reveal is recorded in the audit log/i)).toBeInTheDocument();
  });

  it("reveals the phone only through the audited endpoint, naming the grievance and field", async () => {
    rolesMock.mockReturnValue(["crm_admin"]);
    fetchJsonMock.mockResolvedValue({
      data: grievance({ citizenPhone: "******3210", citizenEmail: "r***@example.com" }),
      source: "api",
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ data: { value: "9876543210" } }), { status: 200 }));
    const ui = await GrievanceDetailPage({ params: { id: ID } });
    render(ui);

    expect(fetchSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: "Reveal" })[0]!);
    fireEvent.change(await screen.findByLabelText(/Reason for revealing/i), { target: { value: "citizen called to chase this case" } });
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Reveal" }));

    expect(await screen.findByText("9876543210")).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/crm/pii/reveal");
    expect(JSON.parse(init.body as string)).toEqual({
      resourceType: "grievance",
      resourceId: ID,
      field: "citizenPhone",
      reason: "citizen called to chase this case",
    });
    // The email stays masked: reveal is per field.
    expect(screen.queryByText("ravi@example.com")).not.toBeInTheDocument();
    fetchSpy.mockRestore();
  });

  it("never offers Reveal to a role without PII-read rights", async () => {
    rolesMock.mockReturnValue(["crm_user"]);
    fetchJsonMock.mockResolvedValue({
      data: grievance({ citizenPhone: "******3210", citizenEmail: "r***@example.com" }),
      source: "api",
    });
    const ui = await GrievanceDetailPage({ params: { id: ID } });
    render(ui);

    expect(screen.queryByRole("button", { name: "Reveal" })).not.toBeInTheDocument();
    expect(screen.getByText(/Ask a CRM administrator/i)).toBeInTheDocument();
  });

  // GAP-CRM-GRIEVANCES-DETAIL-04 — forwardedTo, appealReason and a Forwarded
  // timeline step are displayed once the backend returns them.
  it("renders forwarded department, appeal reason and a Forwarded timeline step", async () => {
    fetchJsonMock.mockResolvedValue({
      data: grievance({
        status: "APPEAL",
        forwardedTo: "Water Dept",
        forwardedAt: "2026-08-01T06:00:00.000Z",
        appealReason: "No response in 30 days",
        escalatedAt: "2026-08-03T00:00:00.000Z",
      }),
      source: "api",
    });
    const ui = await GrievanceDetailPage({ params: { id: ID } });
    render(ui);

    expect(screen.getByText("Forwarded To")).toBeInTheDocument();
    expect(screen.getByText(/Water Dept/)).toBeInTheDocument();
    expect(screen.getByText("Appeal Reason")).toBeInTheDocument();
    expect(screen.getByText("No response in 30 days")).toBeInTheDocument();
    // Timeline has a Forwarded step and the First appeal rename.
    expect(screen.getByText("Forwarded")).toBeInTheDocument();
    // "First appeal" appears twice for an APPEAL grievance: the timeline step and the status pill.
    expect(screen.getAllByText("First appeal")).toHaveLength(2);
    expect(screen.queryByText("Escalated")).not.toBeInTheDocument();
  });

  // GAP-CRM-GRIEVANCES-06: the status pill reads "First appeal" for APPEAL (not the humanised
  // enum "Appeal"), matching the timeline step, the register tile and the register table.
  it("labels an APPEAL grievance's status pill 'First appeal', and leaves other statuses humanised", async () => {
    fetchJsonMock.mockResolvedValue({ data: grievance({ status: "APPEAL", escalatedAt: "2026-08-03T00:00:00.000Z" }), source: "api" });
    render(await GrievanceDetailPage({ params: { id: ID } }));
    const statusPill = screen.getByText("Status").nextElementSibling!.querySelector(".pill");
    expect(statusPill).toHaveTextContent("First appeal");
    expect(screen.queryByText("Appeal")).not.toBeInTheDocument();
  });

  it("keeps the humanised label for a non-APPEAL status", async () => {
    fetchJsonMock.mockResolvedValue({ data: grievance({ status: "ATTENDED" }), source: "api" });
    render(await GrievanceDetailPage({ params: { id: ID } }));
    expect(screen.getByText("Status").nextElementSibling!.querySelector(".pill")).toHaveTextContent("Attended");
  });

  // GAP-CRM-GRIEVANCES-06: priority is a theme-safe shared pill, not an inline var(--bg)-on-fill span.
  it.each([
    ["urgent", "Urgent", "bad"],
    ["high", "High", "warn"],
    ["normal", "Normal", "mut"],
    ["low", "Low", "mut"],
  ])("renders %s priority with the shared .pill.%s tone class", async (priority, label, tone) => {
    fetchJsonMock.mockResolvedValue({ data: grievance({ priority }), source: "api" });
    render(await GrievanceDetailPage({ params: { id: ID } }));
    const badge = screen.getByText("Priority").nextElementSibling!.querySelector("span")!;
    expect(badge).toHaveTextContent(label);
    expect(badge).toHaveClass("pill", tone);
    // No hand-rolled inline colours that ignore the dark theme.
    expect(badge.getAttribute("style") ?? "").not.toMatch(/background|color/);
  });

  // GAP-CRM-GRIEVANCES-DETAIL-04: the Assigned step carries the real assignment time.
  it("shows the real assignment time on the Assigned timeline step", async () => {
    fetchJsonMock.mockResolvedValue({
      data: grievance({ assignedTo: "11111111-2222-4333-8444-555555555555", assignedAt: "2026-08-05T10:30:00.000Z" }),
      source: "api",
    });
    render(await GrievanceDetailPage({ params: { id: ID } }));
    const step = screen.getByText("Assigned").closest("li")!;
    expect(step).toHaveTextContent(formatIndianDateTime("2026-08-05T10:30:00.000Z"));
  });

  it("shows Assigned as done but WITHOUT a time (no invented one) when the grievance predates assigned_at", async () => {
    fetchJsonMock.mockResolvedValue({
      data: grievance({ assignedTo: "11111111-2222-4333-8444-555555555555", assignedAt: null }),
      source: "api",
    });
    render(await GrievanceDetailPage({ params: { id: ID } }));
    const step = screen.getByText("Assigned").closest("li")!;
    expect(step).toHaveTextContent("✓");
    // Only the label and tick: no timestamp line.
    expect(step.querySelectorAll("div > div").length).toBeGreaterThan(0);
    expect(step.textContent).toBe("✓Assigned");
  });

  it("does not mark Assigned done when nobody is assigned", async () => {
    fetchJsonMock.mockResolvedValue({ data: grievance({ assignedTo: undefined, assignedAt: null }), source: "api" });
    render(await GrievanceDetailPage({ params: { id: ID } }));
    expect(screen.getByText("Assigned").closest("li")).toHaveTextContent("○");
  });

  // GAP-CRM-GRIEVANCES-DETAIL-07 — a 5xx/network error must show a retry state,
  // not "Grievance not found".
  it("renders a retry error state (not 'not found') on a 500", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error", status: 500 });
    const ui = await GrievanceDetailPage({ params: { id: ID } });
    render(ui);

    expect(screen.queryByText("Grievance not found")).not.toBeInTheDocument();
    expect(screen.getByText(/couldn't load/i)).toBeInTheDocument();
  });

  it("renders 'Grievance not found' on a 404", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error", status: 404 });
    const ui = await GrievanceDetailPage({ params: { id: ID } });
    render(ui);

    expect(screen.getAllByText("Grievance not found").length).toBeGreaterThan(0);
    expect(screen.queryByText(/couldn't load/i)).not.toBeInTheDocument();
  });

  // GAP-CRM-GRIEVANCES-DETAIL-08 — assignedTo is an identity-service UUID, not a
  // name. It must never be printed verbatim as if it were a person's name.
  it("does not print a raw assignee UUID verbatim in the Assigned To row", async () => {
    const assigneeId = "11111111-2222-4333-8444-555555555555";
    fetchJsonMock.mockResolvedValue({ data: grievance({ assignedTo: assigneeId }), source: "api" });
    const ui = await GrievanceDetailPage({ params: { id: ID } });
    render(ui);

    expect(screen.queryByText(assigneeId)).not.toBeInTheDocument();
    expect(screen.getByText(/Assigned \(ID 11111111…\)/)).toBeInTheDocument();
  });

  it("shows 'Unassigned' when there is no assignee", async () => {
    fetchJsonMock.mockResolvedValue({ data: grievance({ assignedTo: undefined }), source: "api" });
    const ui = await GrievanceDetailPage({ params: { id: ID } });
    render(ui);
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  // GAP-CRM-GRIEVANCES-DETAIL-08 acceptance: an assigned grievance shows the
  // person's NAME, resolved through the identity users endpoint.
  it("shows the assignee's name resolved from identity, not the id", async () => {
    const assigneeId = "11111111-2222-4333-8444-555555555555";
    fetchJsonMock.mockImplementation(async (url: string, _fallback: unknown, opts?: { mapResponse?: (p: unknown) => unknown }) => {
      if (url === `/api/identity/users/${assigneeId}`) {
        const payload = { data: { id: assigneeId, name: "Sunita Mohanty", email: "sunita@example.gov.in" } };
        return { data: opts?.mapResponse ? opts.mapResponse(payload) : payload, source: "api" };
      }
      return { data: grievance({ assignedTo: assigneeId }), source: "api" };
    });
    render(await GrievanceDetailPage({ params: { id: ID } }));
    expect(screen.getByText("Sunita Mohanty")).toBeInTheDocument();
    expect(screen.queryByText(/Assigned \(ID/)).not.toBeInTheDocument();
    expect(screen.queryByText(assigneeId)).not.toBeInTheDocument();
  });

  it("falls back to the short id label when identity refuses the lookup (e.g. 403)", async () => {
    const assigneeId = "11111111-2222-4333-8444-555555555555";
    fetchJsonMock.mockImplementation(async (url: string) =>
      url.startsWith("/api/identity/users/")
        ? { data: null, source: "error", status: 403 }
        : { data: grievance({ assignedTo: assigneeId }), source: "api" },
    );
    render(await GrievanceDetailPage({ params: { id: ID } }));
    expect(screen.getByText(/Assigned \(ID 11111111…\)/)).toBeInTheDocument();
  });
});
