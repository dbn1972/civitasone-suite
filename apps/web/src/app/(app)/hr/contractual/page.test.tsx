import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { addDaysIST, todayIST } from "@/lib/formatters";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("@/lib/auth/roleGuard", () => ({
  requireAnyRole: vi.fn(),
  getSessionRoles: () => ["hr_admin"],
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import ContractualPage from "./page";

// ---- Helpers for the expiring-tile / status-badge tests (cluster 12, GAP-HR-WORKFORCE-CONTRACTUAL-01) ----
const inDays = (n: number) => addDaysIST(todayIST(), n);

function contractEnding(id: string, name: string, status: string, endInDays: number) {
  return {
    id,
    employeeId: `e-${id}`,
    employeeName: name,
    department: "Admin",
    agencyRef: "Agency X",
    designation: "Analyst",
    startDate: "2025-01-01",
    endDate: inDays(endInDays),
    status,
  };
}

async function renderRegister(contracts: ReturnType<typeof contractEnding>[]) {
  fetchJsonMock.mockImplementation(async (_u: string, _f: unknown, o?: { mapResponse: (p: unknown) => unknown }) =>
    // Only the register's own load carries a mapper; ignore any other fetchJson caller.
    o ? { source: "api", data: o.mapResponse({ data: contracts }) } : { source: "api", data: [] },
  );
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{await ContractualPage({})}</NextIntlClientProvider>);
}

const tile = (label: string) => {
  const lab = Array.from(document.querySelectorAll(".stat .lab")).find((el) => el.textContent === label);
  if (!lab) throw new Error(`no stat tile labelled ${label}`);
  return lab.closest(".stat") as HTMLElement;
};
const rowByName = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;

beforeEach(() => fetchJsonMock.mockReset());

// ---- Server paging + per-row Expiry badge tests (cluster 09, GAP-HR-CONTRACTUAL-03/04) ----


// "Now" is 11:30 IST on 15 June 2026, so the IST date is 2026-06-15.
const NOW = "2026-06-15T06:00:00Z";

type ApiContract = {
  id: string; employeeId: string; employeeName: string; department: string; agencyRef: string | null;
  designation: string; startDate: string; endDate: string; status: string;
};

function contract(overrides: Partial<ApiContract> & { id: string }): ApiContract {
  return {
    employeeId: `emp-${overrides.id}`, employeeName: `Staff ${overrides.id}`, department: "Finance", agencyRef: "AGENCY-1",
    designation: "Assistant", startDate: "2025-01-01", endDate: "2027-01-01", status: "active", ...overrides,
  };
}

const SUMMARY = { active: 70, expiring: 12, expired: 9, agencies: 4 };

/** Runs the page's own mapResponse over a realistic API payload, so the real mapping is exercised. */
function serve(data: ApiContract[], meta: { total: number; summary?: typeof SUMMARY }) {
  fetchJsonMock.mockImplementation(async (_path: string, _fallback: unknown, opts: { mapResponse: (p: unknown) => unknown }) => ({
    data: opts.mapResponse({ data, meta: { page: 1, pageSize: 50, ...meta } }),
    source: "api" as const,
  }));
}

async function renderPage(props: Parameters<typeof ContractualPage>[0] = {}) {
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{await ContractualPage(props)}</NextIntlClientProvider>);
}

/** The stat card whose label is `label` (a status pill in the table can carry the same text, e.g. "Active"). */
function stat(label: string): HTMLElement {
  const el = screen.getAllByText(label).find((e) => e.closest(".stat"));
  if (!el) throw new Error(`no stat card labelled ${label}`);
  return el.closest(".stat") as HTMLElement;
}

function many(n: number): ApiContract[] {
  return Array.from({ length: n }, (_, i) => contract({ id: `c${i}`, endDate: "2027-03-01" }));
}

describe("ContractualPage server paging (GAP-HR-CONTRACTUAL-03)", () => {
  afterEach(() => {
    vi.useRealTimers();
    fetchJsonMock.mockReset();
  });

  it("120 contracts: page 1 requests the first 50 (soonest end first), shows the real total, and offers the next page", async () => {
    serve(many(50), { total: 120, summary: SUMMARY });
    await renderPage({});

    expect(fetchJsonMock).toHaveBeenCalledWith(
      "/api/v1/hrms/contracts?limit=50&offset=0&sort=endDate&summary=true",
      expect.anything(),
      expect.anything(),
    );
    // Total is the SERVER total (120), not the 50 rows that loaded.
    expect(stat("Total Contractual")).toHaveTextContent("120");
    expect(screen.getByText(/Showing contracts 1–50 of 120/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Next page →" })).toHaveAttribute("href", "/hr/contractual?page=2");
    expect(screen.queryByRole("link", { name: "← Previous page" })).not.toBeInTheDocument();
    // All 50 loaded rows are on screen (no hidden client-side second page).
    expect(screen.getAllByRole("link", { name: /^Open Staff c\d+$/ })).toHaveLength(50);
  });

  it("page 2 asks for offset 50 and links both ways; the last page has no next link", async () => {
    serve(many(50), { total: 120, summary: SUMMARY });
    await renderPage({ searchParams: Promise.resolve({ page: "2" }) });
    expect(fetchJsonMock).toHaveBeenCalledWith(
      "/api/v1/hrms/contracts?limit=50&offset=50&sort=endDate&summary=true",
      expect.anything(),
      expect.anything(),
    );
    expect(screen.getByText(/Showing contracts 51–100 of 120/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Previous page" })).toHaveAttribute("href", "/hr/contractual");
    expect(screen.getByRole("link", { name: "Next page →" })).toHaveAttribute("href", "/hr/contractual?page=3");
  });

  it("page 3 loads the rest (20 rows) and offers only 'Previous'", async () => {
    serve(many(20), { total: 120, summary: SUMMARY });
    await renderPage({ searchParams: Promise.resolve({ page: "3" }) });
    expect(screen.getByText(/Showing contracts 101–120 of 120/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Previous page" })).toHaveAttribute("href", "/hr/contractual?page=2");
    expect(screen.queryByRole("link", { name: "Next page →" })).not.toBeInTheDocument();
  });

  it("exactly one full page (total 50) is not truncated: no banner, no pager (the old items.length>=100 heuristic would have lied)", async () => {
    serve(many(50), { total: 50, summary: SUMMARY });
    await renderPage({});
    expect(screen.queryByText(/Showing contracts/)).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Contract pages" })).not.toBeInTheDocument();
  });

  it("treats a junk ?page= as page 1", async () => {
    serve([], { total: 0, summary: { active: 0, expiring: 0, expired: 0, agencies: 0 } });
    await renderPage({ searchParams: Promise.resolve({ page: "abc" }) });
    expect(fetchJsonMock).toHaveBeenCalledWith(expect.stringContaining("offset=0"), expect.anything(), expect.anything());
  });

  it("takes every stat card from the server's full-scope summary, not the loaded rows", async () => {
    serve(many(3), { total: 120, summary: SUMMARY });
    await renderPage({});
    expect(stat("Total Contractual")).toHaveTextContent("120");
    expect(stat("Active")).toHaveTextContent("70");
    expect(stat("Expiring ≤30d")).toHaveTextContent("12");
    expect(stat("Expired")).toHaveTextContent("9");
    expect(stat("Agencies")).toHaveTextContent("4");
  });

  it("shows '—' (not a number derived from the page) for the classified cards when the API sends no summary", async () => {
    serve(many(3), { total: 3 });
    await renderPage({});
    expect(stat("Total Contractual")).toHaveTextContent("3");
    expect(stat("Active")).toHaveTextContent("—");
    expect(stat("Expired")).toHaveTextContent("—");
  });

  it("shows the load error instead of a pager or numbers when the fetch fails", async () => {
    fetchJsonMock.mockResolvedValue({ data: { rows: [], total: 0, summary: null }, source: "error", status: 500 });
    await renderPage({});
    expect(screen.queryByRole("navigation", { name: "Contract pages" })).not.toBeInTheDocument();
    expect(stat("Total Contractual")).toHaveTextContent("—");
  });
});

describe("ContractualPage per-row expiry badge (GAP-HR-CONTRACTUAL-04)", () => {
  afterEach(() => {
    vi.useRealTimers();
    fetchJsonMock.mockReset();
  });

  function rowFor(name: string): HTMLElement {
    return screen.getByRole("link", { name: `Open ${name}` }).closest("tr") as HTMLElement;
  }

  it("flags an active contract that ended yesterday as Expired, and one ending in 10 days as 'Expires in 10 days'", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW));
    serve(
      [
        contract({ id: "late", employeeName: "Ended Yesterday", status: "active", endDate: "2026-06-14" }),
        contract({ id: "soon", employeeName: "Ends In Ten", status: "active", endDate: "2026-06-25" }),
        contract({ id: "today", employeeName: "Ends Today", status: "active", endDate: "2026-06-15" }),
        contract({ id: "far", employeeName: "Ends Far Off", status: "active", endDate: "2027-06-15" }),
        contract({ id: "done", employeeName: "Was Terminated", status: "terminated", endDate: "2026-06-10" }),
      ],
      { total: 5, summary: SUMMARY },
    );
    await renderPage({});

    expect(within(rowFor("Ended Yesterday")).getByText("Expired", { selector: "span" })).toBeInTheDocument();
    expect(within(rowFor("Ends In Ten")).getByText("Expires in 10 days")).toBeInTheDocument();
    expect(within(rowFor("Ends Today")).getByText("Expires today")).toBeInTheDocument();
    expect(within(rowFor("Ends Far Off")).getByText("Expires in 365 days")).toBeInTheDocument();
    // A terminated contract is not "expiring" or "expired": no expiry badge at all.
    expect(within(rowFor("Was Terminated")).queryByText(/(?:Expires|^Expired$)/)).not.toBeInTheDocument();
  });

  it("uses the IST date: at 00:30 IST an end date of 'IST yesterday' is already Expired", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-14T19:00:00Z")); // 00:30 IST on 15 June; UTC date still 14 June
    serve([contract({ id: "edge", employeeName: "Edge Case", status: "active", endDate: "2026-06-14" })], { total: 1, summary: SUMMARY });
    await renderPage({});
    expect(within(rowFor("Edge Case")).getByText("Expired", { selector: "span" })).toBeInTheDocument();
  });

  it("has an Expiry column", async () => {
    serve(many(1), { total: 1, summary: SUMMARY });
    await renderPage({});
    expect(screen.getByRole("columnheader", { name: /Expiry/ })).toBeInTheDocument();
  });
});

// ---- Expiring tile, status badge and i18n parity (cluster 12) ----
describe("/hr/contractual expiring <=30d tile (GAP-HR-WORKFORCE-CONTRACTUAL-01)", () => {
  const FIXTURE = [
    contractEnding("c1", "Ends In Ten Days", "active", 10),
    contractEnding("c2", "Flagged Expiring Ten Days", "expiring", 10),
    contractEnding("c3", "Ends In Sixty Days", "expiring", 60), // backend flags <=90d; NOT a 30d signal
    contractEnding("c4", "Ended Yesterday Still Flagged", "expiring", -1), // ended: must not count
    contractEnding("c5", "Terminated Ending Soon", "terminated", 5), // terminated: must not count
    contractEnding("c6", "Long Running", "active", 400),
    contractEnding("c7", "Ends Today", "active", 0), // boundary: today is still within 30d
    contractEnding("c8", "Exactly Thirty", "active", 30), // boundary inclusive
    contractEnding("c9", "Thirty One", "active", 31), // just outside
  ];

  it("counts a contract ending in 10 days (and the 0/30-day boundaries) but not an ended, terminated, 60-day or 31-day one", async () => {
    await renderRegister(FIXTURE);
    // c1 + c2 + c7 + c8 = 4
    expect(within(tile("Expiring ≤30d")).getByText("4")).toBeInTheDocument();
  });

  it("an escalated contract ending within 30 days is counted (as the backend summary counts it) but keeps its own pill", async () => {
    await renderRegister([contractEnding("c1", "Escalated Soon", "escalated", 12), contractEnding("c2", "Escalated Later", "escalated", 40)]);
    expect(tile("Expiring ≤30d")).toHaveTextContent("1");
    expect(within(rowByName("Escalated Soon")).queryByText("Expiring ≤30d")).not.toBeInTheDocument();
  });

  it("an ended contract flagged expiring is counted under Expired, never under Expiring", async () => {
    await renderRegister([contractEnding("c4", "Ended Yesterday Still Flagged", "expiring", -1)]);
    expect(tile("Expiring ≤30d")).toHaveTextContent("0");
    expect(tile("Expired")).toHaveTextContent("1");
  });

  it("an ended draft contract is in no tile -- the loaded-rows tally matches the server summary", async () => {
    await renderRegister([
      contractEnding("c1", "Ended Draft", "draft", -3),
      contractEnding("c2", "Draft Ending Soon", "draft", 5),
      contractEnding("c3", "Ended Expiring", "expiring", -2),
    ]);
    expect(tile("Expired")).toHaveTextContent("1"); // only c3
    expect(tile("Expiring ≤30d")).toHaveTextContent("0");
    expect(tile("Active")).toHaveTextContent("0");
  });

  it("an ended contract still stored as active is not counted as Active", async () => {
    await renderRegister([contractEnding("c1", "Ended Active", "active", -3), contractEnding("c2", "Live", "active", 200)]);
    expect(tile("Active")).toHaveTextContent("1");
    expect(tile("Expired")).toHaveTextContent("1");
  });

  it("highlights the status badge: red for <=30d, amber for the 31-90d expiring status, and a swept-expired pill for an ended one", async () => {
    await renderRegister(FIXTURE);
    const soon = within(rowByName("Ends In Ten Days")).getByText("Expiring ≤30d");
    expect(soon).toHaveClass("pill", "bad");
    const mid = within(rowByName("Ends In Sixty Days")).getByText("Expiring");
    expect(mid).toHaveClass("pill", "warn");
    const ended = within(rowByName("Ended Yesterday Still Flagged")).getByText("Expired");
    expect(ended).toHaveClass("pill", "bad");
    // A calm contract keeps its plain Active pill.
    expect(within(rowByName("Long Running")).getByText("Active")).toHaveClass("pill", "good");
  });
});

describe("contractual i18n parity (GAP-HR-WORKFORCE-CONTRACTUAL-01)", () => {
  const used = new Set(
    [...readFileSync(join(__dirname, "page.tsx"), "utf8").matchAll(/\bt\("(\w+)"[,)]/g)].map((m) => m[1]),
  );
  const ns = (m: unknown) => (m as { contractual: Record<string, string> }).contractual;

  it("the Hindi namespace has every key the page uses (the locale loads hi.json alone, no en fallback)", () => {
    expect(used.has("statExpiringLabel")).toBe(true);
    const missing = [...used].filter((k) => !(k in ns(hiMessages)));
    expect(missing).toEqual([]);
  });

  it("hi and en carry the same contractual keys", () => {
    expect(Object.keys(ns(hiMessages)).sort()).toEqual(Object.keys(ns(enMessages)).sort());
  });
});
