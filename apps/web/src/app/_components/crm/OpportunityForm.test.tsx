import { NextIntlClientProvider } from "next-intl";
import { renderWithIntl } from "@/lib/testUtils/intl";
import enMessages from "@/messages/en.json";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OpportunityForm } from "./OpportunityForm";
import * as op from "@/lib/crm/opportunity";

vi.mock("@/lib/crm/opportunity", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/opportunity")>();
  return { ...actual, getPipelines: vi.fn(), createOpportunity: vi.fn(), updateOpportunity: vi.fn() };
});

const pipeline: op.Pipeline = {
  id: "p1",
  name: "Enterprise",
  enabled: true,
  stages: [
    { key: "qual", name: "Qualify", mandatoryFields: [], gate: false },
    { key: "propose", name: "Propose", mandatoryFields: ["value", "product"], gate: false },
  ],
};

beforeEach(() => {
  vi.mocked(op.getPipelines).mockReset();
  vi.mocked(op.createOpportunity).mockReset();
  vi.mocked(op.updateOpportunity).mockReset();
});

describe("OpportunityForm (OP-003)", () => {
  it("shows the saved-info badge when pipelines fail to load", async () => {
    vi.mocked(op.getPipelines).mockResolvedValue({ data: [], source: "error" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><OpportunityForm /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument());
  });

  it("converts the rupee value to paise and creates the opportunity", async () => {
    vi.mocked(op.getPipelines).mockResolvedValue({ data: [pipeline], source: "api" });
    vi.mocked(op.createOpportunity).mockResolvedValue("deal-1");
    render(<NextIntlClientProvider locale="en" messages={enMessages}><OpportunityForm /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByLabelText(/opportunity name/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/opportunity name/i), { target: { value: "Datacentre" } });
    fireEvent.change(screen.getByLabelText(/deal value in rupees/i), { target: { value: "1500.50" } });
    fireEvent.change(screen.getByLabelText(/probability percent/i), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: /create opportunity/i }));
    await waitFor(() => expect(op.createOpportunity).toHaveBeenCalled());
    const payload = vi.mocked(op.createOpportunity).mock.calls[0][0];
    expect(payload.valueMinor).toBe("150050");
    expect(payload.probability).toBe(40);
    expect(payload.pipelineId).toBe("p1");
    expect(payload.stage).toBe("qual");
  });

  it("blocks an invalid probability without calling the API", async () => {
    vi.mocked(op.getPipelines).mockResolvedValue({ data: [pipeline], source: "api" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><OpportunityForm /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByLabelText(/opportunity name/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/opportunity name/i), { target: { value: "X" } });
    fireEvent.change(screen.getByLabelText(/probability percent/i), { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: /create opportunity/i }));
    expect(await screen.findByText(/between 0 and 100/i)).toBeInTheDocument();
    expect(op.createOpportunity).not.toHaveBeenCalled();
  });

  it("surfaces the 422 MANDATORY_STAGE_FIELDS_MISSING fields inline", async () => {
    vi.mocked(op.getPipelines).mockResolvedValue({ data: [pipeline], source: "api" });
    vi.mocked(op.createOpportunity).mockRejectedValue(new op.MandatoryFieldsError("needs more", ["value", "product"]));
    render(<NextIntlClientProvider locale="en" messages={enMessages}><OpportunityForm /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByLabelText(/opportunity name/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/opportunity name/i), { target: { value: "Y" } });
    fireEvent.change(screen.getByLabelText(/^stage$/i), { target: { value: "propose" } });
    fireEvent.click(screen.getByRole("button", { name: /create opportunity/i }));
    expect(await screen.findByText(/this stage needs:.*deal value.*product/i)).toBeInTheDocument();
  });

  // GAP-CRM-OPPORTUNITIES-NEW-01: two rapid Create clicks must POST exactly once.
  it("does not POST a duplicate on a second Create click after success", async () => {
    vi.mocked(op.getPipelines).mockResolvedValue({ data: [pipeline], source: "api" });
    vi.mocked(op.createOpportunity).mockResolvedValue("deal-123");
    const onSaved = vi.fn();
    render(<NextIntlClientProvider locale="en" messages={enMessages}><OpportunityForm onSaved={onSaved} /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByLabelText(/opportunity name/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/opportunity name/i), { target: { value: "Once" } });
    fireEvent.change(screen.getByLabelText(/deal value in rupees/i), { target: { value: "100" } });

    const btn = screen.getByRole("button", { name: /create opportunity/i });
    fireEvent.click(btn);
    await waitFor(() => expect(op.createOpportunity).toHaveBeenCalledTimes(1));

    // The button is now disabled ("Created") and a second click cannot re-POST.
    const createdBtn = await screen.findByRole("button", { name: /created/i });
    expect(createdBtn).toBeDisabled();
    fireEvent.click(createdBtn);
    expect(op.createOpportunity).toHaveBeenCalledTimes(1);
    // onSaved received the created id so the route can navigate away.
    expect(onSaved).toHaveBeenCalledWith("deal-123");
  });

  it("offers 'Create another' after success, which resets and re-enables Create", async () => {
    vi.mocked(op.getPipelines).mockResolvedValue({ data: [pipeline], source: "api" });
    vi.mocked(op.createOpportunity).mockResolvedValue("deal-abc");
    render(<NextIntlClientProvider locale="en" messages={enMessages}><OpportunityForm /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByLabelText(/opportunity name/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/opportunity name/i), { target: { value: "First" } });
    fireEvent.change(screen.getByLabelText(/deal value in rupees/i), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: /create opportunity/i }));
    await waitFor(() => expect(op.createOpportunity).toHaveBeenCalledTimes(1));

    fireEvent.click(await screen.findByRole("button", { name: /create another/i }));
    // Name cleared and the Create button is live again.
    expect((screen.getByLabelText(/opportunity name/i) as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("button", { name: /create opportunity/i })).not.toBeDisabled();
  });

  // GAP-CRM-OPPORTUNITIES-NEW-03: a stage's mandatory fields are shown BEFORE
  // submit — an inline hint and starred labels — not only after a rejected save.
  it("shows the stage's required fields inline (hint + starred labels) before submit", async () => {
    vi.mocked(op.getPipelines).mockResolvedValue({ data: [pipeline], source: "api" });
    vi.mocked(op.createOpportunity).mockResolvedValue("deal-xyz");
    render(<NextIntlClientProvider locale="en" messages={enMessages}><OpportunityForm initialAccountId="acc-9" initialAccountLabel="Ward 12 Office" /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByLabelText(/opportunity name/i)).toBeInTheDocument());
    // Choosing the "propose" stage (needs value + product) surfaces the hint.
    fireEvent.change(screen.getByLabelText(/^stage$/i), { target: { value: "propose" } });
    const note = screen.getByRole("note");
    expect(note.textContent).toMatch(/required for this stage:.*deal value.*product/i);
    // The create API has not been touched — this is purely a client hint.
    expect(op.createOpportunity).not.toHaveBeenCalled();
    // The Value and Product labels are starred proactively.
    expect(screen.getByText(/Value \(₹\) \*/)).toBeInTheDocument();
    expect(screen.getByText(/Product \*/)).toBeInTheDocument();
  });

  // GAP-CRM-OPPORTUNITIES-NEW-05: the Name field must not be aria-invalid on first
  // render; it becomes invalid only after blur (or a failed submit).
  it("does not mark Name invalid until it is blurred or submit is attempted", async () => {
    vi.mocked(op.getPipelines).mockResolvedValue({ data: [pipeline], source: "api" });
    renderWithIntl(<OpportunityForm />);
    const name = await screen.findByLabelText(/opportunity name/i);
    // Fresh render: no aria-invalid announced.
    expect(name).not.toHaveAttribute("aria-invalid");
    // It is announced as required, though.
    expect(name).toHaveAttribute("aria-required", "true");
    // After blurring it empty, it becomes invalid with an associated error.
    fireEvent.blur(name);
    await waitFor(() => expect(name).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getByText(/enter an opportunity name/i)).toBeInTheDocument();
  });

  it("marks Name invalid after a failed submit even without blurring (GAP-CRM-OPPORTUNITIES-NEW-05)", async () => {
    vi.mocked(op.getPipelines).mockResolvedValue({ data: [pipeline], source: "api" });
    renderWithIntl(<OpportunityForm />);
    const name = await screen.findByLabelText(/opportunity name/i);
    expect(name).not.toHaveAttribute("aria-invalid");
    // Attempt to submit with an empty name (no blur). The handler runs, flags the
    // submit attempt, and the empty Name then reads invalid.
    fireEvent.click(screen.getByRole("button", { name: /create opportunity/i }));
    await waitFor(() => expect(name).toHaveAttribute("aria-invalid", "true"));
    expect(op.createOpportunity).not.toHaveBeenCalled();
  });

  // GAP-CRM-OPPORTUNITIES-NEW-06: blank probability/quantity are OMITTED from the
  // payload (not sent as 0), so an untouched form does not persist a real-looking 0.
  it("omits probability and quantity from the payload when left blank", async () => {
    vi.mocked(op.getPipelines).mockResolvedValue({ data: [pipeline], source: "api" });
    vi.mocked(op.createOpportunity).mockResolvedValue("deal-1");
    renderWithIntl(<OpportunityForm />);
    await waitFor(() => expect(screen.getByLabelText(/opportunity name/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/opportunity name/i), { target: { value: "Blank fields" } });
    fireEvent.change(screen.getByLabelText(/deal value in rupees/i), { target: { value: "100" } });
    // Leave probability and quantity blank.
    fireEvent.click(screen.getByRole("button", { name: /create opportunity/i }));
    await waitFor(() => expect(op.createOpportunity).toHaveBeenCalled());
    const payload = vi.mocked(op.createOpportunity).mock.calls[0][0];
    expect(payload).not.toHaveProperty("probability");
    expect(payload).not.toHaveProperty("quantity");
  });

  it("sends probability/quantity when they are provided (GAP-CRM-OPPORTUNITIES-NEW-06)", async () => {
    vi.mocked(op.getPipelines).mockResolvedValue({ data: [pipeline], source: "api" });
    vi.mocked(op.createOpportunity).mockResolvedValue("deal-2");
    renderWithIntl(<OpportunityForm />);
    await waitFor(() => expect(screen.getByLabelText(/opportunity name/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/opportunity name/i), { target: { value: "Filled" } });
    fireEvent.change(screen.getByLabelText(/deal value in rupees/i), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText(/probability percent/i), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /create opportunity/i }));
    await waitFor(() => expect(op.createOpportunity).toHaveBeenCalled());
    const payload = vi.mocked(op.createOpportunity).mock.calls[0][0];
    // An explicit 0% is a real value and MUST be sent (distinct from blank).
    expect(payload.probability).toBe(0);
    expect(payload.quantity).toBe(5);
  });
});

describe("OpportunityForm quantity bound (server cap 100,000,000)", () => {
  it("declares the cap on the input and refuses a larger quantity without calling the API", async () => {
    vi.mocked(op.getPipelines).mockResolvedValue({ data: [pipeline], source: "api" });
    renderWithIntl(<OpportunityForm />);
    await waitFor(() => expect(screen.getByLabelText(/opportunity name/i)).toBeInTheDocument());
    const qty = screen.getByRole("spinbutton", { name: /quantity/i });
    expect(qty).toHaveAttribute("max", "100000000");
    fireEvent.change(screen.getByLabelText(/opportunity name/i), { target: { value: "Bulk order" } });
    fireEvent.change(qty, { target: { value: "100000001" } });
    expect(qty).toHaveAttribute("aria-invalid", "true");
    fireEvent.click(screen.getByRole("button", { name: /create opportunity/i }));
    expect(await screen.findByText(/quantity must be a whole number/i)).toBeInTheDocument();
    expect(op.createOpportunity).not.toHaveBeenCalled();
  });

  it("still accepts the cap itself", async () => {
    vi.mocked(op.getPipelines).mockResolvedValue({ data: [pipeline], source: "api" });
    vi.mocked(op.createOpportunity).mockResolvedValue("deal-2");
    renderWithIntl(<OpportunityForm />);
    await waitFor(() => expect(screen.getByLabelText(/opportunity name/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/opportunity name/i), { target: { value: "Bulk order" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: /quantity/i }), { target: { value: "100000000" } });
    fireEvent.click(screen.getByRole("button", { name: /create opportunity/i }));
    await waitFor(() => expect(op.createOpportunity).toHaveBeenCalled());
    expect(vi.mocked(op.createOpportunity).mock.calls[0][0].quantity).toBe(100000000);
  });
});
