import { PageHeader, StatGrid, StatCard } from "@/app/_components/ds";
import { getDataExports } from "@/app/_data/loaders";
import { DataExportClient } from "./DataExportClient";

export default async function DataExportPage() {
  const { data: exports, source } = await getDataExports();
  const readyCount = exports.filter((e) => e.status === "ready").length;
  const processingCount = exports.filter((e) => e.status === "processing").length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      {/* UX-012: the data-source badge now lives inside DataExportClient,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the client's own cache state (UX-002's pattern). */}
      <PageHeader title="Data Export" subtitle="Export your organisation's data under DPDP Act 2023 compliance." back="/tenant-admin" />

      <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: 16, marginBottom: 24 }}>
        <p style={{ margin: 0, fontSize: 14, color: "#1e40af" }}>
          📋 <strong>DPDP Notice:</strong> Under the Digital Personal Data Protection Act 2023, you have the right to export your data.
          Exports are available for download for 48 hours after generation.
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
