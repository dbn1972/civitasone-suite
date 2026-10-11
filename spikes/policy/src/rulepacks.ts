/**
 * SYNTHETIC rule packs for the ST-M01-14 policy spike.
 *
 * ⚠️  EVERY PACK HERE IS SYNTHETIC. These are NOT real transfer policy.
 *     Real policy, its GO/notification references and legal citations are
 *     D-ST-15 (INFORMATION REQUEST, not supplied). The packId, GO references,
 *     authorities and clauses below are invented placeholders used only to
 *     exercise the engine, the trace and the citation path. `synthetic: true`
 *     on every pack and `SYN-` prefixes on every id make this explicit.
 *
 * Three packs, matching the row's required rule families:
 *   1. min-tenure              — minimum tenure before a transfer is eligible.
 *   2. sensitive-post-rotation — mandatory rotation out of a sensitive post.
 *   3. spouse-medical-priority — priority banding for spouse/medical grounds.
 */

import type {
  PolicyCitation,
  RulePackDefinition,
} from "./PolicyEvaluatorPort.js";

const SYNTHETIC = true;

/** Helper to build a SYNTHETIC citation with the §6 traceability fields. */
function syn(
  ruleId: string,
  goReference: string,
  clause: string,
  effectiveFrom = "2026-01-01",
): PolicyCitation {
  return {
    ruleId,
    policyId: `SYN-POLICY-${ruleId}`,
    goReference,
    issuingAuthority: "SYNTHETIC Department of Personnel (placeholder)",
    clause,
    effectiveFrom,
  };
}

// ── Pack 1: minimum tenure ───────────────────────────────────────────────────
const minTenureGraph = {
  contentType: "application/vnd.gorules.decision",
  nodes: [
    { id: "in", type: "inputNode", name: "request", position: { x: 0, y: 0 } },
    {
      id: "dt",
      type: "decisionTableNode",
      name: "minTenure",
      position: { x: 300, y: 0 },
      content: {
        hitPolicy: "first",
        inputs: [
          { id: "i1", name: "Tenure months", field: "tenureMonths" },
          { id: "i2", name: "Hardship posting", field: "hardshipPosting" },
        ],
        outputs: [
          { id: "o1", name: "Eligible", field: "eligible" },
          { id: "o2", name: "Rule id", field: "ruleId" },
        ],
        rules: [
          // Hardship postings: shorter minimum tenure.
          { _id: "SYN-TEN-HARDSHIP-24", i1: ">= 24", i2: "== true", o1: "true", o2: '"SYN-TEN-HARDSHIP-24"' },
          // Standard minimum tenure of 36 months.
          { _id: "SYN-TEN-STD-36", i1: ">= 36", i2: "", o1: "true", o2: '"SYN-TEN-STD-36"' },
          // Otherwise not eligible on tenure grounds.
          { _id: "SYN-TEN-FAIL", i1: "", i2: "", o1: "false", o2: '"SYN-TEN-FAIL"' },
        ],
      },
    },
    { id: "out", type: "outputNode", name: "result", position: { x: 600, y: 0 } },
  ],
  edges: [
    { id: "e1", sourceId: "in", targetId: "dt", type: "edge" },
    { id: "e2", sourceId: "dt", targetId: "out", type: "edge" },
  ],
};

export const minTenurePack: RulePackDefinition = {
  packId: "syn-min-tenure",
  version: "1.0.0",
  synthetic: SYNTHETIC,
  graph: minTenureGraph,
  citations: {
    "SYN-TEN-HARDSHIP-24": syn("SYN-TEN-HARDSHIP-24", "SYN-GO-TEN-2026/01", "cl.4(b) hardship tenure"),
    "SYN-TEN-STD-36": syn("SYN-TEN-STD-36", "SYN-GO-TEN-2026/01", "cl.4(a) standard tenure"),
    "SYN-TEN-FAIL": syn("SYN-TEN-FAIL", "SYN-GO-TEN-2026/01", "cl.4 default ineligible"),
  },
};

// ── Pack 2: sensitive-post rotation ──────────────────────────────────────────
const sensitiveRotationGraph = {
  contentType: "application/vnd.gorules.decision",
  nodes: [
    { id: "in", type: "inputNode", name: "request", position: { x: 0, y: 0 } },
    {
      id: "dt",
      type: "decisionTableNode",
      name: "sensitiveRotation",
      position: { x: 300, y: 0 },
      content: {
        hitPolicy: "first",
        inputs: [
          { id: "i1", name: "Sensitive post", field: "sensitivePost" },
          { id: "i2", name: "Months in post", field: "monthsInPost" },
        ],
        outputs: [
          { id: "o1", name: "Rotation due", field: "rotationDue" },
          { id: "o2", name: "Priority", field: "rotationPriority" },
          { id: "o3", name: "Rule id", field: "ruleId" },
        ],
        rules: [
          // Overdue: sensitive post held beyond 60 months → mandatory rotation.
          { _id: "SYN-ROT-OVERDUE-60", i1: "== true", i2: "> 60", o1: "true", o2: '"mandatory"', o3: '"SYN-ROT-OVERDUE-60"' },
          // Due: sensitive post held 36–60 months → rotation due.
          { _id: "SYN-ROT-DUE-36", i1: "== true", i2: ">= 36", o1: "true", o2: '"due"', o3: '"SYN-ROT-DUE-36"' },
          // Sensitive but within tenure window.
          { _id: "SYN-ROT-WITHIN", i1: "== true", i2: "", o1: "false", o2: '"none"', o3: '"SYN-ROT-WITHIN"' },
          // Non-sensitive post: rotation rule does not apply.
          { _id: "SYN-ROT-NA", i1: "", i2: "", o1: "false", o2: '"not_applicable"', o3: '"SYN-ROT-NA"' },
        ],
      },
    },
    { id: "out", type: "outputNode", name: "result", position: { x: 600, y: 0 } },
  ],
  edges: [
    { id: "e1", sourceId: "in", targetId: "dt", type: "edge" },
    { id: "e2", sourceId: "dt", targetId: "out", type: "edge" },
  ],
};

export const sensitiveRotationPack: RulePackDefinition = {
  packId: "syn-sensitive-rotation",
  version: "1.0.0",
  synthetic: SYNTHETIC,
  graph: sensitiveRotationGraph,
  citations: {
    "SYN-ROT-OVERDUE-60": syn("SYN-ROT-OVERDUE-60", "SYN-GO-ROT-2026/02", "cl.7(c) overdue rotation"),
    "SYN-ROT-DUE-36": syn("SYN-ROT-DUE-36", "SYN-GO-ROT-2026/02", "cl.7(a) rotation due"),
    "SYN-ROT-WITHIN": syn("SYN-ROT-WITHIN", "SYN-GO-ROT-2026/02", "cl.7(a) within window"),
    "SYN-ROT-NA": syn("SYN-ROT-NA", "SYN-GO-ROT-2026/02", "cl.7 scope"),
  },
};

// ── Pack 3: spouse / medical priority banding ────────────────────────────────
const spouseMedicalGraph = {
  contentType: "application/vnd.gorules.decision",
  nodes: [
    { id: "in", type: "inputNode", name: "request", position: { x: 0, y: 0 } },
    {
      id: "dt",
      type: "decisionTableNode",
      name: "spouseMedicalPriority",
      position: { x: 300, y: 0 },
      content: {
        hitPolicy: "first",
        inputs: [
          { id: "i1", name: "Medical ground", field: "medicalGround" },
          { id: "i2", name: "Spouse ground", field: "spouseGround" },
          { id: "i3", name: "Disability", field: "disability" },
        ],
        outputs: [
          { id: "o1", name: "Priority band", field: "priorityBand" },
          { id: "o2", name: "Weight", field: "weight" },
          { id: "o3", name: "Rule id", field: "ruleId" },
        ],
        rules: [
          // Serious medical or disability → highest band.
          { _id: "SYN-PRI-MED-A", i1: "== true", i2: "", i3: "", o1: '"A"', o2: "100", o3: '"SYN-PRI-MED-A"' },
          { _id: "SYN-PRI-DIS-A", i1: "", i2: "", i3: "== true", o1: '"A"', o2: "100", o3: '"SYN-PRI-DIS-A"' },
          // Spouse posting ground → band B.
          { _id: "SYN-PRI-SPOUSE-B", i1: "", i2: "== true", i3: "", o1: '"B"', o2: "60", o3: '"SYN-PRI-SPOUSE-B"' },
          // No priority ground → band C.
          { _id: "SYN-PRI-NONE-C", i1: "", i2: "", i3: "", o1: '"C"', o2: "0", o3: '"SYN-PRI-NONE-C"' },
        ],
      },
    },
    { id: "out", type: "outputNode", name: "result", position: { x: 600, y: 0 } },
  ],
  edges: [
    { id: "e1", sourceId: "in", targetId: "dt", type: "edge" },
    { id: "e2", sourceId: "dt", targetId: "out", type: "edge" },
  ],
};

export const spouseMedicalPack: RulePackDefinition = {
  packId: "syn-spouse-medical-priority",
  version: "1.0.0",
  synthetic: SYNTHETIC,
  graph: spouseMedicalGraph,
  citations: {
    "SYN-PRI-MED-A": syn("SYN-PRI-MED-A", "SYN-GO-PRI-2026/03", "cl.9(a) medical priority"),
    "SYN-PRI-DIS-A": syn("SYN-PRI-DIS-A", "SYN-GO-PRI-2026/03", "cl.9(b) disability priority"),
    "SYN-PRI-SPOUSE-B": syn("SYN-PRI-SPOUSE-B", "SYN-GO-PRI-2026/03", "cl.9(c) spouse ground"),
    "SYN-PRI-NONE-C": syn("SYN-PRI-NONE-C", "SYN-GO-PRI-2026/03", "cl.9 default band"),
  },
};

/** All synthetic packs, in load order. */
export const syntheticPacks: RulePackDefinition[] = [
  minTenurePack,
  sensitiveRotationPack,
  spouseMedicalPack,
];
