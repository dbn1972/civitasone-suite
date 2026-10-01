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

describe("PayGroupsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    rolesMock.mockReturnValue(["payroll_admin"]);
  });

  it("renders the list of pay groups without a fabricated employee count", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        { id: "g1", name: "Monthly Staff", frequency: "monthly", pay_day_of_month: 28, timezone: "Asia/Kolkata", status: "active" },
      ],
      source: "api",
    });
    render(withIntl(await PayGroupsPage()));
    expect(screen.getByText("Monthly Staff")).toBeInTheDocument();
    // PAY-GROUPS-03: the API returns no employee count -> "—", not "0";
    // and no always-zero "Inactive" stat.
    expect(screen.queryByText("Inactive")).not.toBeInTheDocument();
    expect(screen.getByText("28th")).toBeInTheDocument();
  });

  it("renders an empty state when there are no pay groups", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(withIntl(await PayGroupsPage()));
    expect(screen.getByText("No pay groups yet")).toBeInTheDocument();
  });

  it("shows the data-source badge on a failed load (PAY-GROUPS-05)", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    render(withIntl(await PayGroupsPage()));
    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });

  it("hides the create form from read-only roles and denies employees (PAY-GROUPS-04)", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    rolesMock.mockReturnValue(["finance_officer"]);
    render(withIntl(await PayGroupsPage()));
    expect(screen.queryByText("Create Pay Group")).not.toBeInTheDocument();

    fetchJsonMock.mockClear();
    rolesMock.mockReturnValue(["employee"]);
    render(withIntl(await PayGroupsPage()));
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
