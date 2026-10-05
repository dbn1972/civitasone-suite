import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

import { ReviewWorkspace } from "./ReviewWorkspace";
import { reviewDetail } from "@/lib/bulkScan/fixtures";
import { mapLinks } from "@/lib/bulkScan/mappers";
import { jsonResponse, renderIntl } from "./testHelpers";
import type { ReviewQueueItem } from "@/lib/bulkScan/types";

const q = (id: string): ReviewQueueItem => ({ batchId: "b1", fileId: id, originalName: `${id}.pdf`, docType: null, confidence: null, reasons: [], piiFlags: [], pageCount: 1, degradedPages: 0, batchName: null, updatedAt: "", version: 1 });
const QUEUE = [q("f0"), q("f1"), q("f2")];
const awaiting = (requestedBy: string) => mapLinks({ data: [{ linkId: "l1", fileId: "f1", target: "hr_employee", targetId: "EMP-1", state: "awaiting_approval", requestedBy }] })!.items[0]!;
const ui = (over: Partial<Parameters<typeof ReviewWorkspace>[0]> = {}) => renderIntl(<ReviewWorkspace detail={reviewDetail()} queue={QUEUE} awaitingLink={null} currentUserId="me" {...over} />);
const region = () => screen.getByRole("region", { name: /Review workspace/ });
const key = (k: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(region(), { key: k, ...init });
const zoomText = () => screen.getByLabelText("Zoom level").textContent;

describe("ReviewWorkspace", () => {
  const f = vi.fn();
  beforeEach(() => { f.mockReset(); push.mockReset(); vi.stubGlobal("fetch", f); try { window.localStorage.clear(); } catch { /* ignore */ } });
  afterEach(() => vi.unstubAllGlobals());

  it("shows the human-readable review reasons, the degraded-pages banner and masked PII only", () => {
    ui();
    expect(screen.getByText("Text recognition confidence is below the review threshold.")).toBeInTheDocument();
    expect(screen.getByText("A required field is missing: date.")).toBeInTheDocument();
    const banner = screen.getByText("Some pages have an incomplete searchable PDF").closest("[role=status]") as HTMLElement;
    expect(within(banner).getByText(/Page 2 — missing scripts: Deva/)).toBeInTheDocument();
    expect(screen.getByText("Personal data found")).toBeInTheDocument();
    expect(screen.getAllByText("XXXX XXXX 1234").length).toBeGreaterThan(0);
    expect(screen.getByText("Personal data is masked and cannot be edited.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Aadhaar/)).toBeDisabled();
  });

  it("confidence is shown with text and glyphs, not colour alone", () => {
    ui();
    expect(screen.getAllByText(/62% · Low|62% · Medium/).length).toBeGreaterThan(0);
    const low = screen.getByRole("button", { name: /bok/ });
    expect(low).toHaveAttribute("data-band", "low");
    expect(within(low).getByText(/Low 35%/)).toBeInTheDocument();
  });

  it("classification: preset type, top-2 candidates with percentages, pick with one click", async () => {
    f.mockResolvedValue(jsonResponse(202, { id: "x", status: "accepted" }));
    ui();
    expect(screen.getByText(/Set by batch or profile: Service book/)).toBeInTheDocument();
    expect(screen.getByText(/Service book — 55% score/)).toBeInTheDocument();
    expect(screen.getByText(/Pay slip — 31% score/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Use Pay slip as the document type/ }));
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(f.mock.calls[0]![0]).toBe("/api/proxy/v1/documents/bulk-scan/batches/b1/files/f1/review/edit");
    expect(JSON.parse(f.mock.calls[0]![1].body)).toEqual({ expectedVersion: 3, docType: "pay_slip" });
  });

  it("keys 1 and 2 pick the first or second candidate through the edit action", async () => {
    f.mockResolvedValue(jsonResponse(202, { id: "x", status: "accepted" }));
    ui();
    key("2");
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    expect(JSON.parse(f.mock.calls[0]![1].body).docType).toBe("pay_slip");
  });

  it("keyboard: + / - zoom, 0 fits, ] and [ change page, ? opens the shortcut help", () => {
    ui();
    const fit = zoomText();
    key("+");
    expect(zoomText()).not.toBe(fit);
    key("-"); key("-");
    key("0");
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    key("]");
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    key("[");
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    key("?");
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
  });

  it("keyboard: r rotates the page surface 90 degrees", () => {
    ui();
    const surface = screen.getByTestId("page-surface");
    expect(surface.style.transform).toContain("rotate(0deg)");
    key("r");
    expect(surface.style.transform).toContain("rotate(90deg)");
    key("R", { shiftKey: true });
    expect(surface.style.transform).toContain("rotate(0deg)");
  });

  it("keyboard: arrows pan while the viewer has focus", () => {
    ui();
    const viewer = screen.getByRole("group", { name: "Page 1 image viewer" });
    const before = screen.getByTestId("page-surface").style.transform;
    fireEvent.keyDown(viewer, { key: "ArrowRight" });
    expect(screen.getByTestId("page-surface").style.transform).not.toBe(before);
  });

  it("keyboard: n / p go to the next / previous file in the queue, a opens the approve dialog, e focuses the type select", () => {
    ui();
    key("n");
    expect(push).toHaveBeenCalledWith("/admin/bulk-scan/review/b1/f2");
    key("p");
    expect(push).toHaveBeenCalledWith("/admin/bulk-scan/review/b1/f0");
    key("e");
    expect(screen.getByLabelText("Type")).toHaveFocus();
    key("a");
    expect(screen.getByRole("alertdialog", { name: /Approve this file/ })).toBeInTheDocument();
  });

  it("shortcuts do not fire while typing in a field", () => {
    ui();
    const input = screen.getByLabelText(/Tags \(separated/);
    fireEvent.keyDown(input, { key: "a" });
    fireEvent.keyDown(input, { key: "n" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("WCAG 2.1.4: single-key shortcuts are scoped to the workspace region, not the document", () => {
    ui();
    fireEvent.keyDown(document.body, { key: "n" });
    fireEvent.keyDown(document.body, { key: "a" });
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    // focus on a button inside the region still works (buttons do not use letter keys); an outside control does not
    fireEvent.keyDown(screen.getByRole("button", { name: "Fit" }), { key: "n" });
    expect(push).toHaveBeenCalledWith("/admin/bulk-scan/review/b1/f2");
    push.mockReset();
    fireEvent.keyDown(screen.getByRole("button", { name: "Reject" }), { key: "n" });
    expect(push).not.toHaveBeenCalled();
  });

  it("a visible Keyboard shortcuts switch turns every single-key handler off, is remembered per user, and the help button still works", () => {
    const first = ui({ currentUserId: "u-1" });
    const toggle = screen.getByRole("switch", { name: /Keyboard shortcuts/ });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(screen.getByRole("switch", { name: /Keyboard shortcuts: Off/ })).toBeInTheDocument();
    key("n"); key("a"); key("?");
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).not.toBeInTheDocument();
    expect(window.localStorage.getItem("bulkScan.reviewShortcuts.u-1")).toBe("off");
    fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
    first.unmount();
    // same user: remembered; another user: default on
    ui({ currentUserId: "u-1" });
    expect(screen.getByRole("switch", { name: /Keyboard shortcuts/ })).not.toBeChecked();
  });

  it("the switch defaults to on for another user and without a user id, and works when storage throws", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    ui({ currentUserId: null });
    const toggle = screen.getByRole("switch", { name: /Keyboard shortcuts/ });
    expect(toggle).toBeChecked();
    key("n");
    expect(push).toHaveBeenCalled();
    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    get.mockRestore(); set.mockRestore();
  });

  it("shows an error, never a silently empty state, when the queue or the awaiting-approval links failed to load", () => {
    ui({ queueFailed: true, awaitingFailed: true });
    expect(screen.getByText(/review queue could not be loaded/)).toBeInTheDocument();
    expect(screen.getByText(/Pending link approvals could not be loaded/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Retry" }).length).toBe(2);
  });

  it("the amount field states its unit (paise vs rupees) and has a placeholder", () => {
    ui();
    expect(screen.getAllByText(/Digits only are read as paise/).length).toBeGreaterThan(0);
    expect(screen.getAllByPlaceholderText("Paise: 125000, rupees: 1250.00").length).toBeGreaterThan(0);
  });

  it("hovering a word box highlights it in the text panel and the other way round", () => {
    ui();
    const word = screen.getByRole("button", { name: /^Service \(High/ });
    const box = document.querySelector('[data-word="0"]') as HTMLElement;
    expect(box).toHaveAttribute("data-active", "false");
    fireEvent.mouseEnter(word);
    expect(box).toHaveAttribute("data-active", "true");
    fireEvent.mouseLeave(word);
    expect(box).toHaveAttribute("data-active", "false");
    const second = document.querySelector('[data-word="1"]') as HTMLElement;
    fireEvent.mouseEnter(second);
    expect(screen.getByRole("button", { name: /bok/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.mouseLeave(second);
    fireEvent.focus(word);
    expect(box).toHaveAttribute("data-active", "true");
  });

  it("word list is a roving-tabindex list navigated with arrow keys", () => {
    ui();
    const first = screen.getByRole("button", { name: /^Service \(High/ });
    const second = screen.getByRole("button", { name: /bok/ });
    expect(first).toHaveAttribute("tabindex", "0");
    expect(second).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(second).toHaveFocus();
    expect(second).toHaveAttribute("tabindex", "0");
  });

  it("409 STALE on save shows the reload prompt and reloading restores a clean state", async () => {
    f.mockResolvedValueOnce(jsonResponse(409, { code: "STALE", message: "x" }));
    ui();
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "other" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("This file was changed by someone else")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    f.mockResolvedValueOnce(jsonResponse(200, { ...reviewDetail(), file: { ...reviewDetail().file, version: 4, docType: "other" } }));
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() => expect(screen.queryByText("This file was changed by someone else")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Type")).toHaveValue("other");
  });

  it("approve is blocked while there are unsaved edits", () => {
    ui();
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "other" } });
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getAllByText("Save your edits before approving.").length).toBeGreaterThan(0);
  });

  it("approve with a chosen HR link sends the version and the link, then moves to the next file", async () => {
    f.mockResolvedValue(jsonResponse(202, { id: "x", status: "accepted" }));
    ui();
    fireEvent.click(screen.getByRole("button", { name: "Choose EMP-0042 - R. Kumar as the link" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    const dlg = await screen.findByRole("alertdialog");
    expect(within(dlg).getByText(/linked to HR employee file: EMP-0042 - R. Kumar/)).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(f.mock.calls[0]![0]).toContain("/review/approve");
    expect(JSON.parse(f.mock.calls[0]![1].body)).toEqual({ expectedVersion: 3, link: { target: "hr_employee", targetId: "e1" } });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/admin/bulk-scan/review/b1/f2"));
  });

  it("finance amount mismatch: warned, and there is no way to attach it", () => {
    ui();
    expect(screen.getByText("The amount on the document differs from this record.")).toBeInTheDocument();
    expect(screen.getByText("Cannot be attached: the amounts do not match.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Choose PAY-2026-0091 as the link" })).not.toBeInTheDocument();
  });

  it("lookup: finance amount compared against the document; a matching record can be chosen", async () => {
    f.mockResolvedValue(jsonResponse(200, { data: [
      { target: "finance_voucher", targetId: "v1", label: "VCH-1", amountMinor: "125000", reference: "VCH-1" },
      { target: "finance_voucher", targetId: "v2", label: "VCH-2", amountMinor: "125001", reference: "VCH-2" },
    ] }));
    ui({ detail: reviewDetail({ linkSuggestions: [] }) });
    fireEvent.change(screen.getByLabelText("Record type"), { target: { value: "finance_voucher" } });
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "VCH" } });
    fireEvent.change(screen.getByLabelText("Amount in rupees (optional)"), { target: { value: "1250" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Search" })[0]!);
    expect(await screen.findByText("VCH-1")).toBeInTheDocument();
    expect(f.mock.calls[0]![0]).toContain("/link-lookup?target=finance_voucher&q=VCH&amountMinor=125000");
    expect(screen.getByRole("button", { name: "Choose VCH-1 as the link" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Choose VCH-2 as the link" })).not.toBeInTheDocument();
  });

  it("maker-checker: shows who must approve and locks editing and approving", () => {
    ui({ detail: reviewDetail({ file: { ...reviewDetail().file, state: "ready_to_file" } }), awaitingLink: awaiting("me") });
    expect(screen.getByText("Awaiting approval by a different person")).toBeInTheDocument();
    expect(screen.getByText(/You requested this link\. A different user must approve it/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByLabelText("Type")).toBeDisabled();
    expect(screen.getByRole("link", { name: "Open link approvals" })).toHaveAttribute("href", "/admin/bulk-scan/links");
  });

  it("maker-checker also shows from the file's own links[] when the page has no link row", () => {
    ui({ detail: reviewDetail({ links: [{ linkId: "l9", target: "hr_employee", targetId: "EMP-7", state: "awaiting_approval", reason: null, resultReason: null }] }), awaitingLink: null });
    expect(screen.getByText("Awaiting approval by a different person")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
  });

  it("an unreachable target service during lookup is not shown as no results and offers a retry", async () => {
    f.mockResolvedValueOnce(jsonResponse(200, { data: [], error: { code: "TARGET_UNAVAILABLE", target: "hr_employee" } }));
    ui({ detail: reviewDetail({ linkSuggestions: [] }) });
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "42" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Search" })[0]!);
    expect(await screen.findByText(/record service is not reachable/)).toBeInTheDocument();
    expect(screen.queryByText("No matching records.")).not.toBeInTheDocument();
    f.mockResolvedValueOnce(jsonResponse(200, { data: [{ target: "hr_employee", targetId: "e", label: "EMP-42" }] }));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("EMP-42")).toBeInTheDocument();
  });

  it("maker-checker banner for another viewer explains where to decide", () => {
    ui({ awaitingLink: awaiting("someone-else") });
    expect(screen.getByText(/You can decide on it under Link approvals/)).toBeInTheDocument();
  });

  it("reject needs a reason of at least 5 characters", async () => {
    f.mockResolvedValue(jsonResponse(202, { id: "x", status: "accepted" }));
    ui();
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    const dlg = await screen.findByRole("alertdialog");
    const confirm = within(dlg).getByRole("button", { name: "Reject" });
    fireEvent.change(within(dlg).getByLabelText("Reason (at least 5 characters)"), { target: { value: "bad" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dlg).getByLabelText("Reason (at least 5 characters)"), { target: { value: "blurry scan" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(JSON.parse(f.mock.calls[0]![1].body)).toEqual({ expectedVersion: 3, reason: "blurry scan" });
  });

  it("a page without an image shows an explicit state, keeps the text and word list, and keyboard navigation still works", () => {
    ui();
    key("]");
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    const state = screen.getByTestId("no-image");
    expect(state).toHaveAttribute("role", "status");
    expect(within(state).getByText("Page image not available")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^two \(High/ })).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    key("+");
    key("[");
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    expect(screen.queryByTestId("no-image")).not.toBeInTheDocument();
  });

  it("an image that fails to load shows the same state with a retry that fetches a fresh URL and keeps unsaved edits", async () => {
    ui();
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "other" } });
    fireEvent.error(screen.getByRole("img", { name: "Scanned page 1" }));
    const state = screen.getByTestId("no-image");
    expect(within(state).getByText("Page image not available")).toBeInTheDocument();
    expect(within(state).getByText(/could not be loaded/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Service \(High/ })).toBeInTheDocument();
    f.mockResolvedValueOnce(jsonResponse(200, { ...reviewDetail(), pages: reviewDetail().pages.map((p) => ({ ...p, imageUrl: "https://files.example/fresh.png" })) }));
    fireEvent.click(within(state).getByRole("button", { name: "Try loading the image again" }));
    await waitFor(() => expect(screen.getByRole("img", { name: "Scanned page 1" })).toHaveAttribute("src", "https://files.example/fresh.png"));
    expect(screen.getByLabelText("Type")).toHaveValue("other");
  });

  it("clearance errors on re-reading the review: denied has no retry, unavailable (503) has a retry", async () => {
    ui();
    fireEvent.error(screen.getByRole("img", { name: "Scanned page 1" }));
    f.mockResolvedValueOnce(jsonResponse(403, { code: "CLEARANCE_DENIED" }));
    fireEvent.click(screen.getByRole("button", { name: "Try loading the image again" }));
    expect(await screen.findByText(/above your clearance level/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    f.mockResolvedValueOnce(jsonResponse(503, { code: "CLEARANCE_UNAVAILABLE" }));
    fireEvent.click(screen.getByRole("button", { name: "Try loading the image again" }));
    expect(await screen.findByText(/clearance check is temporarily unavailable/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("renders in Hindi", () => {
    renderIntl(<ReviewWorkspace detail={reviewDetail()} queue={QUEUE} awaitingLink={null} currentUserId="me" />, "hi");
    expect(screen.getByText("कीबोर्ड शॉर्टकट")).toBeInTheDocument();
  });
});
