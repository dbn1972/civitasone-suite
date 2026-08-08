"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/app/_components/ds";
import { Segmented } from "@/app/_components/ds/Segmented";
import { PackCard, StatutoryWarningDialog } from "@/app/_components/ds/designer";
import {
  fetchServicePacks,
  importServicePack,
  type ServicePackDto,
} from "../_data/packLibraryApi";
import type { DomainPackRow } from "../_data/designerLoader";
import {
  buildPackPreviewBlocks,
  filterServicePacks,
  packJurisdiction,
  packSector,
  packSourceLabel,
  uniqueJurisdictions,
  uniquePatterns,
  uniqueSectors,
} from "../_data/packLibraryModel";

interface PackLibraryClientProps {
  domainPacks: DomainPackRow[];
}

export function PackLibraryClient({ domainPacks }: PackLibraryClientProps) {
  const router = useRouter();
  const [packs, setPacks] = useState<ServicePackDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [sector, setSector] = useState("all");
  const [pattern, setPattern] = useState("all");
  const [domainFilter, setDomainFilter] = useState("all");
  const [jurisdiction, setJurisdiction] = useState("all");
  const [source, setSource] = useState("all");
  const [previewPack, setPreviewPack] = useState<ServicePackDto | null>(null);
  const [importPack, setImportPack] = useState<ServicePackDto | null>(null);
  const [importBusy, setImportBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const data = await fetchServicePacks();
      if (!cancelled) {
        setPacks(data);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const domainByKey = useMemo(
    () => new Map(domainPacks.map((d) => [d.domainPackKey, d])),
    [domainPacks],
  );

  const sectors = useMemo(() => ["all", ...uniqueSectors(domainPacks)], [domainPacks]);
  const jurisdictions = useMemo(() => ["all", ...uniqueJurisdictions(domainPacks)], [domainPacks]);
  const patterns = useMemo(() => ["all", ...uniquePatterns(packs)], [packs]);

  const filtered = useMemo(
    () => filterServicePacks(packs, domainPacks, {
      sector,
      pattern,
      domainFilter,
      jurisdiction,
      source,
    }),
    [packs, domainPacks, sector, pattern, domainFilter, jurisdiction, source],
  );

  const beginImport = (pack: ServicePackDto) => {
    if (pack.statutoryReferences.length > 0) {
      setImportPack(pack);
      return;
    }
    void doImport(pack);
  };

  const doImport = async (pack: ServicePackDto) => {
    setImportBusy(true);
    try {
      const draftId = await importServicePack(pack.id);
      setNotice("Imported as draft — nothing is live until your office publishes it.");
      setImportPack(null);
      router.push(`/designer/${draftId}/b1`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setImportBusy(false);
    }
  };

  const importDomain = importPack?.domainPackKey
    ? domainByKey.get(importPack.domainPackKey)
    : undefined;
  const previewBlocks = previewPack ? buildPackPreviewBlocks(previewPack) : [];

  return (
    <>
      <PageHeader
        title="Pack Library"
        subtitle="Browse domain packs and import starter services as drafts."
        actions={<Link href="/designer" className="btn ghost">← Library</Link>}
      />

      {notice ? (
        <p role="status" style={{ marginBottom: 12, color: "var(--ink2)", fontSize: 14 }}>{notice}</p>
      ) : null}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 16,
          alignItems: "center",
        }}
      >
        <label style={{ fontSize: 13, color: "var(--ink2)" }}>
          Sector{" "}
          <select value={sector} onChange={(e) => setSector(e.target.value)} className="btn ghost">
            {sectors.map((s) => <option key={s} value={s}>{s === "all" ? "All sectors" : s}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 13, color: "var(--ink2)" }}>
          Jurisdiction{" "}
          <select
            value={jurisdiction}
            onChange={(e) => setJurisdiction(e.target.value)}
            className="btn ghost"
          >
            {jurisdictions.map((j) => (
              <option key={j} value={j}>{j === "all" ? "All jurisdictions" : j}</option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 13, color: "var(--ink2)" }}>
          Source{" "}
          <select value={source} onChange={(e) => setSource(e.target.value)} className="btn ghost">
            <option value="all">All sources</option>
            <option value="domain">Domain packs</option>
            <option value="tenant">Tenant library</option>
          </select>
        </label>
        <label style={{ fontSize: 13, color: "var(--ink2)" }}>
          Domain pack{" "}
          <select value={domainFilter} onChange={(e) => setDomainFilter(e.target.value)} className="btn ghost">
            <option value="all">All domain packs</option>
            {domainPacks.map((d) => (
              <option key={d.domainPackKey} value={d.domainPackKey}>{d.name}</option>
            ))}
          </select>
        </label>
        <Segmented
          value={pattern === "all" ? "All patterns" : pattern}
          onChange={(v) => setPattern(v === "All patterns" ? "all" : v)}
          options={patterns.map((p) => (p === "all" ? "All patterns" : p))}
        />
      </div>

      {loading ? (
        <p style={{ color: "var(--mut)" }}>Loading packs…</p>
      ) : filtered.length === 0 ? (
        <p style={{ color: "var(--mut)" }}>No packs match the current filters.</p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 16,
          }}
        >
          {filtered.map((pack) => {
            const domain = pack.domainPackKey ? domainByKey.get(pack.domainPackKey) : undefined;
            return (
              <PackCard
                key={pack.id}
                pack={pack}
                source={packSourceLabel(pack, domain)}
                sector={packSector(pack, domain)}
                jurisdiction={packJurisdiction(pack, domain)}
                onPreview={setPreviewPack}
                onImport={beginImport}
              />
            );
          })}
        </div>
      )}

      {previewPack ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="pack-preview-title"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(16,24,40,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
          onClick={() => setPreviewPack(null)}
        >
          <div
            style={{
              width: "min(640px, 100%)",
              maxHeight: "90vh",
              overflow: "auto",
              background: "var(--panel)",
              borderRadius: "var(--r-sm)",
              border: "1px solid var(--line)",
              padding: 20,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="pack-preview-title" style={{ margin: "0 0 8px" }}>{previewPack.name}</h2>
            <p style={{ margin: "0 0 12px", color: "var(--mut)", fontSize: 14 }}>
              Read-only wizard walkthrough — {previewPack.servicePattern} · v{previewPack.version}
            </p>
            <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
              {previewBlocks.map((block) => (
                <li
                  key={block.id}
                  style={{
                    padding: "10px 12px",
                    border: "1px solid var(--line)",
                    borderRadius: "var(--r-sm)",
                    background: "var(--bg)",
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{block.label}</div>
                  <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--ink2)" }}>
                    {block.summary}
                  </p>
                </li>
              ))}
            </ol>
            <p style={{ margin: "12px 0 0", fontSize: 12, color: "var(--mut)" }}>
              Import creates a local draft — nothing is live until your office publishes it.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button type="button" className="btn ghost" onClick={() => setPreviewPack(null)}>
                Close
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => { beginImport(previewPack); setPreviewPack(null); }}
              >
                Import as draft
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <StatutoryWarningDialog
        open={Boolean(importPack)}
        packName={importPack?.name ?? ""}
        references={importPack?.statutoryReferences ?? []}
        authorityScope={
          importDomain
            ? [importDomain.sector, importDomain.jurisdiction].filter(Boolean).join(" · ")
            : undefined
        }
        busy={importBusy}
        onCancel={() => setImportPack(null)}
        onConfirm={() => importPack && void doImport(importPack)}
      />
    </>
  );
}
