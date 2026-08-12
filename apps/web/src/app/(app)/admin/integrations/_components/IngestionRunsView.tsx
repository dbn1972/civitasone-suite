"use client";
/**
 * IngestionRunsView — recent SFTP lead-ingestion runs + a "Run now" trigger
 * (BRD §9 #12). Shown for the sftp connector inside IntegrationDrawer.
 *
 * Data is source-gated: on a failed load we render "—" for every count and a
 * DataSourceBadge, never a fabricated "0 rows imported". The empty-state ("No
 * ingestion runs yet") shows ONLY when the load actually succeeded. "Run now"
 * is a side-effectful trigger, so it goes through ConfirmDialog before firing,
 * then reloads the runs list.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { ConfirmDialog } from "@/app/_components/ds";
import {
  getIngestionRuns,
  triggerIngestion,
  runStatusLabel,
  runStatusVariant,
  runStatusIcon,
  formatDateTime,
  type IngestionRun,
  type IngestionSource,
} from "@/lib/admin/sftpIngestion";

export function IngestionRunsView({ provider, env }: { provider: string; env: string }) {
  const [runs, setRuns] = useState<IngestionRun[]>([]);
  const [source, setSource] = useState<IngestionSource | "loading">("loading");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const headingId = useId();

  // Unconditional mount tracker (declared before any early return) so the
  // async "Run now" path can short-circuit its setState calls after unmount.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const load = useCallback(async (live?: () => boolean) => {
    setSource("loading");
    const { data, source: s } = await getIngestionRuns(provider, env);
    if (live && !live()) return;
    setRuns(data);
    setSource(s);
  }, [provider, env]);

  useEffect(() => {
    let alive = true;
    void load(() => alive);
    return () => { alive = false; };
  }, [load]);

  async function confirmRun() {
    setTriggering(true);
    setTriggerError(null);
    setNotice(null);
    const res = await triggerIngestion(provider, env);
    if (!mountedRef.current) return;
    setTriggering(false);
    if (!res.ok) {
      setTriggerError(res.error ?? "Failed to start ingestion");
      return;
    }
    setConfirmOpen(false);
    setNotice("Ingestion started. Refreshing runs…");
    await load(() => mountedRef.current);
  }

  const isError = source === "error";
  const isLoading = source === "loading";

  return (
    <div className="card" style={{ boxShadow: "none", border: "1px solid var(--line)" }}>
      <div className="card-h" style={{ alignItems: "center" }}>
        <h3 id={headingId} style={{ fontSize: 13.5 }}>Ingestion runs</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {isError ? <DataSourceBadge source="error" /> : null}
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => { setTriggerError(null); setConfirmOpen(true); }}
            disabled={triggering}
          >
            ▶ Run now
          </button>
        </div>
      </div>

      <div className="pad" style={{ padding: 14 }}>
        {notice && (
          <div className="alert" role="status" style={{ fontSize: 12.5, marginBottom: 10, background: "var(--goodbg)", borderColor: "var(--goodbd)", color: "var(--good)" }}>
            {notice}
          </div>
        )}

        {isLoading ? (
          <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--ink2)", margin: 0 }}>
            Loading ingestion runs…
          </p>
        ) : isError ? (
          // No fabricated counts: em-dash line, the badge above says why.
          <p style={{ fontSize: 13, color: "var(--ink2)", margin: 0 }}>
            Ingestion runs unavailable — showing no figures rather than guessed ones. —
          </p>
        ) : runs.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--ink2)", margin: 0 }}>No ingestion runs yet.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }} aria-labelledby={headingId}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--ink2)" }}>
                  <th scope="col" style={thStyle}>Status</th>
                  <th scope="col" style={thStyle}>Files</th>
                  <th scope="col" style={thStyle}>Created</th>
                  <th scope="col" style={thStyle}>Failed</th>
                  <th scope="col" style={thStyle}>Started</th>
                  <th scope="col" style={thStyle}>Finished</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={tdStyle}>
                      <span className={`pill ${runStatusVariant(r.status)}`}>
                        <span aria-hidden>{runStatusIcon(r.status)}</span> {runStatusLabel(r.status)}
                      </span>
                      {r.error && (
                        <div style={{ fontSize: 11, color: "var(--bad)", marginTop: 3 }}>{r.error}</div>
                      )}
                    </td>
                    <td style={tdStyle}>{r.filesSeen}</td>
                    <td style={tdStyle}>{r.rowsCreated}</td>
                    <td style={tdStyle}>
                      {r.rowsFailed > 0 ? (
                        <span style={{ color: "var(--bad)", fontWeight: 650 }}>{r.rowsFailed}</span>
                      ) : (
                        r.rowsFailed
                      )}
                    </td>
                    <td style={tdStyle}>{formatDateTime(r.startedAt)}</td>
                    <td style={tdStyle}>{formatDateTime(r.finishedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Run ingestion now?"
        description="This starts an immediate sweep of the inbound path. Matching files will be read and, if lead ingestion is on, promoted to CRM leads."
        confirmLabel="Run now"
        busy={triggering}
        errorMessage={triggerError ?? undefined}
        onConfirm={() => { void confirmRun(); }}
        onCancel={() => { if (!triggering) setConfirmOpen(false); }}
      />
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: "6px 10px", fontWeight: 650, whiteSpace: "nowrap" };
const tdStyle: React.CSSProperties = { padding: "8px 10px", verticalAlign: "top", whiteSpace: "nowrap" };
