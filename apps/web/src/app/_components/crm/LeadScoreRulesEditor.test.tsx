import { NextIntlClientProvider } from "next-intl";
import { renderWithIntl } from "@/lib/testUtils/intl";
import enMessages from "@/messages/en.json";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LeadScoreRulesEditor } from "./LeadScoreRulesEditor";
import * as lq from "@/lib/crm/leadQualification";

vi.mock("@/lib/crm/leadQualification", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/leadQualification")>();
  return { ...actual, getScoreRules: vi.fn(), saveScoreRules: vi.fn() };
});

const rule: lq.LeadScoreRule = { attribute: "leadSource", weight: 5, scoreFnType: "map", params: { default: 20 }, enabled: true };

beforeEach(() => {
  vi.mocked(lq.getScoreRules).mockReset();
  vi.mocked(lq.saveScoreRules).mockReset();
});

/** Walk through the GAP-04 confirm dialog that now gates every Save. */
async function confirmSave() {
  fireEvent.click(await screen.findByRole("button", { name: /save and re-score/i }));
}

describe("LeadScoreRulesEditor (LQ-002 admin)", () => {
  it("loads and shows existing rules", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: [rule], source: "api" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><LeadScoreRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(screen.getByLabelText(/attribute for rule 1/i)).toHaveValue("leadSource");
    expect(screen.queryByText(/couldn.t load/i)).not.toBeInTheDocument();
  });

  it("shows a recoverable error (no Save/Add, no PUT) on a failed load (source===error)", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: [], source: "error" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><LeadScoreRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText(/couldn.t load scoring rules/i)).toBeInTheDocument());
    expect(screen.queryByText(/no scoring rules yet/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save rules/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add rule/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("recovers to the editor when retry succeeds", async () => {
    vi.mocked(lq.getScoreRules)
      .mockResolvedValueOnce({ data: [], source: "error" })
      .mockResolvedValueOnce({ data: [rule], source: "api" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><LeadScoreRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /save rules/i })).toBeInTheDocument();
  });

  // GAP-CRM-LEAD-SCORING-02: the score-function select now offers the real
  // backend kinds, not linear/step/boolean.
  it("offers the real crm-service score-function kinds (not linear/step/boolean)", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: [rule], source: "api" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><LeadScoreRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    const options = Array.from(screen.getByLabelText(/score function for rule 1/i).querySelectorAll("option")).map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(["presence", "map", "recency", "numeric_threshold"]);
    expect(options).not.toContain("linear");
  });

  it("adds a rule and saves it, serialising params to JSON (through the confirm)", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(lq.saveScoreRules).mockResolvedValue(undefined);
    render(<NextIntlClientProvider locale="en" messages={enMessages}><LeadScoreRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText(/no scoring rules yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add rule/i }));
    fireEvent.change(screen.getByLabelText(/attribute for rule 1/i), { target: { value: "company" } });
    fireEvent.change(screen.getByLabelText(/weight for rule 1/i), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText(/params json for rule 1/i), { target: { value: '{"present":80,"absent":10}' } });
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));
    await confirmSave();
    await waitFor(() => expect(lq.saveScoreRules).toHaveBeenCalled());
    const saved = vi.mocked(lq.saveScoreRules).mock.calls[0][0];
    expect(saved[0]).toMatchObject({ attribute: "company", scoreFnType: "presence", params: { present: 80, absent: 10 } });
  });

  it("blocks save when a weight is non-finite (NaN guard)", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: [{ ...rule, weight: Number.NaN }], source: "api" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><LeadScoreRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));
    expect(await screen.findByText(/needs an attribute, a whole-number weight/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save and re-score/i })).not.toBeInTheDocument();
    expect(lq.saveScoreRules).not.toHaveBeenCalled();
  });

  it("blocks save when params are not valid JSON", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: [rule], source: "api" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><LeadScoreRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    const params = screen.getByLabelText(/params json for rule 1/i);
    fireEvent.change(params, { target: { value: "{not json" } });
    expect(params).toHaveAttribute("aria-invalid", "true");
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));
    expect(await screen.findByText(/valid params for its score function/i)).toBeInTheDocument();
    expect(lq.saveScoreRules).not.toHaveBeenCalled();
  });

  // GAP-CRM-LEAD-SCORING-02: a params blob that is valid JSON but the wrong
  // shape for the chosen function is now blocked with a per-row message.
  it("blocks save when params do not match the score function's shape", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: [{ ...rule, scoreFnType: "map", params: {} }], source: "api" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><LeadScoreRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    const params = screen.getByLabelText(/params json for rule 1/i);
    // "values" must be an object of value → score.
    fireEvent.change(params, { target: { value: '{"values":[1,2,3]}' } });
    expect(await screen.findByText(/“values” must be an object/i)).toBeInTheDocument();
    expect(params).toHaveAttribute("aria-invalid", "true");
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));
    expect(lq.saveScoreRules).not.toHaveBeenCalled();
  });

  // GAP-CRM-LEAD-SCORING-03: an unrecognised attribute warns (but is still
  // allowed — backend attribute is free text).
  it("warns on an attribute that is not a known lead field", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: [{ ...rule, attribute: "madeUpField" }], source: "api" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><LeadScoreRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(screen.getByText(/not a known lead field/i)).toBeInTheDocument();
  });

  // GAP-CRM-LEAD-SCORING-04: a running total and per-rule share are shown, and
  // Save is gated by a confirm that says it re-scores every lead.
  it("shows the running weight total and share, and confirms before re-scoring", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({
      data: [
        { ...rule, attribute: "leadSource", weight: 30 },
        { ...rule, attribute: "company", weight: 10, scoreFnType: "presence", params: {} },
      ],
      source: "api",
    });
    vi.mocked(lq.saveScoreRules).mockResolvedValue(undefined);
    render(<NextIntlClientProvider locale="en" messages={enMessages}><LeadScoreRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(screen.getByLabelText(/total enabled weight/i)).toHaveTextContent("40");
    expect(screen.getByLabelText(/share for rule 1/i)).toHaveTextContent("75%");
    // Save opens the confirm; the API is not called until confirmed.
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));
    expect(await screen.findByText(/re-scores every lead/i)).toBeInTheDocument();
    expect(lq.saveScoreRules).not.toHaveBeenCalled();
    await confirmSave();
    await waitFor(() => expect(lq.saveScoreRules).toHaveBeenCalled());
  });

  it("surfaces a save error from the server", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: [rule], source: "api" });
    vi.mocked(lq.saveScoreRules).mockRejectedValue(new Error("BAD: nope"));
    render(<NextIntlClientProvider locale="en" messages={enMessages}><LeadScoreRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));
    await confirmSave();
    expect(await screen.findByText(/BAD: nope/)).toBeInTheDocument();
  });

  it("keeps a rule's own value and focus attached to it after an earlier rule is removed", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: [], source: "api" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><LeadScoreRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText(/no scoring rules yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add rule/i }));
    fireEvent.click(screen.getByRole("button", { name: /add rule/i }));
    fireEvent.click(screen.getByRole("button", { name: /add rule/i }));

    const thirdAttribute = screen.getAllByLabelText(/attribute for rule/i)[2]!;
    fireEvent.change(thirdAttribute, { target: { value: "budget" } });
    thirdAttribute.focus();
    expect(document.activeElement).toBe(thirdAttribute);

    fireEvent.click(screen.getAllByRole("button", { name: /remove rule/i })[0]!);

    const survivingThirdAttribute = screen.getAllByLabelText(/attribute for rule/i)[1]!;
    expect(survivingThirdAttribute).toHaveValue("budget");
    expect(document.activeElement).toBe(survivingThirdAttribute);
  });

  // GAP-CRM-LEAD-SCORING-05 (wave2): optimistic concurrency wiring.
  it("sends the loaded version to saveScoreRules and shows Last changed by/at", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({
      data: [rule],
      source: "api",
      meta: { version: "9", updatedBy: "admin-xyz", updatedAt: "2026-10-02T09:00:00.000Z" },
    });
    vi.mocked(lq.saveScoreRules).mockResolvedValue("10");
    render(<NextIntlClientProvider locale="en" messages={enMessages}><LeadScoreRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(screen.getByText(/last changed/i)).toBeInTheDocument();
    expect(screen.getByText(/admin-xyz/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));
    await confirmSave();
    await waitFor(() => expect(lq.saveScoreRules).toHaveBeenCalled());
    expect(vi.mocked(lq.saveScoreRules).mock.calls[0][1]).toBe("9");
  });

  it("shows a reload message on a 409 ConfigConflictError", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: [rule], source: "api", meta: { version: "9" } });
    vi.mocked(lq.saveScoreRules).mockRejectedValue(new lq.ConfigConflictError());
    render(<NextIntlClientProvider locale="en" messages={enMessages}><LeadScoreRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));
    await confirmSave();
    expect(await screen.findByText(/changed by another admin/i)).toBeInTheDocument();
  });

  // GAP-CRM-LEAD-SCORING-06: a new rule starts with a blank (NaN) weight — the
  // weight input is aria-invalid and Save is blocked until a number is typed.
  it("starts a new rule with a blank weight that is aria-invalid and blocks save", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: [], source: "api" });
    renderWithIntl(<LeadScoreRulesEditor />);
    await waitFor(() => expect(screen.getByText(/no scoring rules yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add rule/i }));
    const weight = screen.getByLabelText(/weight for rule 1/i);
    expect(weight).toHaveValue(null); // blank, not 1
    expect(weight).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(screen.getByLabelText(/attribute for rule 1/i), { target: { value: "company" } });
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));
    expect(await screen.findByText(/needs an attribute, a whole-number weight/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save and re-score/i })).not.toBeInTheDocument();
    expect(lq.saveScoreRules).not.toHaveBeenCalled();
  });

  // GAP-CRM-LEAD-SCORING-07: removing a loaded rule then Save surfaces the
  // removed-rule count in the confirm dialog.
  it("shows how many rules will be removed in the save confirm", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({
      data: [
        { ...rule, attribute: "leadSource", weight: 30 },
        { ...rule, attribute: "company", weight: 10, scoreFnType: "presence", params: {} },
      ],
      source: "api",
    });
    vi.mocked(lq.saveScoreRules).mockResolvedValue(undefined);
    renderWithIntl(<LeadScoreRulesEditor />);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: /remove rule/i })[1]!);
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/1 rule will be removed/i);
  });
});
