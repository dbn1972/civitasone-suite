import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const browserFetch = vi.fn();
vi.mock("@/lib/api/browserClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/browserClient")>("@/lib/api/browserClient");
  return { ...actual, browserFetch: (...a: unknown[]) => browserFetch(...a) };
});

import { CaseActions, buildPayload } from "./CaseActions";

beforeEach(() => { browserFetch.mockReset(); refresh.mockClear(); });

function renderActions(p: Partial<React.ComponentProps<typeof CaseActions>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <CaseActions caseId="case-1" status="opened" proceedingType="major" roles={["hr_admin"]} isOwner {...p} />
    </NextIntlClientProvider>,
  );
}

describe("CaseActions (GAP-HR-DISCIPLINARY-DETAIL-06)", () => {
  it("shows the next transition for an owner and advances via the real route", async () => {
    browserFetch.mockResolvedValue(new Response(JSON.stringify({ status: "charge_memo_issued" }), { status: 200 }));
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: /issue charge memo/i }));
    expect(screen.getAllByRole("button", { name: /issue charge memo/i }).at(-1)).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/charge memo reference/i), { target: { value: "CM/2026/9" } });
    fireEvent.change(screen.getByLabelText(/charge memo date/i), { target: { value: "2026-03-01" } });
    fireEvent.click(screen.getAllByRole("button", { name: /issue charge memo/i }).at(-1)!);
    await waitFor(() => expect(browserFetch).toHaveBeenCalledTimes(1));
    const [path, init] = browserFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("v1/hrms/disciplinary-cases/case-1/charge-memo");
    expect(JSON.parse(init.body as string)).toEqual({ chargeMemoRef: "CM/2026/9", chargeMemoDate: "2026-03-01" });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(await screen.findByRole("status")).toHaveTextContent(/submitted/i);
  });

  it("shows no action buttons to a non-owner, only an explanation", () => {
    renderActions({ isOwner: false });
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/only the case creator or the assigned inquiry officer/i)).toBeInTheDocument();
  });

  it("hides HR-only actions from an hr_officer", () => {
    renderActions({ roles: ["hr_officer"] });
    expect(screen.getByRole("button", { name: /issue charge memo/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /drop case/i })).toBeNull();
  });

  it("shows a clear message when the backend answers 403 NOT_CASE_OWNER", async () => {
    browserFetch.mockResolvedValue(new Response(JSON.stringify({ code: "NOT_CASE_OWNER" }), { status: 403, headers: { "content-type": "application/json" } }));
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: /issue charge memo/i }));
    fireEvent.change(screen.getByLabelText(/charge memo reference/i), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText(/charge memo date/i), { target: { value: "2026-03-01" } });
    fireEvent.click(screen.getAllByRole("button", { name: /issue charge memo/i }).at(-1)!);
    expect(await screen.findByText(/neither the creator nor the assigned inquiry officer/i)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("offers only minor penalties in a minor proceeding", () => {
    renderActions({ status: "charge_memo_issued", proceedingType: "minor" });
    fireEvent.click(screen.getByRole("button", { name: /impose penalty/i }));
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toContain("Censure");
    expect(options).not.toContain("Dismissal");
  });

  it("renders nothing for a terminal case but explains there is nothing to do", () => {
    renderActions({ status: "closed" });
    expect(screen.getByText(/no further actions/i)).toBeInTheDocument();
  });
});

describe("buildPayload", () => {
  it("rejects missing required fields and malformed dates", () => {
    expect(buildPayload("charge_memo", { chargeMemoRef: "a" }, undefined)).toBeNull();
    expect(buildPayload("charge_memo", { chargeMemoRef: "a", chargeMemoDate: "01-03-2026" }, undefined)).toBeNull();
  });
  it("maps the finding note to findingNotes and other notes to notes", () => {
    expect(buildPayload("finding", { finding: "guilty", findingDate: "2026-03-01" }, "n")).toEqual({ finding: "guilty", findingDate: "2026-03-01", findingNotes: "n" });
    expect(buildPayload("drop", {}, "why")).toEqual({ notes: "why" });
  });
});
