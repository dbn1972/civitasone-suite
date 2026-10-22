import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const { getSessionRolesMock } = vi.hoisted(() => ({ getSessionRolesMock: vi.fn((): string[] => ["employee"]) }));
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: getSessionRolesMock }));

import OvertimeNewPage from "./page";

async function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {await OvertimeNewPage()}
    </NextIntlClientProvider>,
  );
}

// GAP-HR-OVERTIME-NEW-02 / GAP-HR-OVERTIME-03: POST /v1/hrms/overtime-requests
// is HR staff + employee only, so a bare manager used to fill in the whole form
// and then fail on submit.
describe("/hr/overtime/new role gate (GAP-HR-OVERTIME-NEW-02)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/me/profile")) return Promise.resolve(new Response(JSON.stringify({ id: "self-1", fullName: "Self Employee", employeeNo: "EMP-SELF" }), { status: 200 }));
      if (url.includes("/hrms/employees")) return Promise.resolve(new Response(JSON.stringify({ data: [{ id: "e1", name: "Test Employee", employeeNo: "EMP001" }] }), { status: 200 }));
      return Promise.resolve(new Response("", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("a bare manager gets the access-restricted card with a way back, not a form that cannot succeed", async () => {
    getSessionRolesMock.mockReturnValue(["manager"]);
    await renderPage();
    expect(screen.getByText("Access restricted")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /submit request/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Overtime" })).toHaveAttribute("href", "/hr/overtime");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a manager who is also an employee can file (for themselves)", async () => {
    getSessionRolesMock.mockReturnValue(["manager", "employee"]);
    await renderPage();
    expect(await screen.findByDisplayValue("Self Employee (EMP-SELF)")).toBeDisabled();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/hrms/employees"))).toBe(false);
  });

  it("an employee gets the form locked to their own record", async () => {
    getSessionRolesMock.mockReturnValue(["employee"]);
    await renderPage();
    expect(screen.getByRole("button", { name: /submit request/i })).toBeInTheDocument();
    expect(await screen.findByDisplayValue("Self Employee (EMP-SELF)")).toBeDisabled();
  });

  it.each(["hr_admin", "hr_officer", "super_admin"])("%s gets the employee picker", async (role) => {
    getSessionRolesMock.mockReturnValue([role]);
    await renderPage();
    await waitFor(() => expect(screen.getByRole("option", { name: /test employee/i })).toBeInTheDocument());
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/me/profile"))).toBe(false);
  });
});
