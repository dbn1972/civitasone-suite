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
    } as never);
    render(<ContactsTable contacts={[]} source="api" />);
    expect(screen.getByText("No contacts yet")).toBeInTheDocument();
  });

  it("renders cache note when fromCache=true", () => {
    mockedHook.mockReturnValue({
      data: sampleContacts as never,
      fromCache: true,
      offline: false,
      cachedAt: null,
    } as never);
    render(<ContactsTable contacts={sampleContacts as never} source="api" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/Showing saved data/i)).toBeInTheDocument();
  });
});
