import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DedupRulesEditor } from "./DedupRulesEditor";
import * as dq from "@/lib/crm/dataQuality";

vi.mock("@/lib/crm/dataQuality", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/dataQuality")>();
  return { ...actual, getDedupRules: vi.fn(), saveDedupRules: vi.fn() };
});

const rule: dq.DedupRule = { field: "email", matchType: "exact", weight: 1, threshold: 0.9, enabled: true };

beforeEach(() => {
  vi.mocked(dq.getDedupRules).mockReset();
  vi.mocked(dq.saveDedupRules).mockReset();
});

describe("DedupRulesEditor (DQ-001 admin)", () => {
  it("loads and shows existing rules", async () => {
    vi.mocked(dq.getDedupRules).mockResolvedValue({ data: [rule], source: "api" });
    render(<DedupRulesEditor />);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(screen.queryByText(/couldn.t load/i)).not.toBeInTheDocument();
  });

  it("shows saved-info badge on a failed load (source===error)", async () => {
    vi.mocked(dq.getDedupRules).mockResolvedValue({ data: [], source: "error" });
    render(<DedupRulesEditor />);
    await waitFor(() => expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument());
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
    expect(await screen.findByText(/must be valid numbers/i)).toBeInTheDocument();
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
});
