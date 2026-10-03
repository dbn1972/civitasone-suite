import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

import { RaiseRegularisation } from "./RaiseRegularisation";

const EMPLOYEES = [{ id: "e1", name: "Test Employee", employeeNo: "EMP001", department: "Finance" }];

function ui(canPick: boolean) {
  return render(<NextIntlClientProvider locale="en" messages={enMessages}><RaiseRegularisation canPickEmployee={canPick} /></NextIntlClientProvider>);
}
function mockFetch(post: () => Response) {
  return vi.fn((url: string, init?: RequestInit) => {
    if (typeof url === "string" && url.includes("/hrms/employees")) return Promise.resolve(new Response(JSON.stringify({ data: EMPLOYEES }), { status: 200 }));
    if (init?.method === "POST") return Promise.resolve(post());
    return Promise.resolve(new Response("nf", { status: 404 }));
  });
}
const posted = (f: ReturnType<typeof mockFetch>) => f.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === "POST");

describe("RaiseRegularisation", () => {
  beforeEach(() => refresh.mockReset());
  afterEach(() => vi.unstubAllGlobals());

  it("employee flow: no employee picker; sends only date/status/reason (the server derives the employee)", async () => {
    const f = mockFetch(() => new Response(JSON.stringify({ id: "r1", status: "accepted" }), { status: 202 }));
    vi.stubGlobal("fetch", f);
    ui(false);
    fireEvent.click(screen.getByRole("button", { name: "Raise request" }));
    expect(screen.queryByLabelText(/^employee/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^date/i), { target: { value: "2026-02-10" } });
    fireEvent.change(screen.getByLabelText(/^reason/i), { target: { value: "Biometric was down" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const body = JSON.parse((posted(f)![1] as RequestInit).body as string);
    expect(body).toEqual({ date: "2026-02-10", requestedStatus: "present", reason: "Biometric was down" });
  });

  it("HR/manager flow: requires and sends the picked employee", async () => {
    const f = mockFetch(() => new Response(JSON.stringify({ id: "r1" }), { status: 202 }));
    vi.stubGlobal("fetch", f);
    ui(true);
    fireEvent.click(screen.getByRole("button", { name: "Raise request" }));
    fireEvent.change(screen.getByLabelText(/^date/i), { target: { value: "2026-02-10" } });
    fireEvent.change(screen.getByLabelText(/^reason/i), { target: { value: "Forgot to punch" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
    expect(await screen.findByText(/choose the employee/i)).toBeInTheDocument();
    expect(posted(f)).toBeUndefined();
    fireEvent.change(screen.getByLabelText(/^employee/i), { target: { value: "Test" } });
    fireEvent.mouseDown(await screen.findByText("Test Employee (EMP001)"));
    fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(JSON.parse((posted(f)![1] as RequestInit).body as string).employeeId).toBe("e1");
  });

  it("a future date is blocked client-side with no network call", async () => {
    const f = mockFetch(() => new Response("{}", { status: 202 }));
    vi.stubGlobal("fetch", f);
    ui(false);
    fireEvent.click(screen.getByRole("button", { name: "Raise request" }));
    fireEvent.change(screen.getByLabelText(/^date/i), { target: { value: "2999-01-01" } });
    fireEvent.change(screen.getByLabelText(/^reason/i), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
    expect(await screen.findByText(/not in the future/i)).toBeInTheDocument();
    expect(posted(f)).toBeUndefined();
  });

  it("maps ATTENDANCE_RECORD_NOT_FOUND to a friendly message, stays open, no success notice", async () => {
    vi.stubGlobal("fetch", mockFetch(() => new Response(JSON.stringify({ code: "ATTENDANCE_RECORD_NOT_FOUND", message: "no attendance record exists for employee abc" }), { status: 404 })));
    ui(false);
    fireEvent.click(screen.getByRole("button", { name: "Raise request" }));
    fireEvent.change(screen.getByLabelText(/^date/i), { target: { value: "2026-02-10" } });
    fireEvent.change(screen.getByLabelText(/^reason/i), { target: { value: "Biometric was down" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
    expect(await screen.findByText(/no attendance was marked for that day/i)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.queryByText(/request raised/i)).not.toBeInTheDocument();
  });
});
