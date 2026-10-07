import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const rulesMock = vi.fn();
vi.mock("../_data", () => ({ getAiGuardrailRules: () => rulesMock() }));

import GuardrailsPage from "./page";

describe("GuardrailsPage (GAP-AI-GUARDRAILS-01/02/03/04/05)", () => {
  beforeEach(() => rulesMock.mockReset());

  it("GUARDRAILS-01: a failed fetch shows a retry state, not an empty list", async () => {
    rulesMock.mockResolvedValue({ data: [], source: "error" });
    render(await GuardrailsPage());
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText(/No guardrail rules are configured/i)).not.toBeInTheDocument();
  });

  it("GUARDRAILS-01: an empty successful result shows the custom empty message", async () => {
    rulesMock.mockResolvedValue({ data: [], source: "api" });
    render(await GuardrailsPage());
    expect(screen.getByText(/No guardrail rules are configured/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("GUARDRAILS-02/03: shows typed columns and the friendly rule type label", async () => {
    rulesMock.mockResolvedValue({
      data: [{ id: "11111111-1111-1111-1111-111111111111", name: "Block PAN", ruleType: "pii", pattern: "[A-Z]{5}", severity: "high", status: "active" }],
      source: "api",
    });
    render(await GuardrailsPage());
    expect(screen.getByText("Block PAN")).toBeInTheDocument();
    expect(screen.getByText("PII redaction")).toBeInTheDocument();
    // full id available as a title on the mono cell
    const mono = document.querySelector("span.mono[title]") as HTMLElement | null;
    expect(mono?.getAttribute("title")).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("GUARDRAILS-04: links to the blocked-prompt audit trail", async () => {
    rulesMock.mockResolvedValue({ data: [], source: "api" });
    render(await GuardrailsPage());
    expect(screen.getByRole("link", { name: /View blocked prompts/i })).toHaveAttribute("href", "/ai/governance?blocked=true");
  });

  it("GUARDRAILS-05: back link points to /ai (client-side PageHeader back)", async () => {
    rulesMock.mockResolvedValue({ data: [], source: "api" });
    render(await GuardrailsPage());
    expect(screen.getByRole("link", { name: "AI & Copilot" })).toHaveAttribute("href", "/ai");
  });
});
