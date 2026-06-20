import { ModuleHub } from "../../_components/ModuleHub";

export default function Page() {
  return (
    <ModuleHub
      title="Legal"
      description="Case management, hearings, court orders, and legal opinions."
      links={[
        { href: "/legal/dashboard", label: "Dashboard", note: "Active cases, hearings this week, orders pending" },
        { href: "/legal/list", label: "Cases List", note: "All cases across courts, tribunals, arbitration" },
        { href: "/legal/hearings", label: "Hearings", note: "Upcoming and past court hearings" },
        { href: "/legal/court-orders", label: "Court Orders", note: "Compliance-tracked court orders" },
        { href: "/legal/opinions", label: "Legal Opinions", note: "In-house and external legal opinions" },
      ]}
    />
  );
}
