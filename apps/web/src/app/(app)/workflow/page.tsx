import { ModuleHub } from "../../_components/ModuleHub";

export default function Page() {
  return (
    <ModuleHub
      title="Workflow & BPM"
      description="Process instances and tasks — API-backed list views."
      links={[{ href: "/workflow/list", label: "Instances", note: "Live data from Workflow service API" }]}
    />
  );
}
