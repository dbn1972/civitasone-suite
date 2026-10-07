import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const mockFaqs = vi.fn();
const mockFlows = vi.fn();
vi.mock("../_data/loaders", () => ({
  getKnowledgeFaqs: (...a: unknown[]) => mockFaqs(...a),
  getKnowledgeGuidedFlows: (...a: unknown[]) => mockFlows(...a),
}));

import Page from "./page";
import { FaqBrowser } from "./FaqBrowser";

const faq = (over: Record<string, unknown> = {}) => ({
  id: "f1", question: "How to apply for leave?", answer: "Use HRMS.",
  category: "HR", tags: ["leave"], status: "published", updatedAt: "2026-01-01T00:00:00Z", ...over,
});

describe("FAQ page (FAQS-01, FAQS-05)", () => {
  beforeEach(() => { mockFaqs.mockReset(); mockFlows.mockReset(); });

  // GAP-KNOWLEDGE-FAQS-01: on error, stat cards show "—" not 0.
  it("shows — in stat cards when a loader errors", async () => {
    mockFaqs.mockResolvedValue({ data: [], source: "error" });
    mockFlows.mockResolvedValue({ data: [], source: "api" });
    render(await Page());
    expect(screen.getAllByText("—").length).toBe(3);
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  // GAP-KNOWLEDGE-FAQS-05: a null category is counted and displayed as "General".
  it("renders a null-category FAQ as General", async () => {
    mockFaqs.mockResolvedValue({ data: [faq({ category: null })], source: "api" });
    mockFlows.mockResolvedValue({ data: [], source: "api" });
    render(await Page());
    expect(screen.getByText("· General")).toBeInTheDocument();
  });
});

describe("FaqBrowser (FAQS-03)", () => {
  const faqs = [
    faq({ id: "a", question: "Leave policy question", answer: "about leave", category: "HR", tags: ["leave"] }),
    faq({ id: "b", question: "Travel reimbursement", answer: "about travel", category: "Finance", tags: ["travel"] }),
    faq({ id: "c", question: "No category one", answer: "misc", category: "General", tags: [] }),
  ];

  it("filters FAQs by keyword and restores on clear", () => {
    render(<FaqBrowser faqs={faqs} />);
    fireEvent.change(screen.getByLabelText("Search FAQs"), { target: { value: "travel" } });
    expect(screen.getByText("Travel reimbursement")).toBeInTheDocument();
    expect(screen.queryByText("Leave policy question")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByText("Leave policy question")).toBeInTheDocument();
  });

  it("filters by category", () => {
    render(<FaqBrowser faqs={faqs} />);
    fireEvent.change(screen.getByLabelText("Filter by category"), { target: { value: "Finance" } });
    expect(screen.getByText("Travel reimbursement")).toBeInTheDocument();
    expect(screen.queryByText("Leave policy question")).not.toBeInTheDocument();
    expect(screen.queryByText("No category one")).not.toBeInTheDocument();
  });

  it("shows an empty state when nothing matches", () => {
    render(<FaqBrowser faqs={faqs} />);
    fireEvent.change(screen.getByLabelText("Search FAQs"), { target: { value: "zzzznomatch" } });
    expect(screen.getByText("No FAQs match")).toBeInTheDocument();
  });
});
