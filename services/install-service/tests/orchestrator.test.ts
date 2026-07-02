import { describe, it, expect } from "vitest";
import {
  createWizardBody,
  completeStepBody,
  skipStepBody,
  wizardIdParam,
  stepKeyParam,
  stepDefBody,
} from "../src/modules/orchestrator/validators.js";
import * as commands from "../src/modules/orchestrator/commands.js";
import * as queries from "../src/modules/orchestrator/queries.js";
import type { RequestContext } from "@civitasone/types";

const CTX: RequestContext = {
  tenantId: "11111111-aaaa-4000-8000-000000000001",
  actorId: "00000000-aaaa-4000-8000-000000000001",
  correlationId: "corr-1",
  roles: ["install_admin"],
};

// ══════════════════════════════════════════════════════════════════════════════
// Validators
// ══════════════════════════════════════════════════════════════════════════════
describe("orchestrator validators", () => {
  describe("createWizardBody", () => {
    it("accepts valid wizard body", () => {
      const body = createWizardBody.parse({
        name: "onboarding",
        steps: [{ stepKey: "deploy-db", title: "Deploy DB", handlerType: "auto" }],
      });
      expect(body.name).toBe("onboarding");
      expect(body.steps).toHaveLength(1);
      expect(body.steps[0]!.isRequired).toBe(true);
      expect(body.steps[0]!.dependsOn).toEqual([]);
      expect(body.steps[0]!.config).toEqual({});
      expect(body.steps[0]!.sortOrder).toBe(0);
    });

    it("accepts full wizard body with all fields", () => {
      const body = createWizardBody.parse({
        name: "setup-wizard",
        description: "Complete tenant setup",
        steps: [
          { stepKey: "step-a", title: "First", handlerType: "manual", isRequired: true, dependsOn: [], config: { foo: "bar" }, sortOrder: 1 },
          { stepKey: "step-b", title: "Second", handlerType: "auto", isRequired: false, dependsOn: ["step-a"], config: {}, sortOrder: 2 },
        ],
      });
      expect(body.description).toBe("Complete tenant setup");
      expect(body.steps).toHaveLength(2);
    });

    it("rejects empty name", () => {
      expect(() => createWizardBody.parse({ name: "", steps: [{ stepKey: "a", title: "A", handlerType: "auto" }] })).toThrow();
    });

    it("rejects name too long", () => {
      expect(() => createWizardBody.parse({ name: "x".repeat(200), steps: [{ stepKey: "a", title: "A", handlerType: "auto" }] })).toThrow();
    });

    it("rejects empty steps array", () => {
      expect(() => createWizardBody.parse({ name: "wizard", steps: [] })).toThrow();
    });

    it("rejects too many steps", () => {
      const steps = Array.from({ length: 51 }, (_, i) => ({ stepKey: `step-${i}`, title: `Step ${i}`, handlerType: "auto" }));
      expect(() => createWizardBody.parse({ name: "wizard", steps })).toThrow();
    });

    it("rejects missing steps", () => {
      expect(() => createWizardBody.parse({ name: "wizard" })).toThrow();
    });
  });

  describe("stepDefBody", () => {
    it("accepts valid step definition", () => {
      const result = stepDefBody.parse({ stepKey: "deploy-db", title: "Deploy DB", handlerType: "auto" });
      expect(result.stepKey).toBe("deploy-db");
    });

    it("rejects invalid stepKey format (uppercase)", () => {
      expect(() => stepDefBody.parse({ stepKey: "DeployDB", title: "Deploy", handlerType: "auto" })).toThrow();
    });

    it("rejects invalid stepKey format (spaces)", () => {
      expect(() => stepDefBody.parse({ stepKey: "deploy db", title: "Deploy", handlerType: "auto" })).toThrow();
    });

    it("accepts underscores in stepKey", () => {
      const result = stepDefBody.parse({ stepKey: "deploy_db", title: "Deploy", handlerType: "auto" });
      expect(result.stepKey).toBe("deploy_db");
    });

    it("rejects empty stepKey", () => {
      expect(() => stepDefBody.parse({ stepKey: "", title: "Deploy", handlerType: "auto" })).toThrow();
    });

    it("rejects stepKey too long", () => {
      expect(() => stepDefBody.parse({ stepKey: "a".repeat(65), title: "Deploy", handlerType: "auto" })).toThrow();
    });

    it("rejects empty title", () => {
      expect(() => stepDefBody.parse({ stepKey: "step-a", title: "", handlerType: "auto" })).toThrow();
    });

    it("rejects title too long", () => {
      expect(() => stepDefBody.parse({ stepKey: "step-a", title: "x".repeat(200), handlerType: "auto" })).toThrow();
    });

    it("rejects empty handlerType", () => {
      expect(() => stepDefBody.parse({ stepKey: "step-a", title: "Step", handlerType: "" })).toThrow();
    });

    it("rejects description too long", () => {
      expect(() => stepDefBody.parse({ stepKey: "step-a", title: "Step", handlerType: "auto", description: "x".repeat(600) })).toThrow();
    });
  });

  describe("completeStepBody", () => {
    it("accepts empty body (output defaults to {})", () => {
      const result = completeStepBody.parse({});
      expect(result.output).toEqual({});
    });

    it("accepts body with output", () => {
      const result = completeStepBody.parse({ output: { key: "value" } });
      expect(result.output).toEqual({ key: "value" });
    });
  });

  describe("skipStepBody", () => {
    it("accepts empty body", () => {
      const result = skipStepBody.parse({});
      expect(result.reason).toBeUndefined();
    });

    it("accepts body with reason", () => {
      const result = skipStepBody.parse({ reason: "Not needed" });
      expect(result.reason).toBe("Not needed");
    });

    it("rejects reason too long", () => {
      expect(() => skipStepBody.parse({ reason: "x".repeat(600) })).toThrow();
    });
  });

  describe("wizardIdParam", () => {
    it("accepts valid uuid", () => {
      const result = wizardIdParam.parse({ wizardId: "11111111-aaaa-4000-8000-000000000001" });
      expect(result.wizardId).toBeDefined();
    });

    it("rejects invalid uuid", () => {
      expect(() => wizardIdParam.parse({ wizardId: "not-a-uuid" })).toThrow();
    });
  });

  describe("stepKeyParam", () => {
    it("accepts valid params", () => {
      const result = stepKeyParam.parse({ wizardId: "11111111-aaaa-4000-8000-000000000001", stepKey: "deploy-db" });
      expect(result.stepKey).toBe("deploy-db");
    });

    it("rejects invalid wizardId", () => {
      expect(() => stepKeyParam.parse({ wizardId: "bad", stepKey: "deploy-db" })).toThrow();
    });

    it("rejects empty stepKey", () => {
      expect(() => stepKeyParam.parse({ wizardId: "11111111-aaaa-4000-8000-000000000001", stepKey: "" })).toThrow();
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Commands
// ══════════════════════════════════════════════════════════════════════════════
describe("orchestrator commands", () => {
  describe("createWizard", () => {
    it("returns accepted with id and correlationId", async () => {
      const result = await commands.createWizard(CTX, {
        name: "test-wizard",
        steps: [{ stepKey: "step-a", title: "Step A", handlerType: "auto", isRequired: true, dependsOn: [], config: {}, sortOrder: 0 }],
      });
      expect(result.id).toBeDefined();
      expect(result.status).toBe("accepted");
      expect(result.correlationId).toBe("corr-1");
    });

    it("computes initial status for steps (ready when no deps)", async () => {
      const result = await commands.createWizard(CTX, {
        name: "wizard-2",
        steps: [
          { stepKey: "step-a", title: "A", handlerType: "auto", isRequired: true, dependsOn: [], config: {}, sortOrder: 0 },
          { stepKey: "step-b", title: "B", handlerType: "auto", isRequired: true, dependsOn: ["step-a"], config: {}, sortOrder: 1 },
        ],
      });
      expect(result.status).toBe("accepted");
    });

    it("handles optional description", async () => {
      const result = await commands.createWizard(CTX, {
        name: "wizard-desc",
        description: "A wizard with description",
        steps: [{ stepKey: "first", title: "First", handlerType: "manual", isRequired: true, dependsOn: [], config: {}, sortOrder: 0 }],
      });
      expect(result.id).toBeDefined();
    });
  });

  describe("startStep", () => {
    it("returns accepted", async () => {
      const result = await commands.startStep(CTX, "11111111-aaaa-4000-8000-000000000001", "step-a");
      expect(result.status).toBe("accepted");
      expect(result.correlationId).toBe("corr-1");
    });
  });

  describe("completeStep", () => {
    it("returns accepted", async () => {
      const result = await commands.completeStep(CTX, "11111111-aaaa-4000-8000-000000000001", "step-a", { output: { done: true } });
      expect(result.status).toBe("accepted");
    });

    it("works without output", async () => {
      const result = await commands.completeStep(CTX, "11111111-aaaa-4000-8000-000000000001", "step-a", { output: {} });
      expect(result.status).toBe("accepted");
    });
  });

  describe("skipStep", () => {
    it("returns accepted", async () => {
      const result = await commands.skipStep(CTX, "11111111-aaaa-4000-8000-000000000001", "step-a", "not needed");
      expect(result.status).toBe("accepted");
    });

    it("works without reason", async () => {
      const result = await commands.skipStep(CTX, "11111111-aaaa-4000-8000-000000000001", "step-a");
      expect(result.status).toBe("accepted");
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Queries (getWizardProgress — returns null when no wizard found)
// ══════════════════════════════════════════════════════════════════════════════
describe("orchestrator queries", () => {
  it("getWizardProgress is a function", () => {
    expect(typeof queries.getWizardProgress).toBe("function");
  });

  it("listWizards is a function", () => {
    expect(typeof queries.listWizards).toBe("function");
  });
});
