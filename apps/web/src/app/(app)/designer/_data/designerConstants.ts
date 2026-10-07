export const SERVICE_PATTERN_OPTIONS = [
  {
    id: "certificate",
    title: "Certificate / Permission",
    description: "Licences, NOCs, registrations, and character certificates.",
    examples: ["Trade License", "Fire NOC", "Birth Certificate"],
    activeBlocks: ["Catalogue", "Form", "Eligibility", "Approval chain", "Fee", "Documents", "Output", "Notifications"],
  },
  {
    id: "booking",
    title: "Booking / Reservation",
    description: "Hall booking, slot allocation, and appointments.",
    examples: ["Community hall", "Vehicle fitness slot", "Registrar appointment"],
    activeBlocks: ["Catalogue", "Form", "Fee", "Documents", "Output", "Notifications"],
  },
  {
    id: "collection",
    title: "Collection (fee-only)",
    description: "Self-assessment and fee payment without an approval gate.",
    examples: ["Property tax", "Amnesty scheme fee", "Professional tax"],
    activeBlocks: ["Catalogue", "Form", "Fee", "Output", "Notifications"],
  },
  {
    id: "grievance",
    title: "Grievance / Case",
    description: "Complaints, service requests, and case tracking.",
    examples: ["PGR complaint", "RTI-adjacent case", "Demand objection"],
    activeBlocks: ["Catalogue", "Form", "Eligibility", "Approval chain", "Documents", "Output", "Notifications"],
  },
] as const;

export const DEFAULT_BLOCKS = [
  { id: "b1", shortLabel: "B1", label: "Catalogue & Identity" },
  { id: "b2", shortLabel: "B2", label: "Intake Form" },
  { id: "b3", shortLabel: "B3", label: "Eligibility" },
  { id: "b4", shortLabel: "B4", label: "Approval Chain" },
  { id: "b5", shortLabel: "B5", label: "Fee & Revenue" },
  { id: "b6", shortLabel: "B6", label: "Documents" },
  { id: "b7", shortLabel: "B7", label: "Output & Issuance" },
  { id: "b8", shortLabel: "B8", label: "Notifications" },
] as const;

/** Blocks hidden per Service Pattern (FN-33 / UX §5.2). */
export function hiddenBlocksForPattern(pattern: string): Set<string> {
  switch (pattern) {
    case "booking":
      return new Set(["b3"]);
    case "collection":
      return new Set(["b3", "b4", "b6"]);
    case "grievance":
      return new Set(["b5"]);
    default:
      return new Set();
  }
}

/** Human-readable block labels affected when switching Service Pattern (FN-19). */
export function patternChangeImpact(from: string, to: string): { hidden: string[]; shown: string[] } {
  const fromHidden = hiddenBlocksForPattern(from);
  const toHidden = hiddenBlocksForPattern(to);
  const hidden: string[] = [];
  const shown: string[] = [];
  for (const block of DEFAULT_BLOCKS) {
    const wasHidden = fromHidden.has(block.id);
    const nowHidden = toHidden.has(block.id);
    if (!wasHidden && nowHidden) hidden.push(block.label);
    if (wasHidden && !nowHidden) shown.push(block.label);
  }
  return { hidden, shown };
}

/**
 * GAP-DESIGNER-DETAIL-B1-01: derive a consistent block-rail status for every
 * block from the ServiceDefinition fields, so b1..b8 all show the same rail for
 * the same definition instead of each page's inline, inconsistent ternaries.
 *
 * NOTE (per item risk): this is a *progress hint* for the maker, NOT a publish
 * gate. 'complete' here means "has the data this block needs to look done", not
 * "validated for publish" — backend validation remains the publish authority.
 *
 * `def` is intentionally a loose shape so this can be called from any wizard
 * page with whatever subset of the definition it holds.
 */
export type DesignerBlockStatus = "empty" | "in-progress" | "complete";

interface BlockStatusInput {
  name?: string | null;
  serviceKey?: string | null;
  ownerDepartment?: string | null;
  slaDays?: number | null;
  channels?: string[] | null;
  formId?: string | null;
  forms?: unknown[] | null;
  eligibilityRuleSetId?: string | null;
  workflowDefinitionId?: string | null;
  feeModel?: string | null;
  hoaCode?: string | null;
  requiredDocuments?: unknown[] | null;
  issuanceType?: string | null;
  outputs?: unknown[] | null;
}

export function blockStatuses(def: BlockStatusInput): Record<string, DesignerBlockStatus> {
  const has = (v: unknown): boolean => {
    if (v == null) return false;
    if (typeof v === "string") return v.trim().length > 0;
    if (Array.isArray(v)) return v.length > 0;
    return true;
  };

  // B1 identity: name, serviceKey, ownerDepartment, slaDays, channels
  const b1Fields = [def.name, def.serviceKey, def.ownerDepartment, def.slaDays, def.channels];
  const b1Present = b1Fields.filter(has).length;
  const b1: DesignerBlockStatus =
    b1Present === 0 ? "empty" : b1Present === b1Fields.length ? "complete" : "in-progress";

  const simple = (ok: boolean): DesignerBlockStatus => (ok ? "complete" : "empty");

  return {
    b1,
    b2: simple(has(def.formId) || has(def.forms)),
    b3: simple(has(def.eligibilityRuleSetId)),
    b4: simple(has(def.workflowDefinitionId)),
    b5: has(def.feeModel) && has(def.hoaCode)
      ? "complete"
      : has(def.feeModel) ? "in-progress" : "empty",
    b6: simple(has(def.requiredDocuments)),
    b7: simple(has(def.issuanceType) || has(def.outputs)),
    b8: simple(has(def.outputs)),
  };
}
