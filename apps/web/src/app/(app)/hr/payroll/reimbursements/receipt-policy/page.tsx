import { PageHeader, Card } from "../../../../../_components/ds";
import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { PermissionDenied } from "../../../../../_components/PermissionDenied";
import { fetchJson } from "@/app/_data/apiClient";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PAYROLL_CONFIG_ROLES } from "@/lib/auth/workRoles";
import { receiptPolicyFromApi } from "@/lib/payroll/receiptRules";
import { getTranslations } from "next-intl/server";
import { ReceiptPolicyForm } from "./ReceiptPolicyForm";

type Loaded = { policy: ReturnType<typeof receiptPolicyFromApi>; isDefault: boolean };

async function getPolicy() {
  return fetchJson<unknown, Loaded | null>("/api/v1/payroll/reimbursement-receipt-policy", null, {
    telemetryKey: "payroll.reimbursementReceiptPolicy.settings",
    mapResponse: (p) => {
      const policy = receiptPolicyFromApi(p);
      return policy ? { policy, isDefault: (p as { isDefault?: boolean }).isDefault === true } : null;
    },
  });
}

/** Receipt rules for reimbursement claims: payroll admin / super admin only (the API enforces the same). */
export default async function ReceiptPolicyPage() {
  const t = await getTranslations("receiptPolicy");
  const header = (
    <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr/payroll/reimbursements" backLabel={t("backLabel")} />
  );
  if (!getSessionRoles().some((r) => PAYROLL_CONFIG_ROLES.includes(r))) {
    return (
      <div className="page-main wrap">
        {header}
        <PermissionDenied module="receipt-policy" requiredRoles={PAYROLL_CONFIG_ROLES} backHref="/hr/payroll/reimbursements" backLabel={t("backLabel")} />
      </div>
    );
  }
  const { data, source } = await getPolicy();
  return (
    <div className="page-main wrap">
      {header}
      <DataSourceBadge source={source} message={t("loadErrorMessage")} />
      {data ? (
        <Card title={t("cardTitle")} padding>
          <ReceiptPolicyForm policy={data.policy} isDefault={data.isDefault} />
        </Card>
      ) : (
        <Card title={t("cardTitle")} padding>
          <p role="alert" className="pill bad" style={{ width: "fit-content" }}>{t("loadErrorMessage")}</p>
        </Card>
      )}
    </div>
  );
}
