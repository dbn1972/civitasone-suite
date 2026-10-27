/**
 * Owner decision D4c #7 (GAP-DESIGNER-DETAIL-B5-05): the wizard blocks Next on
 * anything money- or statute-related (head of account, fee, signatory) and only
 * warns about the rest. This is the one place that rule lives; the block rail,
 * the page help texts and the review page all read it, with the same wording
 * ("Blocks Next" / "Warning").
 */
export type GateSeverity = "blocks_next" | "warning";

export type DesignIssueCode = "hoa_missing" | "fee_missing" | "signatory_missing" | "doc_no_lane";

export interface DesignIssue {
  blockId: string;
  severity: GateSeverity;
  code: DesignIssueCode;
  /** How many items the issue covers (documents), when more than one can apply. */
  count?: number;
}

export interface GateInput {
  feeModel?: string | null;
  feeScheduleId?: string | null;
  hoaCode?: string | null;
  requiredDocuments?: unknown[] | null;
  issuanceType?: string | null;
  outputs?: unknown[] | null;
}

const filled = (v: unknown): boolean => typeof v === "string" && v.trim().length > 0;

function issuanceConfig(outputs: unknown[] | null | undefined): Record<string, unknown> | null {
  const cfg = (outputs ?? []).find(
    (o): o is Record<string, unknown> => typeof o === "object" && o !== null && (o as { kind?: unknown }).kind === "issuance",
  );
  return cfg ?? null;
}

export function collectDesignIssues(def: GateInput, hidden: ReadonlySet<string>): DesignIssue[] {
  const out: DesignIssue[] = [];

  // Money: a fee model needs a Head of Account and a saved fee schedule.
  if (!hidden.has("b5") && filled(def.feeModel)) {
    if (!filled(def.hoaCode)) out.push({ blockId: "b5", severity: "blocks_next", code: "hoa_missing" });
    else if (!filled(def.feeScheduleId)) out.push({ blockId: "b5", severity: "blocks_next", code: "fee_missing" });
  }

  // Statute: an issued document needs a named signatory (a receipt does not).
  if (!hidden.has("b7")) {
    const cfg = issuanceConfig(def.outputs);
    const outputType = (cfg?.outputType as string | undefined) ?? def.issuanceType ?? null;
    if ((cfg || outputType) && outputType !== "receipt") {
      if (!filled(cfg?.signatoryDesignationId) && !filled(cfg?.signatoryLabel)) {
        out.push({ blockId: "b7", severity: "blocks_next", code: "signatory_missing" });
      }
    }
  }

  // Advisory: a mandatory document may be verified outside the workflow.
  if (!hidden.has("b6")) {
    const docs = (def.requiredDocuments ?? []) as Array<{ mandatory?: unknown; verifiedAtLane?: unknown }>;
    const count = docs.filter((d) => d && d.mandatory === true && !filled(d.verifiedAtLane)).length;
    if (count > 0) out.push({ blockId: "b6", severity: "warning", code: "doc_no_lane", count });
  }

  return out;
}

export function countIssuesByBlock(issues: DesignIssue[]): Record<string, { blocking: number; warning: number }> {
  const out: Record<string, { blocking: number; warning: number }> = {};
  for (const i of issues) {
    const slot = (out[i.blockId] ??= { blocking: 0, warning: 0 });
    if (i.severity === "blocks_next") slot.blocking += 1;
    else slot.warning += 1;
  }
  return out;
}
