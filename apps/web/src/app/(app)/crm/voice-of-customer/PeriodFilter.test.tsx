import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@/test-utils/intl-render";

/**
 * GAP-CRM-VOICE-OF-CUSTOMER-01 - the period control. It must write the window into the URL (so the
 * SERVER page re-runs its loader), compute "7/30/90 days" on the IST calendar the office works in
 * (the old toISOString() slice was the UTC date: yesterday for the first 5h30m of every IST day),
 * keep any other query parameters, and reflect what the URL currently says.
 */
const replaceMock = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => "/crm/voice-of-customer",
  useSearchParams: () => new URLSearchParams(search),
}));

import { PeriodFilter } from "./PeriodFilter";

beforeEach(() => {
  replaceMock.mockReset();
  search = "";
  vi.useFakeTimers();
  // 2026-09-30 20:00 UTC is already 2026-10-01 01:30 in IST - the day the two calendars disagree.
  vi.setSystemTime(new Date("2026-09-30T20:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

function url(): URLSearchParams {
  const target = replaceMock.mock.calls[0]![0] as string;
  return new URL(target, "http://x").searchParams;
}

describe("PeriodFilter", () => {
  it("offers 7 / 30 / 90 days and All", () => {
    render(<PeriodFilter />);
    for (const name of ["7 days", "30 days", "90 days", "All"]) {
      expect(screen.getByRole("tab", { name })).toBeInTheDocument();
    }
  });

  it("writes the last 30 IST days into the URL (today is the IST date, not the UTC one)", () => {
    render(<PeriodFilter />);
    fireEvent.click(screen.getByRole("tab", { name: "30 days" }));
    expect(replaceMock).toHaveBeenCalledTimes(1);
    expect(url().get("to")).toBe("2026-10-01"); // IST today; the UTC date would be 2026-09-30
    expect(url().get("from")).toBe("2026-09-01");
  });

  it.each([
    ["7 days", "2026-09-24"],
    ["90 days", "2026-07-03"],
  ])("computes %s back from the IST date", (name, from) => {
    render(<PeriodFilter />);
    fireEvent.click(screen.getByRole("tab", { name }));
    expect(url().get("from")).toBe(from);
    expect(url().get("to")).toBe("2026-10-01");
  });

  it("'All' clears the window but keeps unrelated query parameters", () => {
    search = "from=2026-09-01&to=2026-09-30&tab=themes";
    render(<PeriodFilter from="2026-09-01" to="2026-09-30" />);
    fireEvent.click(screen.getByRole("tab", { name: "All" }));
    const params = url();
    expect(params.has("from")).toBe(false);
    expect(params.has("to")).toBe(false);
    expect(params.get("tab")).toBe("themes");
  });

  it("clearing everything routes to the bare path", () => {
    search = "from=2026-09-01&to=2026-09-30";
    render(<PeriodFilter from="2026-09-01" to="2026-09-30" />);
    fireEvent.click(screen.getByRole("tab", { name: "All" }));
    expect(replaceMock).toHaveBeenCalledWith("/crm/voice-of-customer");
  });

  it("reflects the URL: the matching preset is selected, an unmatched window reads as Custom", () => {
    const { unmount } = render(<PeriodFilter from="2026-09-01" to="2026-10-01" />);
    expect(screen.getByRole("tab", { name: "30 days" })).toHaveAttribute("aria-selected", "true");
    unmount();
    render(<PeriodFilter from="2026-08-01" to="2026-08-15" />);
    expect(screen.getByRole("tab", { name: "Custom" })).toHaveAttribute("aria-selected", "true");
  });

  it("with no window, 'All' is selected", () => {
    render(<PeriodFilter />);
    expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true");
  });
});
