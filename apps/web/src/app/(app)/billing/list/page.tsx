import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getBillingPlans } from "../../../_data/loaders";

export default async function Page() {
  const { data, source } = await getBillingPlans();
  return (
    <ModuleListPage
      title="Billing — Plans"
      description="Read-only list loaded from the Billing service API."
      rows={data}
      source={source}
    />
  );
}
