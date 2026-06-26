import { ModuleHub } from "../../_components/ModuleHub";

export default function Page() {
  return (
    <ModuleHub
      title="Grants"
      description="Grant lifecycle, disbursements, grantee management and utilisation certificates."
      links={[
        { href: "/grants/schemes", label: "Schemes", note: "Browse grant schemes and create new ones" },
        { href: "/grants/applications", label: "Applications", note: "All grant applications with approval status" },
        { href: "/grants/dashboard", label: "Dashboard", note: "Grants overview — KPIs and fund utilisation" },
        { href: "/grants/list", label: "Grants", note: "All grants with disbursement tracking" },
        { href: "/grants/grantees", label: "Grantees", note: "Grantee registry and UC compliance" },
        { href: "/grants/releases", label: "Releases", note: "Fund releases with bank references" },
        { href: "/grants/installments", label: "Installments", note: "Disbursement schedule" },
        { href: "/grants/utilization", label: "UC Management", note: "Utilisation certificate tracking" },
      ]}
    />
  );
}
