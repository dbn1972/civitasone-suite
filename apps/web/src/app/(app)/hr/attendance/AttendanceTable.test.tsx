import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { AttendanceTable } from "./AttendanceTable";
import type { AttendanceSummaryItem } from "@civitasone/types";

const ROW: AttendanceSummaryItem = {
  id: "a1",
  employeeId: "e1",
  employeeName: "Test Employee",
  department: "Engineering",
  date: "2026-09-01",
  checkIn: "09:30:00",
  checkOut: "18:00:00",
  status: "on_leave",
  hoursWorked: 8.5,
};

function renderTable(props: Partial<React.ComponentProps<typeof AttendanceTable>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AttendanceTable attendance={[]} source="api" {...props} />
    </NextIntlClientProvider>,
  );
}

describe("AttendanceTable — GAP-HR-ATTENDANCE-06 (status label)", () => {
  it("shows a humanized status label instead of the raw lowercase enum", () => {
    renderTable({ attendance: [ROW] });
    // "on_leave" must render as "On Leave" (StatusPill's own humanizeStatus
    // fallback), not the raw "on leave" the old explicit `label` prop forced.
    expect(screen.getByText("On Leave")).toBeInTheDocument();
    expect(screen.queryByText("on leave")).not.toBeInTheDocument();
  });
});

describe("AttendanceTable — GAP-HR-ATTENDANCE-04 (empty-state CTA)", () => {
  it("shows no configure/rules link for a role that can't open the target page", () => {
    renderTable({ attendance: [], canConfigure: false });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows the (relabeled) rules link only for a role that can actually open it", () => {
    renderTable({ attendance: [], canConfigure: true });
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/hr/attendance/config");
    // Must no longer promise an action the target page can't perform.
    expect(link).not.toHaveTextContent(/configure/i);
  });
});
