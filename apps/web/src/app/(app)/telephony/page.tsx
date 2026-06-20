import { ModuleHub } from "../../_components/ModuleHub";

export default function Page() {
  return (
    <ModuleHub
      title="Telephony"
      description="Module workspace — API-backed list views."
      links={[{ href: "/telephony/list", label: "Call Log", note: "Live data from backend API" }]}
    />
  );
}
