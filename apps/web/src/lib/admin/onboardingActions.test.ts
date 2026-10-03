import { describe, it, expect, vi, afterEach } from "vitest";
import { createOnboardingRequest, moveOnboardingStage, needsReason, nextStages } from "./onboardingActions";

afterEach(() => vi.restoreAllMocks());

describe("onboarding actions", () => {
  it("nextStages mirrors the machine, tolerating vocabulary variants; closed or unknown stages have none", () => {
    expect(nextStages("new request")).toEqual(["in progress", "rejected", "cancelled"]);
    expect(nextStages("Go-Live Pending")).toEqual(["completed", "in progress", "cancelled"]);
    expect(nextStages("go_live_pending")).toEqual(["completed", "in progress", "cancelled"]);
    expect(nextStages("completed")).toEqual([]);
    expect(nextStages("blocked")).toEqual([]);
  });
  it("only reject and cancel need a reason", () => {
    expect(needsReason("rejected")).toBe(true);
    expect(needsReason("cancelled")).toBe(true);
    expect(needsReason("completed")).toBe(false);
  });
  it("tenant id is sent only when completing", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    await moveOnboardingStage("r1", { from: "new request", to: "in progress", provisionedTenantId: "x" });
    expect(JSON.parse((spy.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ from: "new request", to: "in progress" });
  });
  it("a failure never leaks a status code and maps the known conflict codes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ code: "ILLEGAL_TRANSITION" }), { status: 409 }));
    const a = await moveOnboardingStage("r1", { from: "new request", to: "completed" });
    expect(a.ok === false && a.message).toMatch(/not allowed/);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("{}", { status: 500 }));
    const b = await createOnboardingRequest({ orgName: "X Org", contactName: "A", contactEmail: "a@b.gov.in" });
    expect(b.ok === false && b.message).not.toMatch(/500/);
  });
});
