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
});
