import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/app/_components/ds";
import { PermissionDenied } from "@/app/_components/PermissionDenied";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { CreateReportForm } from "./CreateReportForm";
import { REPORT_INSPECTOR_ROLES } from "../reportMeta";

export const dynamic = "force-dynamic";

export default async function NewInspectionReportPage(props: { searchParams?: Promise<{ inspectionId?: string }> }) {
  const searchParams = (await props.searchParams) ?? {};
  const t = await getTranslations("inspectionReports");
  const canCreate = getSessionRoles().some((r) => REPORT_INSPECTOR_ROLES.includes(r));
  return (
    <div className="wrap">
      <PageHeader title={t("formTitle")} subtitle={t("formSubtitle")} back="/inspection/reports" backLabel={t("backToReports")} />
      {canCreate ? (
        <CreateReportForm {...(typeof searchParams.inspectionId === "string" && searchParams.inspectionId ? { initialInspectionId: searchParams.inspectionId } : {})} />
      ) : (
        <PermissionDenied backHref="/inspection/reports" backLabel={t("backToReports")} />
      )}
    </div>
  );
}
