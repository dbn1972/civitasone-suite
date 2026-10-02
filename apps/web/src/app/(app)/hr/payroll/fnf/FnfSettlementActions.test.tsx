import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));
const browserFetchMock = vi.fn();
vi.mock("@/lib/api/browserClient", async (io) => ({
  ...(await io<typeof import("@/lib/api/browserClient")>()),
  browserFetch: (...a: unknown[]) => browserFetchMock(...a),
}));

import { FnfSettlementActions, type FnfActionRow } from "./FnfSettlementActions";
import { fnfAvailability, todayIst } from "./fnfWorkflow";

const ME = "11111111-0000-4000-8000-0000000000aa";
const OTHER = "22222222-0000-4000-8000-0000000000bb";
const ID = "33333333-0000-4000-8000-0000000000cc";

const base: FnfActionRow = {
  id: ID, name: "Meera Iyer", netPayableMinor: "1030000", status: "computed", version: 3,
  computedBy: OTHER, submittedBy: null, financeApprovedBy: null,
};

function renderActions(row: Partial<FnfActionRow>, roles: string[] = ["payroll_admin"]) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <FnfSettlementActions row={{ ...base, ...row }} viewer={{ userId: ME, roles }} />
    </NextIntlClientProvider>,
  );
}

const ok = () => new Response(JSON.stringify({ id: ID, status: "accepted" }), { status: 202 });
const fail = (status: number, code: string) => new Response(JSON.stringify({ code, message: "raw server text" }), { status });

function lastCall(): { path: string; body: Record<string, unknown> } {
  const [path, init] = browserFetchMock.mock.calls.at(-1) as [string, { body: string }];
  return { path, body: JSON.parse(init.body) as Record<string, unknown> };
}

beforeEach(() => {
  browserFetchMock.mockReset();
  refreshMock.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("FnfSettlementActions (GAP-PAYROLL-FNF-01)", () => {
  it("submit: confirm dialog, posts the loaded version, async-aware success copy, refreshes", async () => {
    browserFetchMock.mockResolvedValue(ok());
    renderActions({ status: "computed" });
    fireEvent.click(screen.getByRole("button", { name: /submit the settlement for meera iyer/i }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("₹10,300.00");
    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/status will update in a few seconds/));
    expect(lastCall()).toEqual({ path: `v1/payroll/fnf/settlements/${ID}/submit`, body: { version: 3 } });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("reject: danger dialog, Confirm disabled until a 10+ character reason, reason is posted", async () => {
    browserFetchMock.mockResolvedValue(ok());
    renderActions({ status: "submitted", submittedBy: OTHER });
    fireEvent.click(screen.getByRole("button", { name: /reject the settlement/i }));
    const dialog = screen.getByRole("alertdialog");
    const confirm = screen.getAllByRole("button", { name: "Reject" }).at(-1)!;
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason for rejection"), { target: { value: "too short" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason for rejection"), { target: { value: "gratuity years are wrong" } });
    expect(confirm).toBeEnabled();
    expect(dialog).toBeInTheDocument();
    fireEvent.click(confirm);
    await waitFor(() => expect(browserFetchMock).toHaveBeenCalled());
    expect(lastCall()).toEqual({ path: `v1/payroll/fnf/settlements/${ID}/reject`, body: { version: 3, reason: "gratuity years are wrong" } });
  });

  it("disburse: needs a valid payment reference and a non-future date, posts both", async () => {
    browserFetchMock.mockResolvedValue(ok());
    renderActions({ status: "finance_approved", submittedBy: OTHER, financeApprovedBy: OTHER });
    fireEvent.click(screen.getByRole("button", { name: /record the payment/i }));
    const confirm = screen.getByRole("button", { name: "Mark disbursed" });
    expect(confirm).toBeDisabled();
    const ref = screen.getByLabelText(/payment reference/i);
    fireEvent.change(ref, { target: { value: "UTR 1; x" } });
    expect(screen.getByText(/Use 4 to 64 letters/)).toBeInTheDocument();
    expect(confirm).toBeDisabled();
    fireEvent.change(ref, { target: { value: "SBIN-UTR-0001" } });
    fireEvent.change(screen.getByLabelText(/payment date/i), { target: { value: "2999-01-01" } });
    expect(screen.getByText(/cannot be in the future/)).toBeInTheDocument();
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/payment date/i), { target: { value: "2026-09-30" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(browserFetchMock).toHaveBeenCalled());
    expect(lastCall()).toEqual({
      path: `v1/payroll/fnf/settlements/${ID}/disburse`,
      body: { version: 3, paymentReference: "SBIN-UTR-0001", paymentDate: "2026-09-30" },
    });
  });

  it.each([
    [409, "FNF_VERSION_CONFLICT", /changed since the page loaded/],
    [409, "FNF_INVALID_TRANSITION", /changed since the page loaded/],
    [403, "FNF_SELF_APPROVAL_FORBIDDEN", /you cannot approve or reject it/],
  ])("a %s %s from the server is shown as a plain sentence in the dialog", async (status, code, text) => {
    browserFetchMock.mockResolvedValue(fail(status, code));
    renderActions({ status: "submitted", submittedBy: OTHER });
    fireEvent.click(screen.getByRole("button", { name: /finance-approve the settlement/i }));
    fireEvent.click(screen.getAllByRole("button", { name: "Finance approve" }).at(-1)!);
    await waitFor(() => expect(screen.getByRole("alertdialog")).toHaveTextContent(text));
    expect(screen.getByRole("alertdialog")).not.toHaveTextContent("raw server text");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("the delayed follow-up refresh fires while mounted, and is cancelled on unmount (no leak into the next page/test)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    browserFetchMock.mockResolvedValue(ok());
    const first = renderActions({ status: "computed" });
    fireEvent.click(screen.getByRole("button", { name: /submit the settlement/i }));
    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    vi.advanceTimersByTime(2500);
    expect(refreshMock).toHaveBeenCalledTimes(2);
    first.unmount();

    refreshMock.mockReset();
    const second = renderActions({ status: "computed" });
    fireEvent.click(screen.getByRole("button", { name: /submit the settlement/i }));
    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    second.unmount();
    vi.advanceTimersByTime(5000);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("renders nothing for a status with no next step", () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <FnfSettlementActions row={{ ...base, status: "disbursed" }} viewer={{ userId: ME, roles: ["payroll_admin"] }} />
      </NextIntlClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("fnfAvailability mirrors payroll-service fnf/workflow.ts", () => {
  const v = (roles: string[], userId: string | null = ME) => ({ userId, roles });
  it.each([
    ["draft", {}, ["payroll_officer"], ["submit"], false],
    ["computed", {}, ["payroll_admin"], ["submit"], false],
    ["computed", {}, ["super_admin"], [], false],
    ["computed", {}, ["finance_officer"], [], false],
    ["submitted", { submittedBy: OTHER }, ["finance_officer"], ["finance-approve", "reject"], false],
    ["submitted", { submittedBy: ME }, ["payroll_admin"], [], true],
    ["submitted", { submittedBy: OTHER, computedBy: ME }, ["finance_officer"], [], true],
    ["submitted", { submittedBy: OTHER }, ["payroll_officer"], [], false],
    ["submitted", { submittedBy: OTHER }, ["super_admin"], [], false],
    ["finance_approved", { financeApprovedBy: OTHER }, ["super_admin"], ["disburse", "reject"], false],
    ["finance_approved", { financeApprovedBy: ME }, ["payroll_admin"], [], true],
    ["finance_approved", { financeApprovedBy: OTHER, submittedBy: ME }, ["payroll_admin"], [], true],
    ["finance_approved", { financeApprovedBy: OTHER, computedBy: ME }, ["super_admin"], [], true],
    ["finance_approved", { financeApprovedBy: OTHER }, ["finance_officer"], [], false],
    ["disbursed", {}, ["payroll_admin", "super_admin"], [], false],
    ["rejected", {}, ["payroll_admin"], [], false],
  ] as const)("%s %j as %j -> %j (selfExcluded=%s)", (status, extra, roles, actions, selfExcluded) => {
    expect(fnfAvailability({ status, version: 1, computedBy: OTHER, ...extra }, v([...roles]))).toEqual({ actions, selfExcluded });
  });

  it("no actions without a version or a signed-in user", () => {
    expect(fnfAvailability({ status: "computed" }, v(["payroll_admin"])).actions).toEqual([]);
    expect(fnfAvailability({ status: "computed", version: 1 }, v(["payroll_admin"], null)).actions).toEqual([]);
  });

  it("todayIst is the Indian calendar date", () => {
    expect(todayIst(new Date("2026-10-01T19:00:00Z"))).toBe("2026-10-02");
  });
});

describe("boundaries and i18n", () => {
  it("client modules never import server-only code", () => {
    for (const f of ["FnfSettlementActions.tsx", "FnFSettlementCard.tsx", "fnfWorkflow.ts"]) {
      const src = readFileSync(join(__dirname, f), "utf8");
      const imports = src.match(/^import[^;]*;/gm) ?? [];
      for (const line of imports) expect(line, f).not.toMatch(/_data\/apiClient|next\/headers|server-only|auth\/roleGuard/);
    }
  });

  it("en and hi have the same fnfSettlementActions keys and placeholders", () => {
    const en: Record<string, string> = enMessages.fnfSettlementActions;
    const hi: Record<string, string> = hiMessages.fnfSettlementActions;
    expect(Object.keys(hi).sort()).toEqual(Object.keys(en).sort());
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of Object.keys(en)) expect(ph(hi[k]!), k).toEqual(ph(en[k]!));
  });
});
