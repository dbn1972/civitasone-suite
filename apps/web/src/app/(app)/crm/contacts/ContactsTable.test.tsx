import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

function render(ui: ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));
vi.mock("@/lib/formatters", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/formatters")>()),
  formatIndianDate: (d: string) => d,
}));

import { useSeededResource } from "@/lib/sync/resource";

// RefreshErrorState (shown for the error empty-state) uses the router.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { ContactsTable } from "./ContactsTable";

const mockedHook = vi.mocked(useSeededResource);

// Default: echo the seed (as the real hook does with no cache). Individual
// describes below override this with mockReturnValue.
beforeEach(() => {
  mockedHook.mockImplementation(((_key: string, seed: unknown) => ({
    data: seed,
    fromCache: false,
    offline: false,
    cachedAt: null,
    provenance: "live",
  })) as never);
});

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

    // Two independent role="status" live regions now legitimately coexist here:
    // the page-level DataSourceBadge (data-provenance banner) and EmptyState's
    // own live region (a11y HIGH-3 — a screen reader must hear "no results"
    // too, not just see it). Assert each by its specific text rather than
    // assuming there is exactly one status node.
    expect(screen.getByText(/Couldn't load — showing nothing/i)).toBeInTheDocument();
    expect(screen.queryByText(/Showing saved data/i)).not.toBeInTheDocument();
    // GAP-CRM-CONTACTS-05: a failed load shows a retry state, never the
    // "No contacts yet" first-create nudge.
    expect(screen.getByText(/couldn't load your contacts/i)).toBeInTheDocument();
    expect(screen.queryByText("No contacts yet")).not.toBeInTheDocument();
  });
});

describe("ContactsTable PII (GAP-CRM-CONTACTS-02)", () => {
  it("renders phone/email exactly as received (masking happens server-side in page.tsx)", () => {
    render(<ContactsTable contacts={[{ id: "c1", name: "Asha Rao", phone: "98XXXXX210", email: "a***@e******.c**" }]} />);
    expect(screen.getByText("98XXXXX210")).toBeInTheDocument();
    expect(screen.getByText("a***@e******.c**")).toBeInTheDocument();
  });
});

describe("ContactsTable headers & status (GAP-CRM-CONTACTS-03 / -06)", () => {
  const rows = [
    { id: "c1", name: "Asha Rao", temperature: "hot", priority: "high", leadStatus: "qualified" },
  ];

  it("GAP-CRM-CONTACTS-03: temperature column is headed 'Temperature', not 'Priority Level'", () => {
    render(<ContactsTable contacts={rows} />);
    expect(screen.getByRole("columnheader", { name: "Temperature" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Priority Level" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Priority" })).toBeInTheDocument();
  });

  it("GAP-CRM-CONTACTS-06: lead status renders the canonical label 'Qualified' (not raw enum)", () => {
    render(<ContactsTable contacts={rows} />);
    expect(screen.getByText("Qualified")).toBeInTheDocument();
    expect(screen.queryByText("qualified")).not.toBeInTheDocument();
  });
});

describe("ContactsTable empty/error states (GAP-CRM-CONTACTS-05)", () => {
  it("empty master shows the add-first-contact nudge", () => {
    render(<ContactsTable contacts={[]} />);
    expect(screen.getByText("No contacts yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /New Contact/ })).toBeInTheDocument();
  });

  it("filtered + empty shows 'No matching contacts' with a clear-filters link", () => {
    render(<ContactsTable contacts={[]} filtered />);
    expect(screen.getByText("No matching contacts")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Clear filters/ })).toBeInTheDocument();
    expect(screen.queryByText("No contacts yet")).not.toBeInTheDocument();
  });

  it("error + empty shows a retry state, not an empty-master nudge", () => {
    render(<ContactsTable contacts={[]} source="error" />);
    expect(screen.queryByText("No contacts yet")).not.toBeInTheDocument();
    expect(screen.getByText(/couldn't load your contacts/i)).toBeInTheDocument();
  });
});
