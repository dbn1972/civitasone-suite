import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { PageHeader } from "../../../../_components/ds";
import { currentFinancialYear } from "@/lib/fiscalYear";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { hasAnyRole, TAX_PROOF_VIEWER_ROLES } from "@/lib/payroll/taxProofs";
import { TaxDeclarationForm } from "./TaxDeclarationForm";
import { TaxProofsPanel } from "./TaxProofsPanel";

// GAP-PAYROLL-TAX-DECLARATION-02: metadata is translated (it used to be a hard-coded English constant).
export async function generateMetadata() {
  const t = await getTranslations("taxDeclaration");
  return { title: t("title"), description: t("metaDescription") };
}

export default async function TaxDeclarationPage() {
  const t = await getTranslations("taxDeclaration");
  const tp = await getTranslations("taxProofs");
  const canVerify = hasAnyRole(getSessionRoles(), TAX_PROOF_VIEWER_ROLES);
  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll"
        backLabel={t("errorBackLabel")}
        actions={
          <>
            <Link href="/hr/payroll/income-tax">{t("viewIncomeTaxLink")}</Link>
            {canVerify && <Link href="/hr/payroll/tax-proofs" style={{ marginLeft: 12 }}>{tp("verifyLink")}</Link>}
          </>
        }
      />
      <TaxDeclarationForm />
      <TaxProofsPanel fy={currentFinancialYear()} />
    </div>
  );
}
