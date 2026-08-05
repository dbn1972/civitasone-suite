"use client";
/**
 * DocumentAlertsView — BRD §7.12 DM-002. For one record, shows which mandatory
 * document types are missing and which existing documents are expired or
 * expiring within 30 days. Derived from the document list + document-type config
 * via computeAlerts (pure). A failed load of either feed shows the saved-info
 * badge and never fabricates an "all clear" as fact.
 */
import { useEffect, useId, useState } from "react";
import { DataSourceBadge } from "../DataSourceBadge";
import { formatIndianDate } from "@/lib/formatters";
import {
  getDocuments,
  getDocumentTypes,
  computeAlerts,
  type DocumentAlert,
  type SubjectType,
  type DmSource,
} from "@/lib/crm/documents";

interface Props {
  subjectType: SubjectType;
  subjectId: string;
}

function alertPillClass(kind: DocumentAlert["kind"]): string {
  if (kind === "expired") return "bad";
  if (kind === "missing") return "warn";
  return "info";
}
function alertLabel(a: DocumentAlert): string {
  if (a.kind === "missing") return "Missing";
  if (a.kind === "expired") return "Expired";
  return "Expiring soon";
}

export function DocumentAlertsView({ subjectType, subjectId }: Props) {
  const [alerts, setAlerts] = useState<DocumentAlert[]>([]);
  const [source, setSource] = useState<DmSource | "loading">("loading");
  const headingId = useId();

  useEffect(() => {
    let live = true;
    (async () => {
      setSource("loading");
      const [docsRes, typesRes] = await Promise.all([getDocuments(subjectType, subjectId), getDocumentTypes()]);
      if (!live) return;
      if (docsRes.source === "error" || typesRes.source === "error") {
        setSource("error");
        setAlerts([]);
        return;
      }
      setAlerts(computeAlerts(subjectType, docsRes.data, typesRes.data));
      setSource("api");
    })();
    return () => {
      live = false;
    };
  }, [subjectType, subjectId]);

  return (
    <div className="card">
      <div className="card-h">
        <h3 id={headingId}>Document alerts</h3>
        {source === "error" ? <DataSourceBadge source="error" /> : null}
      </div>
      <div className="pad">
        {source === "loading" ? (
          <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>Checking document requirements…</p>
        ) : source === "error" ? (
          <p role="alert" style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
            — Document requirements unavailable right now. <DataSourceBadge source="error" />
          </p>
        ) : alerts.length === 0 ? (
          <p role="status" style={{ fontSize: 13, color: "#047857", margin: 0 }}>
            ✓ All required documents are present and in date.
          </p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }} aria-label="Document alerts">
            {alerts.map((a) => (
              <li key={`${a.kind}-${a.typeCode}`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, flexWrap: "wrap" }}>
                <span className={`pill ${alertPillClass(a.kind)}`}>{alertLabel(a)}</span>
                <span style={{ fontWeight: 600 }}>{a.typeName}</span>
                {a.kind === "expired" && a.document?.expiryDate ? (
                  <span style={{ color: "var(--muted)" }}>expired {formatIndianDate(a.document.expiryDate)}</span>
                ) : null}
                {a.kind === "expiring" && a.document?.expiryDate ? (
                  <span style={{ color: "var(--muted)" }}>
                    expires {formatIndianDate(a.document.expiryDate)}
                    {typeof a.daysToExpiry === "number" ? ` (in ${a.daysToExpiry} day${a.daysToExpiry === 1 ? "" : "s"})` : ""}
                  </span>
                ) : null}
                {a.kind === "missing" ? <span style={{ color: "var(--muted)" }}>required but not uploaded</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
