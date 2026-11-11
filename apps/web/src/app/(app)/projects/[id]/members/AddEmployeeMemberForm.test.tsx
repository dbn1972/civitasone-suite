import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

import { AddEmployeeMemberForm } from "./AddEmployeeMemberForm";

const EMP = "11111111-1111-4111-8111-111111111111";
const wrap = () => render(<NextIntlClientProvider locale="en" messages={enMessages}><AddEmployeeMemberForm projectId="p1" /></NextIntlClientProvider>);

function stubFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/hrms/employees")) return Promise.resolve(new Response(JSON.stringify({ data: [{ id: EMP, name: "Asha Rao", employeeNo: "C-101" }] }), { status: 200 }));
    return Promise.resolve(new Response(JSON.stringify({ id: "m1", status: "accepted" }), { status: 202 }));
  });
}

describe("AddEmployeeMemberForm (employee with no login)", () => {
  beforeEach(() => { vi.restoreAllMocks(); refreshMock.mockReset(); });

  it("never offers the project manager role: a member without a login cannot be one", () => {
    wrap();
    const options = Array.from((screen.getByLabelText("Role") as HTMLSelectElement).options).map((o) => o.value);
    expect(options).not.toContain("project_manager");
    expect(screen.getByText(/does not need a login/)).toBeInTheDocument();
  });

  it("blocks submit until an employee is selected", () => {
    const f = stubFetch();
    wrap();
    fireEvent.click(screen.getByRole("button", { name: "Add employee" }));
    expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" ")).toContain("Search for and select an employee.");
    expect(f).not.toHaveBeenCalled();
  });

  it("POSTs { employeeId, role } - no userId", async () => {
    const f = stubFetch();
    wrap();
    const combo = screen.getByRole("combobox", { name: /employee/i });
    fireEvent.focus(combo);
    fireEvent.change(combo, { target: { value: "Asha" } });
    fireEvent.mouseDown(await screen.findByText(/Asha Rao/));
    fireEvent.click(screen.getByRole("button", { name: "Add employee" }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const post = f.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST")!;
    expect(String(post[0])).toContain("/projects/p1/members");
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({ employeeId: EMP, role: "engineer" });
  });
});
