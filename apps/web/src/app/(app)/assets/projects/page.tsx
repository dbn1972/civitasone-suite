import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { AucForm } from "./AucForm";
import { AucTable, type AucRow } from "./AucTable";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function mapAucRows(payload: unknown): AucRow[] | null {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : null;
  if (!rows) return null;

  const mapped: AucRow[] = [];
  for (const raw of rows) {
    if (!isRecord(raw)) continue;
    const id = raw.id;
    const projectCode = raw.projectCode;
    const name = raw.name;
    const status = raw.status;
    if (typeof id !== "string" || typeof projectCode !== "string" || typeof name !== "string" || typeof status !== "string") continue;
    mapped.push({
      id,
      projectCode,
      name,
      wbsRef: typeof raw.wbsRef === "string" ? raw.wbsRef : null,
      // Server returns accumulated_minor as a bigint-serialized string or number; both are paise.
      accumulatedMinor: typeof raw.accumulatedMinor === "number" || typeof raw.accumulatedMinor === "string" ? raw.accumulatedMinor : 0,
      status,
      assetId: typeof raw.assetId === "string" ? raw.assetId : null,
    });
  }
  return mapped;
}

async function getAucProjects(): Promise<LoaderResult<AucRow[]>> {
  // Verified: GET /v1/assets/projects/auc in services/asset-service/src/modules/enterprise/routes.ts
  // (returns { data: AucRow[] }). Gateway prefix used elsewhere in this app for asset-service is
  // /api/v1/asset (see getAssetById et al. in _data/loaders.ts) — both /api/v1/asset and
  // /api/v1/assets are registered upstream to the same asset-service; this app's convention is
  // the singular form.
  return fetchJson<unknown, AucRow[]>("/api/v1/asset/projects/auc", [], {
    telemetryKey: "assets.projects.auc",
    mapResponse: mapAucRows,
  });
}

export default async function ProjectsAucPage() {
  const { data: rows, source } = await getAucProjects();

  const underConstruction = rows.filter((r) => r.status === "under_construction");
  const capitalized = rows.filter((r) => r.status === "capitalized");
  const accumulatedTotal = underConstruction.reduce((sum, r) => sum + BigInt(r.accumulatedMinor), 0n);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Projects & AUC"
        subtitle="Assets under construction — accumulate WIP, then capitalize to the fixed-asset register with dual-book depreciation."
        back="/assets"
        backLabel="Assets"
        actions={source === "error" ? <DataSourceBadge source="error" /> : null}
      />

      <StatGrid>
        <StatCard icon="🏗️" iconBg="#fdf0e3" label="Under Construction" value={underConstruction.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Capitalized" value={capitalized.length} />
        <StatCard icon="📦" iconBg="#eff6ff" label="Tracked Projects" value={rows.length} />
        <StatCard icon="💰" iconBg="#fef3f2" label="Accumulated WIP" value={formatMoney(accumulatedTotal)} />
      </StatGrid>

      <AucForm />

      <Card title="AUC register">
        {source === "error" && rows.length === 0 ? (
          <DataSourceBadge source="error" />
        ) : (
          <AucTable rows={rows} />
        )}
      </Card>
    </main>
  );
}
