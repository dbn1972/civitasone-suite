import { getTranslations } from "next-intl/server";
import { getSessionRoles, hasAnyRole, CRM_KYC_APPROVER_ROLES } from "@/lib/auth/roleGuard";
import { OnboardingDetail } from "./OnboardingDetail";

/** P1-9 — Customer onboarding case detail (stage + KYC actions). */
export default async function Page(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const t = await getTranslations("crmOnboardingDetailPage");
  // GAP-CRM-ONBOARDING-DETAIL-03: recording a KYC outcome of verified/rejected
  // is an approver action (crm-service KYC_APPROVER_ROLES). Resolve it on the
  // server from the session and pass it down so the client never offers an
  // outcome that is guaranteed to 403 — the server remains the authority.
  const canApproveKyc = hasAnyRole(getSessionRoles(), CRM_KYC_APPROVER_ROLES);
  // GAP-CRM-ONBOARDING-DETAIL-01: the page header is rendered by OnboardingDetail so the h1
  // can name the customer once the case loads; the server page supplies the translated
  // fallback title and back link.
  return (
    <OnboardingDetail
      id={params.id}
      canApproveKyc={canApproveKyc}
      header={{ title: t("title"), backHref: "/crm/onboarding", backLabel: t("backLabel") }}
    />
  );
}
