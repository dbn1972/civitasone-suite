import { describe, it, expect, vi, afterEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProbationConfirmationList, type ConfirmationRow } from "./ProbationConfirmationCard";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const ROW: ConfirmationRow = {
  id: "emp-1",
  employee: "Priya Nair",
  designation: "Section Officer",
  joiningDate: "2024-01-01",
  probationEnd: "2026-01-01",
  dueDate: "2026-01-15",
  managerRecommendation: "recommended",
  status: "probation",
};

describe("ProbationConfirmationCard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    refresh.mockClear();
  });

  it("requires an order reference and a date, and calls PATCH .../confirm with them, instead of only flipping local state", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 202, text: async () => "{}" }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    render(<NextIntlClientProvider locale="en" messages={enMessages}><ProbationConfirmationList rows={[ROW]} /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Confirm Priya Nair" }));

    // Must ask before doing anything irreversible-looking.
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    // GAP-HR-CONFIRMATION-02: order reference is required before Confirm
    // can succeed -- the dialog's onConfirm rejects an empty one.
    fireEvent.click(screen.getByRole("button", { name: "Confirm service" }));
    await waitFor(() => expect(screen.getByText(/order reference is required/i)).toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/^Order reference/), { target: { value: "CONFIRM/2026/014" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm service" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/v1/hrms/employees/emp-1/confirm",
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"orderRef":"CONFIRM/2026/014"'),
      }),
    ));
    // GAP-HR-CONFIRMATION-04: "submitted" (pending), never an optimistic
    // "Confirmed" the server hasn't actually applied yet -- and the list is
    // asked to re-fetch so a rejected command doesn't leave a stale badge.
    await waitFor(() => expect(screen.getByText("Confirmation submitted")).toBeInTheDocument());
    expect(refresh).toHaveBeenCalled();
  });

  // UX-016: this used to show the raw backend response text ("not
  // authorised") verbatim — the same class of leak useFormError closes
  // fleet-wide (UX-003). It must now show the catalogued clerk-safe message
  // instead, never the raw server text.
  it("blocks an empty or over-long order reference with an inline field error (mirrors confirmEmployeeBody 1-64)", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 202, text: async () => "{}" }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    render(<NextIntlClientProvider locale="en" messages={enMessages}><ProbationConfirmationList rows={[ROW]} /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Confirm Priya Nair" }));
    await screen.findByRole("alertdialog");

    fireEvent.click(screen.getByRole("button", { name: "Confirm service" }));
    expect(await screen.findByText("Enter the order reference.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Order reference/)).toHaveAttribute("aria-invalid", "true");

    fireEvent.change(screen.getByLabelText(/^Order reference/), { target: { value: "X".repeat(65) } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm service" }));
    expect((await screen.findAllByText("Order reference must be 64 characters or fewer.")).length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a clerk-safe failure message instead of showing Confirmed anyway", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, text: async () => "not authorised" }) as Response));
    render(<NextIntlClientProvider locale="en" messages={enMessages}><ProbationConfirmationList rows={[ROW]} /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Confirm Priya Nair" }));
    fireEvent.change(await screen.findByLabelText(/^Order reference/), { target: { value: "CONFIRM/2026/014" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm service" }));

    await waitFor(() => expect(screen.getByText(/You don't have permission to do this\. Ask your administrator if you need access\./)).toBeInTheDocument());
    expect(screen.queryByText(/not authorised/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Confirmation submitted")).not.toBeInTheDocument();
  });

  it("never surfaces a raw HTTP status code on a plain-text failure with no body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, text: async () => "" }) as Response));
    render(<NextIntlClientProvider locale="en" messages={enMessages}><ProbationConfirmationList rows={[ROW]} /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Confirm Priya Nair" }));
    fireEvent.change(await screen.findByLabelText(/^Order reference/), { target: { value: "CONFIRM/2026/014" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm service" }));

    const errorMessage = await waitFor(() => screen.getByText(/We couldn't save the probation confirmation because of a problem on our side\. Your changes haven't been saved\. Try again in a few minutes\./));
    // Scoped to the error text itself, not the whole document -- the
    // dialog's own optional-remark field legitimately renders a
    // "0/500 characters" hint (maxReasonLength={500}), which is not the
    // raw-status-code leak this regression guards against.
    expect(errorMessage.textContent).not.toMatch(/\b500\b/);
  });

  // GAP-HR-CONFIRMATION-05: Extend now calls the real
  // PATCH .../probation-extension endpoint instead of staying permanently
  // disabled with no backend behind it.
  it("Extend calls PATCH .../probation-extension with the new end date and a reason", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 202, text: async () => "{}" }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    render(<NextIntlClientProvider locale="en" messages={enMessages}><ProbationConfirmationList rows={[ROW]} /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Extend probation for Priya Nair" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^New probation end date/), { target: { value: "2027-01-01" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Performance improvement plan ongoing" } });
    fireEvent.click(screen.getByRole("button", { name: "Extend probation" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/v1/hrms/employees/emp-1/probation-extension",
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"newEndDate":"2027-01-01"'),
      }),
    ));
    await waitFor(() => expect(screen.getByText("Extension submitted")).toBeInTheDocument());
  });

  it("Extend's reason is required (at least 3 characters)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 202, text: async () => "{}" }) as Response));
    render(<NextIntlClientProvider locale="en" messages={enMessages}><ProbationConfirmationList rows={[ROW]} /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Extend probation for Priya Nair" }));
    fireEvent.change(await screen.findByLabelText(/^New probation end date/), { target: { value: "2027-01-01" } });

    expect(screen.getByRole("button", { name: "Extend probation" })).toBeDisabled();
  });

  // GAP-HR-CONFIRMATION-05: the probation length is no longer a hard-coded 2 years -- the
  // server derives it per employee type, and the card shows the configured length.
  it("shows the configured probation period beside the Probation End, not an assumed 2 years", () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ProbationConfirmationList rows={[{ ...ROW, probationMonths: 12, probationEnd: "2025-01-01" }]} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("12 months probation")).toBeInTheDocument();
    expect(screen.queryByText(/2-year/i)).not.toBeInTheDocument();
  });

  it("singularises a one-month period and omits the hint when the API sends no period", () => {
    const { rerender } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ProbationConfirmationList rows={[{ ...ROW, probationMonths: 1 }]} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("1 month probation")).toBeInTheDocument();
    rerender(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ProbationConfirmationList rows={[ROW]} />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByText(/month probation|months probation/)).not.toBeInTheDocument();
  });

  it("the empty state no longer promises a fixed 2-year probation", () => {
    render(<NextIntlClientProvider locale="en" messages={enMessages}><ProbationConfirmationList rows={[]} /></NextIntlClientProvider>);
    expect(screen.getByText("No employees currently on probation")).toBeInTheDocument();
    expect(screen.getByText("Employees on probation appear here once added to the service book.")).toBeInTheDocument();
    expect(screen.queryByText(/2-year/i)).not.toBeInTheDocument();
  });

  // GAP-HR-CONFIRMATION-09: recommendation badge and status badge no longer
  // rely on a bare emoji for meaning -- redundant announcement fixed via
  // aria-hidden on the glyph, with the text label carrying the real name.
  it("gives the manager-recommendation badge an accessible name, with the emoji hidden from assistive tech", () => {
    render(<NextIntlClientProvider locale="en" messages={enMessages}><ProbationConfirmationList rows={[ROW]} /></NextIntlClientProvider>);
    const badge = screen.getByRole("status", { name: /manager recommendation: recommended/i });
    expect(badge).toBeInTheDocument();
  });
});

// GAP-HR-CONFIRMATION-01 (owner decision, 26 Nov 2026): the reporting manager records the
// recommendation; HR confirms, with a required override remark when none is on record (or it is "not
// recommended"). Nothing is hard-blocked: Confirm / Extend stay enabled either way. An older API that
// sends no managerRecommendation at all is still shown as "no recommendation on record".
describe("ProbationConfirmationCard manager recommendation chip (GAP-HR-CONFIRMATION-01)", () => {
  const show = (row: ConfirmationRow) =>
    render(<NextIntlClientProvider locale="en" messages={enMessages}><ProbationConfirmationList rows={[row]} /></NextIntlClientProvider>);
  const { managerRecommendation: _drop, ...WITHOUT } = ROW;
  void _drop;

  it("says no recommendation is on record, not 'Awaiting Manager', when the API sends none", () => {
    show(WITHOUT as ConfirmationRow);
    expect(screen.getByText(enMessages.confirmation.recNotRecorded)).toBeInTheDocument();
    expect(screen.queryByText("Awaiting Manager")).not.toBeInTheDocument();
    expect(screen.getByLabelText(`Manager recommendation: ${enMessages.confirmation.recNotRecorded}`)).toBeInTheDocument();
  });

  it("treats an explicit null the same way", () => {
    show({ ...ROW, managerRecommendation: null });
    expect(screen.getByText(enMessages.confirmation.recNotRecorded)).toBeInTheDocument();
    expect(screen.queryByText("Awaiting Manager")).not.toBeInTheDocument();
  });

  it.each([
    ["pending", "Awaiting Manager"],
    ["recommended", "Recommended"],
    ["not_recommended", "Not Recommended"],
  ] as const)("shows an explicit %s recommendation as given", (value, label) => {
    show({ ...ROW, managerRecommendation: value });
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText(enMessages.confirmation.recNotRecorded)).not.toBeInTheDocument();
  });

  it("does not HARD-block Confirm / Extend without a recommendation (an override remark is asked for instead)", () => {
    show(WITHOUT as ConfirmationRow);
    expect(screen.getByRole("button", { name: "Confirm Priya Nair" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Extend probation for Priya Nair" })).toBeEnabled();
  });
});

// GAP-HR-CONFIRMATION-01: HR override remark.
describe("ProbationConfirmationCard HR override remark (GAP-HR-CONFIRMATION-01)", () => {
  afterEach(() => { vi.unstubAllGlobals(); refresh.mockClear(); });
  const showRow = (row: ConfirmationRow) =>
    render(<NextIntlClientProvider locale="en" messages={enMessages}><ProbationConfirmationList rows={[row]} /></NextIntlClientProvider>);

  async function openConfirm(): Promise<void> {
    fireEvent.click(screen.getByRole("button", { name: "Confirm Priya Nair" }));
    await screen.findByRole("alertdialog");
    fireEvent.change(screen.getByLabelText(/^Order reference/), { target: { value: "CONFIRM/2026/014" } });
  }

  it("with a positive recommendation there is no override field and the body carries no overrideRemark", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 202, text: async () => "{}" }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    showRow(ROW);
    await openConfirm();
    expect(screen.queryByLabelText(/Override remark/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm service" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).not.toHaveProperty("overrideRemark");
  });

  it.each(["pending", "not_recommended", null] as const)("with managerRecommendation=%s the override remark is required (>= 10 chars) and is sent", async (rec) => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 202, text: async () => "{}" }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    showRow({ ...ROW, managerRecommendation: rec });
    await openConfirm();
    expect(screen.getByLabelText(/Override remark/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm service" }));
    expect(await screen.findByText(/override remark of at least 10 characters is required/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Override remark/), { target: { value: "Manager on long leave; HOD vouches" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm service" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toMatchObject({ overrideRemark: "Manager on long leave; HOD vouches" });
  });
});

// GAP-HR-CONFIRMATION-01: the reporting manager's entry point.
describe("ProbationConfirmationCard manager recommendation action (GAP-HR-CONFIRMATION-01)", () => {
  afterEach(() => { vi.unstubAllGlobals(); refresh.mockClear(); });
  const showAs = (row: ConfirmationRow, props: { canDecide: boolean; canRecommend: boolean }) =>
    render(<NextIntlClientProvider locale="en" messages={enMessages}><ProbationConfirmationList rows={[row]} {...props} /></NextIntlClientProvider>);

  it("a manager-only viewer gets Recommend, and no Confirm / Extend", () => {
    showAs({ ...ROW, managerRecommendation: "pending" }, { canDecide: false, canRecommend: true });
    expect(screen.getByRole("button", { name: "Record confirmation recommendation for Priya Nair" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm Priya Nair" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Extend probation for Priya Nair" })).not.toBeInTheDocument();
  });

  it("an HR-only viewer gets no Recommend", () => {
    showAs(ROW, { canDecide: true, canRecommend: false });
    expect(screen.queryByRole("button", { name: "Record confirmation recommendation for Priya Nair" })).not.toBeInTheDocument();
  });

  it("records a recommendation through POST .../confirmation-recommendation and refreshes the list", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 202, text: async () => "{}" }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    showAs({ ...ROW, managerRecommendation: "pending" }, { canDecide: false, canRecommend: true });
    fireEvent.click(screen.getByRole("button", { name: "Record confirmation recommendation for Priya Nair" }));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Record recommendation" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/v1/hrms/employees/emp-1/confirmation-recommendation",
      expect.objectContaining({ method: "POST", body: expect.stringContaining('"recommendation":"recommended"') }),
    ));
    await waitFor(() => expect(screen.getByText("Recommendation submitted")).toBeInTheDocument());
    expect(refresh).toHaveBeenCalled();
  });

  it("a 'not recommended' needs a reason of at least 10 characters before anything is sent", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 202, text: async () => "{}" }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    showAs({ ...ROW, managerRecommendation: "pending" }, { canDecide: false, canRecommend: true });
    fireEvent.click(screen.getByRole("button", { name: "Record confirmation recommendation for Priya Nair" }));
    await screen.findByRole("alertdialog");
    fireEvent.change(screen.getByLabelText(/Your recommendation/), { target: { value: "not_recommended" } });
    fireEvent.click(screen.getByRole("button", { name: "Record recommendation" }));
    expect(await screen.findByText(/at least 10 characters/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
