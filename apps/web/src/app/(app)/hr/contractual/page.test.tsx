import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { addDaysIST, todayIST } from "@/lib/formatters";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));
vi.mock("@/lib/auth/roleGuard", () => ({ requireAnyRole: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("next-intl/server", async () => {
  const en = (await import("@/messages/en.json")).default as unknown as Record<string, Record<string, string>>;
  const fmt = (s: string, v?: Record<string, unknown>) => s.replace(/\{(\w+)\}/g, (_m, k) => String(v?.[k] ?? ""));
  return { getTranslations: async (ns: string) => (key: string, v?: Record<string, unknown>) => fmt(en[ns]?.[key] ?? key, v) };
});

import ContractualPage from "./page";

const inDays = (n: number) => addDaysIST(todayIST(), n);

function contract(id: string, name: string, status: string, endInDays: number) {
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

async function renderPage(contracts: ReturnType<typeof contract>[]) {
  fetchJsonMock.mockImplementation(async (_u: string, _f: unknown, o?: { mapResponse: (p: unknown) => unknown }) =>
    // Only the register's own load carries a mapper; ignore any other fetchJson caller.
    o ? { source: "api", data: o.mapResponse({ data: contracts }) } : { source: "api", data: [] },
  );
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{await ContractualPage()}</NextIntlClientProvider>);
}

const tile = (label: string) => {
  const lab = Array.from(document.querySelectorAll(".stat .lab")).find((el) => el.textContent === label);
  if (!lab) throw new Error(`no stat tile labelled ${label}`);
  return lab.closest(".stat") as HTMLElement;
};
const rowFor = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;

beforeEach(() => fetchJsonMock.mockReset());

describe("/hr/contractual expiring <=30d tile (GAP-HR-WORKFORCE-CONTRACTUAL-01)", () => {
  const FIXTURE = [
    contract("c1", "Ends In Ten Days", "active", 10),
    contract("c2", "Flagged Expiring Ten Days", "expiring", 10),
    contract("c3", "Ends In Sixty Days", "expiring", 60), // backend flags <=90d; NOT a 30d signal
    contract("c4", "Ended Yesterday Still Flagged", "expiring", -1), // ended: must not count
    contract("c5", "Terminated Ending Soon", "terminated", 5), // terminated: must not count
    contract("c6", "Long Running", "active", 400),
    contract("c7", "Ends Today", "active", 0), // boundary: today is still within 30d
    contract("c8", "Exactly Thirty", "active", 30), // boundary inclusive
    contract("c9", "Thirty One", "active", 31), // just outside
  ];

  it("counts a contract ending in 10 days (and the 0/30-day boundaries) but not an ended, terminated, 60-day or 31-day one", async () => {
    await renderPage(FIXTURE);
    // c1 + c2 + c7 + c8 = 4
    expect(within(tile("Expiring ≤30d")).getByText("4")).toBeInTheDocument();
  });

  it("an ended contract flagged expiring is counted under Expired, never under Expiring", async () => {
    await renderPage([contract("c4", "Ended Yesterday Still Flagged", "expiring", -1)]);
    expect(tile("Expiring ≤30d")).toHaveTextContent("0");
    expect(tile("Expired")).toHaveTextContent("1");
  });

  it("an ended contract still stored as active is not counted as Active", async () => {
    await renderPage([contract("c1", "Ended Active", "active", -3), contract("c2", "Live", "active", 200)]);
    expect(tile("Active")).toHaveTextContent("1");
    expect(tile("Expired")).toHaveTextContent("1");
  });

  it("highlights the status badge: red for <=30d, amber for the 31-90d expiring status, and a swept-expired pill for an ended one", async () => {
    await renderPage(FIXTURE);
    const soon = within(rowFor("Ends In Ten Days")).getByText("Expiring ≤30d");
    expect(soon).toHaveClass("pill", "bad");
    const mid = within(rowFor("Ends In Sixty Days")).getByText("Expiring");
    expect(mid).toHaveClass("pill", "warn");
    const ended = within(rowFor("Ended Yesterday Still Flagged")).getByText("Expired");
    expect(ended).toHaveClass("pill", "bad");
    // A calm contract keeps its plain Active pill.
    expect(within(rowFor("Long Running")).getByText("Active")).toHaveClass("pill", "good");
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
