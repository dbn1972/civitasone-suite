import type { DesignerBlock } from "@/app/_components/ds/designer";
import type { ServiceDefinitionDto } from "./designerApi";
import { DEFAULT_BLOCKS } from "./designerConstants";
import { collectDesignIssues, countIssuesByBlock } from "./designerGating";

/** Single source of truth for block-rail progress (used by every designer page). */
export function blockStatusForDef(def: ServiceDefinitionDto, blockId: string, hidden: Set<string>): DesignerBlock["status"] {
  if (hidden.has(blockId)) return "empty";
  switch (blockId) {
    case "b1":
      return def.name && def.channels?.length ? "complete" : "in-progress";
    case "b2":
      return def.formId || (Array.isArray(def.forms) && def.forms.length > 0) ? "complete" : "empty";
    case "b3":
      return def.eligibilityRuleSetId ? "complete" : "empty";
    case "b4":
      return def.workflowDefinitionId ? "complete" : "empty";
    case "b5":
      return def.feeScheduleId && def.hoaCode ? "complete" : def.feeScheduleId || def.feeModel ? "in-progress" : "empty";
    case "b6":
      return Array.isArray(def.requiredDocuments) && def.requiredDocuments.length > 0 ? "complete" : "empty";
    case "b7":
      return def.issuanceType || (Array.isArray(def.outputs) && def.outputs.length > 0) ? "complete" : "empty";
    case "b8":
      return "in-progress";
    default:
      return "empty";
  }
}

/** Rail blocks for a saved definition; all "empty" while it is still loading (def null). */
export function computeWizardBlocks(def: ServiceDefinitionDto | null, hidden: Set<string>): DesignerBlock[] {
  if (!def) {
    return DEFAULT_BLOCKS.map((b) => ({
      id: b.id,
      shortLabel: b.shortLabel,
      label: b.label,
      hidden: hidden.has(b.id),
      status: "empty" as const,
    }));
  }
  const counts = countIssuesByBlock(collectDesignIssues(def, hidden));
  return DEFAULT_BLOCKS.map((b) => ({
    id: b.id,
    shortLabel: b.shortLabel,
    label: b.label,
    hidden: hidden.has(b.id),
    status: blockStatusForDef(def, b.id, hidden),
    blockingCount: counts[b.id]?.blocking ?? 0,
    warningCount: counts[b.id]?.warning ?? 0,
  }));
}
