import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const fetchServiceDefinition = vi.fn();
const fetchLatestSandboxTest = vi.fn();
const submitForApproval = vi.fn();

vi.mock("./designerApi", () => ({
  fetchServiceDefinition: (id: string) => fetchServiceDefinition(id),
}));
vi.mock("./sandboxTestApi", () => ({
  fetchLatestSandboxTest: (id: string) => fetchLatestSandboxTest(id),
}));
vi.mock("./designerReviewApi", () => ({
  submitForApproval: (id: string) => submitForApproval(id),
}));

const { useDesignerWizard } = await import("./useDesignerWizard");

/**
 * UX-016: onSubmit's catch fell back to the literal string "Submit
 * failed." when the caught value wasn't an Error instance — the same
 * class of leak (a bare "<Verb> failed" phrase shown to the user)
 * useFormError closes for components (UX-003). This is a plain custom
 * hook with no addressable form fields to attach fieldError(...) spans
 * to, so it routes through the catalogued toHumanError building block
 * directly instead, same as the non-component data-client fixes in this
 * module (works/_data/client.ts precedent).
 */
describe("useDesignerWizard — onSubmit never falls back to a raw '<Verb> failed' literal", () => {
  beforeEach(() => {
    fetchServiceDefinition.mockReset().mockResolvedValue({
      id: "def-1",
      serviceKey: "trade-license",
      name: "Trade License",
      servicePattern: "certificate",
      channels: ["portal"],
      status: "draft",
      version: 1,
    });
    fetchLatestSandboxTest.mockReset().mockResolvedValue({ id: "t1", status: "pass" });
    submitForApproval.mockReset();
  });

  afterEach(() => vi.clearAllMocks());

  it("shows the catalogued clerk-safe message, never 'Submit failed.', when submitForApproval rejects with a non-Error", async () => {
    submitForApproval.mockRejectedValue("boom");

    const { result } = renderHook(() => useDesignerWizard("def-1", "b1"));
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(result.current.error).not.toBe("Submit failed.");
    expect(result.current.error).not.toMatch(/submit failed/i);
    expect(result.current.error).toMatch(/couldn't save/i);
  });

  it("shows the underlying Error message as-is when submitForApproval rejects with a real Error (already clerk-safe from designerReviewApi)", async () => {
    submitForApproval.mockRejectedValue(new Error("We couldn't save your service definition. Nothing was changed."));

    const { result } = renderHook(() => useDesignerWizard("def-1", "b1"));
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(result.current.error).toBe("We couldn't save your service definition. Nothing was changed.");
  });

  // CLOS-S1-03
  it("never shows the raw browser 'Failed to fetch' when submit fails offline", async () => {
    submitForApproval.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => useDesignerWizard("def-1", "b1"));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await result.current.onSubmit(); });
    expect(result.current.error).not.toMatch(/failed to fetch/i);
    expect(result.current.error).toMatch(/couldn't save/i);
  });

  it("never shows the raw browser 'Failed to fetch' when the draft load fails offline", async () => {
    fetchServiceDefinition.mockReset().mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => useDesignerWizard("def-1", "b1"));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.error).not.toBeNull();
    expect(result.current.error).not.toMatch(/failed to fetch/i);
    expect(result.current.error).toMatch(/couldn't load/i);
  });
});

/**
 * A pass only authorises submit for the design it tested. The server flags a run
 * whose design hash no longer matches the draft (`stale`) and rejects submit with
 * TEST_STALE; the Submit button must not light up on such a pass.
 */
describe("useDesignerWizard — canSubmit is bound to the tested design", () => {
  const DEF = {
    id: "def-1", serviceKey: "k", name: "S", servicePattern: "certificate",
    channels: ["portal"], status: "draft", version: 1,
    formId: "f", eligibilityRuleSetId: "e", workflowDefinitionId: "w", feeScheduleId: "fs", hoaCode: "h",
    requiredDocuments: [{ docType: "id" }], issuanceType: "certificate",
  };
  async function submittable(latest: Record<string, unknown>) {
    fetchServiceDefinition.mockReset().mockResolvedValue(DEF);
    fetchLatestSandboxTest.mockReset().mockResolvedValue(latest);
    const { result } = renderHook(() => useDesignerWizard("def-1", "b1"));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    return result.current;
  }

  it("a current pass allows submit", async () => {
    expect((await submittable({ id: "t1", status: "pass", stale: false })).canSubmit).toBe(true);
  });
  it("a pass the server marks stale does NOT allow submit", async () => {
    const w = await submittable({ id: "t1", status: "pass", stale: true });
    expect(w.testPassed).toBe(false);
    expect(w.canSubmit).toBe(false);
  });
  it("a failed or missing run does not allow submit", async () => {
    expect((await submittable({ id: "t1", status: "fail" })).canSubmit).toBe(false);
    expect((await submittable({ id: "", status: "none" })).canSubmit).toBe(false);
  });
});

/**
 * Owner decision D4c #11 (GAP-DESIGNER-DETAIL-B8-03): blocks 1 to 7 must be
 * complete before the officer can run the test; block 8 (notifications) may stay
 * optional. The hook says which block is holding Run Test back.
 */
describe("useDesignerWizard — Run Test needs blocks 1 to 7 complete (D4c #11)", () => {
  const COMPLETE = {
    id: "def-1", serviceKey: "k", name: "S", servicePattern: "certificate",
    channels: ["portal"], status: "draft", version: 1,
    formId: "f", eligibilityRuleSetId: "e", workflowDefinitionId: "w", feeScheduleId: "fs", hoaCode: "h",
    requiredDocuments: [{ docType: "id" }], issuanceType: "certificate",
  };
  async function wizardFor(def: Record<string, unknown>) {
    fetchServiceDefinition.mockReset().mockResolvedValue(def);
    fetchLatestSandboxTest.mockReset().mockResolvedValue({ id: "", status: "none" });
    const { result } = renderHook(() => useDesignerWizard("def-1", "b1"));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    return result.current;
  }

  it("allows Run Test when b1-b7 are complete even though b8 is only in progress", async () => {
    const w = await wizardFor(COMPLETE);
    expect(w.blocks.find((b) => b.id === "b8")?.status).toBe("in-progress");
    expect(w.canRunTest).toBe(true);
    expect(w.runTestBlockedBy).toEqual([]);
  });

  it("a fee model with no Head of Account (b5 in progress) holds Run Test back and names the block", async () => {
    const w = await wizardFor({ ...COMPLETE, hoaCode: undefined });
    expect(w.canRunTest).toBe(false);
    expect(w.runTestBlockedBy).toEqual(["Fee & Revenue"]);
  });

  it("names every incomplete required block, in order", async () => {
    const w = await wizardFor({ ...COMPLETE, formId: undefined, requiredDocuments: [] });
    expect(w.canRunTest).toBe(false);
    expect(w.runTestBlockedBy).toEqual(["Intake Form", "Documents"]);
  });

  it("does not hold Run Test back for a block the pattern hides", async () => {
    const w = await wizardFor({ ...COMPLETE, servicePattern: "collection", eligibilityRuleSetId: undefined, workflowDefinitionId: undefined, requiredDocuments: [] });
    expect(w.canRunTest).toBe(true);
  });
});
