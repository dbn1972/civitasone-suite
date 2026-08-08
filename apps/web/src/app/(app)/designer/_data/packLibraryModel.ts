/**
 * FN-09 pack library helpers — filters, preview walkthrough, source labels.
 */

import type { DomainPackRow } from "./designerLoader";
import type { ServicePackDto } from "./packLibraryApi";

export interface PackPreviewBlock {
  id: string;
  label: string;
  summary: string;
}

export interface PackLibraryFilters {
  sector: string;
  pattern: string;
  domainFilter: string;
  jurisdiction: string;
  source: string;
}

export function packSourceLabel(pack: ServicePackDto, domain?: DomainPackRow | null): string {
  if (pack.domainPackKey) {
    return domain?.name ? `Domain · ${domain.name}` : `Domain · ${pack.domainPackKey}`;
  }
  return "Tenant library";
}

export function packSector(pack: ServicePackDto, domain?: DomainPackRow | null): string {
  return domain?.sector?.trim() || "—";
}

export function packJurisdiction(pack: ServicePackDto, domain?: DomainPackRow | null): string {
  return domain?.jurisdiction?.trim() || "—";
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function blocksFromManifest(manifest: Record<string, unknown>): Record<string, unknown> {
  const blocks = manifest.blocks;
  return isRecord(blocks) ? blocks : {};
}

function countManifestFields(blocks: Record<string, unknown>): number {
  if (!Array.isArray(blocks.forms)) return 0;
  let total = 0;
  for (const form of blocks.forms) {
    if (!isRecord(form)) continue;
    const design = form.formDesign;
    if (isRecord(design) && isRecord(design.fields)) {
      total += Object.keys(design.fields).length;
    }
  }
  return total;
}

/** Read-only wizard walkthrough lines for pack preview (FN-09). */
export function buildPackPreviewBlocks(pack: ServicePackDto): PackPreviewBlock[] {
  const blocks = blocksFromManifest(pack.manifest);
  const fieldCount = countManifestFields(blocks);
  const docs = Array.isArray(blocks.requiredDocuments) ? blocks.requiredDocuments.length : 0;
  const feeFrom = typeof blocks.feeFromMinor === "number" ? blocks.feeFromMinor : null;
  const feeLabel = feeFrom != null
    ? `₹${(feeFrom / 100).toLocaleString("en-IN")}`
    : (pack.feeModel ?? "none");

  return [
    {
      id: "b1",
      label: "Catalogue & identity",
      summary: `${pack.name} · ${(blocks.channels as string[] | undefined)?.join(", ") ?? "channels TBD"} · SLA ${blocks.slaDays ?? "—"} days`,
    },
    {
      id: "b2",
      label: "Intake form",
      summary: fieldCount > 0 ? `${fieldCount} field(s) pre-seeded` : "Form wiring included",
    },
    {
      id: "b3",
      label: "Eligibility",
      summary: blocks.eligibilityRuleSetId ? "Rule-set linked" : "Open for all applicants",
    },
    {
      id: "b4",
      label: "Approval chain",
      summary: blocks.workflowDefinitionId ? "Template approval chain" : "Not configured in pack",
    },
    {
      id: "b5",
      label: "Fee & revenue",
      summary: `${pack.feeModel ?? blocks.feeModel ?? "—"} · ${feeLabel}${pack.hoaCode || blocks.hoaCode ? ` · HOA ${pack.hoaCode ?? blocks.hoaCode}` : ""}`,
    },
    {
      id: "b6",
      label: "Documents",
      summary: docs > 0 ? `${docs} required document(s)` : "No documents required",
    },
    {
      id: "b7",
      label: "Output & issuance",
      summary: String(blocks.issuanceType ?? pack.servicePattern ?? "certificate"),
    },
    {
      id: "b8",
      label: "Notifications",
      summary: "Pattern defaults applied on import",
    },
  ];
}

export function filterServicePacks(
  packs: ServicePackDto[],
  domainPacks: DomainPackRow[],
  filters: PackLibraryFilters,
): ServicePackDto[] {
  const domainByKey = new Map(domainPacks.map((d) => [d.domainPackKey, d]));

  return packs.filter((p) => {
    const domain = p.domainPackKey ? domainByKey.get(p.domainPackKey) : undefined;

    if (filters.domainFilter !== "all" && p.domainPackKey !== filters.domainFilter) return false;
    if (filters.pattern !== "all" && p.servicePattern !== filters.pattern) return false;

    if (filters.sector !== "all") {
      if (!domain || domain.sector !== filters.sector) return false;
    }

    if (filters.jurisdiction !== "all") {
      if (!domain || domain.jurisdiction !== filters.jurisdiction) return false;
    }

    if (filters.source === "domain" && !p.domainPackKey) return false;
    if (filters.source === "tenant" && p.domainPackKey) return false;

    return true;
  });
}

export function uniqueJurisdictions(domainPacks: DomainPackRow[]): string[] {
  return Array.from(new Set(domainPacks.map((d) => d.jurisdiction).filter(Boolean)));
}

export function uniqueSectors(domainPacks: DomainPackRow[]): string[] {
  return Array.from(new Set(domainPacks.map((d) => d.sector).filter(Boolean)));
}

export function uniquePatterns(packs: ServicePackDto[]): string[] {
  return Array.from(
    new Set(packs.map((p) => p.servicePattern).filter((p): p is string => Boolean(p))),
  );
}
