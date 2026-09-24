"use client";
/**
 * ServiceBookView — Sprint 14 / Lifecycle Phase 2
 * Paginated read-only chronological table of a complete service record.
 * Columns: date, event type badge, employee, from, to/detail, order ref.
 * Client-side filter by employee name and event type; 15 rows per page.
 */
import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { formatIndianDate } from "@/lib/formatters";
import { Button } from "@/app/_components/ds";

export type ServiceEntry = {
  id: string;
  employee?: string;
  employeeId?: string;
  eventType: string;
  fromPosting?: string;
  toPosting?: string;
  effectiveDate: string;
  orderNo?: string;
  detail?: string;
  status?: string;
} & Record<string, unknown>;

type Translator = ReturnType<typeof useTranslations>;

function eventConfig(t: Translator): Record<string, { icon: string; color: string; bg: string; label: string }> {
  return {
    join:        { icon: "🎉", color: "var(--good, #16a34a)", bg: "var(--goodbg, #f0fdf4)", label: t("eventJoining") },
    transfer:    { icon: "🔄", color: "var(--info, #2563eb)", bg: "var(--infobg, #eff6ff)", label: t("eventTransfer") },
    posting:     { icon: "📍", color: "var(--info, #2563eb)", bg: "var(--infobg, #eff6ff)", label: t("eventPosting") },
    promotion:   { icon: "⬆️", color: "var(--violet, #7c3aed)", bg: "var(--primary-soft, #f5f3ff)", label: t("eventPromotion") },
    increment:   { icon: "💹", color: "var(--info, #0891b2)", bg: "var(--infobg, #ecfeff)", label: t("eventIncrement") },
    leave:       { icon: "🌴", color: "var(--warn, #d97706)", bg: "#fffbeb", label: t("eventLeave") },
    deputation:  { icon: "🏛️", color: "var(--info, #0891b2)", bg: "var(--infobg, #ecfeff)", label: t("eventDeputation") },
    confirmation:{ icon: "✅", color: "var(--good, #16a34a)", bg: "var(--goodbg, #f0fdf4)", label: t("eventConfirmation") },
    suspension:  { icon: "⛔", color: "var(--bad, #dc2626)", bg: "var(--badbg, #fef2f2)", label: t("eventSuspension") },
    retirement:  { icon: "📤", color: "var(--mut, #64748b)", bg: "var(--bg, #f8fafc)", label: t("eventRetirement") },
    other:       { icon: "📌", color: "var(--mut, #64748b)", bg: "var(--bg, #f8fafc)", label: t("eventOther") },
  };
}

function EventBadge({ type, eventCfg }: { type: string; eventCfg: Record<string, { icon: string; color: string; bg: string; label: string }> }) {
  const cfg = eventCfg[type] ?? eventCfg.other;
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: "2px 10px", borderRadius: 12,
        background: cfg.bg, color: cfg.color,
        fontSize: "0.75rem", fontWeight: 500, whiteSpace: "nowrap",
      }}
    >
      {cfg.icon} {cfg.label}
    </span>
  );
}

const PAGE_SIZE = 15;

interface Props {
  entries: ServiceEntry[];
  /** Pre-filter to a single employee — supplied by parent when rendering a per-employee view */
  employeeId?: string;
}

export function ServiceBookView({ entries, employeeId }: Props) {
  const t = useTranslations("serviceBookView");
  const eventCfg = eventConfig(t);
  const [page, setPage]           = useState(0);
  const [empFilter, setEmpFilter] = useState(employeeId ?? "");
  const [typeFilter, setTypeFilter] = useState("all");

  const eventTypes = useMemo(
    () => ["all", ...Array.from(new Set(entries.map((e) => e.eventType)))],
    [entries],
  );

  // Sort chronological asc, then filter
  const filtered = useMemo(() => {
    let r = [...entries].sort(
      (a, b) =>
        new Date(a.effectiveDate).getTime() - new Date(b.effectiveDate).getTime(),
    );
    if (empFilter) {
      const q = empFilter.toLowerCase();
      r = r.filter(
        (e) =>
          (e.employee ?? "").toLowerCase().includes(q) ||
          (e.employeeId ?? "").toLowerCase().includes(q),
      );
    }
    if (typeFilter !== "all") r = r.filter((e) => e.eventType === typeFilter);
    return r;
  }, [entries, empFilter, typeFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  // Clamp current page if filter reduced results
  const safePage   = Math.min(page, totalPages - 1);
  const slice      = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  function gotoPage(p: number) {
    setPage(Math.max(0, Math.min(totalPages - 1, p)));
  }

  const pageNumbers: number[] = [];
  const start = Math.max(0, Math.min(safePage - 2, totalPages - 5));
  for (let i = start; i < Math.min(start + 5, totalPages); i++) pageNumbers.push(i);

  const COLUMNS = [t("colNum"), t("colDate"), t("colEvent"), t("colEmployee"), t("colFrom"), t("colToDetail"), t("colOrderRef")];

  return (
    <div>
      {/* Filter bar */}
      <div
        style={{
          display: "flex", gap: 10, marginBottom: 14,
          flexWrap: "wrap", alignItems: "center",
        }}
      >
        <input
          type="search"
          placeholder={t("searchEmployeePlaceholder")}
          value={empFilter}
          onChange={(e) => { setEmpFilter(e.target.value); setPage(0); }}
          style={{
            padding: "7px 12px", borderRadius: 6,
            border: "1px solid var(--line, #e2e8f0)",
            fontSize: "0.875rem", background: "var(--bg, #fff)",
            color: "var(--ink)", flex: "1 1 180px", minWidth: 160,
          }}
          aria-label={t("filterByEmployeeAriaLabel")}
        />
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }}
          style={{
            padding: "7px 12px", borderRadius: 6,
            border: "1px solid var(--line, #e2e8f0)",
            fontSize: "0.875rem", background: "var(--bg, #fff)",
            color: "var(--ink)",
          }}
          aria-label={t("filterByEventTypeAriaLabel")}
        >
          {eventTypes.map((ty) => (
            <option key={ty} value={ty}>
              {ty === "all" ? t("allEventTypes") : (eventCfg[ty]?.label ?? ty)}
            </option>
          ))}
        </select>
        <span style={{ fontSize: "0.8125rem", color: "var(--mut)", marginInlineStart: "auto" }}>
          {t("entryCount", { count: filtered.length })}
        </span>
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto" }}>
        <table
          style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}
          aria-label={t("tableAriaLabel")}
        >
          <thead>
            <tr style={{ background: "var(--bg2, #f8fafc)" }}>
              {COLUMNS.map(
                (h) => (
                  <th
                    key={h}
                    style={{
                      padding: "9px 12px", textAlign: "start",
                      fontWeight: 600, fontSize: "0.75rem",
                      color: "var(--ink2)", whiteSpace: "nowrap",
                      borderBottom: "1px solid var(--line, #e2e8f0)",
                    }}
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {slice.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  style={{
                    padding: "36px 12px", textAlign: "center",
                    color: "var(--mut)", fontSize: "0.875rem",
                  }}
                >
                  {t("noEntriesMatch")}
                </td>
              </tr>
            ) : (
              slice.map((entry, idx) => {
                const rowNum = safePage * PAGE_SIZE + idx + 1;
                return (
                  <tr
                    key={entry.id}
                    style={{
                      borderBottom: "1px solid var(--line, #f1f5f9)",
                      background:
                        idx % 2 === 0
                          ? "transparent"
                          : "var(--bg2, #f8fafc)",
                    }}
                  >
                    <td
                      style={{
                        padding: "10px 12px", color: "var(--mut)",
                        width: 36, fontSize: "0.75rem",
                      }}
                    >
                      {rowNum}
                    </td>
                    <td style={{ padding: "10px 12px", whiteSpace: "nowrap", fontWeight: 500 }}>
                      {formatIndianDate(entry.effectiveDate)}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <EventBadge type={entry.eventType} eventCfg={eventCfg} />
                    </td>
                    <td style={{ padding: "10px 12px", fontWeight: 500 }}>
                      {entry.employee ?? entry.employeeId ?? "—"}
                    </td>
                    <td
                      style={{
                        padding: "10px 12px", color: "var(--ink2)",
                        maxWidth: 160, overflow: "hidden",
                        textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}
                    >
                      {entry.fromPosting ?? "—"}
                    </td>
                    <td
                      style={{
                        padding: "10px 12px", color: "var(--ink2)",
                        maxWidth: 180, overflow: "hidden",
                        textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}
                    >
                      {entry.toPosting ?? entry.detail ?? "—"}
                    </td>
                    <td
                      style={{
                        padding: "10px 12px",
                        fontFamily: "'Courier New', monospace",
                        fontSize: "0.8125rem", color: "var(--mut)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {entry.orderNo ?? "—"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div
          style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            marginTop: 14, fontSize: "0.8125rem",
          }}
        >
          <span style={{ color: "var(--mut)" }}>
            {t("paginationRange", {
              from: safePage * PAGE_SIZE + 1,
              to: Math.min(safePage * PAGE_SIZE + PAGE_SIZE, filtered.length),
              total: filtered.length,
            })}
          </span>
          <div style={{ display: "flex", gap: 4 }}>
            <Button
              variant="ghost"
              onClick={() => gotoPage(safePage - 1)}
              disabled={safePage === 0}
              aria-label={t("prevPageAriaLabel")}
            >
              ←
            </Button>
            {pageNumbers.map((pg) => (
              <button
                key={pg}
                onClick={() => gotoPage(pg)}
                style={{
                  padding: "5px 11px", borderRadius: 5, border: "none",
                  background:
                    pg === safePage ? "var(--primary, #2563eb)" : "var(--line2)",
                  color: pg === safePage ? "var(--panel, #fff)" : "var(--ink)",
                  cursor: "pointer",
                }}
              >
                {pg + 1}
              </button>
            ))}
            <Button
              variant="ghost"
              onClick={() => gotoPage(safePage + 1)}
              disabled={safePage >= totalPages - 1}
              aria-label={t("nextPageAriaLabel")}
            >
              →
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
