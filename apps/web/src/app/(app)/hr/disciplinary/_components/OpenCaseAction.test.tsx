import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const browserFetch = vi.fn();
vi.mock("@/lib/api/browserClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/browserClient")>("@/lib/api/browserClient");
  return { ...actual, browserFetch: (...a: unknown[]) => browserFetch(...a) };
});

// The real picker searches GET /v1/hrms/employees; a plain input stands in for it.
vi.mock("@/app/_components/EmployeePicker", () => ({
  EmployeePicker: ({ id, onChange }: { id?: string; onChange: (id: string | null) => void }) => (
    <input id={id} aria-label="Employee" onChange={(e) => onChange(e.target.value || null)} />
  ),
}));

import { OpenCaseAction, buildOpenCaseBody } from "./OpenCaseAction";

const EMP = "d71d4acd-0cbc-41da-a403-b922fe2eb3e8";

beforeEach(() => { browserFetch.mockReset(); refresh.mockClear(); });

function renderIt() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <OpenCaseAction />
    </NextIntlClientProvider>,
  );
}

function fill() {
  fireEvent.change(screen.getByLabelText("Employee"), { target: { value: EMP } });
  fireEvent.change(screen.getByLabelText(/case number/i), { target: { value: " DC/2026/K1 " } });
  fireEvent.change(screen.getByLabelText(/proceeding/i), { target: { value: "minor" } });
  fireEvent.change(screen.getByLabelText(/allegation/i), { target: { value: "Unauthorised absence" } });
}

describe("OpenCaseAction (UAT J11 / D7)", () => {
  it("opens a case through POST /v1/hrms/employees/:id/disciplinary-cases and links to it", async () => {
    browserFetch.mockResolvedValue(new Response(JSON.stringify({ id: "case-9", employeeId: EMP, status: "opened", caseNo: "DC/2026/K1" }), { status: 201 }));
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: /open case/i }));
    const confirm = () => screen.getAllByRole("button", { name: /open case/i }).at(-1)!;
    expect(confirm()).toBeDisabled();
    fill();
    expect(confirm()).toBeEnabled();
    fireEvent.click(confirm());
    await waitFor(() => expect(browserFetch).toHaveBeenCalledTimes(1));
    const [path, init] = browserFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`v1/hrms/employees/${EMP}/disciplinary-cases`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ caseNo: "DC/2026/K1", proceedingType: "minor", allegation: "Unauthorised absence" });
    expect(await screen.findByRole("status")).toHaveTextContent(/DC\/2026\/K1/);
    expect(screen.getByRole("link", { name: /open the case/i })).toHaveAttribute("href", "/hr/disciplinary/case-9");
    expect(refresh).toHaveBeenCalled();
  });

  it("shows a readable error and keeps the dialog open when the employee is not found", async () => {
    browserFetch.mockResolvedValue(new Response(JSON.stringify({ code: "NOT_FOUND" }), { status: 404, headers: { "content-type": "application/json" } }));
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: /open case/i }));
    fill();
    fireEvent.click(screen.getAllByRole("button", { name: /open case/i }).at(-1)!);
    expect(await screen.findByText(/employee record was not found/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /open the case/i })).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("buildOpenCaseBody", () => {
  const ok = { employeeId: EMP, caseNo: "C1", proceedingType: "major", allegation: "x" };
  it("requires an employee, a case number, an allegation and a known proceeding type", () => {
    expect(buildOpenCaseBody(ok)).toEqual({ caseNo: "C1", proceedingType: "major", allegation: "x" });
    expect(buildOpenCaseBody({ ...ok, employeeId: null })).toBeNull();
    expect(buildOpenCaseBody({ ...ok, caseNo: "  " })).toBeNull();
    expect(buildOpenCaseBody({ ...ok, caseNo: "x".repeat(49) })).toBeNull();
    expect(buildOpenCaseBody({ ...ok, allegation: "" })).toBeNull();
    expect(buildOpenCaseBody({ ...ok, proceedingType: "other" })).toBeNull();
  });
});
