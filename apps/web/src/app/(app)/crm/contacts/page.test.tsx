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
    expect(screen.getByText(/showing saved information/i)).toBeInTheDocument();
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
    // Total Contacts = 2, Hot Leads = 1, High Priority = 1, With Email = 1.
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.queryByText(/showing saved information/i)).not.toBeInTheDocument();
  });
});
