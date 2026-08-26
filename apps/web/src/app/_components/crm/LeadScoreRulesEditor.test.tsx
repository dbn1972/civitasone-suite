import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LeadScoreRulesEditor } from "./LeadScoreRulesEditor";
import * as lq from "@/lib/crm/leadQualification";

vi.mock("@/lib/crm/leadQualification", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/leadQualification")>();
  return { ...actual, getScoreRules: vi.fn(), saveScoreRules: vi.fn() };
});

const rule: lq.LeadScoreRule = { attribute: "industry", weight: 5, scoreFnType: "linear", params: { max: 100 }, enabled: true };

beforeEach(() => {
  vi.mocked(lq.getScoreRules).mockReset();
  vi.mocked(lq.saveScoreRules).mockReset();
});

describe("LeadScoreRulesEditor (LQ-002 admin)", () => {
  it("loads and shows existing rules", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: [rule], source: "api" });
    render(<LeadScoreRulesEditor />);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(screen.getByLabelText(/attribute for rule 1/i)).toHaveValue("industry");
    expect(screen.queryByText(/couldn.t load/i)).not.toBeInTheDocument();
  });

  it("shows the saved-info badge on a failed load (source===error)", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: [], source: "error" });
    render(<LeadScoreRulesEditor />);
    await waitFor(() => expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument());
    expect(screen.getByText(/no scoring rules yet/i)).toBeInTheDocument();
  });

  it("adds a rule and saves it, serialising params to JSON", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(lq.saveScoreRules).mockResolvedValue(undefined);
    render(<LeadScoreRulesEditor />);
    await waitFor(() => expect(screen.getByText(/no scoring rules yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add rule/i }));
    fireEvent.change(screen.getByLabelText(/attribute for rule 1/i), { target: { value: "budget" } });
    fireEvent.change(screen.getByLabelText(/params json for rule 1/i), { target: { value: '{"max":50}' } });
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));
    await waitFor(() => expect(lq.saveScoreRules).toHaveBeenCalled());
    const saved = vi.mocked(lq.saveScoreRules).mock.calls[0][0];
    expect(saved[0]).toMatchObject({ attribute: "budget", params: { max: 50 } });
  });

  it("blocks save when a weight is non-finite (NaN guard)", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: [{ ...rule, weight: Number.NaN }], source: "api" });
    render(<LeadScoreRulesEditor />);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));
    expect(await screen.findByText(/needs an attribute, a whole-number weight/i)).toBeInTheDocument();
    expect(lq.saveScoreRules).not.toHaveBeenCalled();
  });

  it("blocks save when params are not valid JSON", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: [rule], source: "api" });
    render(<LeadScoreRulesEditor />);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    const params = screen.getByLabelText(/params json for rule 1/i);
    fireEvent.change(params, { target: { value: "{not json" } });
    expect(params).toHaveAttribute("aria-invalid", "true");
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));
    expect(await screen.findByText(/valid json params/i)).toBeInTheDocument();
    expect(lq.saveScoreRules).not.toHaveBeenCalled();
  });

  it("surfaces a save error from the server", async () => {
    vi.mocked(lq.getScoreRules).mockResolvedValue({ data: [rule], source: "api" });
    vi.mocked(lq.saveScoreRules).mockRejectedValue(new Error("BAD: nope"));
    render(<LeadScoreRulesEditor />);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /save rules/i }));
    expect(await screen.findByText(/BAD: nope/)).toBeInTheDocument();
  });
});
