import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { AucForm } from "./AucForm";
import { AucTable, type AucRow } from "./AucTable";
import { mapAucRows } from "./aucMapper";

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
        {source === "error" ? (
          <>
            <StatCard icon="🏗️" iconBg="#fdf0e3" label="Under Construction" value="—" />
            <StatCard icon="✅" iconBg="#ecfdf3" label="Capitalized" value="—" />
            <StatCard icon="📦" iconBg="#eff6ff" label="Tracked Projects" value="—" />
            <StatCard icon="💰" iconBg="#fef3f2" label="Accumulated WIP" value="—" />
          </>
        ) : (
          <>
            <StatCard icon="🏗️" iconBg="#fdf0e3" label="Under Construction" value={underConstruction.length} />
            <StatCard icon="✅" iconBg="#ecfdf3" label="Capitalized" value={capitalized.length} />
            <StatCard icon="📦" iconBg="#eff6ff" label="Tracked Projects" value={rows.length} />
            <StatCard icon="💰" iconBg="#fef3f2" label="Accumulated WIP" value={formatMoney(accumulatedTotal)} />
          </>
        )}
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
