import { PageHeader, StatGrid, StatCard } from "@/app/_components/ds";
import { getDataExports } from "@/app/_data/loaders";
import { DataExportClient } from "./DataExportClient";

export default async function DataExportPage() {
  const { data: exports, source } = await getDataExports();
  const readyCount = exports.filter((e) => e.status === "ready").length;
  const processingCount = exports.filter((e) => e.status === "processing").length;

  return (
    <div className="page-main wrap">
      {/* UX-012: the data-source badge now lives inside DataExportClient,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the client's own cache state (UX-002's pattern). */}
      <PageHeader title="Data Export" subtitle="Export your organisation's data held in CivitasOne under DPDP Act 2023." back="/tenant-admin" />

      {/* GAP-TENANT-ADMIN-DATA-EXPORT-04: the organisation is a data fiduciary
          exporting data it holds — not a data principal exercising a personal
          right. Copy reworded; the hard-coded "48 hours" window removed (the
          per-row expiry is shown from the API). Token-based colours (no inline
          hex) so it themes in dark mode. Final wording to be confirmed by DPO. */}
      <div className="card" style={{ marginBottom: 24, padding: 16, borderInlineStart: "4px solid var(--primary, #2563eb)" }}>
        <p style={{ margin: 0, fontSize: 14, color: "var(--ink)" }}>
          📋 <strong>DPDP notice:</strong> Your organisation can export the data it holds in CivitasOne. Exports that
          include personal data are recorded with the requester&apos;s identity and purpose. Each export link remains
          downloadable only until it expires (see the expiry shown against each export).
        </p>
      </div>

      <StatGrid>
        <StatCard icon="📦" iconBg="#eef2ff" label="Total Exports" value={exports.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Ready" value={readyCount} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Processing" value={processingCount} />
        <StatCard icon="📊" iconBg="#f1f5f9" label="Expired" value={exports.filter((e) => e.status === "expired").length} />
      </StatGrid>

      <DataExportClient exports={exports} source={source} />
    </div>
  );
}
