import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../../_data/loaders", () => ({
  getCrmAccount: vi.fn(),
  getCrmAccounts: vi.fn(),
  getCrmAccountAncestors: vi.fn(),
  getCrmAccountChildren: vi.fn(),
}));

const mockRoles = vi.fn<() => string[]>();
vi.mock("@/lib/auth/roleGuard", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth/roleGuard")>();
  return { ...actual, getSessionRoles: () => mockRoles() };
});

// Capture the canVerify prop the DocumentsPanel receives.
const docPanelProps: Array<{ canVerify?: boolean }> = [];
vi.mock("../../../../_components/crm/DocumentsPanel", () => ({
  DocumentsPanel: (props: { canVerify?: boolean }) => {
    docPanelProps.push(props);
    return <div data-testid="docs" data-can-verify={String(Boolean(props.canVerify))} />;
  },
}));
// Light stubs for the rest of the heavy client panels.
vi.mock("./AccountParentForm", () => ({ AccountParentForm: () => <div /> }));
vi.mock("../../../../_components/crm/Customer360Panel", () => ({ Customer360Panel: () => <div /> }));
vi.mock("../../../../_components/crm/AccountRelationshipsEditor", () => ({ AccountRelationshipsEditor: () => <div /> }));
vi.mock("../../../../_components/crm/ActivityFeed", () => ({ ActivityFeed: () => <div /> }));
vi.mock("../../../../_components/crm/CommunicationLog", () => ({ CommunicationLog: () => <div /> }));
vi.mock("../../../../_components/crm/AddressesEditor", () => ({ AddressesEditor: () => <div /> }));
vi.mock("../../../../_components/crm/DocumentAlertsView", () => ({ DocumentAlertsView: () => <div /> }));

import Page from "./page";
import {
  getCrmAccount,
  getCrmAccounts,
  getCrmAccountAncestors,
  getCrmAccountChildren,
} from "../../../../_data/loaders";

const mAccount = vi.mocked(getCrmAccount);
const mAccounts = vi.mocked(getCrmAccounts);
const mAncestors = vi.mocked(getCrmAccountAncestors);
const mChildren = vi.mocked(getCrmAccountChildren);

const account = { id: "acc-99", name: "Deep Link Co", industry: "Energy", website: null, parentId: null, contactCount: 2 } as never;

beforeEach(() => {
  docPanelProps.length = 0;
  mAccount.mockReset();
  mAccounts.mockReset();
  mAncestors.mockReset();
  mChildren.mockReset();
  mRolesDefault();
});
function mRolesDefault() {
  mockRoles.mockReturnValue(["crm_admin"]);
}

describe("Account detail page (GAP-CRM-ACCOUNTS-DETAIL-01)", () => {
  it("renders detail for an account resolved by id even though the default list page omits it", async () => {
    // getCrmAccount resolves it (queries at max page size); the default list is
    // empty (simulating the account being beyond the first 50 rows).
    mAccount.mockResolvedValue({ data: account, source: "api" });
    mAccounts.mockResolvedValue({ data: [], source: "api" });
    mAncestors.mockResolvedValue({ data: [], source: "api" });
    mChildren.mockResolvedValue({ data: [], source: "api" });

    render(await Page({ params: { id: "acc-99" } }));
    expect(screen.getAllByText("Deep Link Co").length).toBeGreaterThan(0);
    expect(screen.queryByText("Account not found")).not.toBeInTheDocument();
  });

  it("renders 'Account not found' when the authoritative ancestors endpoint 404s", async () => {
    mAccount.mockResolvedValue({ data: null, source: "api" });
    mAccounts.mockResolvedValue({ data: [], source: "api" });
    mAncestors.mockResolvedValue({ data: [], source: "error", status: 404 });
    mChildren.mockResolvedValue({ data: [], source: "error", status: 404 });

    render(await Page({ params: { id: "missing" } }));
    expect(screen.getByText("Account not found")).toBeInTheDocument();
  });

  it("shows a retry (not 'not found') on a transient load failure", async () => {
    mAccount.mockResolvedValue({ data: null, source: "error", status: 500 });
    mAccounts.mockResolvedValue({ data: [], source: "error", status: 500 });
    mAncestors.mockResolvedValue({ data: [], source: "error", status: 500 });
    mChildren.mockResolvedValue({ data: [], source: "error", status: 500 });

    render(await Page({ params: { id: "acc-99" } }));
    expect(screen.queryByText("Account not found")).not.toBeInTheDocument();
  });
});

describe("Account detail document verify gating (GAP-CRM-ACCOUNTS-DETAIL-02)", () => {
  beforeEach(() => {
    mAccount.mockResolvedValue({ data: account, source: "api" });
    mAccounts.mockResolvedValue({ data: [], source: "api" });
    mAncestors.mockResolvedValue({ data: [], source: "api" });
    mChildren.mockResolvedValue({ data: [], source: "api" });
  });

  it("passes canVerify=false for a plain crm_user", async () => {
    mockRoles.mockReturnValue(["crm_user"]);
    render(await Page({ params: { id: "acc-99" } }));
    expect(screen.getByTestId("docs").dataset.canVerify).toBe("false");
  });

  it("passes canVerify=true for crm_admin", async () => {
    mockRoles.mockReturnValue(["crm_admin"]);
    render(await Page({ params: { id: "acc-99" } }));
    expect(screen.getByTestId("docs").dataset.canVerify).toBe("true");
  });
});
