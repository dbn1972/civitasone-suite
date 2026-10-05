"use client";

/**
 * GAP-CRM-DOCUMENTS-02 — cross-record document register.
 *
 * A paged, filterable view across every record's documents (scan status,
 * expiring-within-N-days, missing-mandatory), with each row linking to its
 * subject record. On a failed load it shows a RefreshErrorState, never a
 * fabricated empty table. Reuses the ds DataTable / StatusPill building blocks.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { DataTable, RefreshErrorState, StatusPill } from "../../../_components/ds";
import {
  getDocumentRegister,
  SUBJECT_TYPES,
  SUBJECT_TYPE_LABELS,
  SCAN_STATUS_LABELS,
  type RegisterRow,
  type RegisterFilters,
  type SubjectType,
} from "@/lib/crm/documents";
import { toHumanError } from "@/lib/messages";

const PAGE_SIZE = 25;

/** Map a subject (type,id) to its record page. */
const SUBJECT_HREF: Record<string, (id: string) => string> = {
  lead: (id) => `/crm/leads/${id}`,
  contact: (id) => `/crm/contacts/${id}`,
  account: (id) => `/crm/accounts/${id}`,
  opportunity: (id) => `/crm/deals/${id}`,
  quotation: (id) => `/crm/quotations/${id}`,
  case: (id) => `/crm/service-requests/${id}`,
};

function subjectHref(type: string, id: string): string {
  return (SUBJECT_HREF[type] ?? ((x: string) => `/crm/contacts/${x}`))(id);
}

type Row = Record<string, unknown> & {
  subject: string;
  subjectLink: string;
  document: string;
  status: string;
  statusLabel: string;
  expiry: string;
};

export function DocumentRegister() {
  const t = useTranslations("crmDocumentRegister");
  const [subjectType, setSubjectType] = useState<string>("");
  const [scanStatus, setScanStatus] = useState<string>("");
  const [view, setView] = useState<"all" | "expiring" | "missing">("all");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<RegisterRow[]>([]);
  const [total, setTotal] = useState(0);
  const [source, setSource] = useState<"api" | "error" | "loading">("loading");

  const load = useCallback(async () => {
    setSource("loading");
    const filters: RegisterFilters = { page, limit: PAGE_SIZE };
    if (subjectType) filters.subjectType = subjectType as SubjectType;
    if (view === "missing") filters.missingMandatory = true;
    else {
      if (scanStatus) filters.scanStatus = scanStatus as RegisterRow["scanStatus"];
      if (view === "expiring") filters.expiringWithinDays = 30;
    }
    const res = await getDocumentRegister(filters);
    setRows(res.rows);
    setTotal(res.total);
    setSource(res.source);
  }, [subjectType, scanStatus, view, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const tableRows: Row[] = rows.map((r) => {
    const subjectLabel = `${SUBJECT_TYPE_LABELS[r.subjectType as SubjectType] ?? r.subjectType} · ${r.subjectId.slice(0, 8)}…`;
    if (r.kind === "missing_mandatory") {
      return {
        subject: subjectLabel,
        subjectLink: subjectHref(r.subjectType, r.subjectId),
        document: r.docTypeName ?? r.docTypeCode ?? "—",
        status: "Missing mandatory",
        statusLabel: t("missingMandatory"),
        expiry: "—",
      };
    }
    return {
      subject: subjectLabel,
      subjectLink: subjectHref(r.subjectType, r.subjectId),
      document: r.title ?? r.filename ?? "—",
      status: SCAN_STATUS_LABELS[r.scanStatus ?? "pending"] ?? (r.scanStatus ?? "—"),
      statusLabel: SCAN_STATUS_LABELS[r.scanStatus ?? "pending"] ?? (r.scanStatus ?? "—"),
      expiry: r.expiryDate ?? "—",
    };
  });

  const columns = [
    {
      key: "subject",
      label: t("colRecord"),
      render: (row: Row) => (
        <a href={row.subjectLink} style={{ color: "var(--link)" }}>
          {row.subject}
        </a>
      ),
    },
    { key: "document", label: t("colDocument") },
    {
      key: "status",
      label: t("colStatus"),
      render: (row: Row) => <StatusPill status={row.status} label={row.statusLabel} />,
    },
    { key: "expiry", label: t("colExpiry") },
  ];

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="card">
      <div className="card-h" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>{t("heading")}</h3>
        <label style={{ fontSize: 13 }}>
          {t("viewLabel")}{" "}
          <select
            aria-label={t("viewAria")}
            value={view}
            onChange={(e) => {
              setPage(1);
              setView(e.target.value as "all" | "expiring" | "missing");
            }}
          >
            <option value="all">{t("viewAll")}</option>
            <option value="expiring">{t("viewExpiring")}</option>
            <option value="missing">{t("missingMandatory")}</option>
          </select>
        </label>
        <label style={{ fontSize: 13 }}>
          {t("recordType")}{" "}
          <select
            aria-label={t("recordType")}
            value={subjectType}
            onChange={(e) => {
              setPage(1);
              setSubjectType(e.target.value);
            }}
          >
            <option value="">{t("all")}</option>
            {SUBJECT_TYPES.map((st) => (
              <option key={st} value={st}>
                {SUBJECT_TYPE_LABELS[st]}
              </option>
            ))}
          </select>
        </label>
        {view !== "missing" && (
          <label style={{ fontSize: 13 }}>
            {t("scanStatus")}{" "}
            <select
              aria-label={t("scanStatus")}
              value={scanStatus}
              onChange={(e) => {
                setPage(1);
                setScanStatus(e.target.value);
              }}
            >
              <option value="">{t("any")}</option>
              {Object.entries(SCAN_STATUS_LABELS).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="pad">
        {source === "error" ? (
          <RefreshErrorState
            error={toHumanError("load", { area: t("loadArea") })}
            backHref="/crm"
            source={{ area: t("loadArea") }}
          />
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={tableRows}
              emptyTitle={t("emptyTitle")}
              emptyMessage={t("emptyMessage")}
              caption={t("caption")}
            />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, fontSize: 13, color: "var(--muted)" }}>
              <span aria-live="polite">
                {source === "loading" ? t("loading") : t("showing", { shown: String(tableRows.length), total: total.toLocaleString("en-IN") })}
              </span>
              <span style={{ display: "flex", gap: 8 }}>
                <button className="btn ghost" type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  {t("previous")}
                </button>
                <span>
                  {t("pageOf", { page: String(page), totalPages: String(totalPages) })}
                </span>
                <button className="btn ghost" type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  {t("next")}
                </button>
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
