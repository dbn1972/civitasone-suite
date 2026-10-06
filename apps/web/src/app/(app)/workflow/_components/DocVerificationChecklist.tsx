"use client";

/**
 * FN-26 — officer workbasket document verification checklist for the current
 * workflow lane. Loads `/v1/citizen/documents/verification-lane?laneKey=…` so
 * only documents bound to this lane (e.g. Inspection) appear.
 */
import { useEffect, useState } from "react";

interface ChecklistItem {
  docType: string;
  label?: string;
  mandatory: boolean;
  provided: boolean;
  verified: boolean;
}

/**
 * GAP-WORKFLOW-MY-TASKS-06 — a tiny module-scope cache keyed by
 * (lane, serviceId, applicationId). DataTable paginates client-side, so a row's
 * checklist remounts every time the user pages back to it; without this each
 * remount re-issued the same browser fetch (N+1 amplified by paging). The cache
 * de-duplicates those: a (lane, application) pair is fetched at most once per
 * page view. Scoped to the module (cleared on full reload); never persisted.
 */
const checklistCache = new Map<string, ChecklistItem[]>();
function cacheKey(lane: string, serviceId: string | null | undefined, applicationId: string | null | undefined): string {
  return `${lane}|${serviceId ?? ""}|${applicationId ?? ""}`;
}

interface Props {
  /** Workflow node key, e.g. "inspection" or "lane_inspection". */
  laneKey: string | null | undefined;
  /** Optional portal service id; when omitted, resolved via applicationId. */
  serviceId?: string | null;
  /** Citizen application id (workflow task refId when refType is application). */
  applicationId?: string | null;
  compact?: boolean;
  /**
   * GAP-WORKFLOW-INSTANCES-DETAIL-02 — lets a parent (e.g. a task row) observe
   * the checklist state so it can gate Approve while mandatory docs are
   * missing or the checklist could not be loaded. Fire-and-forget; the server
   * `/complete` remains the authority.
   */
  onState?: (state: { status: "loading" | "error" | "ready"; missingMandatory: number }) => void;
}

function normalizeLane(laneKey: string): string {
  return laneKey.trim().toLowerCase().replace(/^lane[_./-]?/, "");
}

export function DocVerificationChecklist({
  laneKey,
  serviceId,
  applicationId,
  compact = false,
  onState,
}: Props) {
  const [items, setItems] = useState<ChecklistItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!laneKey || (!serviceId && !applicationId)) {
      setItems(null);
      return;
    }
    let cancelled = false;
    const key = cacheKey(normalizeLane(laneKey), serviceId, applicationId);
    // GAP-WORKFLOW-MY-TASKS-06 — serve a cached result without a new request.
    const cached = checklistCache.get(key);
    if (cached && reloadKey === 0) {
      setItems(cached);
      setError(null);
      return;
    }
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
          const next = Array.isArray(body.items) ? body.items : [];
          checklistCache.set(key, next);
          setItems(next);
          setError(null);
        }
      } catch {
        if (!cancelled) setError("Could not load document checklist.");
      }
    })();

    return () => { cancelled = true; };
  }, [laneKey, serviceId, applicationId, reloadKey]);

  // GAP-WORKFLOW-INSTANCES-DETAIL-02 — surface state upward for Approve gating.
  const missingMandatory = (items ?? []).filter((i) => i.mandatory && !i.provided).length;
  useEffect(() => {
    if (!onState) return;
    if (error) onState({ status: "error", missingMandatory: 0 });
    else if (items === null) onState({ status: "loading", missingMandatory: 0 });
    else onState({ status: "ready", missingMandatory });
  }, [onState, error, items, missingMandatory]);

  if (!laneKey || (!serviceId && !applicationId)) return null;
  if (error) {
    // GAP-WORKFLOW-MY-TASKS-06 / INSTANCES-DETAIL-02 — never silent: show an
    // honest indicator plus a Retry that re-runs the fetch.
    const retry = () => { setError(null); setItems(null); setReloadKey((k) => k + 1); };
    return compact ? (
      <span className="pill warn np" style={{ fontSize: 11 }} title={error}>
        Docs: unavailable
        <button type="button" onClick={retry} className="btn ghost" style={{ fontSize: 10, marginInlineStart: 6, padding: "0 4px" }} aria-label="Retry document checklist">
          Retry
        </button>
      </span>
    ) : (
      <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--mut)" }}>
        {error}{" "}
        <button type="button" onClick={retry} className="btn ghost sm" aria-label="Retry document checklist">Retry</button>
      </p>
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
      <div style={{ fontWeight: 600, marginBottom: 6, display: "flex", gap: 6, alignItems: "center" }}>
        Documents to verify
        {missingMandatory > 0 ? (
          <span className="pill bad np" style={{ fontSize: 10 }}>{missingMandatory} mandatory missing</span>
        ) : null}
      </div>
      <ul style={{ margin: 0, paddingInlineStart: 18 }}>
        {items.map((item) => (
          <li key={item.docType} style={{ marginBottom: 2 }}>
            <span>{item.label || item.docType}{item.mandatory ? " *" : ""}</span>
            <span style={{ color: "var(--mut)", marginInlineStart: 6 }}>
              {item.verified ? "verified" : item.provided ? "uploaded" : "missing"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
