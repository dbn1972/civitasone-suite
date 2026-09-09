import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));
vi.mock("@/lib/formatters", () => ({ formatIndianDate: (d: string) => d }));

import { useSeededResource } from "@/lib/sync/resource";
import { ContactsTable } from "./ContactsTable";

const mockedHook = vi.mocked(useSeededResource);

const sampleContacts = [
  {
    id: "1",
    name: "Priya Sharma",
    account: "NDMA",
    email: "priya@ndma.gov.in",
    phone: "9999999999",
    temperature: "warm",
    priority: "high",
    leadStatus: "active",
    segment: "govt",
    expectedValueDisplay: null,
    lastActivity: null,
    tags: ["nodal"],
  },
  {
    id: "2",
    name: "Rajan Singh",
    account: "MoF",
    email: null,
    phone: null,
    temperature: null,
    priority: "low",
    leadStatus: null,
    segment: null,
    expectedValueDisplay: null,
    lastActivity: null,
    tags: null,
  },
];

describe("ContactsTable", () => {
  beforeEach(() => {
    mockedHook.mockReturnValue({
      data: sampleContacts as never,
      fromCache: false,
      offline: false,
      cachedAt: null,
      provenance: "live",
    } as never);
  });

  it("renders table with contacts data", () => {
    render(<ContactsTable contacts={sampleContacts as never} source="api" />);
    expect(screen.getByText("Priya Sharma")).toBeInTheDocument();
    expect(screen.getByText("Rajan Singh")).toBeInTheDocument();
  });

  it("renders column header 'Priority Level' (not 'Temperature')", () => {
    render(<ContactsTable contacts={sampleContacts as never} source="api" />);
    expect(screen.getByText("Priority Level")).toBeInTheDocument();
    expect(screen.queryByText("Temperature")).not.toBeInTheDocument();
  });

  it("renders empty state when no contacts", () => {
    mockedHook.mockReturnValue({
      data: [] as never,
      fromCache: false,
      offline: false,
      cachedAt: null,
      provenance: "live",
    } as never);
    render(<ContactsTable contacts={[]} source="api" />);
    expect(screen.getByText("No contacts yet")).toBeInTheDocument();
  });

  // UX-002 regression: fetch failed but a cached copy exists — exactly one
  // honest, non-contradictory message should render (never both "showing
  // saved data" and a separate "couldn't load / showing nothing").
  it("shows one consistent message when the fetch failed but cached data exists", () => {
    mockedHook.mockReturnValue({
      data: sampleContacts as never,
      fromCache: true,
      offline: false,
      cachedAt: "2026-09-01T10:00:00.000Z",
      provenance: "cached",
    } as never);
    render(<ContactsTable contacts={[]} source="error" />);

    const statusNodes = screen.getAllByRole("status");
    expect(statusNodes).toHaveLength(1);
    expect(statusNodes[0]).toHaveTextContent(/Showing saved data/i);
    expect(statusNodes[0]).toHaveTextContent(/could not refresh/i);
    // The old, contradictory copy must never appear alongside it.
    expect(screen.queryByText(/showing nothing/i)).not.toBeInTheDocument();
  });

  // UX-002 regression: fetch failed and there is genuinely no cache — an
  // honest empty/error state, with no competing "showing saved data" claim.
  it("shows an honest empty state when the fetch failed and no cache exists", () => {
    mockedHook.mockReturnValue({
      data: [] as never,
      fromCache: false,
      offline: false,
      cachedAt: null,
      provenance: "error-no-data",
    } as never);
    render(<ContactsTable contacts={[]} source="error" />);

    const statusNodes = screen.getAllByRole("status");
    expect(statusNodes).toHaveLength(1);
    expect(statusNodes[0]).toHaveTextContent(/Couldn't load — showing nothing/i);
    expect(screen.queryByText(/Showing saved data/i)).not.toBeInTheDocument();
    expect(screen.getByText("No contacts yet")).toBeInTheDocument();
  });
});
