import { ModuleHub } from "../../_components/ModuleHub";

export default function Page() {
  return (
    <ModuleHub
      title="Assets"
      description="Asset lifecycle, depreciation, maintenance and disposal."
      links={[
        { href: "/assets/dashboard", label: "Dashboard", note: "Overview and quick navigation" },
        { href: "/assets/list", label: "Asset Register", note: "All assets with status and valuation" },
        { href: "/assets/fixed-assets", label: "Fixed Assets", note: "Capitalized assets" },
        { href: "/assets/infra", label: "Infrastructure", note: "Roads, buildings and networks" },
        { href: "/assets/maintenance", label: "Maintenance", note: "AMC, preventive and corrective" },
      ]}
    />
  );
}
