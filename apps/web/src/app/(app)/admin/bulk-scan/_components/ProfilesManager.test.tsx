import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { ProfilesManager } from "./ProfilesManager";
import { mapProfiles, mapProviders } from "@/lib/bulkScan/mappers";
import { jsonResponse, renderIntl } from "./testHelpers";

const providers = { data: mapProviders({ data: [{ id: "tesseract", label: "Tesseract (local)", available: true, sandbox: false }] })!, source: "api" as const };
const profile = { id: "p1", name: "Service book (Hindi + English)", description: "old registers", config: { languages: ["hin", "eng"], dpi: 300 }, version: 2, updatedAt: "2026-10-01T10:00:00.000Z" };
const ui = (rows: unknown[], failed = false) => renderIntl(<ProfilesManager
  profiles={{ data: mapProfiles({ data: rows })!, source: failed ? "error" : "api", ...(failed ? { status: 500 } : {}) }} providers={providers}
  docTypes={[{ id: "service_book", label: "Service book" }, { id: "other", label: "Other" }]} allowedTargets={["hr_employee"]}
  tenantSettings={{ reviewThreshold: 0.8, classification: { uncertainMargin: 0.2, minScore: 0.3 }, malwareFailClosed: true, filingMakerChecker: true, providerChain: [{ id: "tesseract" }], bestOf: { enabled: false, threshold: 0.7 } }} />);

describe("ProfilesManager", () => {
  const f = vi.fn();
  beforeEach(() => { f.mockReset(); vi.stubGlobal("fetch", f); });
  afterEach(() => vi.unstubAllGlobals());

  it("lists profiles with what they override; empty and error are distinct", () => {
    const { unmount } = ui([profile]);
    expect(screen.getByText("Service book (Hindi + English)")).toBeInTheDocument();
    expect(screen.getByText("Languages, Resolution")).toBeInTheDocument();
    unmount();
    const e = ui([]);
    expect(screen.getByText("No scan profiles")).toBeInTheDocument();
    e.unmount();
    ui([], true);
    expect(screen.queryByText("No scan profiles")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("validates before sending: name required, DPI range and Indic scripts need 200 dpi", async () => {
    ui([]);
    fireEvent.click(screen.getAllByRole("button", { name: "New profile" })[0]!);
    const dlg = await screen.findByRole("dialog");
    fireEvent.click(within(dlg).getByRole("button", { name: "Save" }));
    expect(await within(dlg).findByText("This is required.")).toBeInTheDocument();
    expect(f).not.toHaveBeenCalled();
    fireEvent.change(within(dlg).getByLabelText(/Profile name/), { target: { value: "Quick" } });
    fireEvent.click(within(dlg).getByLabelText("Override languages"));
    fireEvent.click(within(dlg).getByLabelText("Hindi"));
    fireEvent.click(within(dlg).getByLabelText("Override resolution"));
    fireEvent.change(within(dlg).getByLabelText("Resolution (DPI)"), { target: { value: "150" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Save" }));
    expect(await within(dlg).findByText("Indian scripts need at least 200 DPI.")).toBeInTheDocument();
    expect(f).not.toHaveBeenCalled();
  });

  it("creates a profile with only the overridden settings", async () => {
    f.mockResolvedValue(jsonResponse(202, { id: "x", status: "accepted" }));
    ui([]);
    fireEvent.click(screen.getAllByRole("button", { name: "New profile" })[0]!);
    const dlg = await screen.findByRole("dialog");
    fireEvent.change(within(dlg).getByLabelText(/Profile name/), { target: { value: "Bills" } });
    fireEvent.click(within(dlg).getByLabelText("Override resolution"));
    fireEvent.change(within(dlg).getByLabelText("Resolution (DPI)"), { target: { value: "400" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(f.mock.calls[0]![1].method).toBe("POST");
    expect(JSON.parse(f.mock.calls[0]![1].body)).toEqual({ name: "Bills", config: { dpi: 400 } });
  });

  it("editing sends the loaded version; a version conflict is explained; delete asks first", async () => {
    f.mockResolvedValueOnce(jsonResponse(409, { code: "CONFLICT" }));
    ui([profile]);
    fireEvent.click(screen.getByRole("button", { name: "Edit Service book (Hindi + English)" }));
    const dlg = await screen.findByRole("dialog");
    fireEvent.click(within(dlg).getByRole("button", { name: "Save" }));
    expect(await within(dlg).findByText(/changed by someone else/)).toBeInTheDocument();
    expect(JSON.parse(f.mock.calls[0]![1].body).expectedVersion).toBe(2);
    fireEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
    f.mockResolvedValueOnce(jsonResponse(202, { id: "x", status: "accepted" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Service book (Hindi + English)" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(f).toHaveBeenCalledTimes(1);
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(f).toHaveBeenCalledTimes(2));
    expect(f.mock.calls[1]![1].method).toBe("DELETE");
  });

  it("lowering the review threshold below the office setting is flagged as needing a second approver; raising it applies immediately", async () => {
    ui([]);
    fireEvent.click(screen.getAllByRole("button", { name: "New profile" })[0]!);
    const dlg = await screen.findByRole("dialog");
    fireEvent.click(within(dlg).getByLabelText("Override review threshold"));
    const field = within(dlg).getByLabelText("Review threshold (%)");
    expect(within(dlg).queryByText(/Loosens a control/)).not.toBeInTheDocument();
    fireEvent.change(field, { target: { value: "50" } });
    expect(within(dlg).getByText(/Loosens a control: needs a second approver/)).toBeInTheDocument();
    expect(within(dlg).getByText("This change needs a second approver (a super admin) before it applies.")).toBeInTheDocument();
    expect(within(dlg).getByLabelText(/Reason for this change/)).toBeInTheDocument();
    fireEvent.change(field, { target: { value: "95" } });
    expect(within(dlg).getByText(/Tightens a control: applies immediately/)).toBeInTheDocument();
  });

  it("422 REASON_REQUIRED asks for a reason, keeps what was typed, and the retry carries the reason", async () => {
    f.mockResolvedValueOnce(jsonResponse(422, { code: "REASON_REQUIRED" }));
    ui([profile]);
    fireEvent.click(screen.getByRole("button", { name: "Edit Service book (Hindi + English)" }));
    const dlg = await screen.findByRole("dialog");
    fireEvent.change(within(dlg).getByLabelText("Resolution (DPI)"), { target: { value: "400" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Save" }));
    expect(await within(dlg).findByText("A reason is required for this change.")).toBeInTheDocument();
    const reason = within(dlg).getByLabelText(/Reason for this change/);
    expect(within(dlg).getByLabelText("Resolution (DPI)")).toHaveValue(400);
    f.mockResolvedValueOnce(jsonResponse(202, { id: "x", status: "accepted", requiresApproval: false }));
    fireEvent.change(reason, { target: { value: "scanner change" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(f).toHaveBeenCalledTimes(2));
    expect(JSON.parse(f.mock.calls[1]![1].body)).toMatchObject({ reason: "scanner change", config: { dpi: 400 }, expectedVersion: 2 });
  });

  it("a 202 with requiresApproval true is not shown as applied: it says submitted for approval and links to the pending requests", async () => {
    f.mockResolvedValueOnce(jsonResponse(202, { id: "cr-9", status: "accepted", requiresApproval: true }));
    ui([profile]);
    fireEvent.click(screen.getByRole("button", { name: "Edit Service book (Hindi + English)" }));
    const dlg = await screen.findByRole("dialog");
    fireEvent.click(within(dlg).getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Submitted for second-approver approval/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View pending change requests" })).toHaveAttribute("href", "/admin/bulk-scan/settings");
    expect(screen.queryByText(/^Applied\./)).not.toBeInTheDocument();
  });

  it("deleting a profile that batches still use: the server asks for a reason, which then goes as ?reason=", async () => {
    f.mockResolvedValueOnce(jsonResponse(422, { code: "REASON_REQUIRED" }));
    ui([profile]);
    fireEvent.click(screen.getByRole("button", { name: "Delete Service book (Hindi + English)" }));
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
    expect(await within(confirm).findByText("A reason is required for this change.")).toBeInTheDocument();
    expect(f.mock.calls[0]![0]).not.toContain("reason=");
    f.mockResolvedValueOnce(jsonResponse(202, { id: "cr-3", status: "accepted", requiresApproval: true }));
    const box = within(confirm).getByLabelText(/Reason/);
    fireEvent.change(box, { target: { value: "still referenced" } });
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(f).toHaveBeenCalledTimes(2));
    expect(f.mock.calls[1]![0]).toBe("/api/proxy/v1/documents/bulk-scan/profiles/p1?reason=still%20referenced");
    expect(f.mock.calls[1]![1].method).toBe("DELETE");
    expect(await screen.findByText(/Submitted for second-approver approval/)).toBeInTheDocument();
  });
});
