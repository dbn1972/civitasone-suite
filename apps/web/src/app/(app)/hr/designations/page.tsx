import Link from "next/link";
import { PageHeader, Card, StatGrid, StatCard, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { DesignationsTable } from "./DesignationsTable";
import { HR_MASTERS_ADMIN_ROLES } from "@/lib/auth/workRoles";
import { getGradeBands, getPayScaleKind } from "@/app/_data/gradeBands";

/**
 * Mirrors the HR_ROLES guard on PATCH/DELETE /v1/hrms/designations/:id.
 * Same roles as departments -- only admins may edit or delete designations.
 */
const DESIGNATION_ADMIN_ROLES = HR_MASTERS_ADMIN_ROLES;

type Designation = { id: string; code: string; name: string; level: number; payGrade: string | null; gradeBandId?: string | null; usageCount?: number } & Record<string, unknown>;

async function getDesignations(withUsage: boolean): Promise<LoaderResult<Designation[]>> {
  try {
    // GAP-HR-DESIGNATIONS-02: admins also get a per-row usageCount so the
    // table can explain why Delete is unavailable instead of offering a
    // dialog that can only 409. The API ignores the flag for other roles.
    const r = await fetchJson<unknown, Designation[]>(`/api/v1/hrms/designations${withUsage ? "?withUsage=true" : ""}`, [], {
      telemetryKey: "config.designations",
      mapResponse: (p) => (p as { data: Designation[] })?.data ?? null,
    });
    return r;
  } catch {
    return { data: [], source: "error" as const };
  }
}

const newBtnStyle: React.CSSProperties = {
  minHeight: 40,
  padding: "0 16px",
  display: "flex",
  alignItems: "center",
  borderRadius: 8,
  fontWeight: 600,
  fontSize: 14,
  background: "var(--primary)",
  color: "var(--panel)",
  textDecoration: "none",
};

export default async function DesignationsPage() {
  const t = await getTranslations("designations");
  const roles = getSessionRoles();
  const canEdit = roles.some((r) => DESIGNATION_ADMIN_ROLES.includes(r));
  const result = await getDesignations(canEdit);
  // S8-G4: a tenant on private grade bands sees a band column instead of the 7th CPC level / service group.
  // Anything unreadable resolves to the government default, so this screen is unchanged for those tenants.
  const payScale = await getPayScaleKind();
  const bandMode = payScale === "private_bands";
  const bands = bandMode ? (await getGradeBands(true)).bands : [];
  const { data: items } = result;
  const resource = toResourceState(result);
  const errored = resource.status === "error";

  const withPayGrade    = errored ? null : items.filter((d) => !!d.payGrade).length;
  const withoutPayGrade = errored ? null : items.filter((d) => !d.payGrade).length;
  // GAP-HR-DESIGNATIONS-05: level 0 means "unclassified" everywhere else in
  // this screen (DesignationsTable renders it as "—"), so it must not count
  // as a real level here either -- items [0,4,4,6] should read 2, not 3.
  const uniqueLevels    = errored ? null : new Set(items.filter((d) => d.level > 0).map((d) => String(d.level))).size;

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("title")}
        subtitle={bandMode ? t("subtitleBands") : t("subtitle")}
        back="/hr"
        backLabel={t("backLabel")}
        help="hr"
        actions={
          canEdit ? (
            <>
              {bandMode && (
                <Link href="/hr/grade-bands" style={{ ...newBtnStyle, background: "transparent", color: "var(--primary)", border: "1px solid var(--primary)", marginInlineEnd: 8 }}>
                  {t("manageBandsLink")}
                </Link>
              )}
              <Link href="/hr/designations/new" style={newBtnStyle}>
                <span aria-hidden="true" style={{ marginInlineEnd: 6 }}>+</span>
                {t("newBtn")}
              </Link>
            </>
          ) : undefined
        }
      />
      <StatGrid>
        <StatCard icon="🏅" iconBg="var(--infobg)" label={t("statTotalLabel")} value={errored ? "—" : items.length} />
        <StatCard icon="💰" iconBg="var(--goodbg)" label={t("statWithPayGradeLabel")}     value={withPayGrade ?? "—"} />
        {/* GAP-HR-DESIGNATIONS-05: "—" as an icon read as if the stat itself
            had failed to load; a real icon distinguishes "0 rows" from "no
            data". */}
        <StatCard icon="⚠️" iconBg="var(--warnbg)" label={t("statWithoutPayGradeLabel")}  value={withoutPayGrade ?? "—"} />
        {bandMode
          ? <StatCard icon="🎚️" iconBg="var(--bg)" label={t("statBandsInUseLabel")} value={errored ? "—" : new Set(items.map((d) => d.gradeBandId).filter(Boolean)).size} />
          : <StatCard icon="🎚️" iconBg="var(--bg)" label={t("statUniqueLevelsLabel")}      value={uniqueLevels ?? "—"} />}
      </StatGrid>

      <Card title={errored ? t("title") : t("cardTitleWithCount", { count: items.length })}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "designations" })} backHref="/hr" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon="🏷️"
            title={t("emptyTitle")}
            message={t("emptyMessage")}
          />
        ) : (
          <DesignationsTable items={items} canEdit={canEdit} payScale={payScale} bands={bands} />
        )}
      </Card>
    </div>
  );
}
