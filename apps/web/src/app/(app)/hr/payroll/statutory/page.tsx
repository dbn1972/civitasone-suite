import { LinkTiles } from "../../../../_components/LinkTiles";
import { PageHeader } from "../../../../_components/ds";
import type { NavTile } from "@civitasone/types";

const tiles: NavTile[] = [
  { title: "PF & ECR", href: "/hr/payroll/statutory/pf", description: "EPF contributions ledger and EPFO ECR file generation" },
  { title: "ESI", href: "/hr/payroll/statutory/esi", description: "Employees' State Insurance contribution records" },
  { title: "Professional Tax", href: "/hr/payroll/statutory/pt", description: "State-wise professional tax slabs" },
  { title: "Labour Welfare Fund", href: "/hr/payroll/statutory/lwf", description: "State-wise LWF contribution configuration" },
  { title: "Gratuity", href: "/hr/payroll/statutory/gratuity", description: "Gratuity computation on separation" },
  { title: "Challans & Reconciliation", href: "/hr/payroll/statutory/challans", description: "TDS challan ingestion and deducted-vs-deposited reconciliation" },
  { title: "Perquisites & Form 12BA", href: "/hr/payroll/statutory/perquisite", description: "Itemised perquisite components (Sec 17(2)) and Form 12BA" },
  { title: "GPF", href: "/hr/payroll/gpf", description: "General Provident Fund statements" },
  { title: "NPS", href: "/hr/payroll/nps", description: "National Pension System contributions" },
];

export default function StatutoryHubPage() {
  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Statutory Consoles"
        subtitle="PF, ESI, professional tax, LWF, gratuity, TDS challans, and perquisite statutory registers."
        back="/hr/payroll"
      />
      <LinkTiles tiles={tiles} columns="three" />
    </main>
  );
}
