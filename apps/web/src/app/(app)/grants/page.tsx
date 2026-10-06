import { ModuleHub } from "../../_components/ModuleHub";

/**
 * GAP-GRANTS-HOME-01 / HOME-03: tiles ordered by lifecycle (Schemes →
 * Applications → Grants → Installments → Releases → UC → Grantees →
 * Dashboard), one consistent en-IN spelling ("utilisation", per GFR usage),
 * and each tile label matches its destination page's H1 ("Grant Applications",
 * "Grants", "Utilisation Certificates", "Grants Dashboard").
 */
export default function Page() {
  return (
    <ModuleHub
      title="Grants"
      description="Grant lifecycle, disbursements, grantee management and utilisation certificates."
      help="grants"
      links={[
        { href: "/grants/schemes", label: "Schemes", note: "Browse grant schemes and create new ones" },
        { href: "/grants/applications", label: "Grant Applications", note: "All grant applications with approval status" },
        { href: "/grants/list", label: "Grants", note: "All sanctioned grants with disbursement tracking" },
        { href: "/grants/installments", label: "Installments", note: "Disbursement schedule" },
        { href: "/grants/releases", label: "Releases", note: "Fund releases with bank references" },
        { href: "/grants/utilization", label: "Utilisation Certificates", note: "Utilisation certificate tracking and verification" },
        { href: "/grants/grantees", label: "Grantees", note: "Grantee registry and UC compliance" },
        { href: "/grants/dashboard", label: "Grants Dashboard", note: "KPIs and fund utilisation overview" },
      ]}
    />
  );
}
