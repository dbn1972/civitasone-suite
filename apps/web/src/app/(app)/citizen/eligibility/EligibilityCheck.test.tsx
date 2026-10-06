import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { EligibilityCheck, type EligibilityServiceOption } from "./EligibilityCheck";

const SERVICES: EligibilityServiceOption[] = [
  { id: "svc-1", name: "Old Age Pension" },
  { id: "svc-2", name: "Scholarship" },
];

function renderCheck(evalResponse?: unknown) {
  const fetchMock = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify(evalResponse ?? { outcome: "not_eligible", reasons: [{ ruleId: "r1", passed: false, message: "Age below threshold" }], id: "ev-123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  const utils = render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <EligibilityCheck services={SERVICES} />
    </NextIntlClientProvider>,
  );
  return { ...utils, fetchMock };
}

describe("EligibilityCheck", () => {
  beforeEach(() => vi.unstubAllGlobals());

  // GAP-CITIZEN-ELIGIBILITY-01
  it("has no prefilled sample attributes (starts as empty object)", () => {
    renderCheck();
    const ta = screen.getByLabelText("Applicant attributes (JSON)") as HTMLTextAreaElement;
    expect(ta.value).toBe("{}");
    expect(ta.value).not.toContain("income_proof");
    expect(ta.value).not.toContain("65");
  });

  it("offers services by name instead of a Service UUID input", () => {
    renderCheck();
    const select = screen.getByLabelText("Service") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect(screen.getByRole("option", { name: "Old Age Pension" })).toBeInTheDocument();
    expect(screen.queryByText("Service ID (UUID)")).not.toBeInTheDocument();
  });

  it("keeps Run disabled until a service is chosen and the JSON is valid", () => {
    renderCheck();
    const runBtn = screen.getByRole("button", { name: "Run check" });
    expect(runBtn).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Service"), { target: { value: "svc-1" } });
    expect(runBtn).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText("Applicant attributes (JSON)"), { target: { value: "{ not json" } });
    expect(runBtn).toBeDisabled();
  });

  // GAP-CITIZEN-ELIGIBILITY-02
  it("renders a humanized outcome ('Not eligible'), not the raw code", async () => {
    renderCheck();
    fireEvent.change(screen.getByLabelText("Service"), { target: { value: "svc-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Run check" }));
    await waitFor(() => expect(screen.getByText(/Outcome: Not eligible/)).toBeInTheDocument());
    expect(screen.queryByText(/not_eligible/)).not.toBeInTheDocument();
  });

  it("shows a textual pass/fail indicator per rule (not colour alone) and the decision reference", async () => {
    renderCheck();
    fireEvent.change(screen.getByLabelText("Service"), { target: { value: "svc-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Run check" }));
    await waitFor(() => expect(screen.getByText(/Age below threshold/)).toBeInTheDocument());
    expect(screen.getByText(/Fail/)).toBeInTheDocument();
    expect(screen.getByText(/Reference:/)).toBeInTheDocument();
    expect(screen.getByText(/ev-123/)).toBeInTheDocument();
  });
});
