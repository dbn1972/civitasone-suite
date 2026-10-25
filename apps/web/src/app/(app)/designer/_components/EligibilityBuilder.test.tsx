import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { emptyEligibilityDesign } from "../_data/eligibilityBuilderApi";
import { EligibilityBuilder } from "./EligibilityBuilder";

// CLOS3-S1-03: persistEligibilityDesign returns a fresh object; feeding it back through setDesign
// re-armed the autosave effect, so the rule set was PATCHed every 2s with no edits.
describe("EligibilityBuilder autosave settles (CLOS3-S1-03)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const calls = (method: string) =>
    fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === method);

  const advance = async (times: number) => {
    for (let i = 0; i < times; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100);
      });
    }
  };

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "rs-new" }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not PATCH an existing rule set when nothing was edited", async () => {
    render(
      <EligibilityBuilder
        serviceId="s"
        serviceName="T"
        initial={{ ...emptyEligibilityDesign("T"), ruleSetId: "rs1" }}
        formFields={[]}
      />,
    );
    await advance(5);
    expect(calls("PATCH")).toHaveLength(0);
  });

  it("PATCHes exactly once after a rule edit", async () => {
    render(
      <EligibilityBuilder
        serviceId="s"
        serviceName="T"
        initial={{ ...emptyEligibilityDesign("T"), ruleSetId: "rs1" }}
        formFields={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add condition/i }));
    await advance(5);
    const patches = calls("PATCH");
    expect(patches).toHaveLength(1);
    expect(String(patches[0][0])).toBe("/api/proxy/v1/citizen/eligibility/rule-sets/rs1");
  });

  it("creates a brand-new rule set once on mount, then stays idle", async () => {
    render(
      <EligibilityBuilder serviceId="s" serviceName="T" initial={emptyEligibilityDesign("T")} formFields={[]} />,
    );
    await advance(5);
    expect(calls("POST")).toHaveLength(1);
    expect(calls("PATCH")).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
