import { ModuleHub } from "../../_components/ModuleHub";

export default function Page() {
  return (
    <ModuleHub
      title="Stock"
      description="Stock-keeping units, stock ledger and inventory valuation."
      help="stock"
      links={[
        { href: "/stock/dashboard", label: "Dashboard", note: "Overview of SKUs, value and low-stock count" },
        { href: "/stock/list", label: "Stock List", note: "All items with levels and valuation" },
        { href: "/stock/ledger", label: "Stock Ledger", note: "Receipt, issue and adjustment log" },
        { href: "/stock/items/new", label: "New Item", note: "Create a stock-keeping unit (SKU)" },
        { href: "/stock/ledger/new", label: "New Stock Entry", note: "Record a receipt, issue or adjustment" },
        { href: "/procurement/grn", label: "Goods Receipts", note: "Goods receipt notes are recorded in Procurement" },
      ]}
    />
  );
}
