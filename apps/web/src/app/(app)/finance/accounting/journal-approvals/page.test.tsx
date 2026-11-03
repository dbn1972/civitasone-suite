/**
 * UAT b15 item 6: /finance/accounting/journal-approvals showed "We couldn’t connect" for uxtester although
 * GET /v1/finance/journals/pending and /rejected answered 200 { data: [], pagination } through the gateway.
 *
 * Root cause: the Server Component page passed mapPendingJournals, imported from the "use client" JournalApprovals.tsx,
 * to fetchJson as mapResponse. On the server a function exported from a client module is a client reference; calling
 * it throws, fetchJson treated the throw as a network error, and LoadErrorState rendered the offline copy. The unit
 * tests imported the mapper directly (a real function under vitest), so they could not see it.
 *
 * This test renders the page through the real fetchJson with the real API response shape, and mocks the client
 * module the way the RSC bundler sees it: only the component renders, any other export throws when called.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("next/headers", () => ({ cookies: () => ({ get: () => ({ value: "test-access-token" }) }) }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => ["finance_officer"] }));
vi.mock("../../../../_data/loaders", () => ({ getChartOfAccounts: async () => ({ data: [], source: "api" }) }));
vi.mock("./JournalApprovals", () => ({
  JournalApprovals: ({ initial, rejected }: { initial: unknown[]; rejected: unknown[] | null }) => (
    <div data-testid="journal-approvals">{`pending=${initial.length} rejected=${rejected === null ? "error" : rejected.length}`}</div>
  ),
  mapPendingJournals: () => {
    throw new Error("Attempted to call mapPendingJournals() from the server but mapPendingJournals is on the client.");
  },
}));

import JournalApprovalsPage from "./page";

/** The live response of finance-service gl/routes.ts for both lists (captured through the gateway, UAT post-b14). */
const EMPTY = { data: [], pagination: { hasMore: false, pageSize: 100 } };
const ONE = {
  data: [{
    id: "6f5b3a2e-1d4c-4e8f-9a7b-2c1d0e9f8a7b", voucherNo: null, type: "journal", postingDate: "2026-09-10",
    narration: "Office stationery", totalMinor: "27000",
    lines: [
      { accountCode: "2202", debitMinor: "27000", creditMinor: "0", narration: "Office stationery" },
      { accountCode: "1100", debitMinor: "0", creditMinor: "27000", narration: "Office stationery" },
    ],
    createdAt: "2026-09-10T10:00:00.000Z", isOwn: false, rejectionReason: null, decidedAt: null,
  }],
  pagination: { hasMore: false, pageSize: 100 },
};

function stubApi(pending: unknown, rejected: unknown) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/api/v1/finance/journals/pending")) return new Response(JSON.stringify(pending), { status: 200 });
    if (u.includes("/api/v1/finance/journals/rejected")) return new Response(JSON.stringify(rejected), { status: 200 });
    return new Response("{}", { status: 404 });
  }));
}

describe("Journal approvals page with the real API response shape (UAT b15 item 6)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    process.env.CIVITASONE_API_BASE_URL = "http://gateway.test";
  });

  it("an empty queue (200 { data: [], pagination }) renders the screen, not the offline error", async () => {
    stubApi(EMPTY, { ...EMPTY, pagination: { hasMore: false, pageSize: 50 } });
    render(await JournalApprovalsPage());
    expect(screen.getByTestId("journal-approvals")).toHaveTextContent("pending=0 rejected=0");
    expect(screen.queryByText(/couldn.t connect/i)).not.toBeInTheDocument();
  });

  it("a pending journal in the live shape reaches the screen", async () => {
    stubApi(ONE, EMPTY);
    render(await JournalApprovalsPage());
    expect(screen.getByTestId("journal-approvals")).toHaveTextContent("pending=1 rejected=0");
  });

  it("the mapper the page calls lives in a plain module, not the \"use client\" component", () => {
    const page = readFileSync(join(__dirname, "page.tsx"), "utf8");
    expect(page).toMatch(/import \{ mapPendingJournals[^}]*\} from "\.\/journalsPayload";/);
    expect(page).not.toMatch(/import \{[^}]*mapPendingJournals[^}]*\} from "\.\/JournalApprovals"/);
    expect(readFileSync(join(__dirname, "journalsPayload.ts"), "utf8")).not.toMatch(/^\s*["\x27]use client["\x27]/m);
  });
});
