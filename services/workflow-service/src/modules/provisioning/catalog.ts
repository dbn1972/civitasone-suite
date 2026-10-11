/**
 * Standard workflow definitions seeded into every tenant on provisioning.
 *
 * Each is a linear approval chain: an `approve` decision on a node advances
 * along its single outgoing edge; the last node has no outgoing edge, so
 * completing it is terminal and triggers the domain dispatch (e.g. for
 * `file_noting` with refType `estab_file`, workflow emits `estab.file.approve`,
 * which promotes the noting to a green, e-signed note).
 *
 * Migration 0003 seeded these NODES for the demo tenant only and seeded NO
 * edges — so the chains could not advance. This catalog fixes both: it seeds
 * nodes AND edges for every tenant, idempotently.
 */

export interface SeedNode {
  nodeKey: string;
  name: string;
  roleRef: string | null;
}

export interface SeedDefinition {
  code: string;
  name: string;
  /**
   * ST-M01-03: the composition module cluster this definition belongs to.
   * `core` definitions are always seeded (file noting is platform-level and
   * every tenant has workflow). Non-core clusters (`hr`, `finance`, `p2p`,
   * `delivery`) are only seeded when the tenant's profile actually includes
   * that cluster — a `smarttransfer_standalone` tenant must NOT get the leave /
   * finance / procurement / grant chains (standalone report §5 item 8). The
   * gate is applied by the provisioning consumer via WORKFLOW_SEED_CLUSTERS.
   */
  cluster: "core" | "hr" | "finance" | "p2p" | "delivery";
  nodes: SeedNode[]; // ordered; linear edges are derived (n[i] -> n[i+1])
}

export const STANDARD_DEFINITIONS: SeedDefinition[] = [
  {
    code: "file_noting",
    name: "File Noting & Approval Workflow",
    cluster: "core",
    nodes: [
      { nodeKey: "draft", name: "Draft Note", roleRef: "estab_user" },
      { nodeKey: "section_review", name: "Section Officer Review", roleRef: "estab_section_officer" },
      { nodeKey: "us_approve", name: "Under Secretary Approval", roleRef: "estab_under_secretary" },
      { nodeKey: "ds_approve", name: "Deputy Secretary Approval", roleRef: "estab_deputy_secretary" },
    ],
  },
  {
    code: "leave_approval",
    name: "Leave Approval Workflow",
    cluster: "hr",
    nodes: [
      { nodeKey: "apply", name: "Employee Application", roleRef: "hrms_employee" },
      { nodeKey: "manager_approve", name: "Manager Approval", roleRef: "hrms_manager" },
      { nodeKey: "hr_approve", name: "HR Approval", roleRef: "hrms_hr" },
    ],
  },
  {
    code: "finance_approval",
    name: "Finance Approval Workflow",
    cluster: "finance",
    nodes: [
      { nodeKey: "submit", name: "Submission", roleRef: "finance_user" },
      { nodeKey: "accounts_check", name: "Accounts Check", roleRef: "finance_accountant" },
      { nodeKey: "budget_officer", name: "Budget Officer Review", roleRef: "finance_budget_officer" },
      { nodeKey: "approve", name: "Final Approval", roleRef: "finance_approver" },
    ],
  },
  {
    code: "procurement_approval",
    name: "Procurement Approval Workflow",
    cluster: "p2p",
    nodes: [
      { nodeKey: "indent", name: "Indent Creation", roleRef: "procurement_user" },
      { nodeKey: "dept_approve", name: "Department Approval", roleRef: "procurement_manager" },
      { nodeKey: "finance_clear", name: "Finance Clearance", roleRef: "finance_approver" },
      { nodeKey: "po_issue", name: "PO Issuance", roleRef: "procurement_manager" },
    ],
  },
  {
    code: "grant_disbursement",
    name: "Grant Disbursement Workflow",
    cluster: "delivery",
    nodes: [
      { nodeKey: "application", name: "Grantee Application", roleRef: "grant_user" },
      { nodeKey: "scrutiny", name: "Application Scrutiny", roleRef: "grant_officer" },
      { nodeKey: "sanction", name: "Sanction Order", roleRef: "grant_approver" },
      { nodeKey: "disbursed", name: "Disbursement", roleRef: "finance_approver" },
    ],
  },
];

/**
 * ST-M01-03: the module clusters whose standard workflow definitions should be
 * seeded on tenant provisioning. `core` is ALWAYS included (file noting is
 * platform-level). The default includes every non-core cluster, so existing
 * tenants are seeded exactly as before. A SmartTransfer-standalone deployment
 * sets WORKFLOW_SEED_CLUSTERS to a narrower list (e.g. just the core set) so
 * the leave / finance / procurement / grant chains are not seeded for a tenant
 * that has none of those modules. Per-tenant (profile-driven) gating is a
 * later step once the created-event carries the composition; this env
 * allow-list is the in-service equivalent of hrms-service's HRMS_MODULES
 * allow-list (ST-M01-04) and is NOT a security guard baseline (no D-101 entry
 * needed — it narrows seeded data, it does not suppress a test or a check).
 */
export function seedClustersFromEnv(raw: string | undefined = process.env.WORKFLOW_SEED_CLUSTERS): Set<string> {
  if (raw === undefined || raw.trim() === "") {
    return new Set(["core", "hr", "finance", "p2p", "delivery"]);
  }
  const set = new Set(
    raw.split(",").map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0),
  );
  set.add("core"); // core is non-negotiable: every tenant gets file noting
  return set;
}

/** The standard definitions to seed given a set of enabled clusters. */
export function definitionsForClusters(clusters: Set<string>): SeedDefinition[] {
  return STANDARD_DEFINITIONS.filter((d) => clusters.has(d.cluster));
}

/** Derive linear edges (node[i] -> node[i+1]) for a seed definition. */
export function linearEdges(def: SeedDefinition): Array<{ fromNode: string; toNode: string }> {
  const edges: Array<{ fromNode: string; toNode: string }> = [];
  for (let i = 0; i < def.nodes.length - 1; i++) {
    edges.push({ fromNode: def.nodes[i]!.nodeKey, toNode: def.nodes[i + 1]!.nodeKey });
  }
  return edges;
}
