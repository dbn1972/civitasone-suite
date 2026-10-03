import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { ExpenseApprovalActions } from "./ExpenseApprovalActions";

const CLAIM_ID = "claim-123";

function renderActions() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ExpenseApprovalActions id={CLAIM_ID} />
    </NextIntlClientProvider>,
  );
}

describe("ExpenseApprovalActions — GAP-HR-EXPENSES-02", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    refreshMock.mockReset();
    fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ id: CLAIM_ID, status: "approved" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("approve calls PATCH .../approve with no body", async () => {
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^approve$/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `/api/proxy/v1/hrms/expenses/${CLAIM_ID}/approve`,
      expect.objectContaining({ method: "PATCH" }),
    ));
    expect(refreshMock).toHaveBeenCalled();
  });

  it("reject's Confirm button stays disabled until a reason of at least 3 characters is typed, matching the backend's mandatory-reason validation", async () => {
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: /^reject$/i }));

    const dialog = await screen.findByRole("alertdialog");
    const confirmBtn = within(dialog).getByRole("button", { name: /^reject$/i });
    expect(confirmBtn).toBeDisabled();

    const reasonField = within(dialog).getByLabelText(/reason for rejection/i);
    fireEvent.change(reasonField, { target: { value: "no" } }); // 2 chars, below min 3
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(reasonField, { target: { value: "Missing receipt" } });
    expect(confirmBtn).not.toBeDisabled();
  });

  it("reject calls PATCH .../reject with the typed reason once it is long enough", async () => {
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: /^reject$/i }));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/reason for rejection/i), { target: { value: "Missing original bill" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^reject$/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `/api/proxy/v1/hrms/expenses/${CLAIM_ID}/reject`,
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ reason: "Missing original bill" }) }),
    ));
  });

  it("shows a clerk-safe fallback message, never the raw HTTP status, when a decision fails (e.g. the self-approval 403)", async () => {
    // "SELF_APPROVAL" is not one of useFormError's catalogued CODE_TO_KIND
    // entries (lib/useFormError.ts), so this -- correctly, by that hook's own
    // "never echo code/message/status to the user" design -- falls back to
    // the generic clerk-safe "save" message rather than surfacing the
    // backend's own, more specific "Cannot approve your own expense claim"
    // text. Adding a SELF_APPROVAL entry there would give a clearer message,
    // but useFormError.ts is shared across every feature in this app, not
    // just /hr/expenses -- out of this change's file scope, noted in the PR
    // description as a follow-up rather than done here.
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: "SELF_APPROVAL", message: "Cannot approve your own expense claim" }), { status: 403 }));
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^approve$/i }));

    await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("You can't approve your own request. Another approver needs to do this."));
    const alertText = within(dialog).getByRole("alert").textContent ?? "";
    expect(alertText).not.toMatch(/\b403\b/);
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
