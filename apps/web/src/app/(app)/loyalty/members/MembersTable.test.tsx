import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

function render(ui: ReactElement) {
  return rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));
import { useSeededResource } from "@/lib/sync/resource";
import { MembersTable } from "./MembersTable";
import type { LoyaltyMemberRow } from "../_data";

const mockedHook = vi.mocked(useSeededResource);

function seed(rows: LoyaltyMemberRow[], provenance = "live") {
  mockedHook.mockReturnValue({
    data: rows as never,
    fromCache: provenance === "cached",
    offline: false,
    cachedAt: null,
    provenance,
  } as never);
}

const sample: LoyaltyMemberRow[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    profileRef: "ab12cd34",
    programId: "pr000000-0000-4000-8000-000000000001",
    status: "active",
    tier: "Gold",
    pointsBalance: "4500",
    lifetimePoints: "1234567",
    enrolledAt: "2026-08-14T09:12:44.000Z",
    updatedAt: "2026-08-14T09:12:44.000Z",
  },
];

beforeEach(() => seed(sample));

describe("MembersTable (GAP-LOYALTY-MEMBERS-01/03, ACCRUALS-03)", () => {
  it("MEMBERS-01: tier is its OWN column value and the Detail/status is not duplicated", () => {
    render(<MembersTable rows={sample} source="api" />);
    expect(screen.getByRole("columnheader", { name: "Tier" })).toBeInTheDocument();
    // tier label visible on its own, status 'active' rendered as a pill elsewhere
    expect(screen.getByText("Gold")).toBeInTheDocument();
  });

  it("ACCRUALS-03: points balance and lifetime render with en-IN grouping", () => {
    render(<MembersTable rows={sample} source="api" />);
    expect(screen.getByText("4,500")).toBeInTheDocument();
    expect(screen.getByText("12,34,567")).toBeInTheDocument();
  });

  it("MEMBERS-03: enrolled date renders formatted (no raw ISO 'T...Z')", () => {
    render(<MembersTable rows={sample} source="api" />);
    expect(screen.getByText("14 Aug 2026")).toBeInTheDocument();
    expect(screen.queryByText(/2026-08-14T09:12:44/)).not.toBeInTheDocument();
  });

  it("MEMBERS-02: member reference is shortened, never the full UUID", () => {
    render(<MembersTable rows={sample} source="api" />);
    expect(screen.getByText("ab12cd34")).toBeInTheDocument();
    expect(screen.queryByText("ab12cd34-0000-4000-8000-000000000001")).not.toBeInTheDocument();
  });

  it("error-no-data renders a retry state, not an empty nudge", () => {
    seed([], "error-no-data");
    render(<MembersTable rows={[]} source="error" />);
    expect(screen.getByText(/couldn't load loyalty members/i)).toBeInTheDocument();
    expect(screen.queryByText("No members")).not.toBeInTheDocument();
  });

  it("live + empty renders the empty state (not an error)", () => {
    seed([], "live");
    render(<MembersTable rows={[]} source="api" />);
    expect(screen.getByText("No members")).toBeInTheDocument();
  });
});

// GAP-LOYALTY-ACCRUALS-02 / MEMBERS-02 (owner decisions D4c #14/#15): full id only on audited request.
describe("MembersTable — audited reveal of the full member id (D4c #14/#15)", () => {
  const FULL = "ab12cd34-0000-4000-8000-000000000001";

  it("never puts the full id in the DOM until revealed (no title attribute, no row data)", () => {
    const { container } = render(<MembersTable rows={sample} source="api" />);
    expect(container.innerHTML).not.toContain(FULL);
    expect(container.querySelector("[title]")?.getAttribute("title") ?? "").not.toContain("ab12cd34-");
  });

  it("Reveal calls the audited endpoint for that enrolment and shows the full id; Hide removes it", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: sample[0]!.id, profileId: FULL } }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    render(<MembersTable rows={sample} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: /Reveal full member ID/i }));
    expect(await screen.findByText(FULL)).toBeInTheDocument();
    expect(String(spy.mock.calls[0]![0])).toBe(`/api/proxy/v1/loyalty/enrolments/${sample[0]!.id}/profile-ref`);
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByText(FULL)).not.toBeInTheDocument();
    spy.mockRestore();
  });

  it("shows a safe message (no raw server text) when the reveal is refused", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "AUDIT_UNAVAILABLE internal detail" } }), { status: 503 }),
    );
    render(<MembersTable rows={sample} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: /Reveal full member ID/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The full ID could not be shown. Try again.");
    expect(screen.queryByText(/internal detail/)).not.toBeInTheDocument();
    expect(screen.queryByText(FULL)).not.toBeInTheDocument();
    spy.mockRestore();
  });
});

describe("MembersTable — offline cache (D4c #15)", () => {
  it("seeds the offline cache under v2 keys, orphaning earlier entries that held a full profile id", () => {
    mockedHook.mockClear();
    render(<MembersTable rows={sample} source="api" />);
    render(<MembersTable rows={sample} source="api" variant="accruals" />);
    expect(mockedHook.mock.calls.map((c) => c[0])).toEqual(["loyalty.members.v2", "loyalty.accruals.v2"]);
    // what is handed to the cache never contains a full profile id
    for (const c of mockedHook.mock.calls) expect(JSON.stringify(c[1])).not.toContain("profileId");
  });
});
