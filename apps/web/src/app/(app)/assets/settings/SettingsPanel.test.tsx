import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { SettingsPanel } from "./SettingsPanel";
import { renderIntl as render } from "../testIntl";

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
const base = { capitalizeMakerChecker: true, cwipAccountCode: null, rouAccountCode: null, leaseLiabilityAccountCode: null, leaseOffsetAccountCode: null, pendingMakerCheckerOff: null };

function mockApi(settings: Record<string, unknown> = base, write: Response | null = null) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === "GET") return new Response(JSON.stringify(settings), { status: 200 });
    return write ?? new Response(JSON.stringify({ id: "x" }), { status: 202 });
  });
}

describe("SettingsPanel (fp-assets-01)", () => {
  beforeEach(() => { calls = []; vi.restoreAllMocks(); });

  it("shows every GL head as not set (no defaults) and sends only the changed heads with a reason", async () => {
    mockApi();
    render(<SettingsPanel canManage />);
    const cwip = await screen.findByLabelText("Capital work in progress account");
    expect(cwip).toHaveValue("");
    expect(cwip).toHaveAttribute("placeholder", "Not set");
    const save = screen.getByRole("button", { name: "Save GL accounts" });
    expect(save).toBeDisabled();
    fireEvent.change(cwip, { target: { value: "1300" } });
    fireEvent.change(screen.getByLabelText("Right-of-use asset account"), { target: { value: "1400" } });
    expect(save).toBeDisabled(); // a reason is required
    fireEvent.change(screen.getByLabelText("Reason", { selector: "#gl-reason" }), { target: { value: "Initial configuration" } });
    fireEvent.click(save);
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ cwipAccountCode: "1300", rouAccountCode: "1400", reason: "Initial configuration" });
    expect(await screen.findByText(/Settings submitted/)).toBeInTheDocument();
  });

  it("has fields for the impairment-expense and revaluation-reserve heads (en and hi) and sends them", async () => {
    mockApi({ ...base, impairmentExpenseAccountCode: "5200" });
    const { unmount } = render(<SettingsPanel canManage />);
    expect(await screen.findByLabelText("Impairment loss account (expense)")).toHaveValue("5200");
    fireEvent.change(screen.getByLabelText("Revaluation reserve account (equity)"), { target: { value: "3100" } });
    fireEvent.change(screen.getByLabelText("Reason", { selector: "#gl-reason" }), { target: { value: "Initial configuration" } });
    fireEvent.click(screen.getByRole("button", { name: "Save GL accounts" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ revaluationReserveAccountCode: "3100", reason: "Initial configuration" }));
    unmount();
    vi.restoreAllMocks();
    mockApi();
    render(<SettingsPanel canManage />, "hi");
    expect(await screen.findByLabelText("हानि (इम्पेयरमेंट) खाता (व्यय)")).toBeInTheDocument();
    expect(screen.getByLabelText("पुनर्मूल्यांकन आरक्षित निधि खाता (इक्विटी)")).toBeInTheDocument();
  });

  it("an invalid head from Finance is shown as a translated message, never the code", async () => {
    mockApi(base, new Response(JSON.stringify({ code: "GL_HEAD_INVALID", message: "The capital work in progress account 1250 is the accumulated-depreciation account" }), { status: 409 }));
    render(<SettingsPanel canManage />);
    fireEvent.change(await screen.findByLabelText("Capital work in progress account"), { target: { value: "1250" } });
    fireEvent.change(screen.getByLabelText("Reason", { selector: "#gl-reason" }), { target: { value: "Initial configuration" } });
    fireEvent.click(screen.getByRole("button", { name: "Save GL accounts" }));
    expect(await screen.findByText(/is not accepted/)).toBeInTheDocument();
    expect(screen.queryByText(/GL_HEAD_INVALID/)).not.toBeInTheDocument();
  });

  it("switching two-person approval OFF is a request with a reason, not an immediate change", async () => {
    mockApi();
    render(<SettingsPanel canManage />);
    expect(await screen.findByText(/Two-person approval is ON/)).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: "Request to switch off" });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason", { selector: "#gl-off-reason" }), { target: { value: "Small unit" } });
    fireEvent.click(btn);
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ capitalizeMakerChecker: false, reason: "Small unit" });
    expect(await screen.findByText(/A different asset administrator must approve it/)).toBeInTheDocument();
  });

  it("a pending request can be approved or rejected by someone else, but not by its requester", async () => {
    mockApi({ ...base, pendingMakerCheckerOff: { id: "req-1", requestedAt: "2026-10-01T00:00:00Z", reason: "x", requestedByMe: false } });
    const { unmount } = render(<SettingsPanel canManage />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/settings/requests/req-1/approve"))).toBe(true));
    unmount();
    calls = [];
    vi.restoreAllMocks();
    mockApi({ ...base, pendingMakerCheckerOff: { id: "req-1", requestedAt: "2026-10-01T00:00:00Z", reason: "x", requestedByMe: true } });
    render(<SettingsPanel canManage />);
    expect(await screen.findByText(/You made this request/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("switching it back ON is single-actor; a read-only role sees no controls", async () => {
    mockApi({ ...base, capitalizeMakerChecker: false });
    const { unmount } = render(<SettingsPanel canManage />);
    expect(await screen.findByText(/Two-person approval is OFF/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Reason", { selector: "#gl-on-reason" }), { target: { value: "Back to two-person" } });
    fireEvent.click(screen.getByRole("button", { name: "Switch on" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ capitalizeMakerChecker: true, reason: "Back to two-person" }));
    unmount();
    vi.restoreAllMocks();
    mockApi();
    render(<SettingsPanel canManage={false} />);
    await screen.findByText(/Two-person approval is ON/);
    expect(screen.queryByRole("button", { name: "Save GL accounts" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request to switch off" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Capital work in progress account")).toBeDisabled();
  });

  it("a failed load is its own error state with a retry, and renders in Hindi", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 500 }));
    const { unmount } = render(<SettingsPanel canManage />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    unmount();
    vi.restoreAllMocks();
    mockApi();
    render(<SettingsPanel canManage />, "hi");
    expect(await screen.findByText("GL खाते सहेजें")).toBeInTheDocument();
  });
});
