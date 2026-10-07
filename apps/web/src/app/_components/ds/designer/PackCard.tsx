"use client";

import type { ServicePackDto } from "@/app/(app)/designer/_data/packLibraryApi";
import { Button } from "../Button";

const PATTERN_ICONS: Record<string, string> = {
  certificate: "📜",
  booking: "📅",
  collection: "💰",
  grievance: "📋",
};

export interface PackCardProps {
  pack: ServicePackDto;
  /**
   * GAP-DESIGNER-LIBRARY-03 — the domain pack's display name (e.g. "Municipal
   * India v1"). When present it is shown in the meta line instead of the raw
   * `domainPackKey` token.
   */
  domainName?: string;
  source?: string;
  sector?: string;
  jurisdiction?: string;
  onPreview: (pack: ServicePackDto) => void;
  onImport: (pack: ServicePackDto) => void;
}

/**
 * GAP-DESIGNER-LIBRARY-03 — turn an enum-style token ("property_tax",
 * "urban-local-body") into a Title Case label ("Property Tax", "Urban Local
 * Body"). A value that is already a human label (contains a space or an
 * uppercase letter) is returned unchanged.
 */
function humanizeToken(value: string): string {
  const v = value.trim();
  if (!v || v === "—") return v;
  if (/\s/.test(v) || /[A-Z]/.test(v)) return v;
  return v
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function PackCard({
  pack,
  domainName,
  source = "Domain pack",
  sector,
  jurisdiction,
  onPreview,
  onImport,
}: PackCardProps) {
  const icon = PATTERN_ICONS[pack.servicePattern ?? "certificate"] ?? "📦";
  const hasStatutory = pack.statutoryReferences.length > 0;
  const sectorLabel = sector && sector !== "—" ? humanizeToken(sector) : null;
  const jurisdictionLabel = jurisdiction && jurisdiction !== "—" ? humanizeToken(jurisdiction) : null;
  const metaBits = [
    domainName ?? (pack.domainPackKey ? humanizeToken(pack.domainPackKey) : "Tenant library"),
    `v${pack.version}`,
    source,
    sectorLabel,
    jurisdictionLabel,
  ].filter(Boolean);

  return (
    <article
      className="card"
      style={{
        padding: 16,
        border: "1px solid var(--line)",
        borderRadius: "var(--r-sm)",
        background: "var(--panel)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span aria-hidden style={{ fontSize: 28 }}>{icon}</span>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: 0, fontSize: 16, color: "var(--ink)" }}>{pack.name}</h3>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--mut)" }}>
            {metaBits.join(" · ")}
          </p>
        </div>
        {hasStatutory ? (
          <span
            title="Contains statutory references"
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--warn)",
              background: "var(--warnbg)",
              border: "1px solid var(--warnbd)",
              borderRadius: 999,
              padding: "2px 8px",
            }}
          >
            Statutory
          </span>
        ) : null}
      </div>
      <p style={{ margin: 0, fontSize: 13, color: "var(--ink2)", textTransform: "capitalize" }}>
        {pack.servicePattern ?? "certificate"} pattern
        {pack.feeModel ? ` · ${pack.feeModel} fee` : ""}
        {pack.hoaCode ? ` · HOA ${pack.hoaCode}` : ""}
      </p>
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <Button type="button" variant="ghost" onClick={() => onPreview(pack)}>Preview</Button>
        <Button type="button" onClick={() => onImport(pack)}>Import</Button>
      </div>
    </article>
  );
}
