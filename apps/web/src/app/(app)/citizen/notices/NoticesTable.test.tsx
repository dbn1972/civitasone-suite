import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { NoticesTable } from "./NoticesTable";
import type { CitizenNotice } from "../../../_data/loaders";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

// Freeze "today" so the active/expired boundary is deterministic.
const FIXED_NOW = new Date("2026-03-10T06:00:00.000Z");

function notice(partial: Partial<CitizenNotice>): CitizenNotice {
  return {
    id: Math.random().toString(36).slice(2),
    noticeNo: "N-1",
    subject: "Subject",
    department: "Dept",
    published: "2026-03-05T00:00:00.000Z",
    expiry: "",
    type: "Statutory",
    ...partial,
  };
}

function renderTable(notices: CitizenNotice[], source: "api" | "error" = "api") {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <NoticesTable notices={notices} source={source} />
    </NextIntlClientProvider>,
  );
}

describe("NoticesTable", () => {
  beforeEach(() => vi.useFakeTimers({ now: FIXED_NOW, toFake: ["Date"] }));
  afterEach(() => vi.useRealTimers());

  it("GAP-CITIZEN-NOTICES-01: on a failed fetch with no cache, shows retry (not four zero stats + 'No notices published')", () => {
    renderTable([], "error");
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText(enMessages.citizenNotices.emptyTitle)).not.toBeInTheDocument();
    // Stat values are "—", never a fabricated 0.
    expect(screen.getByText(enMessages.citizenNotices.statTotal).closest(".stat")).toHaveTextContent("—");
  });

  it("GAP-CITIZEN-NOTICES-02: a notice whose expiry is in the past is Expired and hidden under the default Active filter", () => {
    renderTable([
      notice({ noticeNo: "ACT-1", expiry: "2026-04-01" }),
      notice({ noticeNo: "EXP-1", expiry: "2026-03-09" }),
    ]);
    // Default filter is Active -> only the active row is listed.
    expect(screen.getByText("ACT-1")).toBeInTheDocument();
    expect(screen.queryByText("EXP-1")).not.toBeInTheDocument();
    // Only the active notice is counted in the Statutory stat.
    const statCard = screen
      .getAllByText(enMessages.citizenNotices.statStatutory)
      .map((el) => el.closest(".stat"))
      .find((el): el is HTMLElement => el !== null)!;
    expect(statCard).toHaveTextContent("1");
  });

  it("GAP-CITIZEN-NOTICES-02: a notice without an expiry stays Active", () => {
    renderTable([notice({ noticeNo: "NOEXP", expiry: "" })]);
    expect(screen.getByText("NOEXP")).toBeInTheDocument();
    // Its status cell reads Active.
    const row = screen.getByText("NOEXP").closest("tr");
    expect(row && within(row).getByText(enMessages.citizenNotices.statusActive)).toBeTruthy();
  });

  it("GAP-CITIZEN-NOTICES-04: dates render in Indian format, empty expiry as —", () => {
    renderTable([notice({ noticeNo: "D-1", published: "2026-03-05T00:00:00.000Z", expiry: "" })]);
    const row = screen.getByText("D-1").closest("tr")!;
    expect(within(row).getByText("05 Mar 2026")).toBeInTheDocument();
    // empty expiry -> em dash
    expect(within(row).getAllByText("—").length).toBeGreaterThan(0);
  });
});
