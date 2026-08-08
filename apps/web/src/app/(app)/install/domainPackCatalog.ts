/**
 * FN-17 — Stage 3 Domain Pack catalogue (installer UX).
 * Mirrors DoD §13(f) / install-service MUNICIPAL_ONBOARDING_PACK_KEYS.
 */

export const MUNICIPAL_DOMAIN_PACK_KEY = "municipal-in-v1";

export type DomainPackOutcome = {
  packKey: string;
  label: string;
  shortLabel: string;
  description: string;
};

export type DomainPackCatalogEntry = {
  domainPackKey: string;
  name: string;
  sector: string;
  jurisdiction: string;
  summary: string;
  /** Service packs imported as editable catalogue drafts on activate. */
  outcomes: DomainPackOutcome[];
  recommended?: boolean;
};

/** Pilot municipal pack — always offered even if citizen packs list is empty. */
export const MUNICIPAL_DOMAIN_PACK: DomainPackCatalogEntry = {
  domainPackKey: MUNICIPAL_DOMAIN_PACK_KEY,
  name: "Municipal India (ULB)",
  sector: "municipal",
  jurisdiction: "IN",
  summary:
    "Activates Trade License, PGR, and Water as editable catalogue drafts for local review — nothing goes live until your office publishes.",
  recommended: true,
  outcomes: [
    {
      packKey: "pack:trade-license",
      label: "Trade License",
      shortLabel: "TL",
      description: "Licence / certificate service draft for trade licensing.",
    },
    {
      packKey: "pack:pgr",
      label: "Public Grievance Redressal",
      shortLabel: "PGR",
      description: "Grievance pattern draft wired to citizen grievance runtime.",
    },
    {
      packKey: "pack:water-connection",
      label: "Water Connection",
      shortLabel: "Water",
      description: "Utility connection application draft for water services.",
    },
  ],
};

export const DOMAIN_PACK_CATALOG: DomainPackCatalogEntry[] = [MUNICIPAL_DOMAIN_PACK];

export function findCatalogEntry(domainPackKey: string): DomainPackCatalogEntry | undefined {
  return DOMAIN_PACK_CATALOG.find((p) => p.domainPackKey === domainPackKey);
}

export function outcomeLabels(entry: DomainPackCatalogEntry): string {
  return entry.outcomes.map((o) => o.shortLabel).join(" / ");
}

/** True when an install step is the Stage 3 Domain Pack activation step. */
export function isDomainPackStageStep(step: {
  stepNo?: number;
  title?: string;
  description?: string;
}): boolean {
  if (step.stepNo === 3) return true;
  const hay = `${step.title ?? ""} ${step.description ?? ""}`.toLowerCase();
  return hay.includes("domain pack") || hay.includes("activate-domain-pack");
}
