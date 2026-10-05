import { getTranslations } from "next-intl/server";
import { PageHeader } from "../../../../_components/ds";
import { getSessionRoles, hasAnyRole, CRM_KYC_APPROVER_ROLES } from "@/lib/auth/roleGuard";
import { OnboardingDetail } from "./OnboardingDetail";

/** P1-9 — Customer onboarding case detail (stage + KYC actions). */
export default async function Page({ params }: { params: { id: string } }) {
  const t = await getTranslations("crmOnboardingDetailPage");
  // GAP-CRM-ONBOARDING-DETAIL-03: recording a KYC outcome of verified/rejected
  // is an approver action (crm-service KYC_APPROVER_ROLES). Resolve it on the
  // server from the session and pass it down so the client never offers an
  // outcome that is guaranteed to 403 — the server remains the authority.
  const canApproveKyc = hasAnyRole(getSessionRoles(), CRM_KYC_APPROVER_ROLES);
  return (
    <>
      <PageHeader title={t("title")} back="/crm/onboarding" backLabel={t("backLabel")} />
      <OnboardingDetail id={params.id} canApproveKyc={canApproveKyc} />
    </>
  );
}
