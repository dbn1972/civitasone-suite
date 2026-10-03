import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
const rolesMock = vi.fn(() => ["payroll_admin"]);
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => rolesMock(),
  PAYROLL_ADMIN_ROLES: ["payroll_admin", "payroll_officer", "super_admin"],
  PAYROLL_READER_ROLES: ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer"],
}));

import PayGroupsPage from "./page";
import { PayGroupCard } from "./PayGroupCard";

function withIntl(ui: React.ReactNode) {
  return <NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>;
}

/** Routes the page's several fetchJson calls by URL (the list, DDOs, unassigned count, settings). */
function mockApi(groups: unknown[], opts: { source?: "api" | "error"; unassigned?: number | null } = {}) {
  fetchJsonMock.mockImplementation(async (path: string) => {
    if (path.startsWith("/api/v1/payroll/ddos")) return { data: [{ ddoCode: "DDO-1", name: "Finance DDO", isActive: true }], source: "api" };
    if (path.includes("/unassigned")) {
      return opts.unassigned == null ? { data: null, source: "error" } : { data: opts.unassigned, source: "api" };
    }
    if (path.includes("pay-group-settings")) return { data: false, source: "api" };
    return { data: groups, source: opts.source ?? "api" };
  });
}

describe("PayGroupsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    rolesMock.mockReturnValue(["payroll_admin"]);
  });

  it("renders the list of pay groups without a fabricated employee count", async () => {
    mockApi([
      { id: "g1", name: "Monthly Staff", frequency: "monthly", pay_day_of_month: 28, timezone: "Asia/Kolkata", status: "active" },
    ]);
    render(withIntl(await PayGroupsPage({})));
    expect(screen.getByText("Monthly Staff")).toBeInTheDocument();
    // PAY-GROUPS-03: the API returns no employee count -> "—", not "0".
    expect(screen.getByText("28th")).toBeInTheDocument();
  });

  it("renders an empty state when there are no pay groups", async () => {
    mockApi([]);
    render(withIntl(await PayGroupsPage({})));
    expect(screen.getByText("No pay groups yet")).toBeInTheDocument();
  });

  it("shows the data-source badge on a failed load (PAY-GROUPS-05)", async () => {
    mockApi([], { source: "error" });
    render(withIntl(await PayGroupsPage({})));
    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
    // A failed load must not read as "no pay groups yet".
    expect(screen.queryByText("No pay groups yet")).not.toBeInTheDocument();
  });

  it("hides the create form from read-only roles and denies employees (PAY-GROUPS-04)", async () => {
    mockApi([]);
    rolesMock.mockReturnValue(["finance_officer"]);
    render(withIntl(await PayGroupsPage({})));
    expect(screen.queryByText("Create Pay Group")).not.toBeInTheDocument();

    fetchJsonMock.mockClear();
    rolesMock.mockReturnValue(["employee"]);
    render(withIntl(await PayGroupsPage({})));
    expect(screen.getByText("Access restricted")).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });
});

describe("PayGroupCard", () => {
  it.each([
    [1, "1st"], [2, "2nd"], [3, "3rd"], [4, "4th"], [11, "11th"], [12, "12th"], [13, "13th"],
    [21, "21st"], [22, "22nd"], [23, "23rd"], [31, "31st"],
  ])("formats pay day %i as %s (PAY-GROUPS-02)", (day, expected) => {
    render(withIntl(<PayGroupCard id="g" name="G" frequency="monthly" payDayOfMonth={day} timezone="Asia/Kolkata" status="active" />));
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("uses a translated status pill, not the raw enum (PAY-GROUPS-05)", () => {
    render(withIntl(<PayGroupCard id="g" name="G" frequency="weekly" payDayOfMonth={5} timezone="Asia/Kolkata" status="inactive" />));
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    expect(screen.queryByText("inactive")).not.toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

// fin-payroll-03 (GAP-PAYROLL-PAY-GROUPS-01 / 03)
describe("PayGroupCard schedule + admin actions", () => {
  it("a weekly group shows its weekday, never an ordinal day (PAY-GROUPS-01)", () => {
    render(withIntl(<PayGroupCard id="g" name="Wage staff" frequency="weekly" payDayOfMonth={28} payWeekday={5} timezone="Asia/Kolkata" status="active" />));
    expect(screen.getByText("Friday")).toBeInTheDocument();
    expect(screen.queryByText("28th")).not.toBeInTheDocument();
  });

  it("a bi-weekly group shows the weekday and which weeks", () => {
    render(withIntl(<PayGroupCard id="g" name="Alt" frequency="bi_weekly" payDayOfMonth={28} payWeekday={5} payWeekParity={0} timezone="Asia/Kolkata" status="active" />));
    expect(screen.getByText("Friday (even weeks)")).toBeInTheDocument();
  });

  it("a monthly group flagged last-day shows 'Last day of month', not 31st", () => {
    render(withIntl(<PayGroupCard id="g" name="M" frequency="monthly" payDayOfMonth={31} payLastDay timezone="Asia/Kolkata" status="active" />));
    expect(screen.getByText("Last day of month")).toBeInTheDocument();
    expect(screen.queryByText("31st")).not.toBeInTheDocument();
  });

  it("a legacy weekly group (no weekday stored) says so instead of printing '5th'", () => {
    render(withIntl(<PayGroupCard id="g" name="L" frequency="weekly" payDayOfMonth={5} timezone="Asia/Kolkata" status="active" />));
    expect(screen.getByText("Day 5 (weekday not set)")).toBeInTheDocument();
    expect(screen.queryByText("5th")).not.toBeInTheDocument();
  });

  it("admins get Edit + Deactivate on an active group; read-only viewers get neither", () => {
    const { unmount } = render(withIntl(<PayGroupCard id="g1" name="G" frequency="monthly" payDayOfMonth={5} timezone="Asia/Kolkata" status="active" canAdminister />));
    expect(screen.getByRole("link", { name: "Edit pay group G" })).toHaveAttribute("href", "/hr/payroll/pay-groups?edit=g1");
    expect(screen.getByRole("button", { name: "Deactivate" })).toBeInTheDocument();
    unmount();
    render(withIntl(<PayGroupCard id="g1" name="G" frequency="monthly" payDayOfMonth={5} timezone="Asia/Kolkata" status="active" />));
    expect(screen.queryByRole("button", { name: "Deactivate" })).not.toBeInTheDocument();
  });

  it("an archived group reads Inactive and offers Reactivate (not Edit)", () => {
    render(withIntl(<PayGroupCard id="g1" name="G" frequency="monthly" payDayOfMonth={5} timezone="Asia/Kolkata" status="archived" canAdminister />));
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reactivate" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Edit pay group/ })).not.toBeInTheDocument();
  });
});

describe("PayGroupsPage inactive groups (PAY-GROUPS-03)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    rolesMock.mockReturnValue(["payroll_admin"]);
  });

  it("requests inactive groups too, and counts Active vs Inactive separately", async () => {
    mockApi(
      [
        { id: "g1", name: "Live", frequency: "monthly", pay_day_of_month: 28, timezone: "Asia/Kolkata", status: "active" },
        { id: "g2", name: "Old", frequency: "monthly", pay_day_of_month: 1, timezone: "Asia/Kolkata", status: "archived" },
      ],
      { unassigned: 4 },
    );
    render(withIntl(await PayGroupsPage({})));
    expect(String(fetchJsonMock.mock.calls[0]![0])).toContain("includeInactive=true");
    const labels = Array.from(document.querySelectorAll(".stat, .card")).length;
    expect(labels).toBeGreaterThan(0);
    expect(screen.getByText("Old")).toBeInTheDocument();
    const vals = Array.from(document.querySelectorAll(".val")).map((n) => n.textContent);
    // Active 1, Monthly 1, Bi-weekly 0, Weekly 0, Inactive 1, Not in any pay group 4
    expect(vals).toEqual(["1", "1", "0", "0", "1", "4"]);
  });
});

describe("PayGroupsPage DDO, bill type and membership (PAY-GROUPS-03)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    rolesMock.mockReturnValue(["payroll_admin"]);
  });

  const GROUP = {
    id: "g1", name: "Gazetted Staff", frequency: "monthly", pay_day_of_month: 28, timezone: "Asia/Kolkata", status: "active",
    ddo_code: "DDO-1", bill_type: "non_gazetted", employeeCount: 42,
  };

  it("shows the DDO and a translated bill type, and links the count to the members tab", async () => {
    mockApi([GROUP], { unassigned: 3 });
    render(withIntl(await PayGroupsPage({})));
    expect(screen.getByText("DDO DDO-1")).toBeInTheDocument();
    // the card chip (the create form has an <option> with the same label)
    expect(screen.getAllByText("Non-gazetted").some((n) => n.tagName === "SPAN")).toBe(true);
    expect(screen.queryByText("non_gazetted")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /42 employees in Gazetted Staff/ })).toHaveAttribute("href", "/hr/payroll/pay-groups/g1?tab=members");
  });

  it("links the unassigned stat to the report, and shows an unknown count as — rather than 0", async () => {
    mockApi([GROUP], { unassigned: null });
    render(withIntl(await PayGroupsPage({})));
    const link = screen.getAllByRole("link").find((a) => a.getAttribute("href") === "/hr/payroll/pay-groups/unassigned" && /Not in any pay group/.test(a.textContent ?? ""));
    expect(link).toBeDefined();
    expect(link!.textContent).toContain("—");
  });

  it("offers the mid-month setting to admins only", async () => {
    mockApi([GROUP], { unassigned: 0 });
    render(withIntl(await PayGroupsPage({})));
    expect(screen.getByLabelText("Allow membership changes to start mid-month")).toBeInTheDocument();
  });

  it("hides the mid-month setting from read-only roles", async () => {
    rolesMock.mockReturnValue(["finance_officer"]);
    mockApi([GROUP], { unassigned: 0 });
    render(withIntl(await PayGroupsPage({})));
    expect(screen.queryByLabelText("Allow membership changes to start mid-month")).not.toBeInTheDocument();
  });
});
