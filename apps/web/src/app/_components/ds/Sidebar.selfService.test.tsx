import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import hiMessages from "@/messages/hi.json";
import { Sidebar } from "./Sidebar";
import { visibleNavGroups } from "@/lib/nav/navModel";

let mockPath = "/dashboard";
vi.mock("next/navigation", () => ({ usePathname: () => mockPath }));

const COMPOSED = ["billing", "finance", "hrms-attendance", "hrms-leave", "hrms-payroll", "meeting", "payroll", "procurement", "workflow"];
const hiNav = (hiMessages as unknown as { appNav: { item: Record<string, string>; group: Record<string, string> } }).appNav;

beforeEach(() => {
  mockPath = "/dashboard";
  localStorage.clear();
});

describe("Sidebar: employee self-service + full sections (UAT-P3 S-02)", () => {
  it("gives a plain employee My leave / payslips / attendance / tax declaration / profile, and no staff screens", () => {
    render(<Sidebar enabledModules={COMPOSED} roles={["employee"]} />);
    const expected: Array<[string, string]> = [
      ["My leave", "/hr/leave/apply"],
      ["My payslips", "/hr/payroll/my-slips"],
      ["My attendance", "/hr/attendance"],
      ["My tax declaration", "/hr/payroll/tax-declaration"],
      ["My profile", "/hr/service-book"],
    ];
    for (const [name, href] of expected) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
    }
    expect(screen.getByText("SELF-SERVICE")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /HR & Payroll/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Leave approvals/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /^Revenue$/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /^Billing$/ })).toBeNull();
  });

  it("shows HR & Payroll, Revenue, Billing and Meetings to the UAT officer persona (super_admin, composed tenant)", () => {
    render(<Sidebar enabledModules={COMPOSED} roles={["super_admin"]} />);
    expect(screen.getByRole("link", { name: /HR & Payroll/ })).toHaveAttribute("href", "/hr");
    expect(screen.getByRole("link", { name: /^Revenue$/ })).toHaveAttribute("href", "/revenue");
    expect(screen.getByRole("link", { name: /^Billing$/ })).toHaveAttribute("href", "/billing");
    expect(screen.getByRole("link", { name: /^Meetings$/ })).toHaveAttribute("href", "/meeting");
    for (const heading of ["HR & PAYROLL", "REVENUE", "BILLING", "MEETINGS"]) {
      expect(screen.getByRole("button", { name: heading })).toBeInTheDocument();
    }
  });

  it("an hr_admin sees HR & Payroll on a tenant whose module list has only hrms-* keys (was hidden by exact matching)", () => {
    render(<Sidebar enabledModules={["hrms-payroll", "hrms-leave"]} roles={["hr_admin"]} />);
    expect(screen.getByRole("link", { name: /HR & Payroll/ })).toBeInTheDocument();
  });

  it("marks only the most specific entry as the current page", () => {
    mockPath = "/hr/leave/apply";
    render(<Sidebar enabledModules={null} roles={["super_admin"]} />);
    const current = screen.getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.map((a) => a.textContent)).toEqual(["My leave"]);
  });

  it("translates every heading and entry in Hindi (15 labels used to stay English)", () => {
    render(
      <NextIntlClientProvider locale="hi" messages={hiMessages}>
        <Sidebar enabledModules={null} roles={["super_admin"]} userName="R. Sharma" userRole="Super Admin" />
      </NextIntlClientProvider>,
    );
    const nav = screen.getByRole("navigation", { name: "मुख्य नेविगेशन" });
    for (const g of visibleNavGroups({ enabledModules: null, roles: ["super_admin"] })) {
      expect(within(nav).getByRole("button", { name: hiNav.group[g.id] }), g.id).toBeInTheDocument();
      for (const i of g.items) {
        if (i.id === "dashboard") continue;
        expect(within(nav).getAllByRole("link", { name: hiNav.item[i.id] }).length, i.id).toBeGreaterThan(0);
      }
    }
    expect(within(nav).getByRole("link", { name: "डैशबोर्ड" })).toBeInTheDocument();
    expect(screen.getByText("एंटरप्राइज़ सूट")).toBeInTheDocument();
    expect(screen.getByText("सुपर प्रशासक")).toBeInTheDocument();
  });
});
