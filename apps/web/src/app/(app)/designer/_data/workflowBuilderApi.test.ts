import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { lanesToBpmn, persistWorkflowDesign } from "./workflowBuilderApi";
import {
  defaultLanes,
  emptyWorkflowDesign,
  lanesToBindings,
  narrateWorkflow,
  slaDaysToMinutes,
} from "./workflowConstants";

describe("workflowConstants", () => {
  it("narrates enabled approval steps", () => {
    const lanes = defaultLanes().map((l) =>
      l.key === "decision"
        ? { ...l, designationLabel: "Licensing Officer", slaDays: 5 }
        : l,
    );
    const text = narrateWorkflow(lanes);
    expect(text).toMatch(/licensing officer/i);
    expect(text).toMatch(/5 days/i);
  });

  it("FN-25: converts SLA days to minutes and pack bindings", () => {
    expect(slaDaysToMinutes(7)).toBe(7 * 1440);
    const bindings = lanesToBindings(
      defaultLanes().map((l) =>
        l.key === "inspection"
          ? {
              ...l,
              designationId: "pos-i",
              escalationDesignationId: "pos-o",
              escalationDesignationLabel: "Officer",
              slaDays: 7,
            }
          : l,
      ),
    );
    const inspection = bindings.find((b) => b.key === "inspection");
    expect(inspection?.escalationDesignationId).toBe("pos-o");
    expect(inspection?.slaDays).toBe(7);
  });
});

describe("lanesToBpmn (re-export)", () => {
  it("builds a linear chain from guided lanes", () => {
    const { elements, edges } = lanesToBpmn(defaultLanes());
    expect(elements.some((e) => e.type === "startEvent")).toBe(true);
    expect(elements.some((e) => e.type === "task" && e.label === "Decision")).toBe(true);
    expect(edges.length).toBeGreaterThan(0);
  });

  it("FN-25: stamps slaMinutes and escalation designation on task nodes", () => {
    const lanes = defaultLanes().map((l) =>
      l.key === "inspection"
        ? {
            ...l,
            slaDays: 7,
            escalationDesignationId: "pos-officer",
            escalationDesignationLabel: "Licensing Officer",
          }
        : l,
    );
    const { elements } = lanesToBpmn(lanes);
    const node = elements.find((e) => e.properties?.laneKey === "inspection");
    expect(node?.properties?.slaMinutes).toBe(7 * 1440);
    expect(node?.properties?.escalationDesignationId).toBe("pos-officer");
  });
});

/**
 * UX-016: persistWorkflowDesign's parseJson used to throw the raw response
 * body text (or a `Request failed (${status})` fallback) on a failed
 * workflow-design save — the same class of leak useFormError closes for
 * components (UX-003). This module is a plain async data client, not a
 * component, so it can't use that hook; it now goes through the same
 * catalogued toHumanError vocabulary instead and never reads the response
 * body at all, so it structurally cannot leak it.
 */
describe("workflowBuilderApi — persistWorkflowDesign never leaks raw status or server text", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("throws a clerk-safe message, never the raw HTTP status or server text, creating a new definition", async () => {
    fetchMock.mockResolvedValue(
      new Response("workflow-service circuit open", { status: 502 }),
    );
    const design = emptyWorkflowDesign("Trade License");
    const err = await persistWorkflowDesign(design).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).not.toMatch(/\b502\b/);
    expect(message).not.toContain("workflow-service circuit open");
    expect(message).toMatch(/couldn't save/i);
  });

  it("throws the same clerk-safe message updating an existing definition", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    const design = { ...emptyWorkflowDesign("Trade License"), definitionId: "wf-1", version: 2 };
    const err = await persistWorkflowDesign(design).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toMatch(/\b500\b/);
  });
});
