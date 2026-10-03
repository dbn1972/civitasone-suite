import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { SettingsPanel } from "./SettingsPanel";
import { renderIntl as render } from "../testIntl";

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
const base = { capitalizeMakerChecker: true, glMakerChecker: false, cwipAccountCode: null, rouAccountCode: null, leaseLiabilityAccountCode: null, leaseOffsetAccountCode: null, pendingRequests: [] };

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

  it("shows what is set up per posting area, the records waiting for accounts, and posts the pending journals (admin only)", async () => {
    const accounting = {
      acquisition: { configured: false, missing: ["fixed_asset", "acquisition_offset"] },
      maintenance: { configured: true, missing: [] },
      capitalisation: { configured: false, missing: ["cwip"] },
    };
    mockApi({ ...base, accounting, glOpen: { assetsAwaiting: 2, assetsFailed: 1, workOrdersAwaiting: 1, workOrdersFailed: 0 } });
    const { unmount } = render(<SettingsPanel canManage />);
    expect(await screen.findByText("Asset registration journals")).toBeInTheDocument();
    expect(screen.getAllByText("Accounting not set up")).toHaveLength(2);
    expect(screen.getByText("Set up")).toBeInTheDocument();
    expect(screen.getByText(/Fixed asset account \(debit on capitalisation\), Acquisition offset account/)).toBeInTheDocument();
    expect(screen.getByText("3 records are waiting for GL accounts and 1 journals were rejected by Finance.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Post pending journals" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/settings/post-pending"))).toBe(true));
    expect(await screen.findByText(/Pending journals submitted/)).toBeInTheDocument();
    unmount();
    vi.restoreAllMocks();
    mockApi({ ...base, accounting, glOpen: { assetsAwaiting: 2, assetsFailed: 0, workOrdersAwaiting: 0, workOrdersFailed: 0 } });
    render(<SettingsPanel canManage={false} />);
    await screen.findByText("Asset registration journals");
    expect(screen.queryByRole("button", { name: "Post pending journals" })).not.toBeInTheDocument();
  });

  it("has fields for the five formerly hard-coded accounts (en)", async () => {
    mockApi();
    render(<SettingsPanel canManage />);
    for (const label of [
      "Fixed asset account (debit on capitalisation)", "Acquisition offset account (payable or capital)", "Goods-received clearing account (liability)",
      "Maintenance expense account (expense)", "Accounts payable control account (liability)",
    ]) expect(await screen.findByLabelText(label)).toHaveValue("");
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
    mockApi({ ...base, pendingRequests: [{ id: "req-1", kind: "maker_checker_off", reason: "x", requestedByMe: false }] });
    const { unmount } = render(<SettingsPanel canManage />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/settings/requests/req-1/approve"))).toBe(true));
    unmount();
    calls = [];
    vi.restoreAllMocks();
    mockApi({ ...base, pendingRequests: [{ id: "req-1", kind: "maker_checker_off", reason: "x", requestedByMe: true }] });
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

  describe("GL account changes need a second approver (default ON)", () => {
    it("with approval ON the save is a submission for approval, and says a different administrator must approve it", async () => {
      mockApi({ ...base, glMakerChecker: true });
      render(<SettingsPanel canManage />);
      expect(await screen.findByText(/Approval is ON: a change to the GL accounts is a request/)).toBeInTheDocument();
      fireEvent.change(await screen.findByLabelText("Fixed asset account (debit on capitalisation)"), { target: { value: "1200" } });
      fireEvent.change(screen.getByLabelText("Reason", { selector: "#gl-reason" }), { target: { value: "Initial configuration" } });
      expect(screen.queryByRole("button", { name: "Save GL accounts" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));
      await waitFor(() => expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ fixedAssetAccountCode: "1200", reason: "Initial configuration" }));
      expect(await screen.findByText(/A different administrator must approve it before it applies/)).toBeInTheDocument();
    });

    const pendingHeads = { id: "rq-9", kind: "gl_heads_change", reason: "Chart revised", heads: { fixedAssetAccountCode: "1200", grnClearingAccountCode: null } };

    it("a pending GL change shows the requested accounts; another administrator approves or rejects (with a reason), the requester cannot", async () => {
      mockApi({ ...base, glMakerChecker: true, pendingRequests: [{ ...pendingHeads, requestedByMe: false }] });
      const { unmount } = render(<SettingsPanel canManage />);
      const card = await screen.findByTestId("pending-gl_heads_change");
      expect(card).toHaveTextContent("Change GL accounts");
      expect(card).toHaveTextContent("Reason: Chart revised");
      expect(card).toHaveTextContent("Fixed asset account (debit on capitalisation): 1200");
      expect(card).toHaveTextContent("Goods-received clearing account (liability): Not set");
      const reject = screen.getByRole("button", { name: "Reject" });
      expect(reject).toBeDisabled(); // a reason is required
      fireEvent.change(screen.getByLabelText("Reason for rejecting"), { target: { value: "Wrong account" } });
      fireEvent.click(reject);
      await waitFor(() => expect(calls.find((c) => c.url.endsWith("/settings/requests/rq-9/reject"))?.body).toEqual({ reason: "Wrong account" }));
      calls = [];
      fireEvent.click(screen.getByRole("button", { name: "Approve" }));
      await waitFor(() => expect(calls.some((c) => c.url.endsWith("/settings/requests/rq-9/approve"))).toBe(true));
      unmount();
      vi.restoreAllMocks();
      mockApi({ ...base, glMakerChecker: true, pendingRequests: [{ ...pendingHeads, requestedByMe: true }] });
      render(<SettingsPanel canManage />);
      expect(await screen.findByText(/You made this request/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    });

    it("the pending card and approval controls render in Hindi", async () => {
      mockApi({ ...base, glMakerChecker: true, pendingRequests: [{ ...pendingHeads, requestedByMe: false }] });
      render(<SettingsPanel canManage />, "hi");
      expect(await screen.findByText("अनुमोदन की प्रतीक्षा में")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "अनुमोदित करें" })).toBeInTheDocument();
      expect(screen.getByText("जीएल खाते बदलें")).toBeInTheDocument();
    });

    it("switching approval for GL changes OFF is itself a request; switching it back ON is a direct change", async () => {
      mockApi({ ...base, glMakerChecker: true });
      const { unmount } = render(<SettingsPanel canManage />);
      fireEvent.change(await screen.findByLabelText("Reason", { selector: "#gl-mc-off-reason" }), { target: { value: "Single admin" } });
      fireEvent.click(screen.getByRole("button", { name: "Request to switch off GL approval" }));
      await waitFor(() => expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ glMakerChecker: false, reason: "Single admin" }));
      unmount();
      calls = [];
      vi.restoreAllMocks();
      mockApi({ ...base, glMakerChecker: false });
      render(<SettingsPanel canManage />);
      fireEvent.change(await screen.findByLabelText("Reason", { selector: "#gl-mc-on-reason" }), { target: { value: "Two admins now" } });
      fireEvent.click(screen.getByRole("button", { name: "Switch GL approval on" }));
      await waitFor(() => expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ glMakerChecker: true, reason: "Two admins now" }));
    });
  });

  it("when a post-pending run is bounded, says how many more are waiting instead of implying all were sent", async () => {
    mockApi(
      { ...base, accounting: {}, glOpen: { assetsAwaiting: 450, assetsFailed: 0, workOrdersAwaiting: 0, workOrdersFailed: 0 } },
      new Response(JSON.stringify({ id: "x", status: "accepted", waiting: 450, limit: 200, more: true }), { status: 202 }),
    );
    render(<SettingsPanel canManage />);
    fireEvent.click(await screen.findByRole("button", { name: "Post pending journals" }));
    expect(await screen.findByText(/250 more are waiting\. Run it again/)).toBeInTheDocument();
  });

  it("finance_admin scope: GL requests can be decided, the capitalisation control and its OFF request cannot", async () => {
    mockApi({
      ...base, glMakerChecker: true,
      pendingRequests: [
        { id: "gl-1", kind: "gl_heads_change", reason: "x", requestedByMe: false, heads: { fixedAssetAccountCode: "1200" } },
        { id: "cap-1", kind: "maker_checker_off", reason: "y", requestedByMe: false, heads: null },
      ],
    });
    render(<SettingsPanel canManage canManageCapitalisation={false} />);
    const gl = await screen.findByTestId("pending-gl_heads_change");
    const cap = screen.getByTestId("pending-maker_checker_off");
    expect(gl.querySelector("button")).not.toBeNull();
    expect(cap.querySelector("button")).toBeNull(); // no approve / reject for the capitalisation request
    expect(screen.queryByRole("button", { name: "Request to switch off" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Reason", { selector: "#gl-mc-off-reason" })).toBeInTheDocument(); // GL control still available
  });
});
