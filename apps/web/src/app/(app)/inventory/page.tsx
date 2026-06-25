import { ModuleHub } from "../../_components/ModuleHub";

export default function Page() {
  return (
    <ModuleHub
      title="Inventory"
      description="Government store management: item master, goods receipts, issues, transfers, stock-take and reorder alerts."
      links={[
        { href: "/inventory/items", label: "Item Master", note: "Catalogued items, categories, units and reorder policy" },
        { href: "/inventory/receipts", label: "Goods Receipts", note: "Stock received into stores (GRN-in)" },
        { href: "/inventory/issues", label: "Stock Issues", note: "Stock issued / consumed against indents" },
        { href: "/inventory/low-stock", label: "Low Stock & Reorder", note: "Items at/below reorder level with suggested reorder" },
        { href: "/inventory/list", label: "Stock Items", note: "All SKUs and current stock levels" },
        { href: "/inventory/reconcile", label: "Reconciliation", note: "Verify ledger vs. physical stock movements" },
      ]}
    />
  );
}
