import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { SchemeProjectsTable, type SchemeProjectRow } from "./SchemeProjectsTable";
import Link from "next/link";

type SchemeDetail = {
  id: string;
  name: string;
  code: string;
  department: string;
  startDate: string;
  endDate: string;
  nodalOfficer: string;
  fundingPattern: string;
  totalProjects: number;
  budget: string;
  utilizedPct: string;
  beneficiaries: number;
  projects: SchemeProjectRow[];
};

const SCHEMES: Record<string, SchemeDetail> = {
  "pm-awas-yojana": {
    id: "pm-awas-yojana",
    name: "PM Awas Yojana (Urban)",
    code: "PMAY-U/2024/001",
    department: "Ministry of Housing & Urban Affairs",
    startDate: "2015-06-25",
    endDate: "2025-03-31",
    nodalOfficer: "Shri R.K. Gautam, IAS",
    fundingPattern: "Centre 60% : State 40%",
    totalProjects: 12,
    budget: "₹2,450 Cr",
    utilizedPct: "72%",
    beneficiaries: 45200,
    projects: [
      { name: "PM Awas Yojana - Lucknow", district: "Lucknow", status: "active", budget: "₹312 Cr" },
      { name: "PM Awas Yojana - Patna", district: "Patna", status: "active", budget: "₹285 Cr" },
      { name: "PM Awas Yojana - Varanasi", district: "Varanasi", status: "review", budget: "₹198 Cr" },
      { name: "PM Awas Yojana - Jaipur", district: "Jaipur", status: "completed", budget: "₹420 Cr" },
      { name: "PM Awas Yojana - Bhopal", district: "Bhopal", status: "active", budget: "₹275 Cr" },
    ],
  },
  "smart-city-mission": {
    id: "smart-city-mission",
    name: "Smart City Mission",
    code: "SCM/2024/002",
    department: "Ministry of Housing & Urban Affairs",
    startDate: "2015-06-25",
    endDate: "2026-03-31",
    nodalOfficer: "Smt. Priya Sharma, IAS",
    fundingPattern: "Centre 50% : State 25% : ULB 25%",
    totalProjects: 8,
    budget: "₹3,800 Cr",
    utilizedPct: "68%",
    beneficiaries: 120000,
    projects: [
      { name: "Smart City Phase-II Varanasi", district: "Varanasi", status: "active", budget: "₹512 Cr" },
      { name: "Smart City Command Centre - Lucknow", district: "Lucknow", status: "completed", budget: "₹85 Cr" },
      { name: "Smart Roads & Lighting - Jaipur", district: "Jaipur", status: "active", budget: "₹340 Cr" },
      { name: "Integrated Traffic Mgmt - Bhopal", district: "Bhopal", status: "review", budget: "₹210 Cr" },
    ],
  },
};

const DEFAULT_SCHEME: SchemeDetail = {
  id: "default",
  name: "National Highway Development",
  code: "NHDP/2024/003",
  department: "Ministry of Road Transport & Highways",
  startDate: "2022-04-01",
  endDate: "2027-03-31",
  nodalOfficer: "Shri V.K. Singh, IAS",
  fundingPattern: "Centre 90% : State 10%",
  totalProjects: 6,
  budget: "₹4,200 Cr",
  utilizedPct: "58%",
  beneficiaries: 85000,
  projects: [
    { name: "NH-44 Bypass Construction", district: "Jaipur", status: "review", budget: "₹345 Cr" },
    { name: "State Highway Widening - Bhopal", district: "Bhopal", status: "active", budget: "₹178 Cr" },
    { name: "NH-30 Bridge Reconstruction", district: "Dehradun", status: "active", budget: "₹420 Cr" },
    { name: "Ring Road Extension - Raipur", district: "Raipur", status: "overdue", budget: "₹290 Cr" },
  ],
};

export default async function SchemeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scheme = SCHEMES[id] ?? DEFAULT_SCHEME;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" style={{ fontSize: 13, marginBottom: 4 }}>
        <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", gap: 6 }}>
          <li><Link href="/projects">Projects</Link></li>
          <li aria-hidden="true">›</li>
          <li><Link href="/projects/schemes">Schemes</Link></li>
          <li aria-hidden="true">›</li>
          <li aria-current="page" style={{ color: "var(--muted)" }}>{scheme.name}</li>
        </ol>
      </nav>
      <PageHeader title={scheme.name} subtitle={`Scheme code: ${scheme.code}`} back="/projects/schemes" backLabel="Back to Schemes" />

      <StatGrid>
        <StatCard icon="📋" iconBg="#eff6ff" label="Total Projects" value={scheme.totalProjects} />
        <StatCard icon="💰" iconBg="#ecfdf3" label="Budget" value={scheme.budget} />
        <StatCard icon="📈" iconBg="#fffaeb" label="Utilized %" value={scheme.utilizedPct} />
        <StatCard icon="👥" iconBg="#f1f5f9" label="Beneficiaries" value={scheme.beneficiaries.toLocaleString("en-IN")} />
      </StatGrid>

      <Card title="Scheme Details" padding>
        <dl style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: "10px 16px", fontSize: 14, margin: 0 }}>
          <dt style={{ fontWeight: 500, color: "var(--muted)" }}>Scheme Code</dt>
          <dd style={{ margin: 0 }}>{scheme.code}</dd>
          <dt style={{ fontWeight: 500, color: "var(--muted)" }}>Department</dt>
          <dd style={{ margin: 0 }}>{scheme.department}</dd>
          <dt style={{ fontWeight: 500, color: "var(--muted)" }}>Start Date</dt>
          <dd style={{ margin: 0 }}>{scheme.startDate}</dd>
          <dt style={{ fontWeight: 500, color: "var(--muted)" }}>End Date</dt>
          <dd style={{ margin: 0 }}>{scheme.endDate}</dd>
          <dt style={{ fontWeight: 500, color: "var(--muted)" }}>Nodal Officer</dt>
          <dd style={{ margin: 0 }}>{scheme.nodalOfficer}</dd>
          <dt style={{ fontWeight: 500, color: "var(--muted)" }}>Funding Pattern</dt>
          <dd style={{ margin: 0 }}>{scheme.fundingPattern}</dd>
        </dl>
      </Card>

      <Card title="Linked Projects">
        <SchemeProjectsTable rows={scheme.projects} />
      </Card>
    </main>
  );
}
