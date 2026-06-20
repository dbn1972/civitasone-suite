import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getTelephonyCalls } from "../../../_data/loaders";

export default async function Page() {
  const { data, source } = await getTelephonyCalls();
  return (
    <ModuleListPage
      title="Telephony — Call"
      description="Read-only list loaded from the Telephony service API."
      rows={data}
      source={source}
    />
  );
}
