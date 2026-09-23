import { describe, it, expect, vi, afterEach } from "vitest";
import { render as rtlRender, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

/**
 * Regression coverage for the self-service leave-application bug: a plain
 * `employee` role was shown "Couldn't load — showing nothing" and an empty
 * "No employees loaded" dropdown, with no way to select even themselves,
 * because the page only ever populated the picker from the admin-only
 * GET /v1/hrms/employees list (correctly 403'd for that role — see
 * READER_ROLES in hrms-service's employee/routes.ts).
 *
 * page.tsx already had a partial fallback to the self-service
 * GET /v1/hrms/me/profile endpoint (via getMyProfile()) for when the admin
 * list comes back empty. These tests exercise the actual role-dependent
 * resolution logic end to end, per injected loader responses standing in
 * for each role:
 *   - hr_admin/hr_officer/manager: unaffected, full picker as before.
 *   - employee, WITH a linked record: fallback resolves them as the sole
 *     option — and (the concrete bug this fix closes) the page must stop
 *     claiming "Couldn't load" once that fallback actually succeeded.
 *   - employee, WITH NO linked record (404, e.g. this exact test account):
 *     an honest "contact HR" message, not a confusing empty dropdown.
 *   - a genuine failure on both calls: still surfaces as an error, honestly
 *     (not silently reinterpreted as "no employee record").
 */

const getEmployeesMock = vi.fn();
const getMyProfileMock = vi.fn();
vi.mock("../../../../_data/loaders", () => ({
  getEmployees: (...args: unknown[]) => getEmployeesMock(...args),
  getMyProfile: (...args: unknown[]) => getMyProfileMock(...args),
}));

// This page renders the real (unmocked) ApplyLeaveForm, which calls
// useToast()/fetchOrQueue()/trackActivation() — same three mocks
// ApplyLeaveForm.test.tsx already needs for exactly that reason.
vi.mock("@/lib/sync/requestQueue", () => ({ fetchOrQueue: vi.fn() }));
vi.mock("@/lib/activation", () => ({ trackActivation: vi.fn() }));
vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }),
}));

// next-intl/server resolves to a throwing guard under plain Vitest (no
// `react-server` condition) — a pre-existing, unrelated gap; same minimal
// same-shape mock already used by citizen/alerts/page.test.tsx and
// citizen/grievances/page.test.tsx.
vi.mock("next-intl/server", async () => {
  const messages = (await import("@/messages/en.json")).default as Record<string, unknown>;
  function resolve(obj: unknown, dotted: string): unknown {
    return dotted.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), obj);
  }
  return {
    getTranslations: async (namespace?: string) => {
      const scope = namespace ? resolve(messages, namespace) : messages;
      return (key: string) => {
        const found = resolve(scope, key);
        return typeof found === "string" ? found : key;
      };
    },
    getLocale: async () => "en",
    getMessages: async () => messages,
  };
});

import ApplyLeavePage from "./page";

function render(page: Promise<React.ReactElement>) {
  return page.then((ui) => rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>));
}

describe("ApplyLeavePage — role-based employee resolution", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    getEmployeesMock.mockReset();
    getMyProfileMock.mockReset();
  });

  // ApplyLeaveForm's own effect fetches leave-context for the selected
  // employee on mount whenever employeeId is non-empty; stub it so that's
  // deterministic and quiet (same pattern as ApplyLeaveForm.test.tsx).
  function stubLeaveContextFetch() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ employee: {}, leaveTypes: [], allocations: [] }) }) as Response),
    );
  }

  it("hr_admin / hr_officer / manager: full roster loads normally — admin path unaffected", async () => {
    stubLeaveContextFetch();
    getEmployeesMock.mockResolvedValue({
      data: [
        { id: "emp-1", name: "Asha Verma", department: "Finance" },
        { id: "emp-2", name: "Rahul Singh", department: "IT" },
      ],
      source: "api",
    });

    await render(ApplyLeavePage({ searchParams: {} }));

    expect(screen.getByRole("option", { name: /asha verma/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /rahul singh/i })).toBeInTheDocument();
    expect(screen.queryByText(/couldn't load/i)).not.toBeInTheDocument();
    // The admin list succeeded, so the self-service fallback must never be consulted.
    expect(getMyProfileMock).not.toHaveBeenCalled();
  });

  it("employee WITH a linked record: 403 on the admin list falls back to self, and (the bug) no misleading 'Couldn't load' badge once that fallback succeeds", async () => {
    stubLeaveContextFetch();
    getEmployeesMock.mockResolvedValue({ data: [], source: "error", status: 403 });
    getMyProfileMock.mockResolvedValue({
      data: { id: "emp-self", name: "Priya Nair", department: "IT", employeeNo: "E9", status: "active", designation: "Analyst" },
      source: "api",
    });

    await render(ApplyLeavePage({ searchParams: {} }));

    const select = screen.getByRole("combobox", { name: /employee/i });
    expect(select).toHaveValue("emp-self");
    expect(screen.getByRole("option", { name: /priya nair/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /no employees loaded/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/couldn't load/i)).not.toBeInTheDocument();
    // The submit button is disabled while ApplyLeaveForm's own effect is
    // fetching leave-context for the resolved self employeeId (status
    // "loading" -> "idle") — wait for that mocked fetch to settle, same as
    // ApplyLeaveForm.test.tsx's fillAndSubmit() does for the same reason.
    await waitFor(() => expect(screen.getByRole("button", { name: /submit leave request/i })).toBeEnabled());
  });

  it("employee with NO linked record (404): shows the honest 'contact HR' message, not an empty dropdown or a fetch-failure badge", async () => {
    getEmployeesMock.mockResolvedValue({ data: [], source: "error", status: 403 });
    getMyProfileMock.mockResolvedValue({ data: null, source: "api", status: 404 });

    await render(ApplyLeavePage({ searchParams: {} }));

    expect(screen.getByText(/no employee record is linked to your account/i)).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /employee/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/couldn't load/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no employees loaded/i)).not.toBeInTheDocument();
  });

  it("genuine failure on both calls (network/5xx): still shows the error badge honestly, not the 'contact HR' message", async () => {
    getEmployeesMock.mockResolvedValue({ data: [], source: "error", status: 500 });
    getMyProfileMock.mockResolvedValue({ data: null, source: "error" });

    await render(ApplyLeavePage({ searchParams: {} }));

    expect(screen.getByText(/couldn't load/i)).toBeInTheDocument();
    expect(screen.queryByText(/no employee record is linked to your account/i)).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /no employees loaded/i })).toBeInTheDocument();
  });

  it("honors ?empId= deep-link preselection through the admin path (existing behavior, unaffected by this fix)", async () => {
    stubLeaveContextFetch();
    getEmployeesMock.mockResolvedValue({
      data: [
        { id: "emp-1", name: "Asha Verma", department: "Finance" },
        { id: "emp-2", name: "Rahul Singh", department: "IT" },
      ],
      source: "api",
    });

    await render(ApplyLeavePage({ searchParams: { empId: "emp-2" } }));

    expect(screen.getByRole("combobox", { name: /employee/i })).toHaveValue("emp-2");
  });
});
