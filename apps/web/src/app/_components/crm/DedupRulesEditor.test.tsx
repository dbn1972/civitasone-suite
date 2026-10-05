import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { DedupRulesEditor } from "./DedupRulesEditor";
import * as dq from "@/lib/crm/dataQuality";

vi.mock("@/lib/crm/dataQuality", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/dataQuality")>();
  return { ...actual, getDedupRules: vi.fn(), saveDedupRules: vi.fn() };
});

const rule: dq.DedupRule = { field: "email", matchType: "exact", weight: 50, threshold: 90, enabled: true };

beforeEach(() => {
  vi.mocked(dq.getDedupRules).mockReset();
  vi.mocked(dq.saveDedupRules).mockReset();
});

describe("DedupRulesEditor (GAP-CRM-DEDUP-RULES-01)", () => {
  it("renders an error state with retry (not the empty state / Save) when the load fails", async () => {
    vi.mocked(dq.getDedupRules).mockResolvedValue({ data: [], source: "error" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><DedupRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    // No destructive Save button is offered on a failed load.
    expect(screen.queryByRole("button", { name: /save rules/i })).not.toBeInTheDocument();
    // The "No matching rules yet" empty state must NOT be shown for an error.
    expect(screen.queryByText(/no matching rules yet/i)).not.toBeInTheDocument();
    // A retry control is present.
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
  });

  it("re-loads when Retry is clicked", async () => {
    vi.mocked(dq.getDedupRules)
      .mockResolvedValueOnce({ data: [], source: "error" })
      .mockResolvedValueOnce({ data: [rule], source: "api" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><DedupRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /try again|retry/i }));
    await waitFor(() => expect(screen.getByDisplayValue("50")).toBeInTheDocument());
  });

  it("requires explicit confirmation before saving an empty rule set (no silent wipe)", async () => {
    // Loaded cleanly with one rule, user removes it, then saves → must confirm.
    vi.mocked(dq.getDedupRules).mockResolvedValue({ data: [rule], source: "api" });
    vi.mocked(dq.saveDedupRules).mockResolvedValue(undefined);
    render(<NextIntlClientProvider locale="en" messages={enMessages}><DedupRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByDisplayValue("50")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /remove rule 1/i }));
    expect(screen.getByText(/no matching rules yet/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));
    // saveDedupRules must NOT have been called yet — a confirm dialog appears.
    expect(dq.saveDedupRules).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /clear all rules/i }));
    await waitFor(() => expect(dq.saveDedupRules).toHaveBeenCalledWith([]));
  });

  it("saves a non-empty rule set directly without a confirm dialog", async () => {
    vi.mocked(dq.getDedupRules).mockResolvedValue({ data: [rule], source: "api" });
    vi.mocked(dq.saveDedupRules).mockResolvedValue(undefined);
    render(<NextIntlClientProvider locale="en" messages={enMessages}><DedupRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByDisplayValue("50")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));
    await waitFor(() => expect(dq.saveDedupRules).toHaveBeenCalledWith([rule]));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});

describe("DedupRulesEditor (DQ-001 admin) — restored", () => {
  const rule: dq.DedupRule = { field: "email", matchType: "exact", weight: 1, threshold: 90, enabled: true };
  it("loads and shows existing rules", async () => {
    vi.mocked(dq.getDedupRules).mockResolvedValue({ data: [rule], source: "api" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><DedupRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(screen.queryByText(/couldn.t load/i)).not.toBeInTheDocument();
  });

  it("adds a rule and saves it", async () => {
    vi.mocked(dq.getDedupRules).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(dq.saveDedupRules).mockResolvedValue(undefined);
    render(<NextIntlClientProvider locale="en" messages={enMessages}><DedupRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText(/no matching rules yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add rule/i }));
    expect(screen.getByRole("table")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));
    await waitFor(() => expect(dq.saveDedupRules).toHaveBeenCalled());
    expect(await screen.findByText(/matching rules saved/i)).toBeInTheDocument();
  });

  it("surfaces a save error", async () => {
    vi.mocked(dq.getDedupRules).mockResolvedValue({ data: [rule], source: "api" });
    vi.mocked(dq.saveDedupRules).mockRejectedValue(new Error("BAD: nope"));
    render(<NextIntlClientProvider locale="en" messages={enMessages}><DedupRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));
    expect(await screen.findByText("We couldn't save the matching rules. Your changes haven't been saved. Check your internet connection and try again in a few minutes.")).toBeInTheDocument();
    expect(screen.queryByText(/BAD: nope/i)).not.toBeInTheDocument();
  });

  it("blocks save and shows an inline error when a rule has a non-finite number (finding 4)", async () => {
    vi.mocked(dq.getDedupRules).mockResolvedValue({
      data: [{ ...rule, weight: Number.NaN }],
      source: "api",
    });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><DedupRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));
    expect(await screen.findByText(/must be whole numbers/i)).toBeInTheDocument();
    expect(dq.saveDedupRules).not.toHaveBeenCalled();
  });

  it("sanitizes a non-numeric weight entry to 0 instead of NaN (finding 4)", async () => {
    vi.mocked(dq.getDedupRules).mockResolvedValue({ data: [rule], source: "api" });
    vi.mocked(dq.saveDedupRules).mockResolvedValue(undefined);
    render(<NextIntlClientProvider locale="en" messages={enMessages}><DedupRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    const weight = screen.getByLabelText(/weight for rule 1/i);
    // A partial/invalid entry ("-") coerces to a safe 0, never NaN.
    fireEvent.change(weight, { target: { value: "-" } });
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));
    await waitFor(() => expect(dq.saveDedupRules).toHaveBeenCalled());
    const saved = vi.mocked(dq.saveDedupRules).mock.calls[0][0];
    expect(Number.isFinite(saved[0].weight)).toBe(true);
    expect(saved[0].weight).toBe(0);
  });

  // Regression test for the CRITICAL bug: services/crm-service dedup-routes.ts
  // requires weight and threshold to be z.number().int().min(0).max(100), but
  // the threshold input allowed fractional 0-1 values (step 0.05, max 1) and
  // weight allowed any fractional value with no upper bound at all (step 0.1,
  // no max) -- "Save rules" 400'd for any realistic value. Typing a fractional
  // or out-of-range number must now be rounded/clamped to a valid integer
  // before it ever reaches the API, not just validated after the fact.
  it("rounds a fractional threshold and clamps an out-of-range weight before saving (finding: int 0-100 contract)", async () => {
    vi.mocked(dq.getDedupRules).mockResolvedValue({ data: [rule], source: "api" });
    vi.mocked(dq.saveDedupRules).mockResolvedValue(undefined);
    render(<NextIntlClientProvider locale="en" messages={enMessages}><DedupRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/threshold for rule 1/i), { target: { value: "0.9" } });
    fireEvent.change(screen.getByLabelText(/weight for rule 1/i), { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));

    await waitFor(() => expect(dq.saveDedupRules).toHaveBeenCalled());
    const saved = vi.mocked(dq.saveDedupRules).mock.calls[0][0];
    expect(saved[0].threshold).toBe(1); // 0.9 rounds to the nearest integer, not truncates to 0
    expect(saved[0].weight).toBe(100); // clamped to the backend's max
    expect(Number.isInteger(saved[0].threshold)).toBe(true);
    expect(Number.isInteger(saved[0].weight)).toBe(true);
  });

  // Regression test for a stale leftover of the old 0-1 scale: the threshold
  // input's onChange still called sanitizeNumber(value, { max: 1 }) after the
  // rest of this editor was migrated to the real 0-100 integer contract.
  // Because sanitizeNumber defaults max to 100 only when no override is
  // given, that stray { max: 1 } silently collapsed ANY typed threshold above
  // 1 down to 1 -- "match almost anything" -- with no validation error (1 is
  // still a valid int 0-100). A threshold in the middle of the real range
  // must round-trip unchanged, not just extremes like "150"/"0.9" that can
  // pass by coincidence under either ceiling.
  it("preserves a typical in-range threshold exactly instead of collapsing it to 1 (stale 0-1 ceiling)", async () => {
    vi.mocked(dq.getDedupRules).mockResolvedValue({ data: [rule], source: "api" });
    vi.mocked(dq.saveDedupRules).mockResolvedValue(undefined);
    render(<NextIntlClientProvider locale="en" messages={enMessages}><DedupRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/threshold for rule 1/i), { target: { value: "72" } });
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));

    await waitFor(() => expect(dq.saveDedupRules).toHaveBeenCalled());
    const saved = vi.mocked(dq.saveDedupRules).mock.calls[0][0];
    expect(saved[0].threshold).toBe(72);
  });

  // Row identity: rules were keyed by array position, so removing an
  // earlier rule shifted later ones up into a different key -- React
  // patched the focused rule's DOM node in place with a different rule's
  // data instead of removing the right node and leaving the rest (and
  // focus) alone.
  it("keeps a rule's own value and focus attached to it after an earlier rule is removed", async () => {
    vi.mocked(dq.getDedupRules).mockResolvedValue({ data: [], source: "api" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><DedupRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText(/no matching rules yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add rule/i }));
    fireEvent.click(screen.getByRole("button", { name: /add rule/i }));
    fireEvent.click(screen.getByRole("button", { name: /add rule/i }));

    const thirdThreshold = screen.getAllByLabelText(/threshold for rule/i)[2]!;
    fireEvent.change(thirdThreshold, { target: { value: "77" } });
    thirdThreshold.focus();
    expect(document.activeElement).toBe(thirdThreshold);

    // Remove the first rule -- rules 2-3 shift up to become rules 1-2.
    fireEvent.click(screen.getAllByRole("button", { name: /remove rule/i })[0]!);

    const survivingThirdThreshold = screen.getAllByLabelText(/threshold for rule/i)[1]!;
    expect(survivingThirdThreshold).toHaveValue(77);
    expect(document.activeElement).toBe(survivingThirdThreshold);
  });
});


