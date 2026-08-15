"use client";
import { useState, useMemo, useCallback } from "react";
import { PageHeader, StatCard, DataTable } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";

// ── UX decisions ──────────────────────────────────────────────────────────────
// 1. Indian date/time format (dd/MM/yyyy HH:mm) — GFR 2017 mandate
// 2. Actor cell shows name + role badge + avatar initials for rapid scan
// 3. Action-type chips use colour coding: CREATE=info, UPDATE=warn, DELETE=bad, LOGIN=mut
// 4. Change summary truncated to 60 chars with expand-on-click for density
// 5. Date-range filter surfaces the most common audit query pattern
// 6. Actor search + action-type multiselect reduce false-positive results
// 7. Export CSV button at top-right — reachable without scrolling
// 8. 25/page pagination prevents long page loads on large audit logs
// 9. StatCards show at-a-glance counts to orient user before table scan
// 10. Empty state with helpful message when filters eliminate all rows
// ─────────────────────────────────────────────────────────────────────────────

type ActionType = "CREATE" | "UPDATE" | "DELETE" | "LOGIN" | "EXPORT" | "APPROVE" | "SUSPEND";

interface AuditEntry {
  id: string;
  timestamp: string;
  actorName: string;
  actorRole: string;
  actionType: ActionType;
  targetEntity: string;
  changeSummary: string;
  ipAddress: string;
}

const ACTION_COLORS: Record<ActionType, { bg: string; color: string; label: string }> = {
  CREATE: { bg: "#eff6ff", color: "#1d4ed8", label: "CREATE" },
  UPDATE: { bg: "#fffbeb", color: "#b45309", label: "UPDATE" },
  DELETE: { bg: "#fef2f2", color: "#b91c1c", label: "DELETE" },
  LOGIN: { bg: "#f0fdf4", color: "#15803d", label: "LOGIN" },
  EXPORT: { bg: "#f5f3ff", color: "#6d28d9", label: "EXPORT" },
  APPROVE: { bg: "#ecfdf5", color: "#065f46", label: "APPROVE" },
  SUSPEND: { bg: "#fff7ed", color: "#c2410c", label: "SUSPEND" },
};

const ALL_ACTIONS: ActionType[] = ["CREATE", "UPDATE", "DELETE", "LOGIN", "EXPORT", "APPROVE", "SUSPEND"];

function mockAuditData(): AuditEntry[] {
  const actors: Array<{ name: string; role: string }> = [
    { name: "Rajesh Kumar", role: "hr_admin" },
    { name: "Priya Sharma", role: "payroll_admin" },
    { name: "Anand Verma", role: "dept_head" },
    { name: "Sunita Patel", role: "finance_admin" },
    { name: "Mohan Das", role: "audit_admin" },
    { name: "Kavita Singh", role: "platform_admin" },
    { name: "Deepak Joshi", role: "hr_staff" },
    { name: "Meena Rao", role: "super_admin" },
  ];
  const actions: Array<{ type: ActionType; entity: string; summary: string }> = [
    { type: "CREATE", entity: "Employee", summary: "Created employee record EMP-00487: Ramesh Gupta, Dept: Finance" },
    { type: "UPDATE", entity: "Leave Policy", summary: "Updated annual leave quota from 30 to 32 days for Grade A employees" },
    { type: "DELETE", entity: "Draft Payroll", summary: "Deleted payroll draft PRN-2025-07 for MoF Central Processing Unit" },
    { type: "LOGIN", entity: "Session", summary: "Authenticated via Keycloak OIDC from 10.10.0.45 (NIC VPN)" },
    { type: "APPROVE", entity: "Leave Request", summary: "Approved LR-00234 for Shyam Lal — Medical leave 5 days (24–28 Aug)" },
    { type: "EXPORT", entity: "Salary Register", summary: "Exported salary register July 2025 — 412 employees, PDF format" },
    { type: "SUSPEND", entity: "User Account", summary: "Suspended user account: arun.mehta@nic.in — repeated policy violation" },
    { type: "UPDATE", entity: "Role Permissions", summary: "Updated finance_admin: added Payroll Read, removed Payroll Write (SoD)" },
    { type: "CREATE", entity: "Payroll Run", summary: "Initiated payroll run PRN-2025-08 for 1,247 employees" },
    { type: "LOGIN", entity: "Session", summary: "Authenticated via Keycloak OIDC — 2FA verified" },
    { type: "APPROVE", entity: "Budget Allocation", summary: "Approved Q2 FY2025-26 budget allocation ₹4.2 crore for HR Division" },
    { type: "UPDATE", entity: "Employee", summary: "Updated designation: Rajiv Mehta promoted to Deputy Secretary" },
    { type: "CREATE", entity: "Department", summary: "Created new section: Digital Governance Cell under IT Division" },
    { type: "DELETE", entity: "Announcement", summary: "Deleted expired announcement: Holiday Notice 15 Aug 2025" },
    { type: "EXPORT", entity: "Audit Report", summary: "Exported quarterly audit report Q1-FY2025-26 — 89 pages" },
    { type: "UPDATE", entity: "System Settings", summary: "Updated SMTP host to smtp.nic.in:587, TLS enabled, from: noreply@gov.in" },
    { type: "CREATE", entity: "API Key", summary: "Created API key for PFMS integration — scope: read_salary, read_emp" },
    { type: "SUSPEND", entity: "Integration", summary: "Suspended DigiLocker integration — certificate expired" },
    { type: "APPROVE", entity: "Promotion", summary: "Approved promotion order for 12 Group B employees — effective 01/09/2025" },
    { type: "UPDATE", entity: "Org Hierarchy", summary: "Renamed division: Budget & Accounts → Budget, Planning & Accounts" },
    { type: "LOGIN", entity: "Session", summary: "Failed login attempt from 203.45.12.89 — blocked by IP whitelist" },
    { type: "CREATE", entity: "User Account", summary: "Created user: Nisha Trivedi — role: hr_staff, dept: Personnel Division" },
    { type: "DELETE", entity: "API Key", summary: "Revoked expired API key PFMS-INT-2024-0003" },
    { type: "APPROVE", entity: "Overtime Request", summary: "Bulk approved 23 overtime requests for project IT-Infra-Upgrade" },
    { type: "UPDATE", entity: "Payroll Run", summary: "Corrected bank account for EMP-00234: IFSC SBIN0012345 → SBIN0067890" },
  ];
  const ips = ["10.10.0.45", "10.10.0.67", "192.168.1.100", "203.45.12.89", "10.0.0.12", "10.10.1.234"];
  const now = Date.now();
  return Array.from({ length: 25 }, (_, i) => {
    const actor = actors[i % actors.length];
    const action = actions[i % actions.length];
    const daysAgo = Math.floor(i * 1.4);
    const hoursAgo = i % 24;
    const ts = new Date(now - daysAgo * 86400000 - hoursAgo * 3600000);
    const ip = ips[i % ips.length];
    return {
      id: `AL-2025-${String(i + 1).padStart(4, "0")}`,
      timestamp: ts.toISOString(),
      actorName: actor.name,
      actorRole: actor.role,
      actionType: action.type,
      targetEntity: action.entity,
      changeSummary: action.summary,
      ipAddress: ip ?? "—",
    };
  });
}

const MOCK_DATA = mockAuditData();

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const date = formatIndianDate(iso);
  const time = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date} ${time}`;
}

function ActionChip({ type }: { type: ActionType }) {
  const cfg = ACTION_COLORS[type];
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 700, background: cfg.bg, color: cfg.color, letterSpacing: "0.04em" }}>
      {cfg.label}
    </span>
  );
}

function ExpandableSummary({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const truncated = text.length > 60 ? text.slice(0, 60) + "…" : text;
  if (text.length <= 60) return <span style={{ fontSize: 12.5, color: "var(--ink2)" }}>{text}</span>;
  return (
    <span>
      <span style={{ fontSize: 12.5, color: "var(--ink2)" }}>{expanded ? text : truncated}</span>
      {" "}
      <button type="button" onClick={() => setExpanded((v) => !v)} style={{ background: "none", border: "none", color: "var(--primary)", fontSize: 11.5, cursor: "pointer", padding: 0, textDecoration: "underline" }}>
        {expanded ? "less" : "more"}
      </button>
    </span>
  );
}

type AuditRow = AuditEntry & Record<string, unknown>;

export default function AuditLogPage() {
  const [actorSearch, setActorSearch] = useState("");
  const [selectedActions, setSelectedActions] = useState<ActionType[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  function toggleAction(a: ActionType) {
    setSelectedActions((prev) =>
      prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]
    );
  }

  const filtered = useMemo<AuditRow[]>(() => {
    return MOCK_DATA.filter((e) => {
      if (actorSearch && !e.actorName.toLowerCase().includes(actorSearch.toLowerCase())) return false;
      if (selectedActions.length > 0 && !selectedActions.includes(e.actionType)) return false;
      if (dateFrom && e.timestamp < dateFrom) return false;
      if (dateTo && e.timestamp > dateTo + "T23:59:59Z") return false;
      return true;
    }) as AuditRow[];
  }, [actorSearch, selectedActions, dateFrom, dateTo]);

  const total = MOCK_DATA.length;
  const failures = MOCK_DATA.filter((e) => e.actionType === "SUSPEND" || e.actionType === "DELETE").length;
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = MOCK_DATA.filter((e) => e.timestamp.slice(0, 10) === today).length;

  function downloadCsv() {
    const header = "ID,Timestamp,Actor,Role,Action,Target,Summary,IP";
    const rows = filtered.map((e) =>
      [e.id, formatWhen(e.timestamp), e.actorName, e.actorRole, e.actionType, e.targetEntity, `"${e.changeSummary.replace(/"/g, '""')}"`, e.ipAddress].join(",")
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Audit Log"
        subtitle="Platform-wide audit trail — all actor actions, entity changes, and login events."
        back="/admin"
        actions={
          <button type="button" className="btn ghost sm" onClick={downloadCsv} title="Export all filtered results as CSV">
            Export CSV
          </button>
        }
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="📋" iconBg="#f1f5f9" label="Total events" value={total} />
        <StatCard icon="📅" iconBg="#eff6ff" label="Today" value={todayCount} />
        <StatCard icon="⚠️" iconBg="#fef3f2" label="Destructive actions" value={failures} />
        <StatCard icon="👤" iconBg="#ecfdf3" label="Actors (distinct)" value={8} />
      </div>
      <div className="card">
        <div className="card-h" style={{ flexWrap: "wrap", gap: 12 }}>
          <h3>Activity log</h3>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="text"
              placeholder="Search actor name…"
              value={actorSearch}
              onChange={(e) => setActorSearch(e.target.value)}
              aria-label="Search by actor name"
              style={{ padding: "6px 10px", borderRadius: 7, border: "1px solid var(--line)", fontSize: 13, fontFamily: "inherit", color: "var(--ink)", background: "var(--surface)", minWidth: 180 }}
            />
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="From date" style={{ padding: "6px 10px", borderRadius: 7, border: "1px solid var(--line)", fontSize: 13, fontFamily: "inherit", color: "var(--ink)", background: "var(--surface)" }} />
            <span style={{ fontSize: 12, color: "var(--ink3)" }}>to</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="To date" style={{ padding: "6px 10px", borderRadius: 7, border: "1px solid var(--line)", fontSize: 13, fontFamily: "inherit", color: "var(--ink)", background: "var(--surface)" }} />
          </div>
        </div>
        <div style={{ padding: "8px 16px 0", display: "flex", gap: 6, flexWrap: "wrap" }}>
          {ALL_ACTIONS.map((a) => {
            const active = selectedActions.includes(a);
            const cfg = ACTION_COLORS[a];
            return (
              <button
                key={a}
                type="button"
                onClick={() => toggleAction(a)}
                aria-pressed={active}
                style={{ padding: "3px 10px", borderRadius: 10, fontSize: 11, fontWeight: 700, cursor: "pointer", border: `1.5px solid ${active ? cfg.color : "var(--line)"}`, background: active ? cfg.bg : "transparent", color: active ? cfg.color : "var(--ink3)", transition: "all 0.12s" }}
              >
                {a}
              </button>
            );
          })}
          {selectedActions.length > 0 && (
            <button type="button" onClick={() => setSelectedActions([])} style={{ padding: "3px 10px", borderRadius: 10, fontSize: 11, cursor: "pointer", border: "1px solid var(--line)", background: "transparent", color: "var(--ink3)" }}>
              Clear filters
            </button>
          )}
        </div>
        <DataTable<AuditRow>
          columns={[
            {
              key: "timestamp",
              label: "When",
              render: (e) => <span style={{ whiteSpace: "nowrap", fontSize: 12.5, fontFamily: "monospace" }}>{formatWhen(e.timestamp)}</span>,
            },
            {
              key: "actorName",
              label: "Actor",
              render: (e) => (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#e0e7ff", color: "#4f46e5", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} aria-hidden="true">
                    {String(e.actorName).slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 550 }}>{String(e.actorName)}</div>
                    <span style={{ display: "inline-block", padding: "1px 6px", borderRadius: 8, fontSize: 10.5, background: "#f1f5f9", color: "#475569", marginTop: 2 }}>{String(e.actorRole)}</span>
                  </div>
                </div>
              ),
            },
            {
              key: "actionType",
              label: "Action",
              render: (e) => <ActionChip type={e.actionType as ActionType} />,
            },
            { key: "targetEntity", label: "Target", render: (e) => <span style={{ fontSize: 13 }}>{String(e.targetEntity)}</span> },
            {
              key: "changeSummary",
              label: "Change summary",
              sortable: false,
              render: (e) => <ExpandableSummary text={String(e.changeSummary)} />,
            },
            {
              key: "ipAddress",
              label: "IP",
              render: (e) => <span style={{ fontSize: 12, fontFamily: "monospace", color: "var(--ink3)" }}>{String(e.ipAddress)}</span>,
            },
          ]}
          rows={filtered}
          sortable
          pageSize={25}
          emptyIcon="🔍"
          emptyTitle="No audit events match"
          emptyMessage="Adjust the filters above to find events."
        />
      </div>
    </main>
  );
}
