"use client";

import type { ServicePackDto } from "@/app/(app)/designer/_data/packLibraryApi";

const PATTERN_ICONS: Record<string, string> = {
  certificate: "📜",
  booking: "📅",
  collection: "💰",
  grievance: "📋",
};

export interface PackCardProps {
  pack: ServicePackDto;
  source?: string;
  onPreview: (pack: ServicePackDto) => void;
  onImport: (pack: ServicePackDto) => void;
}

export function PackCard({ pack, source = "Domain pack", onPreview, onImport }: PackCardProps) {
  const icon = PATTERN_ICONS[pack.servicePattern ?? "certificate"] ?? "📦";
  const hasStatutory = pack.statutoryReferences.length > 0;

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
            {pack.domainPackKey ?? "—"} · v{pack.version} · {source}
          </p>
        </div>
        {hasStatutory ? (
          <span
            title="Contains statutory references"
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--warn-fg)",
              background: "var(--warn-bg)",
              border: "1px solid var(--warn-border)",
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
        <button type="button" className="btn ghost" onClick={() => onPreview(pack)}>Preview</button>
        <button type="button" className="btn primary" onClick={() => onImport(pack)}>Import</button>
      </div>
    </article>
  );
}
