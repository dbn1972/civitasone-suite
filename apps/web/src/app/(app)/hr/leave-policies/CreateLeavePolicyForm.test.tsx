import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { CreateLeavePolicyForm } from "./CreateLeavePolicyForm";

const LEAVE_TYPES = [{ id: "lt1", code: "EL", name: "Earned Leave" }];

/**
 * UX-016: this used to show the raw backend response text (falling back to
 * `Failed to create policy (${res.status})`) verbatim — the same class of
 * leak useFormError closes fleet-wide (UX-003).
 */
describe("CreateLeavePolicyForm — UX-016 clerk-safe errors", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  async function openConfirmSave() {
    fetchMock.mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/hrms/leave-types")) {
        return Promise.resolve(new Response(JSON.stringify({ data: LEAVE_TYPES }), { status: 200 }));
      }
      return Promise.resolve(new Response("policy-service create-policy trace: NPE at line 88", { status: 500 }));
    });
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <CreateLeavePolicyForm />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /new policy/i }));
    await waitFor(() => expect(screen.getByLabelText(/leave type/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /create policy/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /create policy/i }));
  }

  it("shows a clerk-safe message, never the raw server text or status, when creation fails", async () => {
    await openConfirmSave();

    await waitFor(() => expect(screen.getByRole("alertdialog")).toHaveTextContent(/couldn't save/i));
    const dialogText = screen.getByRole("alertdialog").textContent ?? "";
    expect(dialogText).not.toMatch(/policy-service/);
    expect(dialogText).not.toMatch(/\b500\b/);
  });
});

/**
 * Stale i18n closure regression: the leave-types load effect's .catch()
 * calls t("couldNotLoadLeaveTypes"), but `t` was missing from the effect's
 * dependency array (only [open, leaveTypes.length]) -- so it kept using
 * whatever `t` was in scope when the effect last actually ran, regardless
 * of a later locale switch, until `open`/`leaveTypes.length` changed again.
 */
describe("CreateLeavePolicyForm — locale-safe load-error message", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows the load-failure message in the new language after a locale switch, not the one active when the panel first opened", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));

    const { rerender } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <CreateLeavePolicyForm />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /new policy/i }));
    await waitFor(() => expect(screen.getByText("Could not load leave types.")).toBeInTheDocument());

    // The panel is still open and leaveTypes is still empty (the load
    // failed) -- only `t` itself changes here, exactly the case the missing
    // dependency mishandled.
    rerender(
      <NextIntlClientProvider locale="hi" messages={hiMessages}>
        <CreateLeavePolicyForm />
      </NextIntlClientProvider>,
    );

    await waitFor(() => expect(screen.getByText("अवकाश प्रकार लोड नहीं हो सके।")).toBeInTheDocument());
    expect(screen.queryByText("Could not load leave types.")).not.toBeInTheDocument();
  });
});
