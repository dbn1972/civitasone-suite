"use client";

import Link from "next/link";
import { useSeededResource } from "@/lib/sync/resource";
import { DataTable } from "@/app/_components/ds";
import type { MyApprovalItem } from "@/app/_data/loaders";

interface ApprovalsTableProps {
  initialData: MyApprovalItem[];
  source: "api" | "error";
}

const MODULE_LABELS: Record<string, string> = {
  leave: "Leave",
  payroll: "Payroll",
  procurement: "Procurement",
  finance: "Finance",
  estab: "Establishment",
  workflow: "Workflow",
  billing: "Billing",
  hrms: "HR",
  asset: "Assets",
  project: "Projects",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

function formatRelativeDate(iso: string): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return formatDate(iso);
}

type ApprovalRow = MyApprovalItem & Record<string, unknown>;

export function ApprovalsTable({ initialData, source }: ApprovalsTableProps) {
  const { data, fromCache, offline, cachedAt } = useSeededResource<MyApprovalItem[]>(
    "my-approvals",
    initialData,
    source === "error" ? "error" : "api",
    (d) => d.length === 0,
  );

  const rows: ApprovalRow[] = data.map((item) => ({
    ...item,
    moduleLabel: MODULE_LABELS[item.module] ?? item.module,
    assignedDisplay: formatRelativeDate(item.assignedAt),
    dueDateDisplay: item.dueDate ? formatDate(item.dueDate) : "—",
    isOverdue: item.dueDate ? new Date(item.dueDate).getTime() < Date.now() : false,
  }));

  return (
    <>
      {fromCache && (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>
          {offline ? "You're offline." : ""} Showing cached data{cachedAt ? ` from ${new Date(cachedAt).toLocaleString()}` : ""}.
        </p>
      )}
      <DataTable<ApprovalRow>
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Filter by name, module, status…"
        pageSize={15}
        exportable
        exportFilename="my-approvals"
        rowLinkKey="link"
        columns={[
          {
            key: "instanceName",
            label: "Task",
            sortable: true,
            render: (row: ApprovalRow) => (
              <Link href={row.link} style={{ color: "var(--primary, #4f46e5)", textDecoration: "none", fontWeight: 500 }}>
                {row.instanceName}
              </Link>
            ),
          },
          {
            key: "moduleLabel",
            label: "Module",
            sortable: true,
            render: (row: ApprovalRow) => (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  background: "var(--badge-bg, #e2e8f0)",
                  color: "var(--badge-text, #475569)",
                  borderRadius: 4,
                  padding: "2px 6px",
                  textTransform: "capitalize",
                }}
              >
                {row.moduleLabel as string}
              </span>
            ),
          },
          {
            key: "assignedDisplay",
            label: "Assigned",
            sortable: true,
          },
          {
            key: "dueDateDisplay",
            label: "Due",
            sortable: true,
            render: (row: ApprovalRow) => (
              <span style={{ color: row.isOverdue ? "#ef4444" : "inherit", fontWeight: row.isOverdue ? 600 : 400 }}>
                {row.dueDateDisplay as string}
                {row.isOverdue && " ⚠️"}
              </span>
            ),
          },
          {
            key: "status",
            label: "Status",
            cellType: "status" as const,
            sortable: true,
          },
        ]}
        emptyIcon="✅"
        emptyTitle="No pending approvals"
        emptyMessage="You're all caught up."
      />
    </>
  );
}
