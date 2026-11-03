/**
 * UAT L1: /hr/payroll/tax-declaration "failed to load" for HR / payroll staff.
 * payroll-service answers the self-service GET with 400 (staff must name the
 * employee they file for) or 403 (the user has no linked employee record); the
 * form showed both as a failed load with an overwrite warning. Now staff pick
 * the employee and file on their behalf, and a user with no record is told so.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("../../../../_components/EmployeePicker", () => ({
  EmployeePicker: ({ id, onChange }: { id?: string; onChange: (id: string | null) => void }) => (
    <input id={id} aria-label="Employee" onChange={(e) => onChange(e.target.value || null)} />
  ),
}));

import { TaxDeclarationForm } from "./TaxDeclarationForm";

const EMP = "d71d4acd-0cbc-41da-a403-b922fe2eb3e8";

function renderForm() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <TaxDeclarationForm />
    </NextIntlClientProvider>,
  );
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("TaxDeclarationForm — staff filing and users with no employee record (UAT L1)", () => {
  it("400 for staff: no failed-load alert; staff pick the employee, then load and file for that employee", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/limits") || u.includes("/window")) return Promise.resolve(new Response("", { status: 500 }));
      if (init?.method === "POST") return Promise.resolve(json({ id: "d1", status: "accepted" }, 202));
      if (u.includes("employeeId=")) return Promise.resolve(new Response("null", { status: 200 }));
      return Promise.resolve(json({ code: "VALIDATION_FAILED", message: "employeeId is required" }, 400));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderForm();

    expect(await screen.findByText(/filing on behalf of an employee/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submit declaration/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Employee"), { target: { value: EMP } });
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes(`employeeId=${EMP}`))).toBe(true));
    await waitFor(() => expect(screen.getByRole("button", { name: /submit declaration/i })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: /submit declaration/i }));
    const confirm = screen.queryAllByRole("button", { name: /submit|confirm/i }).at(-1);
    if (confirm) fireEvent.click(confirm);
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === "POST")).toBe(true));
    const post = fetchMock.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === "POST")!;
    expect(JSON.parse(String((post[1] as RequestInit).body))).toMatchObject({ employeeId: EMP });
  });

  it("403 (no linked employee record): explains it, no failed-load alert, and the form stays read-only", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      const u = String(url);
      if (u.includes("/limits") || u.includes("/window")) return Promise.resolve(new Response("", { status: 500 }));
      return Promise.resolve(json({ code: "FORBIDDEN", message: "no employee record is linked to this user" }, 403));
    }));
    renderForm();
    expect(await screen.findByText(/not linked to an employee record/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submit declaration/i })).toBeDisabled();
  });
});
