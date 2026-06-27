import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { BeneficiariesTable, type BeneficiaryRow } from "./BeneficiariesTable";

const rows: BeneficiaryRow[] = [
  { id: "BEN-001", name: "Ramesh Kumar Verma", project: "PM Awas Yojana - Lucknow", district: "Lucknow", category: "OBC", verified: "active", disbursement: "₹2.5 L" },
  { id: "BEN-002", name: "Sunita Devi", project: "Swachh Bharat Mission Phase-II", district: "Varanasi", category: "SC", verified: "active", disbursement: "₹1.2 L" },
  { id: "BEN-003", name: "Mohan Lal Sharma", project: "NH-44 Bypass Construction", district: "Jaipur", category: "General", verified: "rejected", disbursement: "₹0" },
  { id: "BEN-004", name: "Fatima Begum", project: "District Hospital Upgradation - Patna", district: "Patna", category: "OBC", verified: "active", disbursement: "₹3.1 L" },
  { id: "BEN-005", name: "Birsa Munda Oraon", project: "Tribal Welfare Housing Scheme", district: "Raipur", category: "ST", verified: "active", disbursement: "₹2.0 L" },
  { id: "BEN-006", name: "Anjali Tiwari", project: "Smart City Phase-II Varanasi", district: "Varanasi", category: "General", verified: "rejected", disbursement: "₹0" },
  { id: "BEN-007", name: "Dinesh Paswan", project: "PM Awas Yojana - Patna", district: "Patna", category: "SC", verified: "active", disbursement: "₹2.5 L" },
  { id: "BEN-008", name: "Kavita Meena", project: "Integrated Child Development - Bhopal", district: "Bhopal", category: "ST", verified: "pending", disbursement: "₹0" },
];

export default function BeneficiariesPage() {
  const total = rows.length;
  const active = rows.filter((r) => r.verified === "active").length;
  const pending = rows.filter((r) => r.verified === "pending").length;
  const notVerified = rows.filter((r) => r.verified === "rejected").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Beneficiaries" subtitle="Track project beneficiaries, verification status and disbursements." back="/projects" />
      <StatGrid>
        <StatCard icon="👥" iconBg="#eff6ff" label="Total Beneficiaries" value={total} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={active} />
        <StatCard icon="🔍" iconBg="#fffaeb" label="Verified" value={active} />
        <StatCard icon="⏳" iconBg="#fef3f2" label="Pending Verification" value={pending + notVerified} />
      </StatGrid>
      <Card title="Beneficiary Register">
        <BeneficiariesTable rows={rows} />
      </Card>
    </main>
  );
}
