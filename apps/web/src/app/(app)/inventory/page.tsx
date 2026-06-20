import { ModuleHub } from "../../_components/ModuleHub";

export default function Page() {
  return (
    <ModuleHub
      title="Inventory"
      description="Module workspace — API-backed list views."
      links={[{ href: "/inventory/list", label: "Items", note: "Live data from backend API" }]}
    />
  );
}
