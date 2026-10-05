import { NextIntlClientProvider } from "next-intl";
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
});
