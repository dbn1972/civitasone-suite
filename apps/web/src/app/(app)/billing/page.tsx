import { ModuleHub } from "../../_components/ModuleHub";

export default function Page() {
  return (
    <ModuleHub
      title="Billing"
      description="Manage plans, subscriptions, invoices, and payments."
      links={[
        { href: "/billing/plans", label: "Plans", note: "Billing plans and pricing" },
        { href: "/billing/subscriptions", label: "Subscriptions", note: "Active subscriptions" },
        { href: "/billing/invoices", label: "Invoices", note: "Generated invoices" },
        { href: "/billing/payments", label: "Payments", note: "Payment records" },
      ]}
    />
  );
}
