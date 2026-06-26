"use client";

import { DataTable } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import type { ReactNode } from "react";

type ComplianceRow = {
  id: string;
  lawOrRule: string;
  section?: string;
  requirement: string;
  dueDate: string;
  department?: string;
  status: string;
} & Record<string, unknown>;

function StatusCell({ status }: { status: string }): ReactNode {
  if (status === "complied") return <span className="pill good">Compliant</span>;
  if (status === "overdue") return <span className="pill bad">Overdue</span>;
  if (status === "pending") return <span className="pill warn">In progress</span>;
  return <span className="pill mut">Planned</span>;
}

interface ComplianceTableProps {
  items: ComplianceRow[];
  variant: "dpdp" | "cert";
}

export function ComplianceTable({ items, variant }: ComplianceTableProps) {
  if (variant === "dpdp") {
    return (
      <DataTable<ComplianceRow>
        columns={[
          {
            key: "lawOrRule",
            label: "Law / Rule",
            render: (item) => (
              <>{item.lawOrRule as string}{item.section ? ` §${item.section as string}` : ""}</>
            ),
          },
          { key: "requirement", label: "Requirement" },
          {
            key: "dueDate",
            label: "Due",
            render: (item) => formatIndianDate(item.dueDate as string),
          },
          {
            key: "status",
            label: "Status",
            render: (item) => <StatusCell status={item.status as string} />,
          },
        ]}
        rows={items}
      />
    );
  }

  return (
    <DataTable<ComplianceRow>
      columns={[
        { key: "lawOrRule", label: "Law / Rule" },
        { key: "requirement", label: "Requirement" },
        {
          key: "department",
          label: "Dept",
          render: (item) => (item.department as string | undefined) ?? "—",
        },
        {
          key: "status",
          label: "Status",
          render: (item) => <StatusCell status={item.status as string} />,
        },
      ]}
      rows={items}
    />
  );
}
