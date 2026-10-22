import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { renderWithIntl } from "@/lib/testUtils/intl";

vi.mock("../../../../_data/loaders", () => ({ getContactById: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const browserFetchMock = vi.fn();
vi.mock("@/lib/api/browserClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/browserClient")>("@/lib/api/browserClient");
  return { ...actual, browserFetch: (...args: unknown[]) => browserFetchMock(...args) };
});

const mockRoles = vi.fn<() => string[]>();
vi.mock("@/lib/auth/roleGuard", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth/roleGuard")>();
  return { ...actual, getSessionRoles: () => mockRoles() };
});

vi.mock("../../../../_components/crm/DocumentsPanel", () => ({
  DocumentsPanel: (props: { canVerify?: boolean }) => (
    <div data-testid="docs" data-can-verify={String(Boolean(props.canVerify))} />
  ),
}));
vi.mock("./ContactDetailActions", () => ({
  ContactDetailActions: (props: { canDelete?: boolean }) => (
    <div data-testid="actions" data-can-delete={String(Boolean(props.canDelete))} />
  ),
}));
vi.mock("../../../../_components/crm/QualifyPanel", () => ({ QualifyPanel: () => <div /> }));
vi.mock("../../../../_components/crm/ScoreHistoryView", () => ({ ScoreHistoryView: () => <div /> }));
vi.mock("../../../../_components/crm/LeadTransitionControl", () => ({ LeadTransitionControl: () => <div /> }));
vi.mock("../../../../_components/crm/LeadAssignmentControl", () => ({ LeadAssignmentControl: () => <div /> }));
vi.mock("../../../../_components/crm/AssignmentLogView", () => ({ AssignmentLogView: () => <div /> }));
vi.mock("../../../../_components/crm/Customer360Panel", () => ({ Customer360Panel: () => <div /> }));
vi.mock("../../../../_components/crm/ActivityFeed", () => ({ ActivityFeed: () => <div /> }));
vi.mock("../../../../_components/crm/CommunicationLog", () => ({ CommunicationLog: () => <div /> }));
vi.mock("../../../../_components/crm/AddressesEditor", () => ({ AddressesEditor: () => <div /> }));
vi.mock("../../../../_components/crm/ContactRolesEditor", () => ({ ContactRolesEditor: () => <div /> }));
vi.mock("../../../../_components/crm/DocumentAlertsView", () => ({ DocumentAlertsView: () => <div /> }));

import Page from "./page";
import { getContactById } from "../../../../_data/loaders";

const mContact = vi.mocked(getContactById);
const contact = { id: "c-1", name: "Asha", phone: null, email: null, deals: [], tags: [], activityTimeline: [] } as never;

beforeEach(() => {
  browserFetchMock.mockReset();
  mContact.mockReset();
  mContact.mockResolvedValue({ data: contact, source: "api" });
  mockRoles.mockReset();
});

describe("Contact detail document verify gating (GAP-CRM-ACCOUNTS-DETAIL-02)", () => {
  it("passes canVerify=false for a plain crm_user", async () => {
    mockRoles.mockReturnValue(["crm_user"]);
    render(await Page({ params: { id: "c-1" } }));
    expect(screen.getByTestId("docs").dataset.canVerify).toBe("false");
  });

  it("passes canVerify=true for crm_admin", async () => {
    mockRoles.mockReturnValue(["crm_admin"]);
    render(await Page({ params: { id: "c-1" } }));
    expect(screen.getByTestId("docs").dataset.canVerify).toBe("true");
  });

  // The verify route admits crm_admin / super_admin / tenant_admin only; "admin" and "platform_admin"
  // clear the broader CRM admin gate but are 403'd, so they must not be offered Verify / Reject.
  it.each(["admin", "platform_admin"])("passes canVerify=false for %s (the verify route answers 403)", async (role) => {
    mockRoles.mockReturnValue(["crm_user", role]);
    render(await Page({ params: { id: "c-1" } }));
    expect(screen.getByTestId("docs").dataset.canVerify).toBe("false");
  });

  it.each(["super_admin", "tenant_admin"])("passes canVerify=true for %s (the verify route admits it)", async (role) => {
    mockRoles.mockReturnValue([role]);
    render(await Page({ params: { id: "c-1" } }));
    expect(screen.getByTestId("docs").dataset.canVerify).toBe("true");
  });
});

describe("Contact detail PII masking (GAP-CRM-CONTACTS-DETAIL-02)", () => {
  const pii = { id: "c-1", name: "Asha", phone: "9876543210", email: "asha@example.com", marketingConsent: true, deals: [], tags: [], activityTimeline: [] } as never;

  it("masks phone/email for a base crm_user and keeps the clear value out of the DOM", async () => {
    mockRoles.mockReturnValue(["crm_user"]);
    mContact.mockResolvedValue({ data: pii, source: "api" });
    render(await Page({ params: { id: "c-1" } }));
    expect(screen.getByText("98XXXXX210")).toBeInTheDocument();
    expect(screen.getByText("a***@e******.c**")).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("9876543210");
    expect(document.body.innerHTML).not.toContain("asha@example.com");
  });

  it("gives a base crm_user no reveal control", async () => {
    mockRoles.mockReturnValue(["crm_user"]);
    mContact.mockResolvedValue({ data: pii, source: "api" });
    renderWithIntl(await Page({ params: { id: "c-1" } }));
    expect(screen.queryByRole("button", { name: "Reveal" })).not.toBeInTheDocument();
  });

  // GAP-CRM-CONTACTS-DETAIL-02: even a role allowed to read PII sees the MASKED
  // value on load; the clear value is not in the DOM until an audited reveal.
  it("masks phone/email for crm_admin too, with a Reveal control per value and no clear value in the DOM", async () => {
    mockRoles.mockReturnValue(["crm_admin"]);
    mContact.mockResolvedValue({ data: pii, source: "api" });
    renderWithIntl(await Page({ params: { id: "c-1" } }));
    expect(screen.getByText("98XXXXX210")).toBeInTheDocument();
    expect(screen.getByText("a***@e******.c**")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Reveal" })).toHaveLength(2);
    expect(document.body.innerHTML).not.toContain("9876543210");
    expect(document.body.innerHTML).not.toContain("asha@example.com");
    expect(browserFetchMock).not.toHaveBeenCalled();
  });

  it("revealing the phone makes exactly one audited call with the reason, then shows the clear value", async () => {
    mockRoles.mockReturnValue(["crm_admin"]);
    mContact.mockResolvedValue({ data: pii, source: "api" });
    browserFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { resourceType: "contact", field: "phone", value: "9876543210" } }),
    } as unknown as Response);
    renderWithIntl(await Page({ params: { id: "c-1" } }));

    const phoneRow = screen.getByText("Phone").closest(".fld") as HTMLElement;
    fireEvent.click(within(phoneRow).getByRole("button", { name: "Reveal" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Callback requested by the citizen" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reveal" }));

    expect(await screen.findByText("9876543210")).toBeInTheDocument();
    expect(browserFetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = browserFetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(path).toBe("v1/crm/pii/reveal");
    expect(JSON.parse(init.body)).toEqual({
      resourceType: "contact",
      resourceId: "c-1",
      field: "phone",
      reason: "Callback requested by the citizen",
    });
    // the email stays masked: reveal is per field
    expect(screen.getByText("a***@e******.c**")).toBeInTheDocument();
  });

  it("does not double-mask a value crm-service already redacted for a crm_user", async () => {
    mockRoles.mockReturnValue(["crm_user"]);
    mContact.mockResolvedValue({ data: { ...(pii as object), phone: "******3210", email: "a***@example.com" } as never, source: "api" });
    render(await Page({ params: { id: "c-1" } }));
    expect(screen.getByText("******3210")).toBeInTheDocument();
    expect(screen.getByText("a***@example.com")).toBeInTheDocument();
  });

  it("no longer renders a bare Yes/No marketing-consent row", async () => {
    mockRoles.mockReturnValue(["crm_admin"]);
    mContact.mockResolvedValue({ data: pii, source: "api" });
    renderWithIntl(await Page({ params: { id: "c-1" } }));
    expect(screen.queryByText("Marketing Consent")).not.toBeInTheDocument();
  });
});

describe("Contact detail delete gating (GAP-CRM-CONTACTS-DETAIL-03)", () => {
  it("canDelete=false for a plain crm_user", async () => {
    mockRoles.mockReturnValue(["crm_user"]);
    render(await Page({ params: { id: "c-1" } }));
    expect(screen.getByTestId("actions").dataset.canDelete).toBe("false");
  });

  it("canDelete=true for crm_admin", async () => {
    mockRoles.mockReturnValue(["crm_admin"]);
    render(await Page({ params: { id: "c-1" } }));
    expect(screen.getByTestId("actions").dataset.canDelete).toBe("true");
  });
});

describe("Contact detail duplicate cards removed (GAP-CRM-CONTACTS-DETAIL-04)", () => {
  it("does not render a page-level 'Related Deals' or 'Activity Timeline' card", async () => {
    mockRoles.mockReturnValue(["crm_admin"]);
    mContact.mockResolvedValue({
      data: { ...(contact as object), deals: [{ id: "d1", dealName: "Deal A", stage: "won", amount: 100 }], activityTimeline: [{ id: "a1", type: "call", subject: "Rang", status: "completed" }] } as never,
      source: "api",
    });
    render(await Page({ params: { id: "c-1" } }));
    expect(screen.queryByRole("heading", { name: "Related Deals" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Activity Timeline" })).not.toBeInTheDocument();
  });
});

describe("Contact detail failure vs not-found (GAP-CRM-CONTACTS-DETAIL-05)", () => {
  it("a 500 shows a retry/error state, not 'does not exist'", async () => {
    mockRoles.mockReturnValue(["crm_user"]);
    mContact.mockResolvedValue({ data: null, source: "error", status: 500 } as never);
    render(await Page({ params: { id: "c-1" } }));
    expect(screen.queryByText(/does not exist or has been removed/)).not.toBeInTheDocument();
  });

  it("a 404 shows the not-found copy", async () => {
    mockRoles.mockReturnValue(["crm_user"]);
    mContact.mockResolvedValue({ data: null, source: "error", status: 404 } as never);
    render(await Page({ params: { id: "c-1" } }));
    expect(screen.getByText(/does not exist or has been removed/)).toBeInTheDocument();
  });
});

describe("Contact detail status/classification labels (GAP-CRM-CONTACTS-DETAIL-07)", () => {
  it("renders the canonical lead-status label, not the raw enum", async () => {
    mockRoles.mockReturnValue(["crm_admin"]);
    mContact.mockResolvedValue({
      data: { ...(contact as object), leadStatus: "disqualified", temperature: "hot", priority: "high" } as never,
      source: "api",
    });
    render(await Page({ params: { id: "c-1" } }));
    expect(screen.getByText("Disqualified")).toBeInTheDocument();
    expect(screen.queryByText("disqualified")).not.toBeInTheDocument();
  });

  it("humanizes temperature/priority classification pills (Hot/High, not hot/high)", async () => {
    mockRoles.mockReturnValue(["crm_admin"]);
    mContact.mockResolvedValue({
      data: { ...(contact as object), temperature: "hot", priority: "high" } as never,
      source: "api",
    });
    render(await Page({ params: { id: "c-1" } }));
    expect(screen.getByText(/Temperature: Hot/)).toBeInTheDocument();
    expect(screen.getByText(/Priority: High/)).toBeInTheDocument();
  });
});
