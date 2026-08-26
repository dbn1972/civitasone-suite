import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../_data/loaders", () => ({ getCrmContacts: vi.fn() }));
vi.mock("./ContactsTable", () => ({ ContactsTable: () => <div data-testid="contacts-table" /> }));
vi.mock("./ContactToolbar", () => ({ ContactToolbar: () => <div data-testid="toolbar" /> }));
vi.mock("../../../_components/crm/LeadFilters", () => ({ LeadFilters: () => <div data-testid="lead-filters" /> }));
vi.mock("../../../_components/crm/MergeButton", () => ({ MergeButton: () => <div data-testid="merge" /> }));

import Page from "./page";
import { getCrmContacts } from "../../../_data/loaders";

const mocked = vi.mocked(getCrmContacts);

beforeEach(() => mocked.mockReset());

describe("Contacts list page stat gating (LQ-003)", () => {
  it("shows '—' for every stat card (not fabricated 0s) when the load failed", async () => {
    mocked.mockResolvedValue({ data: [], source: "error" });
    render(await Page({ searchParams: {} }));
    // All four stat values render em dashes, and the saved-info badge appears.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument();
  });

  it("shows real counts when the load succeeds", async () => {
    mocked.mockResolvedValue({
      data: [
        { id: "1", name: "A", account: "x", email: "a@x.in", phone: "", temperature: "hot", priority: "high" },
        { id: "2", name: "B", account: "y", email: "", phone: "", temperature: "cold", priority: "low" },
      ] as never,
      source: "api",
    });
    render(await Page({ searchParams: {} }));
    // Total Contacts = 2
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.queryByText(/couldn.t load/i)).not.toBeInTheDocument();
  });

  it("renders DPDP data protection notice", async () => {
    mocked.mockResolvedValue({ data: [], source: "api" });
    render(await Page({ searchParams: {} }));
    const notice = screen.getByRole("note");
    expect(notice).toBeInTheDocument();
    expect(notice.textContent).toMatch(/digital personal data protection/i);
  });

  it("renders 'Priority Contacts' label (not 'High Priority Leads')", async () => {
    mocked.mockResolvedValue({ data: [], source: "api" });
    render(await Page({ searchParams: {} }));
    expect(screen.getByText("Priority Contacts")).toBeInTheDocument();
    expect(screen.queryByText("High Priority Leads")).not.toBeInTheDocument();
  });
});
