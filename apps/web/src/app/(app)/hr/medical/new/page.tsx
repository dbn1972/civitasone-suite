import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader } from "../../../../_components/ds";
import { getEmployees, getMyProfile } from "../../../../_data/loaders";
import { NewMedicalClaimForm } from "./NewMedicalClaimForm";
import { getTranslations } from "next-intl/server";

/**
 * GAP-HR-MEDICAL-05: POST /v1/hrms/medical/claims already existed on the
 * backend (fully role-gated, forgery-fixed — see medical/routes.ts's
 * resolveSelfScopedEmployeeId) with no web page anywhere calling it. Same
 * employees-list-then-self-profile-fallback resolution as
 * hr/leave/apply/page.tsx, so this works for both an HR clerk filing on
 * behalf of an employee and a bare employee filing their own claim.
 */
export default async function NewMedicalClaimPage() {
  const t = await getTranslations("medicalClaims");
  const { data: employees, source, status } = await getEmployees();

  let resolvedEmployees = employees;
  let resolvedSource = source;
  let noLinkedProfile = false;

  if (employees.length === 0) {
    const { data: myProfile, source: mySource } = await getMyProfile();
    const employeesListReallyFailed = source === "error" && status !== 403;
    const profileReallyFailed = mySource === "error";
    resolvedSource = employeesListReallyFailed || profileReallyFailed ? "error" : "api";

    if (myProfile) {
      resolvedEmployees = [{
        id: myProfile.id,
        name: myProfile.name ?? "",
        department: myProfile.department ?? "",
        status: myProfile.status ?? "active",
      }];
    } else if (!profileReallyFailed) {
      noLinkedProfile = true;
    }
  }

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("newClaimTitle")}
        subtitle={t("newClaimSubtitle")}
        back="/hr/medical" backLabel={t("backToMedical")}
      />
      <DataSourceBadge source={resolvedSource} />
      <NewMedicalClaimForm employees={resolvedEmployees} noLinkedProfile={noLinkedProfile} />
    </div>
  );
}
