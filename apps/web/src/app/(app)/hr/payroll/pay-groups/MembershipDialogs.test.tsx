import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));
// The real picker does a server-side search; the dialog only needs the id it reports.
vi.mock("../../../../_components/EmployeePicker", () => ({
  EmployeePicker: ({ onChange }: { onChange: (id: string | null, o: null) => void }) => (
    <button type="button" onClick={() => onChange("emp-1", null)}>Pick employee</button>
  ),
}));

import { AssignEmployeeButton, BulkAssignButton, ChangeGroupButton, EndMembershipButton } from "./MembershipDialogs";

function withIntl(ui: React.ReactNode) {
  return <NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>;
}

const REASON = "Posted to the new office";
const GROUPS = [
  { id: "g1", name: "Monthly Staff" },
  { id: "g2", name: "Contract Staff" },
];

function accepted(data: unknown = {}) {
  return new Response(JSON.stringify({ id: "x", status: "accepted", correlationId: "c", data }), { status: 202 });
}
function failure(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function lastCall(spy: { mock: { calls: unknown[][] } }) {
  const [url, init] = spy.mock.calls[0] as [string, RequestInit];
  return { url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) };
}
function typeReason(text = REASON) {
  fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: text } });
}

describe("AssignEmployeeButton", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("assigns the picked employee with the date, reason and an idempotency key", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(accepted({ action: "assign" }));
    render(withIntl(<AssignEmployeeButton payGroupId="g1" payGroupName="Monthly Staff" defaultDate="2026-11-01" />));
    fireEvent.click(screen.getByRole("button", { name: "Assign employee" }));
    expect((screen.getByLabelText(/^Effective from/) as HTMLInputElement).value).toBe("2026-11-01");

    // Confirm stays disabled until an employee is picked and the reason is long enough.
    expect(screen.getByRole("button", { name: "Assign" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Pick employee" }));
    typeReason("too short");
    expect(screen.getByRole("button", { name: "Assign" })).toBeDisabled();
    typeReason();
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));

    await waitFor(() => expect(screen.getByText("Employee assigned. The list updates shortly.")).toBeInTheDocument());
    const call = lastCall(spy);
    expect(call.url).toBe("/api/proxy/v1/payroll/pay-groups/g1/members");
    expect(call.body).toEqual({ employeeId: "emp-1", effectiveFrom: "2026-11-01", reason: REASON });
    expect(call.headers["x-idempotency-key"]).toBeTruthy();
    expect(refreshMock).toHaveBeenCalled();
  });

  it("says the employee was moved when the server reports a move", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(accepted({ action: "move" }));
    render(withIntl(<AssignEmployeeButton payGroupId="g1" payGroupName="Monthly Staff" defaultDate="2026-11-01" />));
    fireEvent.click(screen.getByRole("button", { name: "Assign employee" }));
    fireEvent.click(screen.getByRole("button", { name: "Pick employee" }));
    typeReason();
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    expect(await screen.findByText("Employee moved. The list updates shortly.")).toBeInTheDocument();
  });

  it("shows a friendly sentence, never the raw code, for a 409 / 400", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(failure(409, { code: "ALREADY_MEMBER", message: "ALREADY_MEMBER: raw" }));
    render(withIntl(<AssignEmployeeButton payGroupId="g1" payGroupName="Monthly Staff" defaultDate="2026-11-01" />));
    fireEvent.click(screen.getByRole("button", { name: "Assign employee" }));
    fireEvent.click(screen.getByRole("button", { name: "Pick employee" }));
    typeReason();
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("already a member");
    expect(alert.textContent).not.toMatch(/ALREADY_MEMBER/);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("maps EFFECTIVE_DATE_NOT_MONTH_START to guidance", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(failure(400, { code: "EFFECTIVE_DATE_NOT_MONTH_START", message: "x" }));
    render(withIntl(<AssignEmployeeButton payGroupId="g1" payGroupName="Monthly Staff" defaultDate="2026-11-01" />));
    fireEvent.click(screen.getByRole("button", { name: "Assign employee" }));
    fireEvent.click(screen.getByRole("button", { name: "Pick employee" }));
    fireEvent.change(screen.getByLabelText(/^Effective from/), { target: { value: "2026-11-15" } });
    typeReason();
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    expect((await screen.findByRole("alert")).textContent).toContain("1st of a month");
  });
});

describe("ChangeGroupButton", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("moves the employee by posting to the TARGET group, excluding the current one from the choices", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(accepted({ action: "move" }));
    render(withIntl(
      <ChangeGroupButton mode="move" currentGroupId="g1" employeeId="emp-9" employeeName="Asha Rao" groups={GROUPS} defaultDate="2026-11-01" />,
    ));
    fireEvent.click(screen.getByRole("button", { name: "Move Asha Rao to another pay group" }));
    const select = screen.getByLabelText(/^Pay group/) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["Select a pay group", "Contract Staff"]);
    expect(screen.getByRole("button", { name: "Move" })).toBeDisabled();
    fireEvent.change(select, { target: { value: "g2" } });
    typeReason();
    fireEvent.click(screen.getByRole("button", { name: "Move" }));

    await waitFor(() => expect(screen.getByText("Employee moved. The list updates shortly.")).toBeInTheDocument());
    const call = lastCall(spy);
    expect(call.url).toBe("/api/proxy/v1/payroll/pay-groups/g2/members");
    expect(call.body).toEqual({ employeeId: "emp-9", effectiveFrom: "2026-11-01", reason: REASON });
  });

  it("assigns an unassigned employee to a chosen group (assign mode)", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(accepted({ action: "assign" }));
    render(withIntl(
      <ChangeGroupButton mode="assign" employeeId="emp-3" employeeName="Ravi Kumar" groups={GROUPS} defaultDate="2026-10-01" />,
    ));
    fireEvent.click(screen.getByRole("button", { name: "Assign Ravi Kumar to a pay group" }));
    fireEvent.change(screen.getByLabelText(/^Pay group/), { target: { value: "g1" } });
    typeReason();
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(lastCall(spy).url).toBe("/api/proxy/v1/payroll/pay-groups/g1/members");
  });
});

describe("EndMembershipButton", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("ends the membership with endsOn and a reason", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(accepted());
    render(withIntl(<EndMembershipButton payGroupId="g1" employeeId="emp-9" employeeName="Asha Rao" defaultDate="2026-12-01" />));
    fireEvent.click(screen.getByRole("button", { name: "End membership of Asha Rao" }));
    typeReason("Retired from service");
    fireEvent.click(screen.getByRole("button", { name: "End membership" }));
    await waitFor(() => expect(screen.getByText("Membership ended. The list updates shortly.")).toBeInTheDocument());
    const call = lastCall(spy);
    expect(call.url).toBe("/api/proxy/v1/payroll/pay-groups/g1/members/emp-9/end");
    expect(call.body).toEqual({ endsOn: "2026-12-01", reason: "Retired from service" });
  });

  it("explains NOT_A_MEMBER", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(failure(409, { code: "NOT_A_MEMBER", message: "x" }));
    render(withIntl(<EndMembershipButton payGroupId="g1" employeeId="emp-9" employeeName="Asha Rao" defaultDate="2026-12-01" />));
    fireEvent.click(screen.getByRole("button", { name: "End membership of Asha Rao" }));
    typeReason("Retired from service");
    fireEvent.click(screen.getByRole("button", { name: "End membership" }));
    expect((await screen.findByRole("alert")).textContent).toContain("not a member");
  });
});

describe("BulkAssignButton", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  function open() {
    render(withIntl(<BulkAssignButton groups={GROUPS} fixedGroupId="g1" defaultDate="2026-11-01" />));
    fireEvent.click(screen.getByRole("button", { name: "Bulk assign" }));
  }

  it("parses pasted CSV rows, submits them and renders accepted and per-row rejections", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      accepted({
        batchId: "b1",
        accepted: 2,
        rejected: [{ row: 2, employeeNo: "E-3", code: "EMPLOYEE_NOT_FOUND", message: "raw server text" }],
      }),
    );
    open();
    fireEvent.change(screen.getByLabelText(/^Employee numbers/), { target: { value: "name,employeeNo\nAsha,E-1\nRavi,E-2\nMeena,E-3\nAsha,E-1" } });
    expect(screen.getByText(/3 employee numbers ready\. 1 duplicate ignored\./)).toBeInTheDocument();
    typeReason("Annual cadre onboarding");
    fireEvent.click(screen.getByRole("button", { name: "Assign employees" }));

    await screen.findByText("2 employees accepted");
    expect(screen.getByText("1 row rejected")).toBeInTheDocument();
    expect(screen.getByText("E-3")).toBeInTheDocument();
    expect(screen.getByText("No employee with this number.")).toBeInTheDocument();
    expect(screen.queryByText(/raw server text/)).not.toBeInTheDocument();
    const call = lastCall(spy);
    expect(call.url).toBe("/api/proxy/v1/payroll/pay-groups/g1/members/bulk");
    expect(call.body).toEqual({
      effectiveFrom: "2026-11-01",
      reason: "Annual cadre onboarding",
      rows: [{ employeeNo: "E-1" }, { employeeNo: "E-2" }, { employeeNo: "E-3" }],
    });
  });

  it("shows the per-row reasons when the server answers 422 BULK_NOTHING_TO_ASSIGN", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      failure(422, {
        code: "BULK_NOTHING_TO_ASSIGN",
        message: "nothing",
        details: { rejected: [{ row: 0, employeeNo: "E-9", code: "ALREADY_MEMBER", message: "x" }] },
      }),
    );
    open();
    fireEvent.change(screen.getByLabelText(/^Employee numbers/), { target: { value: "E-9" } });
    typeReason("Annual cadre onboarding");
    fireEvent.click(screen.getByRole("button", { name: "Assign employees" }));
    expect(await screen.findByText("No employee could be assigned.")).toBeInTheDocument();
    expect(screen.getByText("Already a member of this pay group.")).toBeInTheDocument();
  });

  it("keeps Confirm disabled with no rows, and blocks more than 500", () => {
    open();
    typeReason("Annual cadre onboarding");
    expect(screen.getByRole("button", { name: "Assign employees" })).toBeDisabled();
    const many = Array.from({ length: 501 }, (_, i) => `E${i}`).join("\n");
    fireEvent.change(screen.getByLabelText(/^Employee numbers/), { target: { value: many } });
    expect(screen.getByText(/At most 500 employees/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Assign employees" })).toBeDisabled();
  });

  it("pre-fills the list from the unassigned report and requires a group when none is fixed", () => {
    render(withIntl(<BulkAssignButton groups={GROUPS} initialEmployeeNos={["E-1", "E-2"]} defaultDate="2026-10-01" />));
    fireEvent.click(screen.getByRole("button", { name: "Bulk assign" }));
    expect((screen.getByLabelText(/^Employee numbers/) as HTMLTextAreaElement).value).toBe("E-1\nE-2");
    typeReason("Annual cadre onboarding");
    expect(screen.getByRole("button", { name: "Assign employees" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Pay group/), { target: { value: "g2" } });
    expect(screen.getByRole("button", { name: "Assign employees" })).toBeEnabled();
  });
});
