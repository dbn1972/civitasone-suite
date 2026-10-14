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

/**
 * Client-side zod mirror of createPolicyBody (leavePolicySchema.ts): a field
 * the old hand-rolled check never covered (max continuous days >= 1) now
 * blocks submit with an inline, field-tied message and never opens the
 * confirm dialog or POSTs.
 */
describe("CreateLeavePolicyForm — inline validation", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("blocks submit on an out-of-range max continuous days and shows the message on that field", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ data: LEAVE_TYPES }), { status: 200 })),
    );
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <CreateLeavePolicyForm />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /new policy/i }));
    await waitFor(() => expect(screen.getByRole("option", { name: /earned leave/i })).toBeInTheDocument());
    const maxContinuous = screen.getByLabelText(/max continuous/i);
    fireEvent.change(maxContinuous, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /create policy/i }));

    await waitFor(() => expect(maxContinuous).toHaveAttribute("aria-invalid", "true"));
    expect(document.getElementById(maxContinuous.getAttribute("aria-describedby") ?? "")).toHaveTextContent(/1-730/);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/proxy/v1/hrms/admin/leave-policies", expect.anything());
  });
});
