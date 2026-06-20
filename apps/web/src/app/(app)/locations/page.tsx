import { ModuleHub } from "../../_components/ModuleHub";

export default function Page() {
  return (
    <ModuleHub
      title="Locations"
      description="Module workspace — API-backed list views."
      links={[{ href: "/locations/list", label: "Locations", note: "Live data from backend API" }]}
    />
  );
}
