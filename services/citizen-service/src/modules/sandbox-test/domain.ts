/**
 * FN-10 — synthetic sandbox pipeline validation (pure, no I/O).
 * Steps: form → eligibility → workflow → sla_escalation → doc_verification
 *        → demand → payment → GL → certificate.
 *
 * FN-25/26 additions: simulate per-lane SLA breach → escalation notification,
 * and assert document verification lanes are bound for mandatory docs.
 */
import { hiddenBlocksForPattern } from "./pattern.js";
import type { ServiceDefinitionRow } from "../catalogue/schema.js";
import {
  isSlaTrackedLane,
  simulateLaneSlaBreach,
  unboundMandatoryDocs,
  type LaneBinding,
} from "../catalogue/lane-bindings.js";

export type StepStatus = "pass" | "fail" | "skip";

export interface SandboxStep {
  id: string;
  label: string;
  status: StepStatus;
  error?: string;
  why?: string;
  next?: string;
  blockId?: string;
  blockLink?: string;
  artifacts?: Record<string, unknown>;
}

export interface SandboxRunResult {
  passed: boolean;
  steps: SandboxStep[];
}

function fail(
  id: string,
  label: string,
  blockId: string,
  what: string,
  why: string,
  next: string,
  field?: string,
): SandboxStep {
  return {
    id,
    label,
    status: "fail",
    error: `${what} ${why} ${next}`,
    why,
    next,
    blockId,
    blockLink: `/designer/__ID__/${blockId}${field ? `#${field}` : ""}`,
  };
}

function pass(id: string, label: string, artifacts?: Record<string, unknown>): SandboxStep {
  return { id, label, status: "pass", ...(artifacts ? { artifacts } : {}) };
}

function skip(id: string, label: string): SandboxStep {
  return { id, label, status: "skip" };
}

/** Run the full synthetic pipeline against a draft definition. */
export function runSandboxPipeline(def: ServiceDefinitionRow): SandboxRunResult {
  const pattern = def.servicePattern ?? "certificate";
  const hidden = hiddenBlocksForPattern(pattern);
  const steps: SandboxStep[] = [];

  // 1 — Intake form
  if (hidden.has("b2")) {
    steps.push(skip("form", "Intake form validates"));
  } else if (!def.formId && (!Array.isArray(def.forms) || def.forms.length === 0)) {
    steps.push(fail(
      "form", "Intake form validates", "b2",
      "The intake form is not configured.",
      "Citizens cannot apply without at least one form section.",
      "Open the Form block and add fields.",
      "form",
    ));
  } else {
    steps.push(pass("form", "Intake form validates", {
      formId: def.formId,
      sectionCount: Array.isArray(def.forms) ? def.forms.length : 0,
    }));
  }

  // 2 — Eligibility
  if (hidden.has("b3")) {
    steps.push(skip("eligibility", "Eligibility rules"));
  } else if (!def.eligibilityRuleSetId) {
    steps.push(fail(
      "eligibility", "Eligibility rules", "b3",
      "No eligibility rule-set is linked.",
      "Pre-workflow gates cannot run without rules.",
      "Configure eligibility rules or link an existing rule-set.",
    ));
  } else {
    steps.push(pass("eligibility", "Eligibility rules", { ruleSetId: def.eligibilityRuleSetId }));
  }

  // 3 — Workflow lanes
  if (hidden.has("b4")) {
    steps.push(skip("workflow", "Approval chain lanes"));
  } else if (!def.workflowDefinitionId) {
    steps.push(fail(
      "workflow", "Approval chain lanes", "b4",
      "No approval chain is linked.",
      "Applications cannot be routed without a workflow.",
      "Configure the approval chain in the Workflow block.",
    ));
  } else {
    steps.push(pass("workflow", "Approval chain lanes", { workflowDefinitionId: def.workflowDefinitionId }));
  }

  // 3b — FN-25 SLA / escalation (sandbox breach → notification)
  const laneBindings = (Array.isArray(def.laneBindings) ? def.laneBindings : []) as LaneBinding[];
  const tracked = laneBindings.filter(isSlaTrackedLane);
  if (hidden.has("b4")) {
    steps.push(skip("sla_escalation", "SLA breach escalates"));
  } else if (tracked.length === 0) {
    steps.push(fail(
      "sla_escalation", "SLA breach escalates", "b4",
      "No lane SLA clocks are configured.",
      "Per-lane SLA days drive due timers and escalation on breach.",
      "Set SLA days (and optionally an escalation designation) on each approval lane.",
    ));
  } else {
    const missingEscalation = tracked.filter((l) => !l.escalationDesignationId?.trim());
    if (missingEscalation.length > 0) {
      steps.push(fail(
        "sla_escalation", "SLA breach escalates", "b4",
        `Lane "${missingEscalation[0]!.name}" has no escalation designation.`,
        "On breach the sweeper must notify a superior designation.",
        "Pick an escalation designation on each SLA-tracked lane.",
      ));
    } else {
      const simulations = tracked.map((l) => simulateLaneSlaBreach(l));
      const breached = simulations.filter((s) => s.breached && s.notification);
      steps.push(pass("sla_escalation", "SLA breach escalates", {
        lanesChecked: tracked.length,
        breachedNotifications: breached.map((s) => s.notification),
      }));
    }
  }

  // 3c — FN-26 document verification lane binding
  const docs = Array.isArray(def.requiredDocuments) ? def.requiredDocuments : [];
  if (hidden.has("b6") || docs.length === 0) {
    steps.push(skip("doc_verification", "Document verification lanes"));
  } else {
    const unbound = unboundMandatoryDocs(docs);
    if (unbound.length > 0) {
      steps.push(fail(
        "doc_verification", "Document verification lanes", "b6",
        `Mandatory document "${unbound[0]!.docType}" has no verifying lane.`,
        "Officers will not see a checklist for unbound documents.",
        "Map each mandatory document to a verification lane in the Documents block.",
      ));
    } else {
      steps.push(pass("doc_verification", "Document verification lanes", {
        boundCount: docs.filter((d) => d.verifiedAtLane).length,
        lanes: [...new Set(docs.map((d) => d.verifiedAtLane).filter(Boolean))],
      }));
    }
  }

  // 4 — Fee demand lines
  if (hidden.has("b5")) {
    steps.push(skip("demand", "Fee demand lines"));
  } else if (!def.feeScheduleId) {
    steps.push(fail(
      "demand", "Fee demand lines", "b5",
      "No fee schedule is linked.",
      "Demand lines cannot be generated without a fee model.",
      "Configure the fee schedule in the Fee block.",
    ));
  } else if (!def.feeModel) {
    steps.push(fail(
      "demand", "Fee demand lines", "b5",
      "Fee model is not set.",
      "The billing service needs a fee model (fixed, slab, or engine).",
      "Choose a fee model in the Fee block.",
      "feeModel",
    ));
  } else if (def.feeModel === "engine") {
    const manifestEngine = (def.outputs as unknown[] | undefined)?.length;
    const bindings = (def as { engineBindings?: unknown[] }).engineBindings;
    const hasEngine = Array.isArray(bindings) && bindings.length > 0;
    if (!hasEngine && !manifestEngine) {
      steps.push(fail(
        "demand", "Fee demand lines", "b5",
        "Engine binding is missing or stubbed.",
        "Fee engine services are not wired for this pack.",
        "Bind a live rate engine or switch to a fixed/slab fee model.",
        "engineBinding",
      ));
    } else {
      steps.push(pass("demand", "Fee demand lines", {
        feeModel: def.feeModel,
        feeScheduleId: def.feeScheduleId,
        sampleLines: [{ taxHeadCode: "BASE", amountMinor: 50000, label: "Base fee" }],
      }));
    }
  } else if (!def.hoaCode) {
    steps.push(fail(
      "demand", "Fee demand lines", "b5",
      "Head of Account (HOA) is not set.",
      "Demand lines require an HOA for GL posting.",
      "Select an HOA in the Fee block before submitting.",
      "hoaCode",
    ));
  } else {
    steps.push(pass("demand", "Fee demand lines", {
      feeModel: def.feeModel,
      hoaCode: def.hoaCode,
      sampleLines: [{ taxHeadCode: "BASE", amountMinor: 50000, label: "Base fee" }],
    }));
  }

  // 5 — Sandbox payment (mock)
  const demandFailed = steps.some((s) => s.id === "demand" && s.status === "fail");
  const demandSkipped = steps.some((s) => s.id === "demand" && s.status === "skip");
  if (demandFailed) {
    steps.push(skip("payment", "Sandbox payment"));
  } else if (demandSkipped) {
    steps.push(skip("payment", "Sandbox payment"));
  } else {
    steps.push(pass("payment", "Sandbox payment", { consumerCode: "SANDBOX-MOCK", status: "captured" }));
  }

  // 6 — GL journal entry
  if (hidden.has("b5") || demandSkipped) {
    steps.push(skip("gl", "GL journal entry"));
  } else if (demandFailed) {
    steps.push(skip("gl", "GL journal entry"));
  } else if (!def.hoaCode) {
    steps.push(fail(
      "gl", "GL journal entry", "b5",
      "GL posting cannot proceed without an HOA.",
      "Finance requires a Head of Account for every fee-bearing service.",
      "Set the HOA in the Fee block.",
      "hoaCode",
    ));
  } else {
    steps.push(pass("gl", "GL journal entry", {
      hoaCode: def.hoaCode,
      journalPreview: { debit: def.hoaCode, credit: "CASH", amountMinor: 50000 },
    }));
  }

  // 7 — Certificate issuance
  if (hidden.has("b7")) {
    steps.push(skip("certificate", "Certificate issuance"));
  } else if (!def.issuanceType && (!Array.isArray(def.outputs) || def.outputs.length === 0)) {
    steps.push(fail(
      "certificate", "Certificate issuance", "b7",
      "No output template is configured.",
      "Applicants will not receive a certificate or closure note.",
      "Configure output and issuance in the Output block.",
    ));
  } else {
    steps.push(pass("certificate", "Certificate issuance", {
      issuanceType: def.issuanceType ?? "certificate",
      previewUrl: "/sandbox/certificate-preview.pdf",
    }));
  }

  const passed = steps.every((s) => s.status === "pass" || s.status === "skip");
  return { passed, steps };
}
