import Link from "next/link";
import { PageHeader, Card, StatGrid, StatCard, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { DesignationsTable } from "./DesignationsTable";

/**
 * Mirrors the HR_ROLES guard on PATCH/DELETE /v1/hrms/designations/:id.
 * Same roles as departments -- only admins may edit or delete designations.
 */
const DESIGNATION_ADMIN_ROLES = ["hr_admin", "super_admin", "admin"];

type Designation = { id: string; code: string; name: string; level: number; payGrade: string | null } & Record<string, unknown>;

async function getDesignations(): Promise<LoaderResult<Designation[]>> {
  try {
    const r = await fetchJson<unknown, Designation[]>("/api/v1/hrms/designations", [], {
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
  color: "#fff",
  textDecoration: "none",
};

export default async function DesignationsPage() {
  const t = await getTranslations("designations");
  const result = await getDesignations();
  const { data: items } = result;
  const resource = toResourceState(result);
  const roles = getSessionRoles();
  const canEdit = roles.some((r) => DESIGNATION_ADMIN_ROLES.includes(r));
  const errored = resource.status === "error";

  const withPayGrade    = errored ? null : items.filter((d) => !!d.payGrade).length;
  const withoutPayGrade = errored ? null : items.filter((d) => !d.payGrade).length;
  const uniqueLevels    = errored ? null : new Set(items.map((d) => String(d.level))).size;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr"
        backLabel={t("backLabel")}
        help="hr"
        actions={
          <Link href="/hr/designations/new" style={newBtnStyle}>
            {t("newBtn")}
          </Link>
        }
      />
      <StatGrid>
        <StatCard icon="🏅" iconBg="var(--infobg, #e6f0ff)" label={t("statTotalLabel")} value={errored ? "—" : items.length} />
        <StatCard icon="💰" iconBg="var(--goodbg, #e6f7f0)" label={t("statWithPayGradeLabel")}     value={withPayGrade ?? "—"} />
        <StatCard icon="—" iconBg="var(--warnbg, #fff7e6)" label={t("statWithoutPayGradeLabel")}  value={withoutPayGrade ?? "—"} />
        <StatCard icon="🎚️" iconBg="var(--bg, #f5f5f5)" label={t("statUniqueLevelsLabel")}      value={uniqueLevels ?? "—"} />
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
          <DesignationsTable items={items} canEdit={canEdit} />
        )}
      </Card>
    </div>
  );
}
