import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { LoadErrorState } from "@/app/_components/ds/LoadErrorState";
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

/** GAP-ASSETS-PROJECTS-09: per-tenant maker-checker setting; defaults ON when it cannot be read (the service decides anyway). */
async function getMakerChecker(): Promise<boolean> {
  const res = await fetchJson<unknown, { capitalizeMakerChecker: boolean }>("/api/v1/asset/settings", { capitalizeMakerChecker: true }, {
    telemetryKey: "assets.settings",
    mapResponse: (p) => (typeof p === "object" && p !== null && typeof (p as { capitalizeMakerChecker?: unknown }).capitalizeMakerChecker === "boolean"
      ? { capitalizeMakerChecker: (p as { capitalizeMakerChecker: boolean }).capitalizeMakerChecker } : null),
  });
  return res?.data?.capitalizeMakerChecker !== false;
}

export default async function ProjectsAucPage() {
  const t = await getTranslations("assetsGl");
  const result = await getAucProjects();
  const { data: rows, source } = result;
  const makerChecker = await getMakerChecker();

  // A project awaiting approval is still WIP (nothing has been posted yet).
  const underConstruction = rows.filter((r) => r.status === "under_construction" || r.status === "pending_capitalization");
  const capitalized = rows.filter((r) => r.status === "capitalized");
  const accumulatedTotal = underConstruction.reduce((sum, r) => sum + BigInt(r.accumulatedMinor), 0n);

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Projects & AUC"
        subtitle="Assets under construction — accumulate WIP, then capitalize to the fixed-asset register with dual-book depreciation."
        back="/assets"
        backLabel="Assets"
        actions={
          <>
            <Link href="/assets/settings" className="btn ghost">{t("settingsLink")}</Link>
            {source === "error" ? <DataSourceBadge source="error" /> : null}
          </>
        }
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

      {/* GAP-ASSETS-PROJECTS-01: while the register could not be loaded we cannot
          check for duplicate project codes, so the create form is disabled with a
          notice (the server's own duplicate rejection stays the real guard). */}
      <AucForm
        disabledReason={source === "error" ? "The AUC register could not be loaded, so duplicate project codes cannot be checked. Retry loading before creating a project." : undefined}
      />

      <Card title="AUC register">
        {source === "error" ? (
          <LoadErrorState result={result} area="AUC projects" backHref="/assets" backLabel="Assets" />
        ) : (
          <AucTable rows={rows} makerChecker={makerChecker} />
        )}
      </Card>
    </div>
  );
}
