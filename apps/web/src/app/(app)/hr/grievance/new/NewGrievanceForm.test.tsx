import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

import { NewGrievanceForm } from "./NewGrievanceForm";

const EMPLOYEES = [{ id: "e1", name: "Test Employee", employeeNo: "EMP001", department: "Finance" }];

function renderForm() {
  return render(<NextIntlClientProvider locale="en" messages={enMessages}><NewGrievanceForm /></NextIntlClientProvider>);
}

function mockFetch(post: () => Response) {
  return vi.fn((url: string, init?: RequestInit) => {
    if (typeof url === "string" && url.includes("/hrms/employees")) {
      return Promise.resolve(new Response(JSON.stringify({ data: EMPLOYEES }), { status: 200 }));
    }
    if (typeof url === "string" && url.includes("/hrms/grievances") && init?.method === "POST") return Promise.resolve(post());
    return Promise.resolve(new Response("nf", { status: 404 }));
  });
}

async function fill() {
  fireEvent.change(screen.getByLabelText(/^employee/i), { target: { value: "Test" } });
  fireEvent.mouseDown(await screen.findByText("Test Employee (EMP001)"));
  fireEvent.change(screen.getByLabelText(/category/i), { target: { value: "pay_allowances" } });
  fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "DA arrears" } });
  fireEvent.change(screen.getByLabelText(/description/i), { target: { value: "March DA arrears are missing" } });
}

describe("NewGrievanceForm", () => {
  beforeEach(() => push.mockReset());
  afterEach(() => vi.unstubAllGlobals());

  it("points sexual-harassment complaints to the Internal Committee, and offers no harassment category", () => {
    vi.stubGlobal("fetch", mockFetch(() => new Response("{}", { status: 202 })));
    renderForm();
    expect(screen.getByRole("note")).toHaveTextContent(/sexual harassment/i);
    expect(screen.getByRole("link", { name: /internal committee/i })).toHaveAttribute("href", "/hr/icc");
    expect(screen.queryByRole("option", { name: /harassment/i })).not.toBeInTheDocument();
  });

  it("blocks an empty submit with field errors and no network POST", async () => {
    const f = mockFetch(() => new Response("{}", { status: 202 }));
    vi.stubGlobal("fetch", f);
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Register grievance" }));
    expect(await screen.findByText(/choose the employee/i)).toBeInTheDocument();
    expect(screen.getByText(/choose a category/i, { selector: "p[role=alert]" })).toBeInTheDocument();
    expect(f.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === "POST")).toBe(false);
  });

  it("POSTs the picked employee id with an x-idempotency-key header (the one header the proxy forwards) and returns to the register", async () => {
    const f = mockFetch(() => new Response(JSON.stringify({ id: "g1", status: "accepted" }), { status: 202 }));
    vi.stubGlobal("fetch", f);
    renderForm();
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "Register grievance" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/hr/grievance"));
    const call = f.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === "POST")!;
    const init = call[1] as RequestInit;
    expect((init.headers as Record<string, string>)["x-idempotency-key"]).toMatch(/\S{8,}/);
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ employeeId: "e1", category: "pay_allowances", subject: "DA arrears" });
  });

  it("shows a plain error and stays on the form when the server rejects", async () => {
    vi.stubGlobal("fetch", mockFetch(() => new Response(JSON.stringify({ code: "FORBIDDEN", message: "x" }), { status: 403 })));
    renderForm();
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "Register grievance" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
