import type { ServiceDefinitionInsert } from "../catalogue/schema.js";
import { tradeLicenseManifestBlocks } from "./manifests/trade-license.js";

export interface PackManifestBlocks {
  description?: string;
  slaDays?: number;
  formId?: string;
  forms?: unknown[];
  eligibilityRuleSetId?: string;
  workflowDefinitionId?: string;
  feeScheduleId?: string;
  feeModel?: "flat" | "slab" | "engine";
  hoaCode?: string;
  issuanceType?: string;
  outputs?: unknown[];
  requiredDocuments?: { docType: string; label: string; mandatory: boolean }[];
  channels?: string[];
  feeFromMinor?: number;
  feeCurrency?: string;
}

export function blocksFromManifest(
  packKey: string,
  manifest: Record<string, unknown> | null | undefined,
): PackManifestBlocks | null {
  const raw = manifest?.blocks;
  if (raw && typeof raw === "object") return raw as PackManifestBlocks;
  if (packKey === "pack:trade-license") return tradeLicenseManifestBlocks();
  return null;
}

/** Merge manifest block wiring into a new catalogue draft row. */
export function applyManifestToDefinition(
  base: ServiceDefinitionInsert,
  packKey: string,
  manifest: Record<string, unknown> | null | undefined,
): ServiceDefinitionInsert {
  const blocks = blocksFromManifest(packKey, manifest);
  if (!blocks) return base;

  const formsWithMeta = (blocks.forms ?? base.forms)?.map((f, i) =>
    i === 0 && typeof f === "object" && f !== null
      ? {
          ...f,
          runtimeMeta: {
            description: blocks.description,
            feeFromMinor: blocks.feeFromMinor,
            feeCurrency: blocks.feeCurrency,
          },
        }
      : f,
  );

  const merged: ServiceDefinitionInsert = {
    ...base,
    forms: (formsWithMeta ?? base.forms) as never,
    outputs: (blocks.outputs ?? base.outputs) as never,
    requiredDocuments: blocks.requiredDocuments ?? base.requiredDocuments ?? [],
    channels: (blocks.channels ?? base.channels) as never,
  };

  if (blocks.slaDays != null) merged.slaDays = blocks.slaDays;
  if (blocks.formId != null) merged.formId = blocks.formId;
  if (blocks.eligibilityRuleSetId != null) merged.eligibilityRuleSetId = blocks.eligibilityRuleSetId;
  if (blocks.workflowDefinitionId != null) merged.workflowDefinitionId = blocks.workflowDefinitionId;
  if (blocks.feeScheduleId != null) merged.feeScheduleId = blocks.feeScheduleId;
  if (blocks.feeModel != null) merged.feeModel = blocks.feeModel;
  if (blocks.hoaCode != null) merged.hoaCode = blocks.hoaCode;
  if (blocks.issuanceType != null) merged.issuanceType = blocks.issuanceType;

  return merged;
}
