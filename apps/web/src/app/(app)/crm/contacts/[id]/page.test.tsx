import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../../_data/loaders", () => ({ getContactById: vi.fn() }));

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
vi.mock("./ContactDetailActions", () => ({ ContactDetailActions: () => <div /> }));
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

  it("shows the clear phone/email for crm_admin", async () => {
    mockRoles.mockReturnValue(["crm_admin"]);
    mContact.mockResolvedValue({ data: pii, source: "api" });
    render(await Page({ params: { id: "c-1" } }));
    expect(screen.getByText("9876543210")).toBeInTheDocument();
    expect(screen.getByText("asha@example.com")).toBeInTheDocument();
  });

  it("no longer renders a bare Yes/No marketing-consent row", async () => {
    mockRoles.mockReturnValue(["crm_admin"]);
    mContact.mockResolvedValue({ data: pii, source: "api" });
    render(await Page({ params: { id: "c-1" } }));
    expect(screen.queryByText("Marketing Consent")).not.toBeInTheDocument();
  });
});
