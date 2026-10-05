import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../../_data/loaders", () => ({
  getCrmAccount: vi.fn(),
  getCrmAccounts: vi.fn(),
  getCrmAccountAncestors: vi.fn(),
  getCrmAccountChildren: vi.fn(),
}));

// RefreshErrorState (rendered for partial side-load failures) uses router.refresh().
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

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

const account: Record<string, unknown> = { id: "acc-99", name: "Deep Link Co", industry: "Energy", website: null, parentId: null, contactCount: 2 };

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
    mAccount.mockResolvedValue({ data: account as never, source: "api" });
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
    mAccount.mockResolvedValue({ data: account as never, source: "api" });
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

describe("Account detail partial failure (GAP-CRM-ACCOUNTS-DETAIL-04)", () => {
  it("renders the account and an inline retry when only children fail", async () => {
    mAccount.mockResolvedValue({ data: account as never, source: "api" });
    mAccounts.mockResolvedValue({ data: [], source: "api" });
    mAncestors.mockResolvedValue({ data: [], source: "api" });
    mChildren.mockResolvedValue({ data: [], source: "error", status: 503 });

    render(await Page({ params: { id: "acc-99" } }));
    // The loaded account is NOT replaced by a full-page error.
    expect(screen.getAllByText("Deep Link Co").length).toBeGreaterThan(0);
    // The Child Accounts card offers a retry rather than a false "No child accounts".
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("No child accounts")).not.toBeInTheDocument();
  });
});

describe("Account detail website hardening (GAP-CRM-ACCOUNTS-DETAIL-05)", () => {
  beforeEach(() => {
    mAccounts.mockResolvedValue({ data: [], source: "api" });
    mAncestors.mockResolvedValue({ data: [], source: "api" });
    mChildren.mockResolvedValue({ data: [], source: "api" });
    mockRoles.mockReturnValue(["crm_admin"]);
  });

  it("does not render a javascript: website as a link", async () => {
    mAccount.mockResolvedValue({
      data: { ...account, website: "javascript:alert(1)" } as never,
      source: "api",
    });
    render(await Page({ params: { id: "acc-99" } }));
    // The raw value is shown as text, never as an href.
    const link = screen.queryByRole("link", { name: "javascript:alert(1)" });
    expect(link).not.toBeInTheDocument();
    expect(screen.getByText("javascript:alert(1)")).toBeInTheDocument();
  });

  it("renders a bare domain as an https link", async () => {
    mAccount.mockResolvedValue({
      data: { ...account, website: "ndma.gov.in" } as never,
      source: "api",
    });
    render(await Page({ params: { id: "acc-99" } }));
    const link = screen.getByRole("link", { name: "ndma.gov.in" });
    expect(link).toHaveAttribute("href", "https://ndma.gov.in/");
  });
});
