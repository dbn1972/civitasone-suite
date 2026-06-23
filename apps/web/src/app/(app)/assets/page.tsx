import { ModuleHub } from "../../_components/ModuleHub";

export default function Page() {
  return (
    <ModuleHub
      title="Assets"
      description="Asset lifecycle, depreciation, maintenance and disposal."
      links={[
        { href: "/assets/dashboard", label: "Dashboard", note: "Overview and quick navigation" },
        { href: "/assets/list", label: "Asset Register", note: "All assets with status and valuation" },
        { href: "/assets/register", label: "Register Asset", note: "Manual capitalization" },
        { href: "/assets/depreciation", label: "Depreciation Run", note: "Multi-book period-end posting" },
        { href: "/assets/projects", label: "Projects & AUC", note: "Capitalize WIP to fixed assets" },
        { href: "/assets/leases", label: "IFRS 16 Leases", note: "ROU assets and liabilities" },
        { href: "/assets/locations", label: "Functional Locations", note: "PM hierarchy" },
        { href: "/assets/bulk-import", label: "Bulk Import", note: "Mass asset load" },
        { href: "/assets/scan", label: "Barcode Scan", note: "Mobile field verification" },
        { href: "/assets/verification", label: "Physical Verification", note: "Stock-take and reconciliation" },
        { href: "/assets/fixed-assets", label: "Fixed Assets", note: "Capitalized assets" },
        { href: "/assets/infra", label: "Infrastructure", note: "Roads, buildings and networks" },
        { href: "/assets/maintenance", label: "Maintenance", note: "AMC, preventive and corrective" },
      ]}
    />
  );
}
