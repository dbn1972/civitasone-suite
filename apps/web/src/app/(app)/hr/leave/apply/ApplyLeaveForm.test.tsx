import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/sync/requestQueue", () => ({ fetchOrQueue: vi.fn() }));
vi.mock("@/lib/activation", () => ({ trackActivation: vi.fn() }));
vi.mock("@/app/_components/ds/Toast", () => ({ useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }) }));

import { ApplyLeaveForm } from "./ApplyLeaveForm";

const EMPLOYEES = [
  { id: "emp-1", name: "Asha Verma", department: "Finance" },
  { id: "emp-2", name: "Rahul Singh", department: "IT" },
] as never;

describe("ApplyLeaveForm — deep-link preselection", () => {
  // The component's own useEffect fetches leave-context for the selected
  // employee on mount; stub it so that's deterministic and quiet.
  afterEach(() => vi.unstubAllGlobals());
  function stubLeaveContextFetch() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ employee: {}, leaveTypes: [], allocations: [] }) }) as Response),
    );
  }

  it("defaults to the first employee when no initialEmployeeId is given", () => {
    stubLeaveContextFetch();
    render(<ApplyLeaveForm employees={EMPLOYEES} />);
    expect(screen.getByRole("combobox", { name: /employee/i })).toHaveValue("emp-1");
  });

  it("preselects the employee named by ?empId= (via initialEmployeeId), not just the first in the list", () => {
    stubLeaveContextFetch();
    render(<ApplyLeaveForm employees={EMPLOYEES} initialEmployeeId="emp-2" />);
    expect(screen.getByRole("combobox", { name: /employee/i })).toHaveValue("emp-2");
  });

  it("falls back to the first employee if initialEmployeeId isn't in the list", () => {
    stubLeaveContextFetch();
    render(<ApplyLeaveForm employees={EMPLOYEES} initialEmployeeId="does-not-exist" />);
    expect(screen.getByRole("combobox", { name: /employee/i })).toHaveValue("emp-1");
  });
});
