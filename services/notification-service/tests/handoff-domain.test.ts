/**
 * F.5 — AI pause/resume protocol: the handoff state machine.
 *
 * Exhaustive over the full state x action grid (4 x 4 = 16 transitions), because
 * `aiPaused` is the single flag the AI agent reads before replying: a wrong
 * answer means either the AI talks over a human agent or a citizen gets silence.
 */
import { describe, it, expect } from "vitest";
import {
  applyHandoffTransition,
  isAiPaused,
  allowedActions,
  isHandoffState,
  HANDOFF_STATES,
  HANDOFF_ACTIONS,
  INITIAL_HANDOFF_STATE,
  type HandoffState,
  type HandoffAction,
} from "../src/modules/inbox/handoff-domain.js";

const AGENT = "99999999-9999-4000-8000-000000000009";

/** null = the transition is invalid from that state. */
const EXPECTED: Record<HandoffState, Record<HandoffAction, HandoffState | null>> = {
  ai_handling:    { pause: "paused",  assign_human: "human_handling", resume_ai: null,          close: "closed" },
  paused:         { pause: null,      assign_human: "human_handling", resume_ai: "ai_handling", close: "closed" },
  human_handling: { pause: "paused",  assign_human: null,             resume_ai: "ai_handling", close: "closed" },
  closed:         { pause: null,      assign_human: null,             resume_ai: null,          close: null },
};

describe("applyHandoffTransition — full state x action grid", () => {
  for (const from of HANDOFF_STATES) {
    for (const action of HANDOFF_ACTIONS) {
      const to = EXPECTED[from][action];
      if (to === null) {
        it(`${from} + ${action} → INVALID_TRANSITION`, () => {
          const result = applyHandoffTransition(from, { action, agentId: AGENT });
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.code).toBe("INVALID_TRANSITION");
            expect(result.message).toContain(from);
          }
        });
      } else {
        it(`${from} + ${action} → ${to}`, () => {
          const result = applyHandoffTransition(from, { action, agentId: AGENT });
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.from).toBe(from);
            expect(result.to).toBe(to);
            expect(result.action).toBe(action);
            expect(result.aiPaused).toBe(isAiPaused(to));
          }
        });
      }
    }
  }
});

describe("applyHandoffTransition — assign_human requires an owner", () => {
  it("rejects a missing agentId", () => {
    const result = applyHandoffTransition("ai_handling", { action: "assign_human" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("AGENT_REQUIRED");
  });

  it("rejects a null agentId", () => {
    const result = applyHandoffTransition("ai_handling", { action: "assign_human", agentId: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("AGENT_REQUIRED");
  });

  it("rejects an empty-string agentId", () => {
    const result = applyHandoffTransition("paused", { action: "assign_human", agentId: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("AGENT_REQUIRED");
  });

  it("accepts a present agentId", () => {
    expect(applyHandoffTransition("paused", { action: "assign_human", agentId: AGENT }).ok).toBe(true);
  });

  it("does NOT require an agentId for pause/resume/close", () => {
    expect(applyHandoffTransition("ai_handling", { action: "pause" }).ok).toBe(true);
    expect(applyHandoffTransition("paused", { action: "resume_ai" }).ok).toBe(true);
    expect(applyHandoffTransition("ai_handling", { action: "close" }).ok).toBe(true);
  });

  it("reports INVALID_TRANSITION before AGENT_REQUIRED when both would apply", () => {
    // human_handling + assign_human is not modelled at all; the state check must
    // win so the operator is told the real problem.
    const result = applyHandoffTransition("human_handling", { action: "assign_human" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_TRANSITION");
  });
});

describe("isAiPaused", () => {
  it("ai_handling → the AI may reply", () => {
    expect(isAiPaused("ai_handling")).toBe(false);
  });

  it("paused → the AI must stay silent", () => {
    expect(isAiPaused("paused")).toBe(true);
  });

  it("human_handling → the AI must stay silent", () => {
    expect(isAiPaused("human_handling")).toBe(true);
  });

  it("closed → the AI must stay silent", () => {
    expect(isAiPaused("closed")).toBe(true);
  });
});

describe("allowedActions", () => {
  it("ai_handling", () => {
    expect(allowedActions("ai_handling")).toEqual(["pause", "assign_human", "close"]);
  });

  it("paused", () => {
    expect(allowedActions("paused")).toEqual(["assign_human", "resume_ai", "close"]);
  });

  it("human_handling", () => {
    expect(allowedActions("human_handling")).toEqual(["pause", "resume_ai", "close"]);
  });

  it("closed is terminal — no action is offered", () => {
    expect(allowedActions("closed")).toEqual([]);
  });

  it("every allowed action actually succeeds from that state", () => {
    for (const from of HANDOFF_STATES) {
      for (const action of allowedActions(from)) {
        expect(applyHandoffTransition(from, { action, agentId: AGENT }).ok).toBe(true);
      }
    }
  });

  it("every action NOT allowed actually fails from that state", () => {
    for (const from of HANDOFF_STATES) {
      const allowed = new Set(allowedActions(from));
      for (const action of HANDOFF_ACTIONS) {
        if (allowed.has(action)) continue;
        expect(applyHandoffTransition(from, { action, agentId: AGENT }).ok).toBe(false);
      }
    }
  });
});

describe("isHandoffState / INITIAL_HANDOFF_STATE", () => {
  it("accepts every declared state", () => {
    for (const s of HANDOFF_STATES) expect(isHandoffState(s)).toBe(true);
  });

  it("rejects an unknown string", () => {
    expect(isHandoffState("escalated")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isHandoffState("")).toBe(false);
  });

  it("a never-handed-off conversation starts AI-handled", () => {
    expect(INITIAL_HANDOFF_STATE).toBe("ai_handling");
    expect(isAiPaused(INITIAL_HANDOFF_STATE)).toBe(false);
  });
});

describe("pause/resume round trips", () => {
  it("pause then resume returns to ai_handling", () => {
    const paused = applyHandoffTransition("ai_handling", { action: "pause" });
    expect(paused.ok && paused.to).toBe("paused");
    const resumed = applyHandoffTransition("paused", { action: "resume_ai" });
    expect(resumed.ok && resumed.to).toBe("ai_handling");
    expect(resumed.ok && resumed.aiPaused).toBe(false);
  });

  it("assign then resume hands the conversation back to the AI", () => {
    const assigned = applyHandoffTransition("ai_handling", { action: "assign_human", agentId: AGENT });
    expect(assigned.ok && assigned.to).toBe("human_handling");
    expect(assigned.ok && assigned.aiPaused).toBe(true);
    const resumed = applyHandoffTransition("human_handling", { action: "resume_ai" });
    expect(resumed.ok && resumed.to).toBe("ai_handling");
  });

  it("a closed conversation cannot be reopened by any action", () => {
    for (const action of HANDOFF_ACTIONS) {
      expect(applyHandoffTransition("closed", { action, agentId: AGENT }).ok).toBe(false);
    }
  });
});
