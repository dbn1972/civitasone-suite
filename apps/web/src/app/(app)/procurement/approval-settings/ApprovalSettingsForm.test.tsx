import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

import { ApprovalSettingsForm, draftToMatrix, type ApprovalSettings } from "./ApprovalSettingsForm";

const DEFAULTS: ApprovalSettings = {
  mode: "local", source: "derived", override: null, isDefaultMatrix: true,
  matrix: [
    { upToMinor: "5000000", approverRoles: ["procurement_officer", "procurement_admin"] },
    { upToMinor: "100000000", approverRoles: ["procurement_admin"] },
    { upToMinor: null, approverRoles: ["super_admin"] },
  ],
};
function renderForm(initial = DEFAULTS, canEdit = true, locale: "en" | "hi" = "en") {
  render(
    <NextIntlClientProvider locale={locale} messages={(locale === "hi" ? hiMessages : enMessages) as never}>
      <ApprovalSettingsForm initial={initial} canEdit={canEdit} />
    </NextIntlClientProvider>,
  );
}

describe("draftToMatrix", () => {
  it("turns rupee limits into exact paise strings and leaves the last band unbounded", () => {
    expect(draftToMatrix([{ limit: "50000", roles: ["procurement_officer"] }, { limit: "", roles: ["super_admin"] }]))
      .toEqual({ matrix: [{ upToMinor: "5000000", approverRoles: ["procurement_officer"] }, { upToMinor: null, approverRoles: ["super_admin"] }] });
    expect(draftToMatrix([{ limit: "100000.50", roles: ["procurement_admin"] }, { limit: "", roles: ["super_admin"] }]))
      .toEqual({ matrix: [{ upToMinor: "10000050", approverRoles: ["procurement_admin"] }, { upToMinor: null, approverRoles: ["super_admin"] }] });
  });
  it("refuses an unreadable limit and a band with no role", () => {
    expect(draftToMatrix([{ limit: "abc", roles: ["procurement_admin"] }, { limit: "", roles: ["super_admin"] }])).toEqual({ errorKey: "limitInvalid" });
    expect(draftToMatrix([{ limit: "10", roles: [] }, { limit: "", roles: ["super_admin"] }])).toEqual({ errorKey: "rolesRequired" });
  });
});

describe("ApprovalSettingsForm", () => {
  beforeEach(() => { vi.restoreAllMocks(); refresh.mockReset(); });

  it("shows the mode, the built-in default note and the bands with their limits in rupees", () => {
    renderForm();
    expect(screen.getByText(/does not use the Finance module/)).toBeInTheDocument();
    expect(screen.getByText(/built-in limits/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("50000.00")).toBeInTheDocument();
    expect(screen.getByDisplayValue("1000000.00")).toBeInTheDocument();
    expect(screen.getByText("Band 3")).toBeInTheDocument();
  });

  it("saves the matrix and the mode override together", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "t", status: "accepted" }), { status: 202 }));
    renderForm();
    fireEvent.change(screen.getByDisplayValue("50000.00"), { target: { value: "75000" } });
    fireEvent.change(screen.getByLabelText("Mode"), { target: { value: "local" } });
    fireEvent.click(screen.getByText("Save limits"));
    await waitFor(() => expect(screen.getByText("Approval limits saved.")).toBeInTheDocument());
    const call = spy.mock.calls[0]!;
    expect(String(call[0])).toContain("v1/procurement/po-approval-settings");
    expect((call[1] as RequestInit).method).toBe("PUT");
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({
      modeOverride: "local",
      matrix: [
        { upToMinor: "7500000", approverRoles: ["procurement_officer", "procurement_admin"] },
        { upToMinor: "100000000", approverRoles: ["procurement_admin"] },
        { upToMinor: null, approverRoles: ["super_admin"] },
      ],
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("does not send a limit that is not a rupee amount, and shows why", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    renderForm();
    fireEvent.change(screen.getByDisplayValue("50000.00"), { target: { value: "lots" } });
    fireEvent.click(screen.getByText("Save limits"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/rupee amount/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("shows the server's reason when a save is refused", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "INVALID_MATRIX", message: "band 2: the limit must be above the previous band's limit" }), { status: 400 }));
    renderForm();
    fireEvent.click(screen.getByText("Save limits"));
    expect(await screen.findByRole("alert")).toHaveTextContent("band 2: the limit must be above the previous band's limit");
  });

  it("adds a band before the unbounded one and removes a band", () => {
    renderForm();
    fireEvent.click(screen.getByText("Add a band"));
    expect(screen.getByText("Band 4")).toBeInTheDocument();
    fireEvent.click(screen.getAllByText("Remove this band")[0]!);
    expect(screen.queryByText("Band 4")).toBeNull();
  });

  it("a user who cannot configure sees the limits read-only", () => {
    renderForm(DEFAULTS, false);
    expect(screen.queryByText("Save limits")).toBeNull();
    expect(screen.getByText("Only a procurement admin can change the approval limits.")).toBeInTheDocument();
    expect(screen.getByDisplayValue("50000.00")).toBeDisabled();
  });

  it("describes a finance-sanction tenant and is translated in Hindi", () => {
    renderForm({ ...DEFAULTS, mode: "finance_sanction", isDefaultMatrix: true });
    expect(screen.getByText(/uses the Finance module/)).toBeInTheDocument();
    renderForm(DEFAULTS, true, "hi");
    expect(screen.getByText("स्वीकृति मोड")).toBeInTheDocument();
  });
});
