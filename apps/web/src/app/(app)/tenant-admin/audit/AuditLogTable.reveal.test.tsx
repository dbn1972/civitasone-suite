import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { render } from "@/test-utils/intl-render";
const downloadCsvFile = vi.hoisted(() => vi.fn());
vi.mock("@/lib/export/csvExport", async (orig) => ({
  ...(await orig<typeof import("@/lib/export/csvExport")>()),
  downloadCsvFile,
  tableExportGuard: () => async () => ({ ok: true as const }),
}));

import { AuditLogTable, type AuditEvent } from "./AuditLogTable";

// The server (owner decision #20) already masks the list, so the table receives masked values.
const ev = (o: Partial<AuditEvent> = {}): AuditEvent => ({
  id: "e1", timestamp: "2026-01-15T19:00:00.000Z", actor: "a***@dept.gov.in", ipAddress: "10.1.*.*",
  action: "user.update", resource: "user:1", outcome: "success", ...o,
});

async function revealWith(reason: string) {
  fireEvent.click(screen.getByRole("button", { name: /Reveal actor and IP for user.update/ }));
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.change(within(dialog).getByLabelText(/Reason/i), { target: { value: reason } });
  fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Reveal") as HTMLButtonElement);
  return dialog;
}

describe("AuditLogTable reveal (owner decision #20)", () => {
  beforeEach(() => { vi.restoreAllMocks(); downloadCsvFile.mockClear(); });

  it("a viewer who may not reveal sees no reveal control and the server-masked values as-is", () => {
    render(<AuditLogTable events={[ev()]} />);
    expect(screen.queryByRole("button", { name: /Reveal/ })).toBeNull();
    expect(screen.getByText("a***@dept.gov.in")).toBeInTheDocument();
    expect(screen.getByText("10.1.*.*")).toBeInTheDocument();
  });

  it("the audit officer needs a reason of 10+ characters, posts once to the reveal route and then sees the clear values", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "e1", actor: "asha@dept.gov.in", ipAddress: "10.1.2.3" }), { status: 200 }));
    render(<AuditLogTable events={[ev()]} canReveal />);
    fireEvent.click(screen.getByRole("button", { name: /Reveal actor and IP/ }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Reveal") as HTMLButtonElement;
    fireEvent.change(within(dialog).getByLabelText(/Reason/i), { target: { value: "too short" } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Reason/i), { target: { value: "Investigating export on 20 Oct" } });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.getByText("asha@dept.gov.in")).toBeInTheDocument());
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/audit/events/e1/reveal");
    expect(JSON.parse(String(init.body))).toEqual({ reason: "Investigating export on 20 Oct" });
    expect(screen.getByText("10.1.2.3")).toBeInTheDocument();
    // Hiding returns to the masked values.
    fireEvent.click(screen.getByRole("button", { name: /Hide actor and IP/ }));
    expect(screen.queryByText("asha@dept.gov.in")).toBeNull();
    expect(screen.getByText("a***@dept.gov.in")).toBeInTheDocument();
  });

  it("a refused reveal shows a plain-language error and keeps the values masked", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "FORBIDDEN", message: "requires one of: audit_officer" }), { status: 403 }));
    render(<AuditLogTable events={[ev()]} canReveal />);
    const dialog = await revealWith("Investigating export on 20 Oct");
    await waitFor(() => expect(dialog.textContent).toMatch(/permission|not allowed|can.t|cannot/i));
    expect(dialog.textContent).not.toContain("requires one of");
    expect(screen.queryByText("asha@dept.gov.in")).toBeNull();
  });

  it("a revealed value never reaches the CSV export", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "e1", actor: "asha@dept.gov.in", ipAddress: "10.1.2.3" }), { status: 200 }));
    render(<AuditLogTable events={[ev()]} canReveal />);
    await revealWith("Investigating export on 20 Oct");
    await waitFor(() => expect(screen.getByText("asha@dept.gov.in")).toBeInTheDocument());
    fireEvent.click(screen.getByTitle(/recorded in the audit log/i));
    await waitFor(() => expect(downloadCsvFile).toHaveBeenCalledTimes(1));
    expect(downloadCsvFile.mock.calls[0]![1] as string).not.toContain("asha@dept.gov.in");
  });
});
