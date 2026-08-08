/**
 * FN-09 — build a versioned pack manifest from a published catalogue definition.
 * Pure helpers (no I/O) so export round-trips through import's applyManifestToDefinition.
 */
import type { ServiceDefinitionRow } from "../catalogue/schema.js";
import type { PackManifestBlocks } from "./manifest-apply.js";

export interface ExportedPackManifest {
  schemaVersion: "1.0";
  exportedFrom: {
    serviceDefinitionId: string;
    serviceKey: string;
    definitionVersion: number;
    publishedAt: string | null;
  };
  authorityScope?: string;
  blocks: PackManifestBlocks;
  [key: string]: unknown;
}

/** Derive a stable pack key from a catalogue service_key (e.g. trade-license → pack:trade-license). */
export function packKeyFromServiceKey(serviceKey: string): string {
  const trimmed = serviceKey.trim().toLowerCase();
  const raw = trimmed.startsWith("pack:") ? trimmed.slice("pack:".length) : trimmed;
  const key = raw.replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return key ? `pack:${key}` : "pack:service";
}

function feeMetaFromForms(forms: unknown[]): { feeFromMinor?: number; feeCurrency?: string; description?: string } {
  const first = forms[0];
  if (!first || typeof first !== "object") return {};
  const meta = (first as { runtimeMeta?: Record<string, unknown> }).runtimeMeta;
  if (!meta || typeof meta !== "object") return {};
  const out: { feeFromMinor?: number; feeCurrency?: string; description?: string } = {};
  if (typeof meta.feeFromMinor === "number") out.feeFromMinor = meta.feeFromMinor;
  if (typeof meta.feeCurrency === "string") out.feeCurrency = meta.feeCurrency;
  if (typeof meta.description === "string") out.description = meta.description;
  return out;
}

/** Snapshot B1–B8 wiring from a published definition into importable manifest.blocks. */
export function buildBlocksFromDefinition(def: ServiceDefinitionRow): PackManifestBlocks {
  const feeMeta = feeMetaFromForms(Array.isArray(def.forms) ? def.forms : []);
  const blocks: PackManifestBlocks = {
    slaDays: def.slaDays ?? undefined,
    formId: def.formId ?? undefined,
    forms: Array.isArray(def.forms) ? def.forms : [],
    eligibilityRuleSetId: def.eligibilityRuleSetId ?? undefined,
    workflowDefinitionId: def.workflowDefinitionId ?? undefined,
    feeScheduleId: def.feeScheduleId ?? undefined,
    feeModel: def.feeModel ?? undefined,
    hoaCode: def.hoaCode ?? undefined,
    issuanceType: def.issuanceType ?? undefined,
    outputs: Array.isArray(def.outputs) ? def.outputs : [],
    requiredDocuments: Array.isArray(def.requiredDocuments) ? def.requiredDocuments : [],
    channels: Array.isArray(def.channels) ? def.channels : [],
  };
  if (feeMeta.description) blocks.description = feeMeta.description;
  if (feeMeta.feeFromMinor != null) blocks.feeFromMinor = feeMeta.feeFromMinor;
  if (feeMeta.feeCurrency) blocks.feeCurrency = feeMeta.feeCurrency;
  return blocks;
}

export function buildExportedPackManifest(def: ServiceDefinitionRow): ExportedPackManifest {
  const refs = Array.isArray(def.statutoryReferences) ? def.statutoryReferences : [];
  const authorityScope = refs.length > 0
    ? refs.map((r) => (r.section ? `${r.act} §${r.section}` : r.act)).join("; ")
    : undefined;

  const manifest: ExportedPackManifest = {
    schemaVersion: "1.0",
    exportedFrom: {
      serviceDefinitionId: def.id,
      serviceKey: def.serviceKey,
      definitionVersion: def.version,
      publishedAt: def.publishedAt ? def.publishedAt.toISOString() : null,
    },
    blocks: buildBlocksFromDefinition(def),
  };
  if (authorityScope) manifest.authorityScope = authorityScope;
  if (def.servicePattern) manifest.servicePattern = def.servicePattern;
  return manifest;
}

/** FN-29 — import requires explicit ack when statutory refs or authority scope are present. */
export function requiresStatutoryAcknowledgement(pack: {
  statutoryReferences?: unknown[] | null;
  // The DB column is a jsonb typed as `unknown` on the row; accept that and
  // narrow here rather than forcing every caller to cast.
  manifest?: unknown;
}): boolean {
  const refs = Array.isArray(pack.statutoryReferences) ? pack.statutoryReferences : [];
  if (refs.some((r) => r && typeof r === "object" && typeof (r as { act?: unknown }).act === "string"
    && String((r as { act: string }).act).trim().length > 0)) {
    return true;
  }
  const manifest = pack.manifest;
  const scope =
    manifest && typeof manifest === "object"
      ? (manifest as Record<string, unknown>).authorityScope
      : undefined;
  return typeof scope === "string" && scope.trim().length > 0;
}
