import { ModuleHub } from "../../_components/ModuleHub";

export default function Page() {
  return (
    <ModuleHub
      title="Contracts"
      description="Module workspace — API-backed list views."
      links={[{ href: "/contracts/list", label: "Contracts", note: "Live data from backend API" }]}
    />
  );
}
