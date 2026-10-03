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
  it("edits in a labelled drawer (not inline) and the table stays read-only", async () => {
    mockList([EL_POLICY, CL_POLICY]);
    renderClient();
    await waitFor(() => expect(screen.getByText("Earned Leave")).toBeInTheDocument());

    // no inline inputs while nothing is being edited
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /^edit$/i })[0]!);

    const dialog = await screen.findByRole("dialog");
    // all 12 editable fields, each with a visible label
    for (const label of [/days per year/i, /max accumulation/i, /max continuous/i, /min service/i, /med cert required after/i, /count method/i]) {
      expect(within(dialog).getByLabelText(label)).toBeInTheDocument();
    }
    for (const label of [/carry forward/i, /encashable/i, /requires medical certificate/i, /prefix\/suffix rule/i, /sandwich rule/i, /pro-rata on joining/i]) {
      expect(within(dialog).getByRole("checkbox", { name: label })).toBeInTheDocument();
    }
  });

  it("asks before discarding unsaved drawer edits, and keeps them if the user keeps editing", async () => {
    mockList([EL_POLICY]);
    renderClient();
    await waitFor(() => expect(screen.getByText("Earned Leave")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/days per year/i), { target: { value: "45" } });

    fireEvent.click(within(dialog).getByRole("button", { name: /^cancel$/i }));
    expect(within(dialog).getByText(/discard unsaved changes/i)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: /keep editing/i }));
    expect(within(dialog).queryByText(/discard unsaved changes/i)).not.toBeInTheDocument();
    expect(within(dialog).getByDisplayValue("45")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: /^cancel$/i }));
    fireEvent.click(within(dialog).getByRole("button", { name: /discard changes/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("30")).toBeInTheDocument(); // original value, edit discarded
  });

  it("closes a clean drawer without a discard prompt", async () => {
    mockList([EL_POLICY]);
    renderClient();
    await waitFor(() => expect(screen.getByText("Earned Leave")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^cancel$/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  // GAP-HR-LEAVE-POLICIES-03
  it("shows a 'submitted' toast (not 'updated') and applies the edit optimistically after saving", async () => {
    mockList([EL_POLICY]);
    renderClient();
    await waitFor(() => expect(screen.getByText("Earned Leave")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/days per year/i), { target: { value: "22" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(screen.getByText(/change submitted/i)).toBeInTheDocument());
    expect(screen.queryByText(/policy updated successfully/i)).not.toBeInTheDocument();
    expect(screen.getByText("22")).toBeInTheDocument(); // optimistic value, before any refetch
    const patch = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PATCH");
    expect(JSON.parse(String((patch![1] as RequestInit).body))).toMatchObject({ maxDaysPerYear: 22, prefixSuffixRule: false, proRataOnJoining: true });
  });
});
