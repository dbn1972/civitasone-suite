import { ModuleHub } from "../../_components/ModuleHub";

export default function Page() {
  return (
    <ModuleHub
      title="Billing"
      description="Module workspace — API-backed list views."
      links={[{ href: "/billing/list", label: "Plans", note: "Live data from backend API" }]}
    />
  );
}
