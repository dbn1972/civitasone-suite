import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

import { GrievanceActions } from "./GrievanceActions";

const OFFICERS = [{ id: "o1", name: "R. Singh", employeeNo: "HR001", department: "HR" }];

function renderActions(grievantId = "e1") {
  return render(<NextIntlClientProvider locale="en" messages={enMessages}><GrievanceActions id="g1" grievantId={grievantId} /></NextIntlClientProvider>);
}

function mockFetch() {
  return vi.fn((url: string, init?: RequestInit) => {
    if (typeof url === "string" && url.includes("/hrms/employees")) return Promise.resolve(new Response(JSON.stringify({ data: OFFICERS }), { status: 200 }));
    if (init?.method === "POST") return Promise.resolve(new Response(JSON.stringify({ id: "g1", status: "accepted" }), { status: 202 }));
    return Promise.resolve(new Response("nf", { status: 404 }));
  });
}

describe("GrievanceActions", () => {
  beforeEach(() => refresh.mockReset());
  afterEach(() => vi.unstubAllGlobals());

  it("assign: requires a picked officer, then POSTs to /assign with an idempotency key", async () => {
    const f = mockFetch();
    vi.stubGlobal("fetch", f);
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    expect(await screen.findByText(/choose the hr officer/i)).toBeInTheDocument();
    expect(f.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === "POST")).toBe(false);

    fireEvent.change(screen.getByLabelText("HR officer"), { target: { value: "R." } });
    fireEvent.mouseDown(await screen.findByText("R. Singh (HR001)"));
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const call = f.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === "POST")!;
    expect(String(call[0])).toContain("/hrms/grievances/g1/assign");
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ assigneeEmployeeId: "o1" });
    expect(((call[1] as RequestInit).headers as Record<string, string>)["x-idempotency-key"]).toBeTruthy();
  });

  it("dispose: needs an outcome, then a confirm dialog with mandatory remarks before the POST", async () => {
    const f = mockFetch();
    vi.stubGlobal("fetch", f);
    renderActions();
    expect(screen.getByRole("button", { name: /Dispose…/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Outcome"), { target: { value: "resolved" } });
    fireEvent.click(screen.getByRole("button", { name: /Dispose…/ }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Dispose")!;
    expect(confirm).toBeDisabled();
    expect(f.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === "POST")).toBe(false);
    fireEvent.change(dialog.querySelector("textarea")!, { target: { value: "Arrears were paid" } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const call = f.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === "POST")!;
    expect(String(call[0])).toContain("/hrms/grievances/g1/dispose");
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ disposition: "resolved", remarks: "Arrears were paid" });
  });
});
