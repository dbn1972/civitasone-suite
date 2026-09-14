import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { AllocateLeaveForm } from "./AllocateLeaveForm";

const EMPLOYEES = [{ id: "e1", name: "Test Employee", employeeNo: "EMP001" }];
const LEAVE_TYPES = [{ id: "lt1", code: "EL", name: "Earned Leave" }];

/**
 * UX-016: this used to show the raw backend response text (falling back to
 * `Request failed (${res.status})`) verbatim — the same class of leak
 * useFormError closes fleet-wide (UX-003).
 */
describe("AllocateLeaveForm — UX-016 clerk-safe errors", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/hrms/employees")) {
        return Promise.resolve(new Response(JSON.stringify({ data: EMPLOYEES }), { status: 200 }));
      }
      if (typeof url === "string" && url.includes("/hrms/leave-types")) {
        return Promise.resolve(new Response(JSON.stringify({ data: LEAVE_TYPES }), { status: 200 }));
      }
      return Promise.resolve(new Response("leave-service allocation trace at line 12", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows a clerk-safe message, never the raw server text or status, when allocation fails", async () => {
    render(<AllocateLeaveForm />);
    await waitFor(() => expect(screen.getByRole("option", { name: /test employee/i })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/total days/i), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: /allocate leave/i }));

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/leave-service/);
    expect(alert.textContent).not.toMatch(/\b500\b/);
  });
});
