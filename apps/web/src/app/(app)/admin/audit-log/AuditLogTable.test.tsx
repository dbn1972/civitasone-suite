import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { AuditLogTable, formatActor } from "./AuditLogTable";

const entries = [
  { id: "1", actor: "asha@gov.in", action: "role.granted", resource: "role:auditor", outcome: "success" as const, timestamp: "2026-09-01T10:00:00Z" },
  { id: "2", actor: "system", action: "job.run", resource: "", outcome: "failure" as const, timestamp: "2026-09-01T11:00:00Z" },
];

describe("AuditLogTable", () => {
  // GAP-ADMIN-AUDIT-LOG-05
  it("outcome Segmented filters to failures and All restores", () => {
    render(<AuditLogTable entries={entries} />);
    expect(screen.getByText("role.granted")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Failure" }));
    expect(screen.queryByText("role.granted")).not.toBeInTheDocument();
    expect(screen.getByText("job.run")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "All" }));
    expect(screen.getByText("role.granted")).toBeInTheDocument();
  });

  // GAP-ADMIN-AUDIT-LOG-04
  it("renders the literal 'system' fallback as 'System'", () => {
    render(<AuditLogTable entries={entries} />);
    expect(screen.getByText("System")).toBeInTheDocument();
    expect(formatActor("")).toBe("System");
    // platform-published events carry the uuid system actor, never shown raw
    expect(formatActor("00000000-0000-0000-0000-0000000000c9")).toBe("System");
    expect(formatActor("00000000-0000-0000-0000-0000000000C9")).toBe("System");
    expect(formatActor("asha@gov.in")).toBe("asha@gov.in");
  });

  // GAP-ADMIN-AUDIT-LOG-03
  describe("CSV export", () => {
    let fetchSpy: MockInstance<typeof fetch>;
    beforeEach(() => {
      fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
      URL.createObjectURL = vi.fn(() => "blob:mock");
      URL.revokeObjectURL = vi.fn();
    });
    afterEach(() => vi.restoreAllMocks());

    it("records the export on the audit trail with the row count", () => {
      render(<AuditLogTable entries={entries} />);
      fireEvent.click(screen.getByText("⬇ CSV"));
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(String(fetchSpy.mock.calls[0]![0])).toBe("/api/proxy/v1/admin/audit-logs/export-audit");
      expect(JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ rowCount: 2, filtered: false });
    });

    it("still downloads when the audit call fails", () => {
      fetchSpy.mockRejectedValue(new Error("offline"));
      render(<AuditLogTable entries={entries} />);
      fireEvent.click(screen.getByText("⬇ CSV"));
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    });
  });
});
