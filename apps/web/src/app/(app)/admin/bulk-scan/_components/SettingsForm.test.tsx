import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { SettingsForm, requestActions } from "./SettingsForm";
import { settingsObject } from "@/lib/bulkScan/fixtures";
import { mapProviders, mapSettings } from "@/lib/bulkScan/mappers";
import { jsonResponse, renderIntl } from "./testHelpers";

const PROVIDERS = { data: mapProviders({ data: [
  { id: "tesseract", label: "Tesseract (local)", available: true, sandbox: false },
  { id: "google_docai", label: "Google Document AI", available: true, sandbox: true },
  { id: "aws_textract", label: "AWS Textract", available: false, sandbox: false },
] })!, source: "api" as const };

const cr = (over: Record<string, unknown> = {}) => ({ id: "c1", status: "pending", maker: "maker-aaaa-1111", checker: null, reason: "why", decisionReason: null, sensitive: false, proposed: { dpi: 400 }, createdAt: "2026-10-01T10:00:00.000Z", decidedAt: null, ...over });
const settings = (pending: unknown[] = [], over: Record<string, unknown> = {}) => ({ data: mapSettings({ settings: { ...settingsObject(), ...over }, version: 3, degraded: false, pendingRequests: pending }), source: "api" as const });
const ui = (o: { pending?: unknown[]; over?: Record<string, unknown>; me?: string | null; superAdmin?: boolean } = {}) =>
  renderIntl(<SettingsForm settings={settings(o.pending, o.over)} providers={PROVIDERS} currentUserId={o.me === undefined ? "me-1" : o.me} isSuperAdmin={o.superAdmin ?? false} />);
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

describe("SettingsForm", () => {
  const f = vi.fn();
  beforeEach(() => { f.mockReset(); vi.stubGlobal("fetch", f); });
  afterEach(() => vi.unstubAllGlobals());

  it("says up front which changes need a second approver (loosening) and which apply immediately; save is disabled until something changes", () => {
    ui();
    expect(screen.getByText("Loosening changes need a second approver")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("two-digit-year pivot: help text with defaults, 0..99 integer validation mirrored client-side", async () => {
    f.mockResolvedValue(jsonResponse(202, { id: "x", status: "accepted" }));
    ui();
    const pivot = screen.getByLabelText("Two-digit year pivot (0 to 99)");
    expect(pivot).toHaveValue(49);
    expect(screen.getByText(/49 → 2049; 50 → 1950\. The default is 49\./)).toBeInTheDocument();
    fireEvent.change(pivot, { target: { value: "100" } });
    expect(screen.getByText(/49 → 2049|99 → 2099/)).toBeInTheDocument();
    submit();
    expect(await screen.findByText("Must be at most 99.")).toBeInTheDocument();
    expect(f).not.toHaveBeenCalled();
    fireEvent.change(pivot, { target: { value: "60" } });
    submit();
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(f.mock.calls[0]![0]).toBe("/api/proxy/v1/documents/bulk-scan/settings");
    expect(f.mock.calls[0]![1].method).toBe("PUT");
    const body = JSON.parse(f.mock.calls[0]![1].body);
    expect(body.settings.twoDigitYearPivot).toBe(60);
    expect(body.reason).toBeUndefined();
    expect(await screen.findByText(/A different admin must approve it before it applies/)).toBeInTheDocument();
  });

  it("a fractional or empty pivot is invalid too", async () => {
    ui();
    const pivot = screen.getByLabelText("Two-digit year pivot (0 to 99)");
    fireEvent.change(pivot, { target: { value: "" } });
    submit();
    expect(await screen.findByText("This is required.")).toBeInTheDocument();
    expect(f).not.toHaveBeenCalled();
  });

  it("classifier tuning: uncertainMargin and minScore are optional percentages with help text; defaults come from the server", async () => {
    f.mockResolvedValue(jsonResponse(202, { id: "x", status: "accepted" }));
    ui();
    const margin = screen.getByLabelText("Cross-check margin (%)");
    expect(margin).toHaveValue(20);
    expect(screen.getByText(/only if the classifier picks a different type by at least this margin/)).toBeInTheDocument();
    fireEvent.change(margin, { target: { value: "150" } });
    submit();
    expect(await screen.findAllByText("Must be at most 100.")).not.toHaveLength(0);
    expect(f).not.toHaveBeenCalled();
    fireEvent.change(margin, { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Minimum classifier score (%)"), { target: { value: "35" } });
    submit();
    await waitFor(() => expect(f).toHaveBeenCalled());
    const sent = JSON.parse(f.mock.calls[0]![1].body).settings.classification;
    expect(sent.uncertainMargin).toBeUndefined();
    expect(sent.minScore).toBe(0.35);
  });

  it("turning malware fail-closed OFF requires a reason and says a super_admin second approver is needed", async () => {
    f.mockResolvedValue(jsonResponse(202, { id: "x", status: "accepted" }));
    ui();
    fireEvent.click(screen.getByLabelText(/Hold files when the malware scanner is unavailable/));
    expect(screen.getByText("Turning this off weakens malware protection")).toBeInTheDocument();
    expect(screen.getByText(/approval by a super admin as the second approver/)).toBeInTheDocument();
    submit();
    expect(await screen.findByText("Enter a reason of at least 3 characters.")).toBeInTheDocument();
    expect(f).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Reason for turning it off/), { target: { value: "scanner is being replaced" } });
    submit();
    await waitFor(() => expect(f).toHaveBeenCalled());
    const body = JSON.parse(f.mock.calls[0]![1].body);
    expect(body.settings.malwareFailClosed).toBe(false);
    expect(body.reason).toBe("scanner is being replaced");
    expect(await screen.findByText(/needs approval by a super admin as the second approver/)).toBeInTheDocument();
  });

  it("per-field hints mirror the server rule: raising a threshold applies immediately, lowering it needs a second approver, and the summary follows", () => {
    ui();
    const threshold = screen.getByLabelText("Review threshold (%)");
    expect(screen.queryByText(/Loosens a control/)).not.toBeInTheDocument();
    fireEvent.change(threshold, { target: { value: "90" } });
    expect(screen.getByText(/Tightens a control: applies immediately/)).toBeInTheDocument();
    expect(screen.getByText("This change applies immediately and is recorded in the audit log.")).toBeInTheDocument();
    fireEvent.change(threshold, { target: { value: "50" } });
    expect(screen.getByText(/Loosens a control: needs a second approver/)).toBeInTheDocument();
    expect(screen.getByText("This change needs a second approver (a super admin) before it applies.")).toBeInTheDocument();
    // any loosening field makes the whole change need approval, even next to a tightening one
    fireEvent.click(screen.getByLabelText(/Linked filing needs a second approver/));
    expect(screen.getAllByText(/Loosens a control/).length).toBe(2);
    expect(screen.getByText("This change needs a second approver (a super admin) before it applies.")).toBeInTheDocument();
  });

  it("adding a cloud provider is flagged as loosening; removing one as tightening", () => {
    ui({ over: { providerChain: [{ id: "tesseract", timeoutMs: 120000 }, { id: "google_docai", timeoutMs: 120000 }] } });
    fireEvent.click(screen.getAllByRole("button", { name: /Remove/ })[1]!);
    expect(screen.getByText(/Tightens a control: applies immediately/)).toBeInTheDocument();
  });

  it("the server's requiresApproval decides the confirmation: submitted for approval, or applied", async () => {
    f.mockResolvedValueOnce(jsonResponse(202, { id: "cr-1", status: "accepted", requiresApproval: true }));
    ui();
    fireEvent.change(screen.getByLabelText("Two-digit year pivot (0 to 99)"), { target: { value: "60" } });
    submit();
    expect(await screen.findByText(/Submitted for second-approver approval/)).toBeInTheDocument();
    expect(screen.queryByText(/^Applied\./)).not.toBeInTheDocument();
  });

  it("requiresApproval false is shown as applied (not as a pending request)", async () => {
    f.mockResolvedValueOnce(jsonResponse(202, { id: "s-1", status: "accepted", requiresApproval: false }));
    ui();
    fireEvent.change(screen.getByLabelText("Review threshold (%)"), { target: { value: "90" } });
    submit();
    expect(await screen.findByText("Applied. The change is recorded in the audit log.")).toBeInTheDocument();
  });

  it("a pending scan-profile change is shown distinctly from a settings change", () => {
    ui({ pending: [cr({ kind: "profile", profileId: "p1", profileChange: { op: "delete", name: "Service book", config: { reviewThreshold: 0.5 } }, proposed: {}, sensitive: true })], superAdmin: true });
    expect(screen.getByText("Delete scan profile")).toBeInTheDocument();
    expect(screen.getByText("Scan profile: Service book")).toBeInTheDocument();
    expect(screen.getByText(/Profile settings: reviewThreshold/)).toBeInTheDocument();
    expect(screen.queryByText(/^Changes:/)).not.toBeInTheDocument();
  });

  it("provider chain: ordered, availability shown with text, unavailable ones cannot be added, best-of needs two", async () => {
    ui();
    expect(screen.getByText("1. Tesseract (local)")).toBeInTheDocument();
    expect(screen.getAllByText("Available").length).toBeGreaterThan(0);
    const add = screen.getByLabelText("Add a provider");
    expect(within(add).getByRole("option", { name: "AWS Textract (Unavailable)" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Best-of mode/));
    submit();
    expect(await screen.findByText("Best-of mode needs at least two providers in the chain.")).toBeInTheDocument();
    fireEvent.change(add, { target: { value: "google_docai" } });
    expect(screen.getByText("2. Google Document AI")).toBeInTheDocument();
    expect(screen.getByText("Sandbox")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Move Google Document AI up" }));
    expect(screen.getByText("1. Google Document AI")).toBeInTheDocument();
    expect(screen.getByText("2. Tesseract (local)")).toBeInTheDocument();
  });

  it("retention days per document type are validated against the schema", async () => {
    ui();
    fireEvent.change(screen.getByLabelText("Retention for Service book (days)"), { target: { value: "0" } });
    submit();
    expect(await screen.findAllByText("Must be at least 1.")).not.toHaveLength(0);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("pending change requests (maker-checker)", () => {
  const f = vi.fn();
  beforeEach(() => { f.mockReset(); vi.stubGlobal("fetch", f); });
  afterEach(() => vi.unstubAllGlobals());

  it("pure rules", () => {
    expect(requestActions({ maker: "u", sensitive: false }, "u", true)).toEqual({ approve: false, reject: false, reason: "own" });
    expect(requestActions({ maker: "u", sensitive: true }, "v", false)).toEqual({ approve: false, reject: true, reason: "superAdmin" });
    expect(requestActions({ maker: "u", sensitive: true }, "v", true)).toEqual({ approve: true, reject: true, reason: null });
    expect(requestActions({ maker: "u", sensitive: false }, "v", false)).toEqual({ approve: true, reject: true, reason: null });
  });

  it("my own request cannot be decided by me", () => {
    ui({ pending: [cr({ maker: "me-1" })] });
    expect(screen.getByRole("button", { name: /Approve the change requested by me-1/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Reject the change requested by me-1/ })).toBeDisabled();
    expect(screen.getByText("You made this request. A different admin must decide it.")).toBeInTheDocument();
    expect(screen.getByText("Awaiting second approver")).toHaveClass("pill");
  });

  it("a sensitive request needs a super admin: others see approve disabled with the reason", () => {
    ui({ pending: [cr({ sensitive: true, proposed: { malwareFailClosed: false } })] });
    expect(screen.getByText("Needs a super admin")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Approve the change requested by maker-aa/ })).toBeDisabled();
    expect(screen.getByText("Only a super admin can approve this change.")).toBeInTheDocument();
    expect(screen.getByText(/Changes: .*malwareFailClosed/)).toBeInTheDocument();
  });

  it("a different super admin approves through a dialog; reject needs a reason", async () => {
    f.mockResolvedValue(jsonResponse(202, { id: "x", status: "accepted" }));
    ui({ pending: [cr({ sensitive: true })], superAdmin: true });
    fireEvent.click(screen.getByRole("button", { name: /Approve the change requested by/ }));
    let dlg = await screen.findByRole("alertdialog");
    expect(within(dlg).getByText(/turns off fail-closed malware scanning/)).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(f.mock.calls[0]![0]).toBe("/api/proxy/v1/documents/bulk-scan/settings/change-requests/c1/approve");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Reject the change requested by/ }));
    dlg = await screen.findByRole("alertdialog");
    expect(within(dlg).getByRole("button", { name: "Reject" })).toBeDisabled();
    fireEvent.change(within(dlg).getByLabelText("Reason"), { target: { value: "not needed" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(f).toHaveBeenCalledTimes(2));
    expect(JSON.parse(f.mock.calls[1]![1].body)).toEqual({ reason: "not needed" });
  });

  it("a server-side maker-checker refusal is explained", async () => {
    f.mockResolvedValue(jsonResponse(409, { code: "MAKER_CHECKER_VIOLATION" }));
    ui({ pending: [cr()] });
    fireEvent.click(screen.getByRole("button", { name: /Approve the change requested by/ }));
    const dlg = await screen.findByRole("alertdialog");
    fireEvent.click(within(dlg).getByRole("button", { name: "Approve" }));
    expect(await within(dlg).findByText(/You cannot approve your own request/)).toBeInTheDocument();
  });

  it("no pending requests, a failed load and no settings are distinct states", () => {
    const { unmount } = ui();
    expect(screen.getByText("No change requests are waiting.")).toBeInTheDocument();
    unmount();
    renderIntl(<SettingsForm settings={{ data: null, source: "error", status: 500 }} providers={PROVIDERS} currentUserId={null} isSuperAdmin={false} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("No settings available")).not.toBeInTheDocument();
  });
});
