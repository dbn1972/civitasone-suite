"use client";

/**
 * FN-26 — officer workbasket document verification checklist for the current
 * workflow lane. Loads `/v1/citizen/documents/checklist?laneKey=…` so only
 * documents bound to this lane (e.g. Inspection) appear.
 */
import { useEffect, useState } from "react";

interface ChecklistItem {
  docType: string;
  label?: string;
  mandatory: boolean;
  provided: boolean;
  verified: boolean;
}

interface Props {
  /** Workflow node key, e.g. "inspection" or "lane_inspection". */
  laneKey: string | null | undefined;
  /** Optional portal service id; when omitted, resolved via applicationId. */
  serviceId?: string | null;
  /** Citizen application id (workflow task refId when refType is application). */
  applicationId?: string | null;
  compact?: boolean;
}

function normalizeLane(laneKey: string): string {
  return laneKey.trim().toLowerCase().replace(/^lane[_./-]?/, "");
}

export function DocVerificationChecklist({
  laneKey,
  serviceId,
  applicationId,
  compact = false,
}: Props) {
  const [items, setItems] = useState<ChecklistItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!laneKey || (!serviceId && !applicationId)) {
      setItems(null);
      return;
    }
    let cancelled = false;
    const qs = new URLSearchParams({ laneKey: normalizeLane(laneKey) });
    if (serviceId) qs.set("serviceId", serviceId);
    if (applicationId) qs.set("applicationId", applicationId);

    (async () => {
      try {
        const res = await fetch(`/api/proxy/v1/citizen/documents/verification-lane?${qs.toString()}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          if (!cancelled) setError("Could not load document checklist.");
          return;
        }
        const body = (await res.json()) as { items?: ChecklistItem[] };
        if (!cancelled) {
          setItems(Array.isArray(body.items) ? body.items : []);
          setError(null);
        }
      } catch {
        if (!cancelled) setError("Could not load document checklist.");
      }
    })();

    return () => { cancelled = true; };
  }, [laneKey, serviceId, applicationId]);

  if (!laneKey || (!serviceId && !applicationId)) return null;
  if (error) {
    return compact ? null : (
      <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--mut)" }}>{error}</p>
    );
  }
  if (!items) {
    return compact ? null : (
      <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--mut)" }}>Loading document checklist…</p>
    );
  }
  if (items.length === 0) return null;

  return (
    <div
      aria-label={`Document verification checklist for ${normalizeLane(laneKey)}`}
      style={{
        marginTop: compact ? 6 : 10,
        padding: compact ? "6px 8px" : "10px 12px",
        borderRadius: "var(--r-sm)",
        border: "1px solid var(--line2)",
        background: "var(--bg)",
        fontSize: 12,
        minWidth: compact ? 180 : 240,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 6 }}>
        Documents to verify
      </div>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {items.map((item) => (
          <li key={item.docType} style={{ marginBottom: 2 }}>
            <span>{item.label || item.docType}{item.mandatory ? " *" : ""}</span>
            <span style={{ color: "var(--mut)", marginLeft: 6 }}>
              {item.verified ? "verified" : item.provided ? "uploaded" : "missing"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
