import { getTranslations } from "next-intl/server";
import { PageHeader, Card, StatGrid, StatCard } from "../../../_components/ds";
import { PermissionDenied } from "../../../_components/PermissionDenied";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { GRADE_BAND_ADMIN_ROLES, GRADE_BAND_READ_ROLES, PAY_SCALE_WRITE_ROLES } from "@/lib/gradeBands";
import { getGradeBands, getPayScaleKind } from "@/app/_data/gradeBands";
import { GradeBandsAdmin } from "./GradeBandsAdmin";

/**
 * S8-G4. Mirrors the role lists of services/hrms-service/src/modules/grade-bands/routes.ts:
 * anyone the API lets read the bands may open the page; only the admin tier sees the add/edit controls.
 * The pay-scale switch (policy-settings PUT) is HR-admin only, exactly like the API.
 * (The role lists live in lib/gradeBands.ts: a Next.js page module may not export extra constants.)
 */
export default async function GradeBandsPage() {
  const roles = getSessionRoles();
  if (!roles.some((r) => GRADE_BAND_READ_ROLES.includes(r))) {
    return <PermissionDenied module="grade bands" requiredRoles={GRADE_BAND_READ_ROLES} />;
  }
  const t = await getTranslations("gradeBands");
  const canManage = roles.some((r) => GRADE_BAND_ADMIN_ROLES.includes(r));
  const canSwitchScale = roles.some((r) => PAY_SCALE_WRITE_ROLES.includes(r));
  const [{ bands, failed }, payScale] = await Promise.all([getGradeBands(true), getPayScaleKind()]);

  const active = failed ? null : bands.filter((b) => b.isActive).length;
  const inactive = failed ? null : bands.filter((b) => !b.isActive).length;
  const tracks = failed ? null : new Set(bands.map((b) => b.track).filter(Boolean)).size;

  return (
    <div className="page-main wrap">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr" backLabel={t("backLabel")} help="hr" />
      <StatGrid>
        <StatCard icon="🏷️" iconBg="var(--infobg)" label={t("statTotal")} value={failed ? "—" : bands.length} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statActive")} value={active ?? "—"} />
        <StatCard icon="🚫" iconBg="var(--badbg)" label={t("statInactive")} value={inactive ?? "—"} />
        <StatCard icon="🧭" iconBg="var(--bg)" label={t("statTracks")} value={tracks ?? "—"} />
      </StatGrid>
      <Card title={failed ? t("title") : t("cardTitleWithCount", { count: bands.length })}>
        <GradeBandsAdmin
          initialBands={bands}
          loadFailed={failed}
          canManage={canManage}
          canSwitchScale={canSwitchScale}
          payScale={payScale}
        />
      </Card>
    </div>
  );
}
