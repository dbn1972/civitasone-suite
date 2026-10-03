import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import type { TenantApprovalPolicy, TenantLifecycleRequest } from "@/app/_data/loaders";
import { TenantLifecycleSection, type TenantLifecycleSectionProps } from "./TenantLifecycleSection";
import { ApprovalPolicyCard } from "./ApprovalPolicyCard";

const TID = "11111111-aaaa-4000-8000-000000000001";
const policy: TenantApprovalPolicy = { requiresSecondApprover: true, approverRoles: ["super_admin", "platform_admin"], minApprovals: 1, reasonRequired: true, notifyTenantAdmins: true };

function request(over: Partial<TenantLifecycleRequest> = {}): TenantLifecycleRequest {
  return {
    id: "22222222-aaaa-4000-8000-000000000002", kind: "suspend", status: "pending", reason: "Dues unpaid", payload: {}, effectiveAt: null,
    requestedAt: "2026-10-03T06:00:00Z", requestedByYou: false, requiredApprovals: 1, approvalsCount: 0,
    decidedAt: null, decidedByYou: false, decisionReason: null, failureCode: null, directExecution: false, canDecide: true, canCancel: false, cancelledByYou: false, cancelReason: null, ...over,
  };
}

function ui(props: Partial<TenantLifecycleSectionProps> = {}, locale: "en" | "hi" = "en") {
  return (
    <NextIntlClientProvider locale={locale} messages={locale === "hi" ? hiMessages : enMessages}>
      <TenantLifecycleSection
        tenantId={TID} tenantName="Acme Board" tenantStatus="active" current={{ name: "Acme Board", domain: "acme.gov.in", edition: "psu" }}
        initialRequests={[]} requestsSource="api" policy={policy} {...props}
      />
    </NextIntlClientProvider>
  );
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

describe("TenantLifecycleSection", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("offers Suspend and Edit on an active tenant, never Reactivate", () => {
    render(ui());
    expect(screen.getByRole("button", { name: "Suspend tenant" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit details" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reactivate tenant" })).not.toBeInTheDocument();
  });

  it("offers Reactivate on a suspended tenant", () => {
    render(ui({ tenantStatus: "suspended" }));
    expect(screen.getByRole("button", { name: "Reactivate tenant" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Suspend tenant" })).not.toBeInTheDocument();
  });

  it("suspend dialog explains the impact and will not submit without a reason", () => {
    render(ui());
    fireEvent.click(screen.getByRole("button", { name: "Suspend tenant" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/loses access to CivitasOne/)).toBeInTheDocument();
    expect(within(dialog).getByText(/another platform administrator/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Submit request" })).toBeDisabled();
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Reason/ }), { target: { value: "Dues unpaid" } });
    expect(within(dialog).getByRole("button", { name: "Submit request" })).toBeEnabled();
  });

  it("submits the suspend request with the reason and shows the confirmation", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST") return Promise.resolve(json({ id: "x", status: "accepted" }, 202));
      return Promise.resolve(json({ items: [request()] }));
    });
    render(ui());
    fireEvent.click(screen.getByRole("button", { name: "Suspend tenant" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Reason/ }), { target: { value: "Dues unpaid" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Request submitted"));
    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST")!;
    expect(String(post[0])).toBe(`/api/proxy/v1/admin/tenants/${TID}/lifecycle-requests`);
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({ kind: "suspend", reason: "Dues unpaid" });
  }, 15000);

  it("shows a catalogued message, never raw server text, when the backend refuses", async () => {
    fetchMock.mockResolvedValue(json({ code: "REQUEST_ALREADY_OPEN", message: "raw server text 409" }, 409));
    render(ui());
    fireEvent.click(screen.getByRole("button", { name: "Suspend tenant" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Reason/ }), { target: { value: "Dues unpaid" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
    const alert = await screen.findByText(/already waiting for approval/);
    expect(alert).toBeInTheDocument();
    expect(screen.queryByText(/raw server text/)).not.toBeInTheDocument();
    expect(screen.queryByText(/409/)).not.toBeInTheDocument();
  });

  it("says 'apply now' when the policy has no second approver", () => {
    render(ui({ policy: { ...policy, requiresSecondApprover: false } }));
    fireEvent.click(screen.getByRole("button", { name: "Suspend tenant" }));
    expect(screen.getByText(/without a second approver/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply now" })).toBeInTheDocument();
  });

  it("lists requests with a status badge; Approve/Reject only where the caller may decide", () => {
    render(ui({
      initialRequests: [
        request({ id: "a", canDecide: true }),
        request({ id: "b", canDecide: false, requestedByYou: true, kind: "reactivate" }),
        request({ id: "c", status: "failed", failureCode: "INVALID_TRANSITION", canDecide: false }),
      ],
    }));
    expect(screen.getAllByText("Awaiting approval")).toHaveLength(2);
    expect(screen.getByText("Could not be applied")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(1);
    expect(screen.getByText("You cannot approve your own request.")).toBeInTheDocument();
    expect(screen.getByText(/not in a state where this could be applied/)).toBeInTheDocument();
    // no raw ids or enum values on screen
    expect(screen.queryByText("pending")).not.toBeInTheDocument();
    expect(screen.queryByText(/policy_change/)).not.toBeInTheDocument();
  });

  it("reject requires a reason and posts the decision", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      Promise.resolve(init?.method === "POST" ? json({ id: "a", status: "accepted" }, 202) : json({ items: [] })));
    render(ui({ initialRequests: [request({ id: "a" })] }));
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByRole("button", { name: "Reject" })).toBeDisabled();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Not justified" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("decision was submitted"));
    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST")!;
    expect(String(post[0])).toBe(`/api/proxy/v1/admin/tenants/${TID}/lifecycle-requests/a/decision`);
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({ decision: "reject", comment: "Not justified" });
  }, 15000);

  it("a scheduled request can be cancelled with a reason", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      Promise.resolve(init?.method === "POST" ? json({ id: "s", status: "accepted" }, 202) : json({ items: [] })));
    render(ui({ initialRequests: [request({ id: "s", status: "scheduled", canDecide: false, canCancel: true, effectiveAt: "2026-10-10T06:00:00Z" })] }));
    expect(screen.getByText("Approved, scheduled")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel request" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByRole("button", { name: "Cancel the request" })).toBeDisabled();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Dues were paid" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel the request" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("cancellation was submitted"));
    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST")!;
    expect(String(post[0])).toBe(`/api/proxy/v1/admin/tenants/${TID}/lifecycle-requests/s/cancel`);
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({ reason: "Dues were paid" });
  }, 15000);

  it("no Cancel button when the caller may not cancel", () => {
    render(ui({ initialRequests: [request({ status: "scheduled", canDecide: false, canCancel: false })] }));
    expect(screen.queryByRole("button", { name: "Cancel request" })).not.toBeInTheDocument();
  });

  it("a failed list load is an error, not an empty list", () => {
    render(ui({ requestsSource: "error" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/could not be loaded/);
    expect(screen.queryByText(/No lifecycle requests/)).not.toBeInTheDocument();
  });

  it("renders in Hindi", () => {
    render(ui({ initialRequests: [request({ kind: "edit" })] }, "hi"));
    expect(screen.getByRole("button", { name: "टेनेंट निलंबित करें" })).toBeInTheDocument();
    expect(screen.getByText("अनुमोदन की प्रतीक्षा")).toBeInTheDocument();
  });
});

describe("ApprovalPolicyCard", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => { vi.unstubAllGlobals(); });

  const card = (over: Partial<Parameters<typeof ApprovalPolicyCard>[0]> = {}) => render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ApprovalPolicyCard tenantId={TID} policy={policy} isDefault pending={null} source="api" {...over} />
    </NextIntlClientProvider>,
  );

  it("shows the policy, says a change needs a second approver, and demands a real change", () => {
    card();
    expect(screen.getByText("This tenant uses the platform default policy.")).toBeInTheDocument();
    expect(screen.getByText(/always needs approval from a second platform administrator/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Request policy change" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Change at least one setting");
  });

  it("needs at least one approver role", () => {
    card();
    fireEvent.click(screen.getByRole("checkbox", { name: "Super admin" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Platform admin" }));
    fireEvent.click(screen.getByRole("button", { name: "Request policy change" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose at least one role");
  });

  it("PUTs the new policy with a reason", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      Promise.resolve(init?.method === "PUT" ? json({ id: "x", status: "accepted" }, 202) : json({ policy, isDefault: true, pendingChange: request({ kind: "policy_change" }) })));
    card();
    fireEvent.click(screen.getByRole("checkbox", { name: "Require a second approver" }));
    fireEvent.click(screen.getByRole("button", { name: "Request policy change" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Reason/ }), { target: { value: "Single-officer office" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Request submitted"));
    const put = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PUT")!;
    expect(String(put[0])).toBe(`/api/proxy/v1/admin/tenants/${TID}/approval-policy`);
    expect(JSON.parse((put[1] as RequestInit).body as string)).toEqual({ policy: { ...policy, requiresSecondApprover: false }, reason: "Single-officer office" });
  }, 15000);

  it("is read-only while a policy change is waiting for approval", () => {
    card({ pending: request({ kind: "policy_change" }) });
    expect(screen.getByText(/waiting for approval/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request policy change" })).toBeDisabled();
  });

  it("a failed policy load is an error, not defaults", () => {
    card({ source: "error" });
    expect(screen.getByRole("alert")).toHaveTextContent(/could not be loaded/);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
