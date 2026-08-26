import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../_data/loaders", () => ({ getCrmAccounts: vi.fn() }));
vi.mock("./AccountsTable", () => ({ AccountsTable: () => <div data-testid="accounts-table" /> }));
vi.mock("./AccountHierarchy", () => ({ AccountHierarchy: () => <div data-testid="hierarchy" /> }));
vi.mock("./NewAccountForm", () => ({ NewAccountForm: () => <div data-testid="new-form" /> }));
vi.mock("../../../_components/crm/MergeButton", () => ({ MergeButton: () => <div data-testid="merge" /> }));
vi.mock("./hierarchy", () => ({
  countSubsidiaries: vi.fn((accs: { parentId?: string }[]) => accs.filter((a) => a.parentId).length),
  buildAccountTree: vi.fn(() => []),
}));

import Page from "./page";
import { getCrmAccounts } from "../../../_data/loaders";

const mocked = vi.mocked(getCrmAccounts);

const sampleAccounts = [
  { id: "1", name: "NDMA", industry: "Disaster Management", website: "ndma.gov.in", contactCount: 5, parentId: undefined },
  { id: "2", name: "SDMA UP", industry: "Disaster Management", website: "sdma.up.gov.in", contactCount: 3, parentId: "1" },
];

beforeEach(() => mocked.mockReset());

describe("Accounts list page", () => {
  it("renders heading 'Accounts'", async () => {
    mocked.mockResolvedValue({ data: [], source: "api" });
    render(await Page());
    expect(screen.getByRole("heading", { name: "Accounts" })).toBeInTheDocument();
  });

  it("renders 'Sectors / Ministries' label (not 'Industries Covered')", async () => {
    mocked.mockResolvedValue({ data: [], source: "api" });
    render(await Page());
    expect(screen.getByText("Sectors / Ministries")).toBeInTheDocument();
    expect(screen.queryByText("Industries Covered")).not.toBeInTheDocument();
  });

  it("renders AccountsTable and AccountHierarchy", async () => {
    mocked.mockResolvedValue({ data: [], source: "api" });
    render(await Page());
    expect(screen.getByTestId("accounts-table")).toBeInTheDocument();
    expect(screen.getByTestId("hierarchy")).toBeInTheDocument();
  });

  it("shows real counts when load succeeds", async () => {
    mocked.mockResolvedValue({ data: sampleAccounts as never, source: "api" });
    render(await Page());
    // Linked Contacts = 5+3 = 8, unique among stat values
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.queryByText(/couldn.t load/i)).not.toBeInTheDocument();
  });

  it("shows '—' for all stats when load fails (source='error')", async () => {
    mocked.mockResolvedValue({ data: [], source: "error" });
    render(await Page());
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument();
  });
});
