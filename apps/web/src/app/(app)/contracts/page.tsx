import { ModuleHub } from "../../_components/ModuleHub";

export default function Page() {
  return (
    <ModuleHub
      title="Contracts"
      description="Manage service, supply, and maintenance contracts."
      links={[
        { href: "/contracts/list", label: "Contracts", note: "View and manage all contracts" },
        { href: "/contracts/rate-contracts", label: "Rate Contracts", note: "Framework agreements with fixed rates" },
      ]}
    />
  );
}
