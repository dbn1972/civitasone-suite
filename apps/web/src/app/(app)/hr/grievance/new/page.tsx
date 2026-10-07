import { PageHeader, Card } from "../../../../_components/ds";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { getTranslations } from "next-intl/server";
import { GRIEVANCE_ROLES } from "../grievanceModel";
import { NewGrievanceForm } from "./NewGrievanceForm";

export default async function NewGrievancePage() {
  const t = await getTranslations("grievanceNew");
  const roles = getSessionRoles();
  if (!roles.some((r: string) => GRIEVANCE_ROLES.includes(r))) {
    return <PermissionDenied module="grievances" requiredRoles={GRIEVANCE_ROLES} />;
  }
  return (
    <div className="page-main wrap">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr/grievance" backLabel={t("backLabel")} />
      <Card title={t("cardTitle")}>
        <div className="pad"><NewGrievanceForm /></div>
      </Card>
    </div>
  );
}
