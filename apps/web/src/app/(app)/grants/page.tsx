import { ModuleHub } from "../../_components/ModuleHub";
import {
  GRANTS_APPLICATION_READ_ROLES,
  GRANTS_DASHBOARD_ROLES,
  GRANTS_DISBURSEMENT_READ_ROLES,
  GRANTS_GRANTEE_READ_ROLES,
  GRANTS_SCHEME_READ_ROLES,
} from "./roles";

/**
 * GAP-GRANTS-HOME-01 / HOME-03: tiles ordered by lifecycle (Grant Schemes →
 * Grant Applications → Grants → Grant Installments → Grant Releases → UC →
 * Grantees → Grants Dashboard), one consistent en-IN spelling ("utilisation",
 * per GFR usage), and each tile label matches its destination page's H1.
 * Each tile carries the roles grant-service admits on the destination's primary
 * read endpoint, so a role is never offered a tile that opens onto a 403.
 */
export default function Page() {
  return (
    <ModuleHub
      title="Grants"
      description="Grant lifecycle, disbursements, grantee management and utilisation certificates."
      help="grants"
      links={[
        { href: "/grants/schemes", label: "Grant Schemes", note: "Browse grant schemes and create new ones", roles: GRANTS_SCHEME_READ_ROLES },
        { href: "/grants/applications", label: "Grant Applications", note: "All grant applications with approval status", roles: GRANTS_APPLICATION_READ_ROLES },
        { href: "/grants/list", label: "Grants", note: "All sanctioned grants with disbursement tracking", roles: GRANTS_APPLICATION_READ_ROLES },
        { href: "/grants/installments", label: "Grant Installments", note: "Disbursement schedule", roles: GRANTS_DISBURSEMENT_READ_ROLES },
        { href: "/grants/releases", label: "Grant Releases", note: "Fund releases with bank references", roles: GRANTS_DISBURSEMENT_READ_ROLES },
        { href: "/grants/utilization", label: "Utilisation Certificates", note: "Utilisation certificate tracking and verification", roles: GRANTS_DISBURSEMENT_READ_ROLES },
        { href: "/grants/grantees", label: "Grantees", note: "Grantee registry and UC compliance", roles: GRANTS_GRANTEE_READ_ROLES },
        { href: "/grants/dashboard", label: "Grants Dashboard", note: "KPIs and fund utilisation overview", roles: GRANTS_DASHBOARD_ROLES },
      ]}
    />
  );
}
