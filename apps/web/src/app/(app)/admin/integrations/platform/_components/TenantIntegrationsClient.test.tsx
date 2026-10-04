import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { TenantIntegrationsClient } from "./TenantIntegrationsClient";
import type { PolicySettings, SwitchRequest, TenantCatalogueProvider, TenantRecord } from "@/lib/admin/platformIntegrations";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const ESIGN: TenantCatalogueProvider = {
  key: "esign_nsdl_egov", category: "esign", name: "NSDL e-Gov eSign", vendor: "NSDL", description: "Aadhaar eSign through NSDL.",
  capabilities: ["esign.initiate"], endpoints: { sandbox: null, production: null }, status: "available", configured: true,
  fields: [
    { key: "aspId", label: "ASP / agency ID", labelHi: "ASP / एजेंसी आईडी", type: "text", required: true, secret: false, environments: ["sandbox", "production"] },
    { key: "apiKey", label: "API key", type: "text", required: true, secret: true, environments: ["sandbox", "production"] },
    { key: "prodNote", label: "Prod note", type: "text", required: true, secret: false, environments: ["production"] },
  ],
};
const BANK: TenantCatalogueProvider = { ...ESIGN, key: "bank_sbi", category: "bank_api", name: "State Bank of India", configured: false, fields: [] };

function record(over: Partial<TenantRecord> = {}): TenantRecord {
  return {
    id: "rec-1", providerKey: ESIGN.key, category: "esign", providerName: ESIGN.name, providerStatus: "available", environment: "sandbox",
    enabled: true, config: { aspId: "ASP1", prodNote: "ok" }, secrets: [{ key: "apiKey", label: "API key", set: true, masked: "••••••••" }],
    missingRequired: { sandbox: [], production: [] },
    health: { status: "success", code: "OK", message: "NSDL e-Gov eSign sandbox handshake succeeded (mock).", testedAt: "2026-10-03T06:00:00.000Z", environment: "sandbox" },
    version: 1, updatedAt: "2026-10-03T06:00:00.000Z", pendingSwitch: null, ...over,
  };
}
const swReq = (over: Partial<SwitchRequest> = {}): SwitchRequest => ({
  id: "33333333-3333-4333-8333-333333333333", providerKey: ESIGN.key, status: "pending", reason: "go live for UAT sign-off",
  requestedBy: OTHER, requestedAt: "2026-10-03T05:00:00.000Z", decidedBy: null, decidedAt: null, decisionNote: null, direct: false, ...over,
});

type State = {
  catalogue: TenantCatalogueProvider[];
  records: TenantRecord[];
  pending: SwitchRequest[];
  settings: PolicySettings;
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
function mockApi(state: State, overrides: (call: Call) => Response | undefined = () => undefined) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    const call: Call = { url, method, headers, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const o = overrides(call);
    if (o) return o;
    if (method === "GET") {
      if (url.endsWith("/tenant/catalogue")) return json({ data: state.catalogue });
      if (url.endsWith("/tenant/records")) return json({ data: state.records });
      if (url.includes("/tenant/production-switches")) return json({ data: state.pending });
      if (url.endsWith("/tenant/settings")) return json({ data: state.settings });
      const m = /\/tenant\/records\/([^/?]+)$/.exec(url);
      if (m) { const r = state.records.find((x) => x.providerKey === m[1]); return r ? json({ data: r }) : json({}, 404); }
      if (url.includes("/admin/users")) return json({ data: [{ id: OTHER, name: "Asha Rao", email: "asha@dept.gov.in" }] });
    }
    return json({ id: "x", status: "accepted" }, 202);
  });
  return calls;
}

function ui(opts: { locale?: "en" | "hi"; actorId?: string | null; canEditPolicy?: boolean } = {}) {
  const locale = opts.locale ?? "en";
  return (
    <NextIntlClientProvider locale={locale} messages={locale === "hi" ? hiMessages : enMessages}>
      <TenantIntegrationsClient actorId={opts.actorId === undefined ? ME : opts.actorId} canEditPolicy={opts.canEditPolicy ?? true} />
    </NextIntlClientProvider>
  );
}
const base = (): State => ({
  catalogue: [ESIGN, BANK], records: [record()], pending: [], settings: { requireProductionApproval: true, version: null, isDefault: true, pendingPolicyChange: null },
});

describe("TenantIntegrationsClient", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("shows a loading skeleton, then the category list with environment badge and health", async () => {
    mockApi(base());
    render(ui());
    expect(screen.getByLabelText("Loading integrations")).toHaveAttribute("aria-busy", "true");
    expect(await screen.findByRole("heading", { name: "NSDL e-Gov eSign" })).toBeInTheDocument();
    expect(screen.getAllByText("Sandbox").length).toBeGreaterThan(0);
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText(/mock/i, { selector: "span" })).toBeInTheDocument();
  });

  it("a failed first load is an error with a retry (never an empty catalogue), and retry recovers", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 500 }));
    render(ui());
    const retry = await screen.findByRole("button", { name: /try again/i });
    expect(screen.queryByText("No providers available")).not.toBeInTheDocument();
    spy.mockRestore();
    mockApi(base());
    fireEvent.click(retry);
    expect(await screen.findByRole("heading", { name: "NSDL e-Gov eSign" })).toBeInTheDocument();
  });

  it("a category with no available provider shows an explanatory empty state", async () => {
    mockApi({ ...base(), catalogue: [ESIGN], records: [record()] });
    render(ui());
    await screen.findByRole("heading", { name: "NSDL e-Gov eSign" });
    fireEvent.click(screen.getByRole("tab", { name: "Digital signature (DSC)" }));
    expect(await screen.findByText("No providers available")).toBeInTheDocument();
    expect(screen.getByText(/has not enabled any DSC provider/)).toBeInTheDocument();
  });

  it("renders in Hindi", async () => {
    mockApi(base());
    render(ui({ locale: "hi" }));
    expect(await screen.findByRole("heading", { name: "ई-साइन, DSC और बैंक इंटीग्रेशन" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "ई-साइन" })).toBeInTheDocument();
  });

  it("configure drawer: secrets are write-only (empty password input, 'stored' hint), blank secret is not sent", async () => {
    const calls = mockApi(base());
    render(ui());
    fireEvent.click(await screen.findByRole("button", { name: "Manage" }));
    const dialog = await screen.findByRole("dialog");
    const apiKey = within(dialog).getByLabelText(/API key/) as HTMLInputElement;
    expect(apiKey.type).toBe("password");
    expect(apiKey.value).toBe("");
    expect(within(dialog).getByText(/Stored \(hidden\)/)).toBeInTheDocument();
    expect(dialog.textContent).not.toContain("enc:v2");

    const save = within(dialog).getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled(); // nothing changed
    fireEvent.change(within(dialog).getByLabelText(/ASP \/ agency ID/), { target: { value: "ASP2" } });
    expect(save).not.toBeDisabled();
    fireEvent.click(save);
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.url).toContain("/tenant/records/esign_nsdl_egov");
    expect(put.headers["x-idempotency-key"]).toBeTruthy();
    expect(put.body).toMatchObject({ config: { aspId: "ASP2", prodNote: "ok" }, secrets: {}, clearSecrets: [], enabled: true, expectedVersion: 1 });
  });

  it("typing a new secret sends it once, in `secrets`, and nothing else carries it", async () => {
    const calls = mockApi(base());
    render(ui());
    fireEvent.click(await screen.findByRole("button", { name: "Manage" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/API key/), { target: { value: "rotated-key-123" } }); // gitleaks:allow
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.method === "PUT")!;
    expect((put.body as { secrets: Record<string, string> }).secrets).toEqual({ apiKey: "rotated-key-123" }); // gitleaks:allow
    expect(JSON.stringify((put.body as { config: unknown }).config)).not.toContain("rotated-key-123"); // gitleaks:allow
  });

  it("server field errors appear inline and a failed save never claims success", async () => {
    mockApi(base(), (c) => c.method === "PUT"
      ? json({ code: "VALIDATION_FAILED", fieldErrors: [{ field: "aspId", message: "has an invalid format" }] }, 400)
      : undefined);
    render(ui());
    fireEvent.click(await screen.findByRole("button", { name: "Manage" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/ASP \/ agency ID/), { target: { value: "bad id" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(await within(dialog).findByText("has an invalid format")).toBeInTheDocument();
    expect(within(dialog).queryByText("Configuration saved.")).not.toBeInTheDocument();
  });

  it("production switch needs a reason of at least 5 characters, then posts it with an idempotency key", async () => {
    const calls = mockApi(base(), (c) => c.method === "POST" && c.url.endsWith("/production-switch") ? json({ id: "r1", mode: "pending_approval" }, 202) : undefined);
    render(ui());
    fireEvent.click(await screen.findByRole("button", { name: "Manage" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/runs in the sandbox/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Request switch to production" }));
    const confirm = await screen.findByRole("alertdialog");
    const go = within(confirm).getByRole("button", { name: "Request switch to production" });
    expect(go).toBeDisabled();
    fireEvent.change(within(confirm).getByLabelText("Why is this switch needed?"), { target: { value: "ok" } });
    expect(go).toBeDisabled();
    fireEvent.change(within(confirm).getByLabelText("Why is this switch needed?"), { target: { value: "UAT sign-off complete" } });
    expect(go).not.toBeDisabled();
    fireEvent.click(go);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/production-switch"))).toBe(true));
    const post = calls.find((c) => c.url.endsWith("/production-switch"))!;
    expect(post.body).toEqual({ reason: "UAT sign-off complete" });
    expect(post.headers["x-idempotency-key"]).toBeTruthy();
  });

  it("production switch is blocked in the UI while production-only fields are missing", async () => {
    mockApi({ ...base(), records: [record({ missingRequired: { sandbox: [], production: ["prodNote"] }, config: { aspId: "ASP1" } })] });
    render(ui());
    fireEvent.click(await screen.findByRole("button", { name: "Manage" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Still required for production: Prod note/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Request switch to production" })).toBeDisabled();
  });

  it("test connection in production is a plain 'not yet available', never a fake result", async () => {
    mockApi({ ...base(), records: [record({ environment: "production" })] }, (c) =>
      c.method === "POST" && c.url.endsWith("/test") ? json({ code: "NOT_YET_AVAILABLE", message: "Not yet available — configured for UAT" }, 501) : undefined);
    render(ui());
    fireEvent.click(await screen.findByRole("button", { name: "Manage" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Test connection" }));
    expect(await within(dialog).findByText("Not yet available — configured for UAT")).toBeInTheDocument();
  });

  it("pending approvals: another person's request can be approved/rejected, your own can only be cancelled, and no raw id is shown", async () => {
    mockApi({ ...base(), pending: [swReq({ requestedBy: OTHER }), swReq({ id: "44444444-4444-4444-8444-444444444444", requestedBy: ME, reason: "my own request" })] });
    const { container } = render(ui());
    await screen.findByText("Production switches awaiting approval");
    const theirs = screen.getByText(/Requested by Asha Rao/).closest("div")!;
    expect(within(theirs).getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(within(theirs).getByRole("button", { name: "Reject" })).toBeInTheDocument();
    const mine = screen.getByText(/Requested by You/).closest("div")!;
    expect(within(mine).queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(within(mine).getByRole("button", { name: "Cancel request" })).toBeInTheDocument();
    expect(within(mine).getByText(/another administrator must decide it/)).toBeInTheDocument();
    expect(container.textContent).not.toContain(OTHER);
    expect(container.textContent).not.toContain(ME);
  });

  it("approving posts the decision with an idempotency key and reports it only once the request leaves the pending list", async () => {
    const state = { ...base(), pending: [swReq()] };
    let decided = false;
    const calls = mockApi(state, (c) => {
      if (c.method === "POST" && c.url.endsWith("/approve")) { decided = true; state.pending = []; return json({ id: "x" }, 202); }
      return undefined;
    });
    render(ui());
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: "Approve" }));
    expect(await screen.findByText(/Approved\. NSDL e-Gov eSign is now in production\./)).toBeInTheDocument();
    expect(decided).toBe(true);
    const post = calls.find((c) => c.url.endsWith("/approve"))!;
    expect(post.headers["x-idempotency-key"]).toBeTruthy();
  });

  it("a refused approval (e.g. maker-checker) shows an error and no success notice", async () => {
    mockApi({ ...base(), pending: [swReq()] }, (c) => c.method === "POST" && c.url.endsWith("/approve") ? json({ code: "MAKER_CHECKER_VIOLATION", message: "x" }, 409) : undefined);
    render(ui());
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(screen.queryByText(/Approved\./)).not.toBeInTheDocument());
    expect(await within(await screen.findByRole("alertdialog")).findByRole("alert")).toBeInTheDocument();
  });

  it("the approval policy is only changeable by tenant administrators; switching it OFF files a request with a reason", async () => {
    mockApi(base());
    const { unmount } = render(ui({ canEditPolicy: false }));
    await screen.findByText("Production switch approval");
    expect(screen.queryByRole("button", { name: "Request to switch approval off" })).not.toBeInTheDocument();
    expect(screen.getByText(/Only a tenant administrator can change this setting/)).toBeInTheDocument();
    unmount();

    const calls = mockApi(base());
    render(ui({ canEditPolicy: true }));
    fireEvent.click(await screen.findByRole("button", { name: "Request to switch approval off" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText(/Another administrator must approve this/)).toBeInTheDocument();
    const go = within(confirm).getByRole("button", { name: "Request to switch approval off" });
    expect(go).toBeDisabled(); // a reason is required
    fireEvent.change(within(confirm).getByLabelText("Why should approval be switched off?"), { target: { value: "UAT window needs it" } });
    fireEvent.click(go);
    await waitFor(() => expect(calls.some((c) => c.method === "PUT" && c.url.endsWith("/tenant/settings"))).toBe(true));
    expect(calls.find((c) => c.method === "PUT" && c.url.endsWith("/tenant/settings"))!.body).toEqual({ requireProductionApproval: false, reason: "UAT window needs it" });
  });

  it("a pending policy-change request: another admin can approve/reject, the requester can only cancel; no raw id", async () => {
    const pendingPolicyChange = { id: "55555555-5555-4555-8555-555555555555", status: "pending" as const, reason: "UAT window", requestedBy: OTHER, requestedAt: "2026-10-03T05:00:00.000Z", decidedBy: null, decidedAt: null, decisionNote: null };
    const calls = mockApi({ ...base(), settings: { requireProductionApproval: true, version: null, isDefault: true, pendingPolicyChange } });
    const { container } = render(ui());
    await screen.findByText("Request to switch approval off");
    expect(screen.getByText(/Asha Rao asked to switch approval off/)).toBeInTheDocument();
    expect(container.textContent).not.toContain(OTHER);
    expect(screen.queryByRole("button", { name: "Request to switch approval off" })).not.toBeInTheDocument(); // one pending at a time
    const panel = screen.getByText("Production switch approval").closest("section")!;
    fireEvent.click(within(panel).getByRole("button", { name: "Approve" }));
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/policy-changes/55555555-5555-4555-8555-555555555555/approve"))).toBe(true));
    expect(calls.find((c) => c.url.endsWith("/approve") && c.url.includes("policy-changes"))!.headers["x-idempotency-key"]).toBeTruthy();
  });

  it("a finance/payroll admin (not a policy role) is not offered approve/reject on a policy-OFF request", async () => {
    const pendingPolicyChange = { id: "77777777-7777-4777-8777-777777777777", status: "pending" as const, reason: "UAT window", requestedBy: OTHER, requestedAt: "2026-10-03T05:00:00.000Z", decidedBy: null, decidedAt: null, decisionNote: null };
    mockApi({ ...base(), settings: { requireProductionApproval: true, version: null, isDefault: true, pendingPolicyChange } });
    render(ui({ canEditPolicy: false }));
    await screen.findByText("Request to switch approval off");
    const panel = screen.getByText("Production switch approval").closest("section")!;
    expect(within(panel).queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
  });

  it("your own pending policy request can only be cancelled", async () => {
    const pendingPolicyChange = { id: "66666666-6666-4666-8666-666666666666", status: "pending" as const, reason: "UAT window", requestedBy: ME, requestedAt: "2026-10-03T05:00:00.000Z", decidedBy: null, decidedAt: null, decisionNote: null };
    mockApi({ ...base(), settings: { requireProductionApproval: true, version: null, isDefault: true, pendingPolicyChange } });
    render(ui());
    await screen.findByText("Request to switch approval off");
    const panel = screen.getByText("Production switch approval").closest("section")!;
    expect(within(panel).queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Cancel request" })).toBeInTheDocument();
  });

  it("editing a sensitive field of a LIVE production integration warns that it goes back to sandbox, and asks to confirm", async () => {
    const calls = mockApi({ ...base(), records: [record({ environment: "production" })] });
    render(ui());
    fireEvent.click(await screen.findByRole("button", { name: "Manage" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText(/move this integration back to sandbox/)).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/API key/), { target: { value: "new-credential-1" } }); // gitleaks:allow
    expect(within(dialog).getByText("Saving will move this integration back to sandbox until another administrator approves production again.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(calls.some((c) => c.method === "PUT")).toBe(false); // nothing sent before confirming
    fireEvent.click(within(confirm).getByRole("button", { name: "Save and move to sandbox" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
  });

  it("a non-sensitive production edit (the enabled flag) shows no warning and saves directly", async () => {
    const calls = mockApi({ ...base(), records: [record({ environment: "production" })] });
    render(ui());
    fireEvent.click(await screen.findByRole("button", { name: "Manage" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByLabelText("Integration enabled"));
    // enabled is not a schema field: it never triggers the warning
    expect(within(dialog).queryByText(/move this integration back to sandbox/)).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
