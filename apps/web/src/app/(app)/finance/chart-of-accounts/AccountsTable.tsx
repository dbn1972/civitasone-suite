"use client";

import { useState } from "react";
import type { AccountSummary } from "@civitasone/types";
import { Card, DataTable, Segmented, StatusPill, EmptyState } from "../../../_components/ds";
import { useSeededResource } from "@/lib/sync/resource";

interface AccountsTableProps {
  accounts: AccountSummary[];
  source?: "api" | "error";
}

type TypeFilter = "all" | "asset" | "liability" | "equity" | "income" | "expense";
type StatusFilter = "all" | "active" | "inactive";

type AccountRow = AccountSummary & Record<string, unknown>;

export function AccountsTable({ accounts, source = "api" }: AccountsTableProps) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<AccountSummary[]>(
    "finance.chartOfAccounts",
    accounts,
    source,
    (d) => d.length === 0,
  );

  const q = search.trim().toLowerCase();

  const filtered = rows.filter((a) => {
    const matchesSearch =
      q === "" ||
      a.name.toLowerCase().includes(q) ||
      a.code.toLowerCase().includes(q);
    const matchesType = typeFilter === "all" || a.type === typeFilter;
    const matchesStatus = statusFilter === "all" || a.status === statusFilter;
    return matchesSearch && matchesType && matchesStatus;
  }) as AccountRow[];

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  const SEG_OPTIONS = ["All", "Asset", "Liability", "Income", "Expense"] as const;
  const segValue = typeFilter === "all" ? "All" : typeFilter.charAt(0).toUpperCase() + typeFilter.slice(1);

  function handleSegChange(v: string) {
    setTypeFilter(v === "All" ? "all" : (v.toLowerCase() as TypeFilter));
  }

  return (
    <Card
      title="Chart of Accounts · List of Major & Minor Heads (LMMHA)"
      link={
        <Segmented
          options={[...SEG_OPTIONS]}
          value={segValue}
          onChange={handleSegChange}
        />
      }
    >
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0", padding: "8px 16px 0" }}>
          {cacheNote}
        </p>
      ) : null}
      {/* Search and filter bar */}
      <div
        style={{
          display: "flex",
          gap: "0.75rem",
          padding: "0.75rem 1rem",
          borderBottom: "1px solid var(--border)",
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <label htmlFor="accounts-search" className="sr-only">Search by name or code</label>
        <input
          id="accounts-search"
          type="search"
          placeholder="Search by name or code…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: "1 1 220px",
            minWidth: "180px",
            padding: "0.375rem 0.625rem",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            fontSize: "0.875rem",
            background: "var(--bg)",
            color: "var(--fg)",
            outline: "none",
          }}
        />
        <label htmlFor="accounts-status" className="sr-only">Filter by status</label>
        <select
          id="accounts-status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          style={{
            padding: "0.375rem 0.625rem",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            fontSize: "0.875rem",
            background: "var(--bg)",
            color: "var(--fg)",
            cursor: "pointer",
          }}
        >
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        {(q !== "" || typeFilter !== "all" || statusFilter !== "all") && (
          <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
            {filtered.length} of {rows.length} accounts
          </span>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon="🔍"
          title="No accounts match"
          message="Try adjusting your search or filters."
        />
      ) : (
        <DataTable<AccountRow>
          columns={[
            { key: "code", label: "Code", render: (a) => <span className="mono">{a.code}</span> },
            { key: "name", label: "Name" },
            { key: "type", label: "Type", render: (a) => <span style={{ textTransform: "capitalize" }}>{a.type as string}</span> },
            { key: "currency", label: "Currency" },
            { key: "balanceDisplay", label: "Balance", align: "right", render: (a) => <>₹{a.balanceDisplay}</> },
            { key: "status", label: "Status", render: (a) => <StatusPill status={a.status as string} /> },
          ]}
          rows={filtered}
        />
      )}
    </Card>
  );
}
