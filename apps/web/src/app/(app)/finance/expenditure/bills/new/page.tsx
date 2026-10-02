import { getTranslations } from "next-intl/server";
import { PageHeader, LoadErrorState } from "@/app/_components/ds";
import { getFinanceVendors, getFinanceDdos, getFinanceBillHeads } from "@/app/_data/loaders";
import { BillForm } from "./BillForm";

export default async function NewBillPage() {
  const t = await getTranslations("financeBillForm");
  const [vendors, heads, ddos] = await Promise.all([getFinanceVendors(), getFinanceBillHeads(), getFinanceDdos()]);
  // The form cannot be completed without these pick-lists; a failed load must
  // say so rather than render empty dropdowns.
  const failed = [vendors, heads, ddos].find((r) => r.source === "error" && r.data.length === 0);
  // A deactivated vendor must not be offered (the server also rejects it, 409).
  const activeVendors = vendors.data.filter((v) => String(v.status).toLowerCase() !== "inactive");
  return (
    <>
      <PageHeader title={t("pageTitle")} subtitle={t("pageSubtitle")} back="/finance/expenditure/bills" backLabel={t("backLabel")} />
      {failed ? (
        <LoadErrorState result={failed} area={t("loadFailedArea")} backHref="/finance/expenditure/bills" />
      ) : (
        <BillForm
          vendors={activeVendors.map((v) => ({ id: v.id, label: v.name }))}
          heads={heads.data.map((h) => ({ id: h.id, label: `${h.code} — ${h.name}` }))}
          ddos={ddos.data.map((d) => ({ id: d.ddoCode, label: `${d.ddoCode} — ${d.name}` }))}
        />
      )}
    </>
  );
}
