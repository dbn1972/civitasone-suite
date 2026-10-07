import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState, EmptyState } from "../../../../../_components/ds";
import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { INDIAN_STATES_UTS } from "@/lib/india/states";
import { PtVersionForm } from "./PtVersionForm";
import { PtStatePicker } from "./PtStatePicker";
import { PtApprovals } from "./PtApprovals";
import { PtMakerCheckerSetting } from "./PtMakerCheckerSetting";
import { toHumanError } from "@/lib/messages";
import { PermissionDenied } from "../../../../../_components/PermissionDenied";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PAYROLL_STATUTORY_ADMIN_ROLES } from "@/lib/auth/workRoles";
import { PT_VERSION_ADMIN_ROLES } from "./constants";
import { EMPTY_PT_PAYLOAD, buildPtView, isOpenEnded, parsePtPayload, type PtVersionsPayload } from "./viewModel";

async function getData(): Promise<LoaderResult<PtVersionsPayload>> {
  return fetchJson<unknown, PtVersionsPayload>("/api/v1/payroll/statutory/pt/versions", EMPTY_PT_PAYLOAD, {
    telemetryKey: "payroll.statutory.pt",
    mapResponse: (p) => parsePtPayload(p),
  });
}

/**
 * GAP-PAYROLL-STATUTORY-PT-04 [HUMAN REVIEW: statutory compliance]: slabs are
 * dated versions per state (each State's PT Act and Rules), not a single set
 * that is overwritten. Past and current versions are read-only; a change is a
 * new version that takes effect from its own date.
 */
export default async function ProfessionalTaxPage({ searchParams }: { searchParams?: { state?: string; version?: string } }) {
  const t = await getTranslations("pt");
  // GAP-PAYROLL-STATUTORY-PT-01: hr/layout.tsx admits employee/manager to every /hr/payroll/*
  // URL, but this page's API is READER_ROLES-only in payroll-service. Gate before
  // fetching so those roles get a clear explanation instead of a failed load.
  const roles = getSessionRoles();
  if (!roles.some((r) => PAYROLL_STATUTORY_ADMIN_ROLES.includes(r))) {
    return <PermissionDenied module="professional tax slabs" requiredRoles={PAYROLL_STATUTORY_ADMIN_ROLES} backHref="/hr/payroll/statutory" backLabel={t("errorBackLabel")} />;
  }
  // Creating a version is payroll_admin / super_admin only (payroll-service PT_ADMIN_ROLES).
  const canEdit = roles.some((r) => PT_VERSION_ADMIN_ROLES.includes(r));
  const { data, source } = await getData();
  const errored = source === "error";
  const view = buildPtView(data, searchParams?.state, searchParams?.version);
  const stateName = INDIAN_STATES_UTS.find((s) => s.code === view.stateCode)?.name ?? view.stateCode ?? "";

  const statusLabels = { past: t("statusPast"), current: t("statusCurrent"), upcoming: t("statusUpcoming") };
  const timelineRows = view.versions.map((v) => ({
    href: `/hr/payroll/statutory/pt?state=${encodeURIComponent(v.stateCode)}&version=${encodeURIComponent(v.effectiveFrom)}`,
    effectiveFromLabel: v.legacy ? t("sinceInception") : formatIndianDate(v.effectiveFrom),
    effectiveToLabel: v.effectiveTo ? formatIndianDate(v.effectiveTo) : t("openEnded"),
    status: v.status,
    slabCount: v.slabs.length,
    sourceLabel: v.legacy ? t("sourceBaseline") : v.backDated ? t("sourceBackDated") : t("sourceUser"),
  }));
  type TimelineRow = (typeof timelineRows)[number];
  const timelineColumns: { key: keyof TimelineRow & string; label: string; align?: "left" | "right"; cellType?: "status"; statusLabels?: Record<string, string> }[] = [
    { key: "effectiveFromLabel", label: t("colEffectiveFrom") },
    { key: "effectiveToLabel", label: t("colEffectiveTo") },
    { key: "status", label: t("colStatus"), cellType: "status", statusLabels },
    { key: "slabCount", label: t("colSlabs"), align: "right" },
    { key: "sourceLabel", label: t("colSource") },
  ];

  const slabRows = (view.selected?.slabs ?? []).map((s) => ({
    fromMinor: s.fromMinor,
    toLabel: isOpenEnded(s.toMinor) ? t("noUpperBound") : formatMoney(s.toMinor),
    taxMinor: s.taxMinor,
    februaryLabel: s.februaryTaxMinor == null ? "—" : formatMoney(s.februaryTaxMinor),
    genderLabel: s.appliesToGender === "female" ? t("genderFemale") : s.appliesToGender === "male" ? t("genderMale") : t("genderAll"),
  }));
  type SlabRow = (typeof slabRows)[number];
  const slabColumns: { key: keyof SlabRow & string; label: string; align?: "left" | "right"; cellType?: "amount" }[] = [
    { key: "fromMinor", label: t("colSlabFrom"), align: "right", cellType: "amount" },
    { key: "toLabel", label: t("colSlabTo"), align: "right" },
    { key: "taxMinor", label: t("colPtAmount"), align: "right", cellType: "amount" },
    { key: "februaryLabel", label: t("colFebAmount"), align: "right" },
    { key: "genderLabel", label: t("colGender") },
  ];

  return (
    <div className="page-main wrap">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr/payroll/statutory" backLabel={t("errorBackLabel")} />
      <DataSourceBadge source={source} message={t("loadErrorMessage")} />

      {errored ? (
        <Card title={t("title")}>
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: t("loadErrorArea") })} backHref="/hr/payroll/statutory" />
          </div>
        </Card>
      ) : (
        <>
          <StatGrid>
            <StatCard icon="🗺️" iconBg="var(--goodbg)" label={t("statStatesConfigured")} value={view.configuredStates.length} />
            <StatCard icon="🏛️" iconBg="var(--infobg)" label={t("statVersions")} value={view.stateCode ? view.versions.length : "—"} />
            <StatCard
              icon="📅" iconBg="var(--warnbg)" label={t("statCurrentSince")}
              value={view.current ? (view.current.legacy ? t("sinceInception") : formatIndianDate(view.current.effectiveFrom)) : "—"}
            />
          </StatGrid>

          <p role="note" style={{ margin: "0 0 16px", fontSize: 13 }}>{t("capNote")}</p>
          <PtStatePicker selected={view.stateCode} configured={view.configuredStates} />

          {canEdit && <PtMakerCheckerSetting enabled={data.makerChecker} offPending={data.pending.some((x) => x.kind === "checker_off")} />}
          {view.hasPending && (
            <PtApprovals
              pending={view.pending}
              viewerId={data.viewerId}
              canDecide={canEdit}
              stateName={(code) => `${INDIAN_STATES_UTS.find((s) => s.code === code)?.name ?? code} (${code})`}
            />
          )}

          {!view.stateCode && (
            <EmptyState icon="🏛️" title={t("noStateTitle")} message={view.hasConfiguredStates ? t("noStateMessage") : t("noStateNoneConfigured")} />
          )}

          {view.stateCode && (
            <>
              <Card title={t("timelineCardTitle", { state: `${stateName} (${view.stateCode})` })}>
                <DataTable<TimelineRow>
                  columns={timelineColumns}
                  rows={timelineRows}
                  rowLinkKey="href"
                  rowLinkPrefix=""
                  emptyIcon="🏛️"
                  emptyTitle={t("noVersionsTitle")}
                  emptyMessage={t("noVersionsMessage")}
                />
              </Card>

              {view.selected && (
                <Card title={t("selectedVersionTitle", { date: view.selected.legacy ? t("sinceInception") : formatIndianDate(view.selected.effectiveFrom) })}>
                  <div className="pad" style={{ display: "grid", gap: 8 }}>
                    <p role="note" style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>{t("readOnlyNote")}</p>
                    {view.selected.reason && <p style={{ margin: 0, fontSize: 13 }}>{t("versionReason", { reason: view.selected.reason })}</p>}
                  </div>
                  <DataTable<SlabRow> columns={slabColumns} rows={slabRows} emptyIcon="🏛️" emptyTitle={t("noVersionsTitle")} emptyMessage={t("noVersionsMessage")} />
                </Card>
              )}

              {canEdit && (
                <PtVersionForm
                  key={`${view.stateCode}:${view.current?.effectiveFrom ?? "none"}`}
                  stateCode={view.stateCode}
                  stateName={stateName}
                  baseSlabs={view.baseSlabs}
                  today={data.today}
                  earliestEffectiveFrom={data.earliestEffectiveFrom}
                  lastFinalisedMonth={data.lastFinalisedMonth}
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
