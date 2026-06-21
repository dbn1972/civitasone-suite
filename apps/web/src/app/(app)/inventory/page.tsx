import { ModuleHub } from "../../_components/ModuleHub";

export default function Page() {
  return (
    <ModuleHub
      title="Inventory"
      description="Physical stock tracking, movement ledger and reconciliation."
      links={[
        { href: "/inventory/list", label: "Stock Items", note: "All SKUs and current stock levels" },
        { href: "/inventory/reconcile", label: "Reconciliation", note: "Verify ledger vs. physical stock movements" },
      ]}
    />
  );
}
