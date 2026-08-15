import { LinkTiles } from "../../../../_components/LinkTiles";
import { PageHeader, Card } from "../../../../_components/ds";
import type { NavTile } from "@civitasone/types";
import { StatutoryComplianceCard } from "./StatutoryComplianceCard";

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

// GoI statutory rates — updated per latest FinMin / EPFO / ESIC circulars (Aug 2026)
// Status is placeholder; a real implementation would query challan filings API.
// Wage ceilings in paise (minor units): EPF wage ceil = ₹15,000 = 1,500,000 minor
const STATUTORY_CARDS = [
  {
    label: "PF (EPF)",
    icon: "🏦",
    empPct: 12,
    erPct: 12,
    wageCeilingMonthly: 1_500_000, // ₹15,000/mo (EPFO ceiling)
    challanDueDay: 15,
    complianceStatus: "filed" as const,
    href: "/hr/payroll/statutory/pf",
  },
  {
    label: "ESI",
    icon: "🩺",
    empPct: 0.75,
    erPct: 3.25,
    wageCeilingMonthly: 2_100_000, // ₹21,000/mo (ESIC ceiling)
    challanDueDay: 15,
    complianceStatus: "pending" as const,
    href: "/hr/payroll/statutory/esi",
  },
  {
    label: "Professional Tax",
    icon: "📋",
    empPct: 2.5,
    erPct: 0,
    wageCeilingMonthly: undefined, // State-specific
    challanDueDay: 15,
    complianceStatus: "filed" as const,
    href: "/hr/payroll/statutory/pt",
  },
  {
    label: "Labour Welfare Fund",
    icon: "🤝",
    empPct: 0.5,
    erPct: 1,
    wageCeilingMonthly: undefined, // State-specific
    challanDueDay: 15,
    complianceStatus: "filed" as const,
    href: "/hr/payroll/statutory/lwf",
  },
  {
    label: "NPS",
    icon: "🏛️",
    empPct: 10,
    erPct: 14,
    wageCeilingMonthly: undefined, // No ceiling
    challanDueDay: 15,
    complianceStatus: "filed" as const,
    href: "/hr/payroll/nps",
  },
  {
    label: "GPF",
    icon: "📒",
    empPct: 10,
    erPct: 0,
    wageCeilingMonthly: undefined, // No ceiling
    challanDueDay: 15,
    complianceStatus: "pending" as const,
    href: "/hr/payroll/gpf",
  },
];

export default function StatutoryHubPage() {
  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Statutory Consoles"
        subtitle="PF, ESI, professional tax, LWF, gratuity, TDS challans, and perquisite statutory registers."
        back="/hr/payroll"
      />

      <Card title="Statutory Compliance Summary">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 14,
          }}
        >
          {STATUTORY_CARDS.map((card) => (
            <StatutoryComplianceCard key={card.label} {...card} />
          ))}
        </div>
      </Card>

      <div style={{ marginTop: 24 }}>
        <h2
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: "var(--fg)",
            marginBottom: 12,
          }}
        >
          All Statutory Modules
        </h2>
        <LinkTiles tiles={tiles} columns="three" />
      </div>
    </main>
  );
}
