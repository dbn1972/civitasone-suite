import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { employeeLabel } from "./statutory/_lib/employeeLabel";
import { employeeDisplayLabel } from "@/app/_data/employeeNames";
import { MembersTable } from "./pay-groups/MembersTable";
import { ExceptionPanel } from "./[id]/ExceptionPanel";
import { PendingCorrections } from "./corrections/PendingCorrections";
import type { MemberRow } from "./pay-groups/payGroupMembership";

const UUID = "3f2a9c1e-5b7d-4c8e-9a10-0123456789ab";

function renderEn(ui: ReactElement) {
  return render(ui, {
    wrapper: ({ children }) => (
      <NextIntlClientProvider locale="en" messages={enMessages}>{children}</NextIntlClientProvider>
    ),
  });
}

/** SF-17b: a screen never shows an id (or an 8-hex fragment of one) where a person's name belongs. */
describe("SF-17b unknown-employee fallback", () => {
  it("employeeLabel: name, then HR code, then the supplied Unknown label; never an id", () => {
    expect(employeeLabel("Asha Rao", null, "Unknown employee")).toBe("Asha Rao");
    expect(employeeLabel(null, "EMP-7", "Unknown employee")).toBe("EMP-7");
    expect(employeeLabel("  ", "", "Unknown employee")).toBe("Unknown employee");
    expect(employeeLabel(undefined, undefined, "Unknown employee")).toBe("Unknown employee");
  });

  it("employeeDisplayLabel: an unresolved id is exactly the unknown label, no id fragment", () => {
    const names = new Map([["a", { name: "Asha Rao", employeeNo: "E1" }]]);
    expect(employeeDisplayLabel(names, "a", "Unknown employee")).toBe("Asha Rao (E1)");
    expect(employeeDisplayLabel(names, UUID, "Unknown employee")).toBe("Unknown employee");
    expect(employeeDisplayLabel(names, null, "Unknown employee")).toBe("—");
  });

  it("pay-group MembersTable: an unresolved member reads 'Unknown employee', not blank or an id", () => {
    const row: MemberRow = {
      assignmentId: "as-1", employeeId: UUID, employeeNo: "E-9", fullName: null, departmentName: null,
      effectiveFrom: "2026-04-01", effectiveTo: null, status: "current", reason: null,
    } as MemberRow;
    renderEn(<MembersTable rows={[row]} payGroupId="g1" groups={[]} canAdminister={false} defaultDate="2026-04-01" />);
    expect(screen.getByText("Unknown employee")).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(UUID.slice(0, 8)))).not.toBeInTheDocument();
  });

  it("ExceptionPanel: a blank employee name reads 'Unknown employee'", () => {
    renderEn(<ExceptionPanel exceptions={[{ employeeId: UUID, employeeName: "", issue: "Bank account missing." }]} />);
    expect(screen.getByText("Unknown employee")).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(UUID.slice(0, 8)))).not.toBeInTheDocument();
  });

  it("PendingCorrections: shows the resolved name, and 'Unknown employee' (never the id) without one", () => {
    const base = {
      id: "c1", employee_id: UUID, component: "BASIC", effective_from: "2026-04-01",
      old_value_minor: 100, new_value_minor: 200, arrears_minor: 100, reason: null,
    };
    renderEn(<PendingCorrections rows={[{ ...base, employee_label: "Asha Rao (EMP-1)" }, { ...base, id: "c2" }]} />);
    expect(screen.getByText("Employee Asha Rao (EMP-1)")).toBeInTheDocument();
    expect(screen.getByText("Employee Unknown employee")).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(UUID.slice(0, 8)))).not.toBeInTheDocument();
  });

  it("the fallback string exists in both English and Hindi", () => {
    expect(enMessages.employeeFallback.unknownEmployee).toBe("Unknown employee");
    expect(hiMessages.employeeFallback.unknownEmployee).toBeTruthy();
    expect(hiMessages.employeeFallback.unknownEmployee).not.toBe(enMessages.employeeFallback.unknownEmployee);
  });
});
