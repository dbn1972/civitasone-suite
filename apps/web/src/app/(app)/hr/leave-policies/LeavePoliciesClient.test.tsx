import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import LeavePoliciesClient from "./LeavePoliciesClient";

const EL_POLICY = {
  id: "p1",
  leaveTypeCode: "EL",
  leaveTypeName: "Earned Leave",
  employeeType: "vendor_deputed",
  maxDaysPerYear: 30,
  carryForward: true,
  maxAccumulation: 60,
  encashable: true,
  countMethod: "calendar",
  maxContinuousDays: 365,
  minServiceMonths: 0,
  genderRestriction: null,
  requiresMedicalCert: false,
  requiresMedicalCertAfterDays: 3,
  prefixSuffixRule: false,
  sandwichRule: false,
  proRataOnJoining: true,
  isActive: true,
};

const CL_POLICY = {
  ...EL_POLICY,
  id: "p2",
  leaveTypeCode: "CL",
  leaveTypeName: "Casual Leave",
  employeeType: "consultant",
  isActive: false,
};

function renderClient() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <LeavePoliciesClient />
    </NextIntlClientProvider>,
  );
}

describe("LeavePoliciesClient", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  function mockList(policies: typeof EL_POLICY[]) {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/admin/leave-policies") && (!init || init.method === undefined)) {
        return Promise.resolve(new Response(JSON.stringify({ data: policies }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ id: "x", status: "accepted", correlationId: "c1" }), { status: 202 }));
    });
  }

  // GAP-HR-LEAVE-POLICIES-07
  it("shows real translated employee-type labels, not raw snake_case text", async () => {
    mockList([EL_POLICY]);
    renderClient();
    await waitFor(() => expect(screen.getByText("Earned Leave")).toBeInTheDocument());
    expect(screen.getAllByText("Vendor Deputed").length).toBeGreaterThan(0);
    expect(screen.queryByText("vendor_deputed")).not.toBeInTheDocument();
    expect(screen.queryByText(/vendor deputed$/)).not.toBeInTheDocument(); // lowercase-with-space form should not appear either
  });

  // GAP-HR-LEAVE-POLICIES-04
  it("renders an Active/Inactive status pill per row", async () => {
    mockList([EL_POLICY, CL_POLICY]);
    const { container } = renderClient();
    await waitFor(() => expect(screen.getByText("Earned Leave")).toBeInTheDocument());
    // Scoped to StatusPill's own ".pill" markup — "Active" also appears as
    // the (unrelated) statActive StatCard label elsewhere on the page.
    const pills = Array.from(container.querySelectorAll(".pill")).map((el) => el.textContent);
    expect(pills).toContain("Active");
    expect(pills).toContain("Inactive");
  });

  it("deactivating an active policy requires a reason and updates the row on success", async () => {
    mockList([EL_POLICY]);
    renderClient();
    await waitFor(() => expect(screen.getByText("Earned Leave")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^deactivate$/i }));
    const dialog = await screen.findByRole("alertdialog");
    const confirmBtn = within(dialog).getByRole("button", { name: /^deactivate$/i });
    expect(confirmBtn).toBeDisabled(); // no reason typed yet

    fireEvent.change(within(dialog).getByLabelText(/reason for deactivating/i), { target: { value: "Scheme withdrawn for this vendor category" } });
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^deactivate$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^reactivate$/i })).toBeInTheDocument();
  });

  it("reactivating an inactive policy needs no reason/confirm", async () => {
    mockList([CL_POLICY]);
    renderClient();
    await waitFor(() => expect(screen.getByText("Casual Leave")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^reactivate$/i }));

    await waitFor(() => expect(screen.getByText("Active")).toBeInTheDocument());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  // GAP-HR-LEAVE-POLICIES-05
  it("prompts to discard unsaved changes before switching the edit target to a different row", async () => {
    mockList([EL_POLICY, CL_POLICY]);
    renderClient();
    await waitFor(() => expect(screen.getByText("Earned Leave")).toBeInTheDocument());

    const editButtons = screen.getAllByRole("button", { name: /^edit$/i });
    fireEvent.click(editButtons[0]!); // start editing EL_POLICY
    const daysInputs = screen.getAllByRole("spinbutton", { name: /days per year/i });
    fireEvent.change(daysInputs[0]!, { target: { value: "45" } }); // make it dirty

    // Clicking Edit on the OTHER row (still labelled "Edit" since it isn't being edited)
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));

    const discardDialog = await screen.findByRole("alertdialog");
    expect(discardDialog).toHaveTextContent(/unsaved changes/i);

    // Cancelling keeps the original edit (45 still showing, not reset to 30)
    fireEvent.click(within(discardDialog).getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("45")).toBeInTheDocument();
  });

  // GAP-HR-LEAVE-POLICIES-03
  it("shows a 'submitted' toast (not 'updated') and applies the edit optimistically after saving", async () => {
    mockList([EL_POLICY]);
    renderClient();
    await waitFor(() => expect(screen.getByText("Earned Leave")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    const daysInput = screen.getByRole("spinbutton", { name: /days per year/i });
    fireEvent.change(daysInput, { target: { value: "22" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(screen.getByText(/change submitted/i)).toBeInTheDocument());
    expect(screen.queryByText(/policy updated successfully/i)).not.toBeInTheDocument();
    expect(screen.getByText("22")).toBeInTheDocument(); // optimistic value, before any refetch
  });
});
