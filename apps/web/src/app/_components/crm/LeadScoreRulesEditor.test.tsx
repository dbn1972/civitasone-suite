import { NextIntlClientProvider } from "next-intl";
import { renderWithIntl } from "@/lib/testUtils/intl";
import enMessages from "@/messages/en.json";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { LeadScoreRulesEditor } from "./LeadScoreRulesEditor";
import * as lq from "@/lib/crm/leadQualification";

vi.mock("@/lib/crm/leadQualification", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/leadQualification")>();
  return { ...actual, getScoreRules: vi.fn(), saveScoreRules: vi.fn(), previewScoreRules: vi.fn() };
});

const rule: lq.LeadScoreRule = { attribute: "leadSource", weight: 5, scoreFnType: "map", params: { default: 20 }, enabled: true };

beforeEach(() => {
  vi.mocked(lq.getScoreRules).mockReset();
  vi.mocked(lq.saveScoreRules).mockReset();
  vi.mocked(lq.previewScoreRules).mockReset();
});

/** Walk through the GAP-04 confirm dialog that now gates every Save (its button is also "Save rules"). */
async function confirmSave() {
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: /^save rules$/i }));
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
    // GAP-CRM-LEAD-SCORING-02: presence params are typed into labelled inputs, not a JSON box.
    expect(screen.queryByLabelText(/params json for rule 1/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/score when present, rule 1/i), { target: { value: "80" } });
    fireEvent.change(screen.getByLabelText(/score when absent, rule 1/i), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));
    await confirmSave();
    await waitFor(() => expect(lq.saveScoreRules).toHaveBeenCalled());
    const saved = vi.mocked(lq.saveScoreRules).mock.calls[0][0];
    expect(saved[0]).toMatchObject({ attribute: "company", scoreFnType: "presence", params: { present: 80, absent: 10 } });
  });

  it("still serialises params typed into the Advanced JSON fallback", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(lq.saveScoreRules).mockResolvedValue(undefined);
    render(<NextIntlClientProvider locale="en" messages={enMessages}><LeadScoreRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText(/no scoring rules yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add rule/i }));
    fireEvent.change(screen.getByLabelText(/attribute for rule 1/i), { target: { value: "company" } });
    fireEvent.change(screen.getByLabelText(/weight for rule 1/i), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /edit params as json for rule 1/i }));
    fireEvent.change(screen.getByLabelText(/params json for rule 1/i), { target: { value: '{"present":80,"absent":10}' } });
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));
    await confirmSave();
    await waitFor(() => expect(lq.saveScoreRules).toHaveBeenCalled());
    expect(vi.mocked(lq.saveScoreRules).mock.calls[0][0][0]).toMatchObject({ attribute: "company", params: { present: 80, absent: 10 } });
  });

  it("blocks save when a weight is non-finite (NaN guard)", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: [{ ...rule, weight: Number.NaN }], source: "api" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><LeadScoreRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));
    expect(await screen.findByText(/needs an attribute, a whole-number weight/i)).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(lq.saveScoreRules).not.toHaveBeenCalled();
  });

  it("blocks save when params are not valid JSON", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: [rule], source: "api" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><LeadScoreRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /edit params as json for rule 1/i }));
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
    fireEvent.click(screen.getByRole("button", { name: /edit params as json for rule 1/i }));
    const params = screen.getByLabelText(/params json for rule 1/i);
    // "values" must be an object of value → score.
    fireEvent.change(params, { target: { value: '{"values":[1,2,3]}' } });
    expect(await screen.findByText(/“values” must be an object/i)).toBeInTheDocument();
    expect(params).toHaveAttribute("aria-invalid", "true");
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));
    expect(lq.saveScoreRules).not.toHaveBeenCalled();
  });

  // GAP-CRM-LEAD-SCORING-03: an attribute the scorer does not read is REJECTED on
  // save (it could never score), not merely warned about.
  it("flags a stored attribute the scorer does not read and blocks the save", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: [{ ...rule, attribute: "madeUpField" }], source: "api" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><LeadScoreRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    const attr = screen.getByLabelText(/attribute for rule 1/i);
    expect(attr).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/can never score/i)).toBeInTheDocument();
    // The legacy value stays visible (so it can be removed) but is not a choosable option.
    expect((screen.getByRole("option", { name: "madeUpField" }) as HTMLOptionElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));
    expect(await screen.findByText(/needs an attribute, a whole-number weight/i)).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(lq.saveScoreRules).not.toHaveBeenCalled();
  });

  it("offers only the fields the scorer reads, including the ones the old suggestion list missed", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: [rule], source: "api" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><LeadScoreRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    const values = Array.from(screen.getByLabelText(/attribute for rule 1/i).querySelectorAll("option")).map((o) => (o as HTMLOptionElement).value).filter(Boolean);
    expect(values).toEqual(["leadSource", "company", "lastActivityAt", "email", "phone", "leadStatus", "city", "designation"]);
  });

  it("uses the attribute list the backend advertises when it sends one", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: [rule], source: "api", meta: { scoreableAttributes: ["leadSource", "email"] } });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><LeadScoreRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    const values = Array.from(screen.getByLabelText(/attribute for rule 1/i).querySelectorAll("option")).map((o) => (o as HTMLOptionElement).value).filter(Boolean);
    expect(values).toEqual(["leadSource", "email"]);
  });

  it("blocks two rules on the same field (the backend keeps one rule per field)", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({
      data: [{ ...rule, attribute: "company", scoreFnType: "presence", params: {} }, { ...rule, attribute: "company", scoreFnType: "presence", params: {} }],
      source: "api",
    });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><LeadScoreRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(screen.getAllByText(/another rule already uses this field/i)).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));
    expect(await screen.findByText(/needs an attribute, a whole-number weight/i)).toBeInTheDocument();
    expect(lq.saveScoreRules).not.toHaveBeenCalled();
  });

  // GAP-CRM-LEAD-SCORING-04: a running total and per-rule share are shown, and
  // Save is gated by a confirm that says truthfully what Save does: it stores the rules, it does
  // not re-score existing leads in bulk (a lead's stored score updates when that lead changes).
  it("shows the running weight total and share, and confirms before saving", async () => {
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
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/applies these rules from now on/i);
    expect(dialog).toHaveTextContent(/updates the next time that lead is changed/i);
    // No code path re-scores on Save, so the confirm must not promise it.
    expect(dialog).not.toHaveTextContent(/re-scores every lead|existing scores are recalculated|save and re-score/i);
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
    fireEvent.change(thirdAttribute, { target: { value: "city" } });
    thirdAttribute.focus();
    expect(document.activeElement).toBe(thirdAttribute);

    fireEvent.click(screen.getAllByRole("button", { name: /remove rule/i })[0]!);

    const survivingThirdAttribute = screen.getAllByLabelText(/attribute for rule/i)[1]!;
    expect(survivingThirdAttribute).toHaveValue("city");
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
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(lq.saveScoreRules).not.toHaveBeenCalled();
  });

  // GAP-CRM-LEAD-SCORING-07: removing a loaded rule then Save surfaces the
  // removed-rule count in the confirm dialog -- and says truthfully that Save does not
  // delete it (crm-service upserts by field and never deletes an omitted rule).
  it("tells the admin a rule dropped from the list is NOT deleted by Save", async () => {
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
    expect(dialog).toHaveTextContent(/1 rule is no longer in this list/i);
    expect(dialog).toHaveTextContent(/saving does not delete it/i);
    expect(dialog).toHaveTextContent(/keeps scoring/i);
    expect(dialog).toHaveTextContent(/turn it off instead/i);
    expect(dialog).not.toHaveTextContent(/no longer contribute/i);
  });

  it("changing a rule's score function edits the same rule: it is not reported as dropped", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({
      data: [{ ...rule, attribute: "leadSource", weight: 30 }],
      source: "api",
    });
    vi.mocked(lq.saveScoreRules).mockResolvedValue(undefined);
    renderWithIntl(<LeadScoreRulesEditor />);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/score function for rule 1/i), { target: { value: "presence" } });
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).not.toHaveTextContent(/no longer in this list/i);
  });
});

describe("LeadScoreRulesEditor structured params (GAP-CRM-LEAD-SCORING-02)", () => {
  function renderEditor() {
    return render(<NextIntlClientProvider locale="en" messages={enMessages}><LeadScoreRulesEditor /></NextIntlClientProvider>);
  }
  const numeric: lq.LeadScoreRule = { attribute: "designation", weight: 20, scoreFnType: "presence", params: {}, enabled: true };

  it("switching a rule to numeric_threshold shows the tier editor, and the tiers are saved as params", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: [numeric], source: "api" });
    vi.mocked(lq.saveScoreRules).mockResolvedValue(undefined);
    renderEditor();
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    // Presence shows its two score boxes and no tier controls.
    expect(screen.queryByRole("button", { name: /add a tier to rule 1/i })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/score function for rule 1/i), { target: { value: "numeric_threshold" } });
    expect(screen.queryByLabelText(/score when present, rule 1/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /add a tier to rule 1/i }));
    fireEvent.change(screen.getByLabelText(/at least, tier 1, rule 1/i), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText(/score for tier 1, rule 1/i), { target: { value: "80" } });
    fireEvent.change(screen.getByLabelText(/score below the first tier, rule 1/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));
    await confirmSave();
    await waitFor(() => expect(lq.saveScoreRules).toHaveBeenCalled());
    expect(vi.mocked(lq.saveScoreRules).mock.calls[0][0][0]).toMatchObject({
      scoreFnType: "numeric_threshold",
      params: { tiers: [{ min: 100, score: 80 }], default: 5 },
    });
  });

  it("recency tiers are keyed by maxDays (days since), not min", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: [{ ...numeric, attribute: "lastActivityAt", scoreFnType: "recency" }], source: "api" });
    vi.mocked(lq.saveScoreRules).mockResolvedValue(undefined);
    renderEditor();
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add a tier to rule 1/i }));
    fireEvent.change(screen.getByLabelText(/within \(days\), tier 1, rule 1/i), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText(/score for tier 1, rule 1/i), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText(/score when older than every tier, rule 1/i), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));
    await confirmSave();
    await waitFor(() => expect(lq.saveScoreRules).toHaveBeenCalled());
    expect(vi.mocked(lq.saveScoreRules).mock.calls[0][0][0].params).toEqual({ tiers: [{ maxDays: 7, score: 100 }], beyondScore: 20 });
  });

  it("map rows build the values table, with a default", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: [{ ...numeric, attribute: "leadSource", scoreFnType: "map" }], source: "api" });
    vi.mocked(lq.saveScoreRules).mockResolvedValue(undefined);
    renderEditor();
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add a value to rule 1/i }));
    fireEvent.change(screen.getByLabelText(/lead value 1, rule 1/i), { target: { value: "referral" } });
    fireEvent.change(screen.getByLabelText(/score for value 1, rule 1/i), { target: { value: "90" } });
    fireEvent.change(screen.getByLabelText(/score for any other value, rule 1/i), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));
    await confirmSave();
    await waitFor(() => expect(lq.saveScoreRules).toHaveBeenCalled());
    expect(vi.mocked(lq.saveScoreRules).mock.calls[0][0][0].params).toEqual({ values: { referral: 90 }, default: 20 });
  });

  it("shows a per-field message on the exact input that is wrong, and blocks the save", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: [numeric], source: "api" });
    renderEditor();
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    const present = screen.getByLabelText(/score when present, rule 1/i);
    const absent = screen.getByLabelText(/score when absent, rule 1/i);
    fireEvent.change(present, { target: { value: "150" } });
    expect(present).toHaveAttribute("aria-invalid", "true");
    const err = screen.getByText(/score must be between 0 and 100/i);
    expect(err).toHaveAttribute("role", "alert");
    expect(present).toHaveAttribute("aria-describedby", err.id);
    // The untouched sibling is not flagged.
    expect(absent).not.toHaveAttribute("aria-invalid");
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));
    expect(await screen.findByText(/needs an attribute, a whole-number weight/i)).toBeInTheDocument();
    expect(lq.saveScoreRules).not.toHaveBeenCalled();
  });

  it("rejects an upper-case map value (the scorer matches lower-cased values, so it would never match)", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: [{ ...numeric, attribute: "leadSource", scoreFnType: "map" }], source: "api" });
    renderEditor();
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add a value to rule 1/i }));
    fireEvent.change(screen.getByLabelText(/lead value 1, rule 1/i), { target: { value: "Referral" } });
    fireEvent.change(screen.getByLabelText(/score for value 1, rule 1/i), { target: { value: "90" } });
    expect(screen.getByText(/use lower case/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));
    expect(await screen.findByText(/needs an attribute, a whole-number weight/i)).toBeInTheDocument();
    expect(lq.saveScoreRules).not.toHaveBeenCalled();
  });

  it("an incomplete tier row is flagged on its own boxes", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: [{ ...numeric, scoreFnType: "numeric_threshold" }], source: "api" });
    renderEditor();
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add a tier to rule 1/i }));
    expect(screen.getByLabelText(/at least, tier 1, rule 1/i)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/score for tier 1, rule 1/i)).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(screen.getByLabelText(/at least, tier 1, rule 1/i), { target: { value: "50" } });
    expect(screen.getByLabelText(/at least, tier 1, rule 1/i)).not.toHaveAttribute("aria-invalid");
    expect(screen.getByLabelText(/score for tier 1, rule 1/i)).toHaveAttribute("aria-invalid", "true");
  });

  it("opens stored params the form cannot show in Advanced JSON so nothing is rewritten, and refuses 'Use form' until the JSON fits", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({
      data: [{ ...numeric, scoreFnType: "map", params: { values: [1, 2, 3] } }],
      source: "api",
    });
    renderEditor();
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    const json = screen.getByLabelText(/params json for rule 1/i);
    expect(json).toHaveValue('{"values":[1,2,3]}');
    expect(screen.getByText(/“values” must be an object/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /use the form for rule 1/i }));
    expect(screen.getByText(/can't be shown in the form/i)).toBeInTheDocument();
    // Fix the JSON, then the form accepts it.
    fireEvent.change(json, { target: { value: '{"values":{"referral":90},"default":10}' } });
    fireEvent.click(screen.getByRole("button", { name: /use the form for rule 1/i }));
    expect(screen.getByLabelText(/lead value 1, rule 1/i)).toHaveValue("referral");
    expect(screen.getByLabelText(/score for any other value, rule 1/i)).toHaveValue(10);
  });

  it("keeps keys the form does not model when a rule is edited in the form", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: [{ ...numeric, params: { present: 70, note: "keep me" } }], source: "api" });
    vi.mocked(lq.saveScoreRules).mockResolvedValue(undefined);
    renderEditor();
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/score when absent, rule 1/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));
    await confirmSave();
    await waitFor(() => expect(lq.saveScoreRules).toHaveBeenCalled());
    expect(vi.mocked(lq.saveScoreRules).mock.calls[0][0][0].params).toEqual({ present: 70, absent: 5, note: "keep me" });
  });
});

describe("LeadScoreRulesEditor weights + impact preview (GAP-CRM-LEAD-SCORING-04)", () => {
  function renderEditor() {
    return render(<NextIntlClientProvider locale="en" messages={enMessages}><LeadScoreRulesEditor /></NextIntlClientProvider>);
  }
  const two: lq.LeadScoreRule[] = [
    { attribute: "leadSource", weight: 30, scoreFnType: "map", params: { default: 20 }, enabled: true },
    { attribute: "company", weight: 10, scoreFnType: "presence", params: {}, enabled: true },
  ];
  const preview: lq.ScorePreview = {
    totalLeads: 120, sampled: 120, truncated: false, unscored: 4, currentAverage: 52.5, proposedAverage: 31.2,
    changed: 80, raised: 10, lowered: 70, totalWeight: 40, maxPossibleScore: 40, retainedRules: 0,
    bands: [
      { label: "0-19", current: 5, proposed: 30 },
      { label: "20-39", current: 20, proposed: 50 },
      { label: "40-59", current: 40, proposed: 30 },
      { label: "60-79", current: 35, proposed: 6 },
      { label: "80-100", current: 16, proposed: 0 },
    ],
  };

  it("states the real scoring rule: weights are not normalised, so the enabled total is the ceiling", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: two, source: "api" });
    renderEditor();
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(screen.getByText(/weights are not normalised/i)).toHaveTextContent(/highest possible score is 40/i);
    expect(screen.getByRole("note")).toHaveTextContent(/no lead can score above 40/i);
    expect(screen.queryByText(/weights are normalised, so/i)).not.toBeInTheDocument();
  });

  it("an enabled total of exactly 100 shows no ceiling warning", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: [{ ...two[0]!, weight: 60 }, { ...two[1]!, weight: 40 }], source: "api" });
    renderEditor();
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("Preview impact sends the rules as edited and renders the before/after distribution", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: two, source: "api" });
    vi.mocked(lq.previewScoreRules).mockResolvedValue(preview);
    renderEditor();
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/weight for rule 2/i), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: /preview impact/i }));
    const summary = await screen.findByRole("region", { name: /impact preview/i });
    expect(lq.previewScoreRules).toHaveBeenCalledTimes(1);
    expect(vi.mocked(lq.previewScoreRules).mock.calls[0][0].map((r) => [r.attribute, r.weight])).toEqual([["leadSource", 30], ["company", 25]]);
    expect(summary).toHaveTextContent(/scored 120 of 120 leads/i);
    expect(summary).toHaveTextContent(/52\.5 now, 31\.2 with these rules/i);
    expect(summary).toHaveTextContent(/10 leads would score higher and 70 lower/i);
    // The column is the score each lead WOULD get; nothing has been re-scored, so it is not "After".
    expect(within(summary).getByRole("columnheader", { name: "With these rules" })).toBeInTheDocument();
    expect(within(summary).queryByRole("columnheader", { name: /^after$/i })).not.toBeInTheDocument();
    const rows = screen.getAllByRole("row").map((r) => r.textContent);
    expect(rows.some((r) => /80-100\s*16\s*0/.test(r ?? ""))).toBe(true);
    // Preview is read-only: nothing was saved.
    expect(lq.saveScoreRules).not.toHaveBeenCalled();
  });

  it("says so when the preview still counts saved rules the edited list dropped", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: two, source: "api" });
    vi.mocked(lq.previewScoreRules).mockResolvedValue({ ...preview, retainedRules: 2 });
    renderEditor();
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /preview impact/i }));
    const summary = await screen.findByRole("region", { name: /impact preview/i });
    expect(summary).toHaveTextContent(/2 saved rules are not in this list/i);
    expect(summary).toHaveTextContent(/still counted here because Save does not delete them/i);
  });

  it("shows no retained-rule line when the list covers every saved rule", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: two, source: "api" });
    vi.mocked(lq.previewScoreRules).mockResolvedValue(preview);
    renderEditor();
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /preview impact/i }));
    const summary = await screen.findByRole("region", { name: /impact preview/i });
    expect(summary).not.toHaveTextContent(/saved rules? (is|are) not in this list/i);
  });

  it("drops a stale preview as soon as the rules change", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: two, source: "api" });
    vi.mocked(lq.previewScoreRules).mockResolvedValue(preview);
    renderEditor();
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /preview impact/i }));
    await screen.findByRole("region", { name: /impact preview/i });
    fireEvent.change(screen.getByLabelText(/weight for rule 1/i), { target: { value: "31" } });
    expect(screen.queryByRole("region", { name: /impact preview/i })).not.toBeInTheDocument();
  });

  it("does not preview invalid rules", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: [{ ...two[0]!, weight: Number.NaN }], source: "api" });
    renderEditor();
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /preview impact/i }));
    expect(await screen.findByText(/needs an attribute, a whole-number weight/i)).toBeInTheDocument();
    expect(lq.previewScoreRules).not.toHaveBeenCalled();
  });

  it("shows a catalogued message (never the raw error) when the preview fails", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: two, source: "api" });
    vi.mocked(lq.previewScoreRules).mockRejectedValue(new Error("pg: relation crm.contacts does not exist"));
    renderEditor();
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /preview impact/i }));
    expect(await screen.findByText(/couldn't preview the impact/i)).toBeInTheDocument();
    expect(screen.queryByText(/relation crm\.contacts/i)).not.toBeInTheDocument();
  });

  it("tells the admin how many leads would change inside the save confirm once a preview exists", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: two, source: "api" });
    vi.mocked(lq.previewScoreRules).mockResolvedValue(preview);
    renderEditor();
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /preview impact/i }));
    await screen.findByRole("region", { name: /impact preview/i });
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/80 of 120 leads would score differently once re-scored/i);
  });
});

// GAP-CRM-LEAD-SCORING-03: Save is an additive upsert, so a stored rule on a field the scorer does not
// read can never be deleted. It used to block every Save until it was removed from the list (and then
// kept scoring). It is retired by switching it OFF, which crm-service accepts for a rule it stores.
describe("LeadScoreRulesEditor legacy rules (GAP-CRM-LEAD-SCORING-03)", () => {
  const legacy: lq.LeadScoreRule = { attribute: "industry", weight: 10, scoreFnType: "presence", params: { present: 100, absent: 0 }, enabled: true };

  it("a legacy rule that is switched on blocks the save, a switched-off one does not and is sent disabled", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: [rule, legacy], source: "api" });
    vi.mocked(lq.saveScoreRules).mockResolvedValue(undefined);
    renderWithIntl(<LeadScoreRulesEditor />);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    // on: flagged, with the way out in the message, and Save is refused
    expect(screen.getByLabelText(/attribute for rule 2/i)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/turn the rule off/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));
    expect(await screen.findByText(/needs an attribute, a whole-number weight/i)).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(lq.saveScoreRules).not.toHaveBeenCalled();

    // off: no longer an error (it is still listed, so the admin can see what was retired)
    fireEvent.click(screen.getByLabelText(/enable rule 2/i));
    expect(screen.getByLabelText(/attribute for rule 2/i)).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText(/can never score/i)).not.toBeInTheDocument();
    expect((screen.getByRole("option", { name: "industry" }) as HTMLOptionElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));
    await confirmSave();
    await waitFor(() => expect(lq.saveScoreRules).toHaveBeenCalledTimes(1));
    const sent = vi.mocked(lq.saveScoreRules).mock.calls[0]![0];
    expect(sent.find((r) => r.attribute === "industry")).toMatchObject({ enabled: false });
    expect(sent.find((r) => r.attribute === "leadSource")).toMatchObject({ enabled: true });
  });

  it("switching a legacy rule back on blocks the save again", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: [rule, { ...legacy, enabled: false }], source: "api" });
    renderWithIntl(<LeadScoreRulesEditor />);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(screen.queryByText(/can never score/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/enable rule 2/i));
    expect(screen.getByText(/can never score/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));
    expect(await screen.findByText(/needs an attribute, a whole-number weight/i)).toBeInTheDocument();
    expect(lq.saveScoreRules).not.toHaveBeenCalled();
  });

  it("previews with the retired rule included (the same disabled rule the Save would send)", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: [rule, { ...legacy, enabled: false }], source: "api" });
    vi.mocked(lq.previewScoreRules).mockRejectedValue(new Error("not under test"));
    renderWithIntl(<LeadScoreRulesEditor />);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /preview impact/i }));
    await waitFor(() => expect(lq.previewScoreRules).toHaveBeenCalledTimes(1));
    expect(vi.mocked(lq.previewScoreRules).mock.calls[0]![0].find((r) => r.attribute === "industry")).toMatchObject({ enabled: false });
  });
});
