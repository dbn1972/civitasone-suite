import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QualifyPanel } from "./QualifyPanel";
import * as lq from "@/lib/crm/leadQualification";

vi.mock("@/lib/crm/leadQualification", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/leadQualification")>();
  return { ...actual, getFrameworks: vi.fn(), qualifyLead: vi.fn() };
});

const framework: lq.QualificationFramework = {
  id: "f1",
  name: "BANT",
  businessLine: "government",
  active: true,
  questions: [
    { id: "q1", text: "Has budget?", weight: 2, options: [{ label: "Yes", value: "yes", score: 10 }, { label: "No", value: "no", score: 0 }] },
    { id: "q2", text: "Decision timeline?", weight: 1 },
  ],
};

beforeEach(() => {
  vi.mocked(lq.getFrameworks).mockReset();
  vi.mocked(lq.qualifyLead).mockReset();
});

describe("QualifyPanel (LQ-001)", () => {
  it("loads the framework for the business line and renders its questions", async () => {
    vi.mocked(lq.getFrameworks).mockResolvedValue({ data: [framework], source: "api" });
    render(<QualifyPanel leadId="l1" businessLine="government" />);
    await waitFor(() => expect(screen.getByLabelText("Has budget?")).toBeInTheDocument());
    expect(lq.getFrameworks).toHaveBeenCalledWith("government");
    expect(screen.getByLabelText("Decision timeline?")).toBeInTheDocument();
  });

  it("collects answers, qualifies, and shows the outcome + score", async () => {
    vi.mocked(lq.getFrameworks).mockResolvedValue({ data: [framework], source: "api" });
    vi.mocked(lq.qualifyLead).mockResolvedValue({ outcome: "qualified", score: 88 });
    render(<QualifyPanel leadId="l1" businessLine="government" />);
    await waitFor(() => expect(screen.getByLabelText("Has budget?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Has budget?"), { target: { value: "yes" } });
    fireEvent.click(screen.getByRole("button", { name: /qualify lead/i }));
    await waitFor(() => expect(lq.qualifyLead).toHaveBeenCalledWith("l1", { frameworkId: "f1", answers: { q1: "yes" } }));
    expect(await screen.findByText(/qualified/)).toBeInTheDocument();
    expect(screen.getByText("88")).toBeInTheDocument();
  });

  it("shows the saved-info badge and an empty state on a failed framework load", async () => {
    vi.mocked(lq.getFrameworks).mockResolvedValue({ data: [], source: "error" });
    render(<QualifyPanel leadId="l1" businessLine="government" />);
    await waitFor(() => expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument());
    expect(screen.getByText(/no qualification framework/i)).toBeInTheDocument();
  });

  it("surfaces a qualify error without crashing", async () => {
    vi.mocked(lq.getFrameworks).mockResolvedValue({ data: [framework], source: "api" });
    vi.mocked(lq.qualifyLead).mockRejectedValue(new Error("QUALIFY_FAILED: engine down"));
    render(<QualifyPanel leadId="l1" businessLine="government" />);
    await waitFor(() => expect(screen.getByLabelText("Has budget?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /qualify lead/i }));
    expect(await screen.findByText(/QUALIFY_FAILED: engine down/)).toBeInTheDocument();
  });
});
