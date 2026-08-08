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

  const sectors = useMemo(() => {
    const fromDomain = domainPacks.map((d) => d.sector).filter(Boolean);
    return ["all", ...Array.from(new Set(fromDomain))];
  }, [domainPacks]);

  const patterns = useMemo(() => {
    const vals = packs.map((p) => p.servicePattern).filter(Boolean) as string[];
    return ["all", ...Array.from(new Set(vals))];
  }, [packs]);

  const filtered = packs.filter((p) => {
    if (domainFilter !== "all" && p.domainPackKey !== domainFilter) return false;
    if (pattern !== "all" && p.servicePattern !== pattern) return false;
    if (sector !== "all") {
      const domain = domainPacks.find((d) => d.domainPackKey === p.domainPackKey);
      if (domain && domain.sector !== sector) return false;
    }
    return true;
  });

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
          {filtered.map((pack) => (
            <PackCard
              key={pack.id}
              pack={pack}
              source={pack.domainPackKey ?? "tenant"}
              onPreview={setPreviewPack}
              onImport={beginImport}
            />
          ))}
        </div>
      )}

      {previewPack ? (
        <div
          role="dialog"
          aria-modal="true"
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
              width: "min(560px, 100%)",
              background: "var(--panel)",
              borderRadius: "var(--r-sm)",
              border: "1px solid var(--line)",
              padding: 20,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: "0 0 8px" }}>{previewPack.name}</h2>
            <p style={{ margin: "0 0 12px", color: "var(--mut)", fontSize: 14 }}>
              Read-only preview — {previewPack.servicePattern} · v{previewPack.version}
            </p>
            <ul style={{ fontSize: 14, paddingLeft: 20 }}>
              <li>Fee model: {previewPack.feeModel ?? "none"}</li>
              <li>HOA: {previewPack.hoaCode ?? "—"}</li>
              <li>Business service: {String(previewPack.manifest.businessService ?? "—")}</li>
            </ul>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button type="button" className="btn ghost" onClick={() => setPreviewPack(null)}>Close</button>
              <button type="button" className="btn primary" onClick={() => { beginImport(previewPack); setPreviewPack(null); }}>
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
        busy={importBusy}
        onCancel={() => setImportPack(null)}
        onConfirm={() => importPack && void doImport(importPack)}
      />
    </>
  );
}
