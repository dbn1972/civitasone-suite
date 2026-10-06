"use client";

import Link from "next/link";
import { useSeededResource } from "@/lib/sync/resource";
import { DataTable } from "@/app/_components/ds";
import { formatIndianDate, humanizeStatus } from "@/lib/formatters";
import type { MyApprovalItem } from "@/app/_data/loaders";
import { isTaskOverdue } from "./overdue";

interface ApprovalsTableProps {
  initialData: MyApprovalItem[];
  source: "api" | "error";
}

// GAP-APPROVALS-HOME-05: module is derived from refType.split("_")[0]
// (loaders.ts), so the keys here are those prefixes. Extended to cover the
// prefixes that actually occur (works, crm, helpdesk, legal, grants, hr) and
// the dead "hrms" key removed — the known HR refType (leave_app) yields the
// prefix "leave", never "hrms". Anything not listed falls back to a humanised
// label (humanizeStatus) rather than the raw css-capitalised prefix.
const MODULE_LABELS: Record<string, string> = {
  leave: "Leave",
  payroll: "Payroll",
  procurement: "Procurement",
  finance: "Finance",
  estab: "Establishment",
  workflow: "Workflow",
  billing: "Billing",
  hr: "HR",
  asset: "Assets",
  project: "Projects",
  works: "Works",
  crm: "CRM",
  helpdesk: "Helpdesk",
  legal: "Legal",
  grants: "Grants",
};

function moduleLabel(module: string): string {
  return MODULE_LABELS[module] ?? humanizeStatus(module);
}

function formatDate(iso: string | null): string {
  return formatIndianDate(iso);
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
    moduleLabel: moduleLabel(item.module),
    assignedDisplay: formatRelativeDate(item.assignedAt),
    dueDateDisplay: item.dueDate ? formatDate(item.dueDate) : "—",
    isOverdue: isTaskOverdue(item.dueDate),
    // GAP-APPROVALS-HOME-07: raw sort keys so Assigned/Due sort by real time,
    // not by the display strings ("Today" / "3d ago" / "12 Sep 2026"), which
    // the generic comparator ordered alphabetically. null (missing) sorts
    // first, exactly as compareValues treats a null cell.
    assignedSort: item.assignedAt ? new Date(item.assignedAt).getTime() : null,
    dueSort: item.dueDate ? new Date(item.dueDate).getTime() : null,
  }));

  return (
    <>
      {fromCache && (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>
          {offline ? "You're offline." : ""} Showing cached data{cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}.
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
                }}
              >
                {row.moduleLabel as string}
              </span>
            ),
          },
          {
            key: "assignedSort",
            label: "Assigned",
            sortable: true,
            csv: (row: ApprovalRow) => row.assignedDisplay as string,
            render: (row: ApprovalRow) => <>{row.assignedDisplay as string}</>,
          },
          {
            key: "dueSort",
            label: "Due",
            sortable: true,
            csv: (row: ApprovalRow) => row.dueDateDisplay as string,
            render: (row: ApprovalRow) => (
              <span style={{ color: row.isOverdue ? "#ef4444" : "inherit", fontWeight: row.isOverdue ? 600 : 400 }}>
                {row.dueDateDisplay as string}
                {Boolean(row.isOverdue) && (
                  <>
                    {" "}
                    <span style={{ fontSize: 11, fontWeight: 600 }}>⚠️ Overdue</span>
                  </>
                )}
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
