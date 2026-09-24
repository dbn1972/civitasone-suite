import { getTranslations } from "next-intl/server";
import { PageHeader, RefreshErrorState } from "../../../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { CreatePensionerForm } from "./CreatePensionerForm";

export default async function NewPensionerPage() {
  try {
    const t = await getTranslations("pensionersNew");
    return (
      <main className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader
          title={t("title")}
          subtitle={t("subtitle")}
          back="/hr/payroll/pensioners" backLabel="Back to Pensioners"
        />
        <CreatePensionerForm />
      </main>
    );
  } catch {
    return (
      <main className="page-main wrap">
        <RefreshErrorState error={toHumanError("load", { area: "new pensioner" })} backHref="/hr/payroll/pensioners" />
      </main>
    );
  }
}
