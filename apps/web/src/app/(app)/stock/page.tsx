import { ModuleHub } from "../../_components/ModuleHub";

export default function Page() {
  return (
    <ModuleHub
      title="Stock"
      description="Stock-keeping units, GRN tracking, stock ledger and inventory valuation."
      links={[
        { href: "/stock/dashboard", label: "Dashboard", note: "Overview with low-stock alerts" },
        { href: "/stock/list", label: "Stock List", note: "All items with levels and valuation" },
        { href: "/stock/ledger", label: "Stock Ledger", note: "Receipt, issue and adjustment log" },
      ]}
    />
  );
}
