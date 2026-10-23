import { describe, it, expect, vi } from "vitest";
import { render as rtlRender, screen, fireEvent, type RenderOptions } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement, ReactNode } from "react";
import enMessages from "@/messages/en.json";

vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, initial: unknown) => ({ data: initial, fromCache: false, offline: false, cachedAt: null, provenance: "live" }),
}));

import { FormulationTable } from "./FormulationTable";

const withIntl = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="en" messages={enMessages}>{children}</NextIntlClientProvider>
);
const render = (ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) => rtlRender(ui, { wrapper: withIntl, ...options });

const row = (id: string, status: string, majorHead = `MH-${id}`) => ({
  id, majorHead, subHead: `Head ${id}`, sanctionedAmount: "100", releasedAmount: "100", expenditure: "0", balance: "100",
  beMinor: "100", reMinor: "100", status, financialYear: "2026-27",
});
const tabNames = () => screen.getAllByRole("tab").map((t) => t.textContent);
const shownHeads = () => screen.queryAllByText(/^MH-/).map((c) => c.textContent);

// GAP-FINANCE-BUDGET-FORMULATION-05
describe("FormulationTable status tabs", () => {
  const LIVE = [row("a", "active"), row("b", "active"), row("c", "exhausted")];

  it("offers a tab for each status the rows actually carry, in the words the pill uses, and no dead tabs", () => {
    render(<FormulationTable budgets={LIVE as never} />);
    expect(tabNames()).toEqual(["All", "Active", "Exhausted"]);
    expect(tabNames()).not.toContain("Pending");
    expect(tabNames()).not.toContain("Approved");
    expect(tabNames()).not.toContain("Submitted");
  });

  it("each tab lists exactly its rows, and every row is under exactly one status tab", () => {
    render(<FormulationTable budgets={LIVE as never} />);
    expect(shownHeads().sort()).toEqual(["MH-a", "MH-b", "MH-c"]);
    fireEvent.click(screen.getByRole("tab", { name: "Active" }));
    expect(shownHeads().sort()).toEqual(["MH-a", "MH-b"]);
    fireEvent.click(screen.getByRole("tab", { name: "Exhausted" }));
    expect(shownHeads()).toEqual(["MH-c"]);
  });

  it("the approval statuses get their tabs when a row carries one; an unknown status is under Other, never dropped", () => {
    render(<FormulationTable budgets={[row("a", "pending"), row("b", "draft"), row("c", "rejected"), row("d", "frozen")] as never} />);
    expect(tabNames()).toEqual(["All", "Draft", "Pending", "Rejected", "Other"]);
    fireEvent.click(screen.getByRole("tab", { name: "Other" }));
    expect(shownHeads()).toEqual(["MH-d"]);
  });

  it("opens on initialTab when it has rows, and on All when it does not (a stale ?tab= link)", () => {
    const { unmount } = render(<FormulationTable budgets={LIVE as never} initialTab="exhausted" />);
    expect(screen.getByRole("tab", { name: "Exhausted" })).toHaveAttribute("aria-selected", "true");
    expect(shownHeads()).toEqual(["MH-c"]);
    unmount();
    render(<FormulationTable budgets={LIVE as never} initialTab="approved" />);
    expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true");
    expect(shownHeads()).toHaveLength(3);
  });

  it("a just-created estimate is announced with its head, FY and the tab it is under", () => {
    render(<FormulationTable budgets={LIVE as never} initialTab="active" highlightId="b" />);
    expect(screen.getByText("Estimate added: MH-b · Head b (FY 2026-27). It is listed under the Active tab.")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Active" })).toHaveAttribute("aria-selected", "true");
  });

  it("an estimate that is not in the list yet (async create) says it is still being processed", () => {
    render(<FormulationTable budgets={LIVE as never} highlightId="not-there-yet" />);
    expect(screen.getByText(/still being processed/)).toBeInTheDocument();
    expect(screen.queryByText(/Estimate added/)).not.toBeInTheDocument();
  });

  it("no highlight, no banner", () => {
    render(<FormulationTable budgets={LIVE as never} />);
    expect(screen.queryByText(/Estimate added|still being processed/)).not.toBeInTheDocument();
  });
});
