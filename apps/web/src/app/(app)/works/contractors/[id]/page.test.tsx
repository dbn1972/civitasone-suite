import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

// RevealableValue (client) uses next-intl.
function render(ui: React.ReactElement) {
  return rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

const nextResults = vi.hoisted(() => ({ contractor: {} as Record<string, unknown>, rating: {} as Record<string, unknown> }));
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (url: string, empty: unknown, opts: { mapResponse?: (p: unknown) => unknown }) => {
    const isHistory = url.includes("rating-history");
    const r = isHistory ? nextResults.rating : nextResults.contractor;
    const source = (r.source as string) ?? "api";
    const data = source === "error" ? empty : opts.mapResponse ? opts.mapResponse(r.payload) ?? empty : r.payload;
    return Promise.resolve({ data, source, ...(r.status ? { status: r.status as number } : {}) });
  },
}));

const notFoundMock = vi.hoisted(() => vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }));
vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const session = vi.hoisted(() => ({ roles: [] as string[], userId: "me-0000" as string | null }));
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => session.roles,
  getSessionUserId: () => session.userId,
}));

vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }),
}));

import ContractorDetailPage from "./page";

const ID = "11111111-2222-4000-8000-000000000001";

function contractor(overrides: Record<string, unknown> = {}) {
  const detail = {
    id: ID,
    name: "ABC Constructions",
    registrationNo: "PWD/A/2024/001",
    pan: "AAAPZ1234C",
    gst: "29BBBPZ5678C1Z5",
    email: "abc@example.com",
    phone: "9876543210",
    address: "Cuttack",
    active: true,
    performanceRating: 4,
    ratingCount: 2,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...(overrides.detail as Record<string, unknown> | undefined),
  };
  return {
    payload: { data: detail },
    source: "api",
    ...overrides,
  };
}

describe("ContractorDetailPage", () => {
  beforeEach(() => {
    session.roles = [];
    session.userId = "me-0000";
    nextResults.contractor = contractor();
    nextResults.rating = { payload: [], source: "api" };
    notFoundMock.mockClear();
  });

  // GAP-WORKS-CONTRACTORS-DETAIL-01: a 500 renders a retryable error, NOT notFound.
  it("renders a retryable error state (not notFound) on a 500", async () => {
    nextResults.contractor = { source: "error", status: 500 };
    render(await ContractorDetailPage({ params: Promise.resolve({ id: ID }) }));
    expect(notFoundMock).not.toHaveBeenCalled();
    expect(screen.getAllByRole("button", { name: /try again|retry/i }).length).toBeGreaterThan(0);
  });

  // GAP-WORKS-CONTRACTORS-DETAIL-01: a 404 is still a genuine not-found.
  it("calls notFound() on a 404", async () => {
    nextResults.contractor = { source: "error", status: 404 };
    await expect(ContractorDetailPage({ params: Promise.resolve({ id: ID }) })).rejects.toThrow(/NOT_FOUND/);
    expect(notFoundMock).toHaveBeenCalled();
  });

  // GAP-WORKS-CONTRACTORS-DETAIL-02 (PII): PAN masked for a viewer without reveal role,
  // appears exactly once (not duplicated in a KPI tile), phone/email masked.
  it("masks PAN/phone/email and shows PAN once for a non-reveal viewer", async () => {
    session.roles = ["works_viewer"];
    render(await ContractorDetailPage({ params: Promise.resolve({ id: ID }) }));
    expect(screen.getByText("AAAPZ****C")).toBeInTheDocument();
    // No clear PAN anywhere, and no Reveal control for a read-only viewer.
    expect(document.body.textContent).not.toContain("AAAPZ1234C");
    expect(document.body.textContent).not.toContain("9876543210");
    expect(screen.queryByRole("button", { name: /reveal/i })).not.toBeInTheDocument();
  });

  // GAP-WORKS-CONTRACTORS-DETAIL-02: a write-tier viewer gets a Reveal control.
  it("offers a Reveal control for a write-tier role", async () => {
    session.roles = ["works_admin"];
    render(await ContractorDetailPage({ params: Promise.resolve({ id: ID }) }));
    expect(screen.getByRole("button", { name: /reveal/i })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("AAAPZ1234C");
  });

  // GAP-WORKS-CONTRACTORS-DETAIL-03: rater NAME (not a UUID slice), and a Comment column.
  it("renders the rater name and comment, never a raw UUID slice", async () => {
    nextResults.rating = {
      payload: [
        { id: "r1", rating: 4, ratedAt: "2024-02-01T00:00:00Z", ratedBy: "abc12345-6789-4000-8000-000000000000", ratedByName: "J. Rao", note: "Good work" },
        { id: "r2", rating: 3, ratedAt: "2024-03-01T00:00:00Z", ratedBy: "ffffffff-6789-4000-8000-000000000000" },
      ],
      source: "api",
    };
    render(await ContractorDetailPage({ params: Promise.resolve({ id: ID }) }));
    expect(screen.getByText("J. Rao")).toBeInTheDocument();
    expect(screen.getByText("Good work")).toBeInTheDocument();
    // The 8-char UUID slice "abc12345" / "ffffffff" must never appear.
    expect(document.body.textContent).not.toContain("abc12345");
    expect(document.body.textContent).not.toContain("ffffffff");
  });

  // GAP-WORKS-CONTRACTORS-DETAIL-01: history fetch error shows an error, not "No ratings recorded yet."
  it("shows an error (not an empty state) when the rating-history fetch fails", async () => {
    nextResults.rating = { source: "error", status: 500 };
    render(await ContractorDetailPage({ params: Promise.resolve({ id: ID }) }));
    expect(screen.queryByText("No ratings recorded yet.")).not.toBeInTheDocument();
  });

  // GAP-WORKS-CONTRACTORS-DETAIL-05: the "Rate Contractor" card is hidden for a read-only viewer.
  it("hides the Rate Contractor card for a role that cannot rate", async () => {
    session.roles = ["works_viewer"];
    render(await ContractorDetailPage({ params: Promise.resolve({ id: ID }) }));
    expect(screen.queryByText("Rate Contractor")).not.toBeInTheDocument();
  });

  it("shows the Rate Contractor card for a rate-capable role", async () => {
    session.roles = ["works_admin"];
    render(await ContractorDetailPage({ params: Promise.resolve({ id: ID }) }));
    expect(screen.getByText("Rate Contractor")).toBeInTheDocument();
  });

  // GAP-WORKS-CONTRACTORS-DETAIL-05: stars never exceed the printed decimal (floor).
  it("floors the star glyphs so they never exceed the printed rating", async () => {
    nextResults.contractor = contractor({ detail: { performanceRating: 4 } });
    // performanceRating is integer in the backend; verify 4 filled stars for 4.0.
    render(await ContractorDetailPage({ params: Promise.resolve({ id: ID }) }));
    const banner = screen.getByLabelText(/Rating: 4\.0 out of 5/i);
    const filled = (banner.textContent?.match(/★/g) ?? []).length;
    expect(filled).toBe(4);
  });
});

describe("ContractorDetailPage: rater names and the cooling-off period (DETAIL-03 / DETAIL-04)", () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
  beforeEach(() => {
    session.roles = ["works_admin"];
    session.userId = "me-0000";
    nextResults.contractor = contractor();
    nextResults.rating = { payload: [], source: "api" };
  });

  it("DETAIL-03: a row the server could not name shows a dash in Rated By, never any part of the user id", async () => {
    nextResults.rating = {
      payload: {
        data: [{ id: "r1", rating: 4, ratedAt: "2024-02-01T00:00:00Z", ratedBy: "deadbeef-6789-4000-8000-000000000000", ratedByName: null, note: "Fine" }],
        meta: { cooldownDays: 0 },
      },
      source: "api",
    };
    render(await ContractorDetailPage({ params: Promise.resolve({ id: ID }) }));
    const row = screen.getByText("Fine").closest("tr") as HTMLElement;
    expect(row.textContent).toContain("—");
    expect(document.body.textContent).not.toContain("deadbeef");
  });

  it("DETAIL-04: the Work column shows the linked work number, and a dash for an unlinked rating", async () => {
    nextResults.rating = {
      payload: {
        data: [
          { id: "r1", rating: 5, ratedAt: "2024-02-01T00:00:00Z", ratedBy: "u1", ratedByName: "A", note: "linked one", workNumber: "WRK/2026/7" },
          { id: "r2", rating: 3, ratedAt: "2024-01-01T00:00:00Z", ratedBy: "u2", ratedByName: "B", note: "unlinked one" },
        ],
        meta: { cooldownDays: 0 },
      },
      source: "api",
    };
    render(await ContractorDetailPage({ params: Promise.resolve({ id: ID }) }));
    expect((screen.getByText("linked one").closest("tr") as HTMLElement).textContent).toContain("WRK/2026/7");
    expect((screen.getByText("unlinked one").closest("tr") as HTMLElement).textContent).not.toContain("WRK/");
    expect(screen.getByRole("columnheader", { name: /Work/ })).toBeInTheDocument();
  });

  it("DETAIL-04: the {data, meta.cooldownDays} envelope reaches the form -- the viewer's own recent rating warns and holds Submit", async () => {
    nextResults.rating = {
      payload: {
        data: [
          // newest first: someone else rated today, but the viewer's own last rating is 3 days old
          { id: "r1", rating: 5, ratedAt: daysAgo(0), ratedBy: "someone-else", ratedByName: "R. Das" },
          { id: "r2", rating: 4, ratedAt: daysAgo(3), ratedBy: "me-0000", ratedByName: "Me" },
        ],
        meta: { cooldownDays: 30 },
      },
      source: "api",
    };
    render(await ContractorDetailPage({ params: Promise.resolve({ id: ID }) }));
    expect(screen.getByText(/rated this contractor within the last 30 days/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Rate 3 stars/i }));
    expect(screen.getByRole("button", { name: "Submit Rating" })).toBeDisabled();
  });

  it("DETAIL-04: with no cooling-off period configured (no meta) there is no warning, even after a very recent own rating", async () => {
    nextResults.rating = {
      payload: [{ id: "r2", rating: 4, ratedAt: daysAgo(0), ratedBy: "me-0000", ratedByName: "Me" }],
      source: "api",
    };
    render(await ContractorDetailPage({ params: Promise.resolve({ id: ID }) }));
    expect(screen.queryByText(/rated this contractor within the last/i)).not.toBeInTheDocument();
  });
});
