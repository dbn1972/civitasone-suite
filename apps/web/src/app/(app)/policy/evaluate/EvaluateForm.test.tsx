import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EvaluateForm } from "./EvaluateForm";

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }) as unknown as Response,
  ).mockImplementation(async () =>
    ({ ok, status, json: async () => body, text: async () => JSON.stringify(body), headers: new Headers() }) as unknown as Response,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("EvaluateForm", () => {
  it("GAP-POLICY-EVALUATE-01: hides the 'Evaluate as user' picker for a non-admin and never sends subjectUserId", async () => {
    const spy = mockFetchOnce({ decision: "deny", reason: "no permission" });
    render(<EvaluateForm canEvaluateOthers={false} />);
    expect(screen.queryByLabelText("Evaluate as user")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Evaluate" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const bodyStr = (spy.mock.calls[0]![1] as RequestInit).body as string;
    expect(JSON.parse(bodyStr)).not.toHaveProperty("subjectUserId");
  });

  it("GAP-POLICY-EVALUATE-01: shows the picker for an admin", () => {
    render(<EvaluateForm canEvaluateOthers />);
    expect(screen.getByLabelText("Evaluate as user")).toBeInTheDocument();
  });

  it("GAP-POLICY-EVALUATE-02: renders the decision as a coloured pill", async () => {
    mockFetchOnce({ decision: "deny", reason: "no permission" });
    render(<EvaluateForm />);
    fireEvent.click(screen.getByRole("button", { name: "Evaluate" }));
    const pill = await screen.findByText("Deny");
    expect(pill.className).toContain("bad");
  });

  it("GAP-POLICY-EVALUATE-02: links a matched rule to /policy/abac#rule-<id>", async () => {
    mockFetchOnce({ decision: "deny", reason: "abac", matchedRuleId: "rule-123" });
    render(<EvaluateForm />);
    fireEvent.click(screen.getByRole("button", { name: "Evaluate" }));
    const link = await screen.findByRole("link", { name: "View rule" });
    expect(link.getAttribute("href")).toBe("/policy/abac#rule-rule-123");
  });

  it("GAP-POLICY-EVALUATE-03: a server failure message does not say 'save'", async () => {
    mockFetchOnce({ code: "INTERNAL" }, false, 500);
    render(<EvaluateForm />);
    fireEvent.click(screen.getByRole("button", { name: "Evaluate" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent?.toLowerCase()).not.toContain("save");
  });

  it("GAP-POLICY-EVALUATE-04: the previous result stays visible during a re-run", async () => {
    mockFetchOnce({ decision: "allow", reason: "role:super_admin" });
    render(<EvaluateForm />);
    fireEvent.click(screen.getByRole("button", { name: "Evaluate" }));
    await screen.findByText("Allow");
    // Re-run: the result region is still present (not blanked on submit).
    fireEvent.click(screen.getByRole("button", { name: /Evaluat/ }));
    expect(screen.getByText("Allow")).toBeInTheDocument();
  });
});
