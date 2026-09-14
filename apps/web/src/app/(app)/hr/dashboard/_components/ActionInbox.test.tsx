import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ActionInbox } from "./ActionInbox";

const ITEM = {
  id: "i1",
  employeeName: "Test Employee",
  leaveTypeCode: "EL",
  leaveTypeName: "Earned Leave",
  fromDate: "2026-09-10",
  toDate: "2026-09-11",
  daysApplied: 2,
  departmentName: "IT",
};

/**
 * UX-016: this used to show the raw backend `error`/`message` (falling back
 * to `Error ${res.status}`) verbatim — the same class of leak useFormError
 * closes fleet-wide (UX-003).
 */
describe("ActionInbox — UX-016 clerk-safe errors", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows a clerk-safe message, never the raw HTTP status, when approve fails", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({}), { status: 500, headers: { "content-type": "application/json" } }),
    );
    // @ts-expect-error minimal fixture, not the full LeaveInboxItem type
    render(<ActionInbox initialItems={[ITEM]} />);

    fireEvent.click(screen.getByRole("button", { name: /approve leave for test employee/i }));

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/\b500\b/);
  });

  it("never surfaces a raw backend `error` field verbatim", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "leave-service: employee not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );
    // @ts-expect-error minimal fixture, not the full LeaveInboxItem type
    render(<ActionInbox initialItems={[ITEM]} />);

    fireEvent.click(screen.getByRole("button", { name: /decline leave for test employee/i }));

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/leave-service/);
  });
});
