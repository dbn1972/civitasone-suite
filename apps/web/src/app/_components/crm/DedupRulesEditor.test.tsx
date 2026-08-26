import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DedupRulesEditor } from "./DedupRulesEditor";
import * as dq from "@/lib/crm/dataQuality";

vi.mock("@/lib/crm/dataQuality", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/dataQuality")>();
  return { ...actual, getDedupRules: vi.fn(), saveDedupRules: vi.fn() };
});

const rule: dq.DedupRule = { field: "email", matchType: "exact", weight: 1, threshold: 90, enabled: true };

beforeEach(() => {
  vi.mocked(dq.getDedupRules).mockReset();
  vi.mocked(dq.saveDedupRules).mockReset();
});

describe("DedupRulesEditor (DQ-001 admin)", () => {
  it("loads and shows existing rules", async () => {
    vi.mocked(dq.getDedupRules).mockResolvedValue({ data: [rule], source: "api" });
    render(<DedupRulesEditor />);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(screen.queryByText(/showing saved information/i)).not.toBeInTheDocument();
  });

  it("shows saved-info badge on a failed load (source===error)", async () => {
    vi.mocked(dq.getDedupRules).mockResolvedValue({ data: [], source: "error" });
    render(<DedupRulesEditor />);
    await waitFor(() => expect(screen.getByText(/showing saved information/i)).toBeInTheDocument());
    expect(screen.getByText(/no matching rules yet/i)).toBeInTheDocument();
  });

  it("adds a rule and saves it", async () => {
    vi.mocked(dq.getDedupRules).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(dq.saveDedupRules).mockResolvedValue(undefined);
    render(<DedupRulesEditor />);
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
    render(<DedupRulesEditor />);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));
    expect(await screen.findByText(/BAD: nope/i)).toBeInTheDocument();
  });

  it("blocks save and shows an inline error when a rule has a non-finite number (finding 4)", async () => {
    vi.mocked(dq.getDedupRules).mockResolvedValue({
      data: [{ ...rule, weight: Number.NaN }],
      source: "api",
    });
    render(<DedupRulesEditor />);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));
    expect(await screen.findByText(/must be whole numbers/i)).toBeInTheDocument();
    expect(dq.saveDedupRules).not.toHaveBeenCalled();
  });

  it("sanitizes a non-numeric weight entry to 0 instead of NaN (finding 4)", async () => {
    vi.mocked(dq.getDedupRules).mockResolvedValue({ data: [rule], source: "api" });
    vi.mocked(dq.saveDedupRules).mockResolvedValue(undefined);
    render(<DedupRulesEditor />);
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
    render(<DedupRulesEditor />);
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
});

