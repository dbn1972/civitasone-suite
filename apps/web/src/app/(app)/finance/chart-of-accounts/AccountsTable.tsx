"use client";

import { useState } from "react";
import type { AccountSummary } from "@civitasone/types";
import { Card, StatusPill, EmptyState } from "../../../_components/ds";
import { useSeededResource } from "@/lib/sync/resource";

interface AccountsTableProps {
  accounts: AccountSummary[];
  source?: "api" | "error";
}

type TypeFilter = "all" | "asset" | "liability" | "equity" | "income" | "expense";
type StatusFilter = "all" | "active" | "inactive";

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
  });

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <Card
      title="Chart of Accounts · List of Major & Minor Heads (LMMHA)"
      link={
        <div className="seg">
          <span
            className={typeFilter === "all" ? "on" : ""}
            onClick={() => setTypeFilter("all")}
            style={{ cursor: "pointer" }}
          >
            All
          </span>
          <span
            className={typeFilter === "asset" ? "on" : ""}
            onClick={() => setTypeFilter("asset")}
            style={{ cursor: "pointer" }}
          >
            Asset
          </span>
          <span
            className={typeFilter === "liability" ? "on" : ""}
            onClick={() => setTypeFilter("liability")}
            style={{ cursor: "pointer" }}
          >
            Liability
          </span>
          <span
            className={typeFilter === "income" ? "on" : ""}
            onClick={() => setTypeFilter("income")}
            style={{ cursor: "pointer" }}
          >
            Income
          </span>
        </div>
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
        <input
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
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
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
          <option value="all">All Types</option>
          <option value="asset">Asset</option>
          <option value="liability">Liability</option>
          <option value="equity">Equity</option>
          <option value="income">Income</option>
          <option value="expense">Expense</option>
        </select>
        <select
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
        <table className="tbl">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Type</th>
              <th>Currency</th>
              <th className="num">Balance</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((account) => (
              <tr key={account.code}>
                <td>
                  <span className="mono">{account.code}</span>
                </td>
                <td>{account.name}</td>
                <td style={{ textTransform: "capitalize" }}>{account.type}</td>
                <td>{account.currency}</td>
                <td className="num">₹{account.balanceDisplay}</td>
                <td>
                  <StatusPill status={account.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
