"use client";

import { PageHeader, StatCard, StatGrid, Card, DataTable, StatusPill } from "@/app/_components/ds";
import { Breadcrumb } from "../Breadcrumb";

type MfaUser = {
  id: string;
  name: string;
  email: string;
  department: string;
  mfaStatus: string;
  enrolledAt: string | null;
};

const users: MfaUser[] = [
  { id: "usr-001", name: "Rajesh Verma", email: "rajesh.verma@gov.in", department: "Finance", mfaStatus: "active", enrolledAt: "2024-11-01T10:00:00Z" },
  { id: "usr-002", name: "Priya Sharma", email: "priya.sharma@gov.in", department: "HR", mfaStatus: "active", enrolledAt: "2024-11-05T09:30:00Z" },
  { id: "usr-003", name: "Amit Patel", email: "amit.patel@gov.in", department: "IT", mfaStatus: "active", enrolledAt: "2024-10-20T14:00:00Z" },
  { id: "usr-004", name: "Neha Gupta", email: "neha.gupta@gov.in", department: "Procurement", mfaStatus: "pending", enrolledAt: null },
  { id: "usr-005", name: "Suresh Kumar", email: "suresh.kumar@gov.in", department: "Legal", mfaStatus: "pending", enrolledAt: null },
  { id: "usr-006", name: "Deepika Reddy", email: "deepika.reddy@gov.in", department: "Admin", mfaStatus: "inactive", enrolledAt: null },
  { id: "usr-007", name: "Vikram Singh", email: "vikram.singh@gov.in", department: "Finance", mfaStatus: "active", enrolledAt: "2024-12-10T11:00:00Z" },
  { id: "usr-008", name: "Anjali Desai", email: "anjali.desai@gov.in", department: "IT", mfaStatus: "active", enrolledAt: "2024-09-15T08:00:00Z" },
];

export default function MfaManagementPage() {
  const totalUsers = users.length;
  const enrolled = users.filter((u) => u.mfaStatus === "active").length;
  const pending = users.filter((u) => u.mfaStatus === "pending").length;
  const enrollmentPct = Math.round((enrolled / totalUsers) * 100);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "MFA Management" }]} />
      <PageHeader
        back="/tenant-admin"
        title="MFA Management"
        subtitle="Multi-factor authentication enrollment status and user-level MFA controls."
      />

      <StatGrid>
        <StatCard icon="👥" iconBg="#f1f5f9" label="Total Users" value={totalUsers} />
        <StatCard icon="🔐" iconBg="#ecfdf3" label="MFA Enrolled" value={enrolled} />
        <StatCard icon="📊" iconBg="#eff6ff" label="Enrollment %" value={`${enrollmentPct}%`} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending" value={pending} />
      </StatGrid>
      <Card title="User MFA Status">
        <DataTable<MfaUser & Record<string, unknown>>
          columns={[
            { key: "name", label: "Name" },
            { key: "email", label: "Email" },
            { key: "department", label: "Department" },
            { key: "mfaStatus", label: "MFA Status", render: (row) => <StatusPill status={row.mfaStatus as string} /> },
            { key: "enrolledAt", label: "Enrolled On", render: (row) => row.enrolledAt ? new Date(row.enrolledAt as string).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "—" },
          ]}
          rows={users as (MfaUser & Record<string, unknown>)[]}
        />
      </Card>
    </main>
  );
}
