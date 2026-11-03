import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { PageHeader } from "../../../../_components/ds";
import { currentFinancialYear } from "@/lib/fiscalYear";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { hasAnyRole, TAX_PROOF_VIEWER_ROLES } from "@/lib/payroll/taxProofs";
import { isTaxDeclarationStaff, isSelfServiceEmployee } from "@/lib/payroll/taxDeclarationRoles";
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
  const roles = getSessionRoles();
  const canVerify = hasAnyRole(roles, TAX_PROOF_VIEWER_ROLES);
  // UAT b15 item 3: the roles decide the mode up front (staff file on behalf; only the employee role has own proofs),
  // instead of the loaders reading it from a 400 / 403 on every load. A staff member who also holds the employee
  // role keeps their own proofs (GET tax-proofs/mine needs only the employee role) -- PR #2450 review.
  const staff = isTaxDeclarationStaff(roles);
  const selfService = isSelfServiceEmployee(roles);
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
      <TaxDeclarationForm staff={staff} />
      <TaxProofsPanel fy={currentFinancialYear()} selfService={selfService} />
    </div>
  );
}
