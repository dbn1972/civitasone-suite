"use client";
/**
 * AgentWorkloadEditor — AS-003 admin. Set each agent's lead capacity and
 * availability. Reads the roster (with live open-lead counts) on mount and
 * PATCHes capacity per agent.
 *
 * - GAP-CRM-AGENT-WORKLOAD-02: saving one row no longer blows away unsaved
 *   edits on other rows. After a successful PATCH we merge the saved agent's
 *   server-normalised values back into just that row (a background refetch
 *   that never flips the whole table into the "Loading…" state), and keep every
 *   other row's local edits.
 * - GAP-CRM-AGENT-WORKLOAD-03: `maxLeads` stays NaN until the admin types a
 *   value (a missing value is never silently PATCHed as 0, which the engine
 *   reads as "receives no new leads"); the column header carries a HelpTip
 *   documenting what 0 means, and a 0 shows a "Blocked" hint.
 * - GAP-CRM-AGENT-WORKLOAD-04: a risky change (going unavailable, on leave, or
 *   lowering max leads) opens a ConfirmDialog that requires a reason, which is
 *   sent to the backend (recorded on the capacity audit event).
 */
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { DataSourceBadge } from "../DataSourceBadge";
import { EmptyState, Button, HelpTip, ConfirmDialog } from "../ds";
import { SkeletonTable } from "../ds/Skeleton";
import {
  getAgents,
  updateAgentCapacity,
  type AgentWorkload,
  type AsSource,
} from "@/lib/crm/assignment";

function sanitizeInt(raw: string): number {
  if (raw.trim() === "") return Number.NaN;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : Number.NaN;
}

const inputStyle = { padding: 6, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)" } as const;

/** Does moving from `before` to `after` need an explicit reason? */
function needsReason(before: AgentWorkload | undefined, after: AgentWorkload): boolean {
  if (!before) return false;
  if (before.available && !after.available) return true; // going unavailable
  if (!before.onLeave && after.onLeave) return true; // going on leave
  if (
    Number.isFinite(before.maxLeads) &&
    Number.isFinite(after.maxLeads) &&
    after.maxLeads < before.maxLeads
  ) {
    return true; // lowering capacity
  }
  return false;
}

export function AgentWorkloadEditor() {
  const t = useTranslations("crmAgentWorkloadEditor");
  const [agents, setAgents] = useState<AgentWorkload[]>([]);
  const [source, setSource] = useState<AsSource | "loading">("loading");
  // Server-truth snapshot per agentId, used to detect dirty rows and risky
  // changes without re-reading the whole table.
  const [saved, setSaved] = useState<Record<string, AgentWorkload>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmFor, setConfirmFor] = useState<AgentWorkload | null>(null);
  const firstLoad = useRef(true);
  const headingId = useId();

  async function initialLoad(isLive: () => boolean = () => true) {
    setSource("loading");
    const { data, source: s } = await getAgents();
    if (!isLive()) return;
    setAgents(data);
    setSaved(Object.fromEntries(data.map((a) => [a.agentId, a])));
    setSource(s);
    firstLoad.current = false;
  }

  useEffect(() => {
    let live = true;
    void initialLoad(() => live);
    return () => { live = false; };
  }, []);

  const isError = source === "error";

  function update(agentId: string, patch: Partial<AgentWorkload>) {
    setAgents((prev) => prev.map((a) => (a.agentId === agentId ? { ...a, ...patch } : a)));
  }

  /**
   * Background refetch that updates ONLY the saved row's server values and the
   * snapshot, preserving unsaved edits on every other row. Never sets
   * source="loading" (which would unmount the table and discard edits).
   */
  async function refreshSavedRow(agentId: string) {
    const { data, source: s } = await getAgents();
    if (s !== "api") return; // keep local state on a failed refresh
    const serverRow = data.find((a) => a.agentId === agentId);
    if (!serverRow) return;
    setAgents((prev) => prev.map((a) => (a.agentId === agentId ? serverRow : a)));
    setSaved((prev) => ({ ...prev, [agentId]: serverRow }));
  }

  async function performSave(agent: AgentWorkload, reason?: string) {
    setBusyId(agent.agentId);
    setMessage("");
    setError("");
    try {
      await updateAgentCapacity(agent.agentId, {
        maxLeads: agent.maxLeads,
        available: agent.available,
        onLeave: agent.onLeave,
        ...(reason ? { reason } : {}),
      });
      await refreshSavedRow(agent.agentId);
      setMessage(`${agent.name}'s capacity saved.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the capacity.");
    } finally {
      setBusyId(null);
    }
  }

  function requestSave(agent: AgentWorkload) {
    setMessage("");
    setError("");
    if (!Number.isInteger(agent.maxLeads) || agent.maxLeads < 0) {
      setError(t("needsWholeNumber", { name: agent.name }));
      return;
    }
    if (needsReason(saved[agent.agentId], agent)) {
      setConfirmFor(agent);
      return;
    }
    void performSave(agent);
  }

  if (source === "loading" && firstLoad.current) {
    // GAP-CRM-AGENT-WORKLOAD-07: a proper table skeleton (role=status via
    // aria-busy) on first load instead of a bare "Loading…" line. No offline
    // cache is used here on purpose: this is live admin configuration data and
    // a stale capacity table would mislead (see decision in the gap report).
    return (
      <div className="card">
        <div className="card-h">
          <h3 id={headingId}>Agent workload &amp; capacity</h3>
        </div>
        <div className="pad">
          <SkeletonTable rows={5} />
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-h">
        <h3 id={headingId}>Agent workload &amp; capacity</h3>
        {isError ? <DataSourceBadge source="error" /> : null}
      </div>
      {message ? <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", padding: "0 12px" }}>{message}</p> : null}
      {error ? <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", padding: "0 12px" }}>{error}</p> : null}

      {agents.length === 0 ? (
        <EmptyState
          icon="👥"
          title={isError ? "Workload unavailable" : "No agents yet"}
          message={isError ? "We couldn't load the agent roster just now." : "No agents are configured for lead assignment."}
          action={
            isError ? (
              <Button type="button" onClick={() => void initialLoad()}>
                Try again
              </Button>
            ) : undefined
          }
        />
      ) : (
        <table className="tbl" aria-labelledby={headingId}>
          <thead>
            <tr>
              <th>Agent</th>
              <th style={{ textAlign: "right" }}>Open leads</th>
              <th style={{ textAlign: "right" }}>
                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "flex-end" }}>
                  {t("maxLeads")}
                  <HelpTip term={t("maxLeads")}>
                    {t("maxLeadsHelp")}
                  </HelpTip>
                </span>
              </th>
              <th>Available</th>
              <th>On leave</th>
              <th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => {
              const busy = busyId === a.agentId;
              const maxMissing = !Number.isInteger(a.maxLeads);
              const over = !isError && Number.isFinite(a.maxLeads) && a.maxLeads > 0 && a.activeLeads > a.maxLeads;
              const blocked = Number.isInteger(a.maxLeads) && a.maxLeads === 0;
              return (
                <tr key={a.agentId}>
                  <th scope="row" style={{ textAlign: "start", fontWeight: 500 }}>{a.name}</th>
                  <td className="num">
                    {isError ? "—" : (
                      <span className={over ? "pill warn" : undefined}>
                        {a.activeLeads}{over ? " (over)" : ""}
                      </span>
                    )}
                  </td>
                  <td className="num">
                    {/* GAP-CRM-AGENT-WORKLOAD-06: label by agent NAME, not row
                        position, so a screen-reader user knows whose capacity
                        they are editing after a sort/reload. */}
                    <label className="sr-only" htmlFor={`${headingId}-max-${a.agentId}`}>Max leads for {a.name}</label>
                    <input
                      id={`${headingId}-max-${a.agentId}`}
                      type="number" min={0} step={1}
                      value={Number.isInteger(a.maxLeads) ? a.maxLeads : ""}
                      aria-invalid={maxMissing ? true : undefined}
                      onChange={(e) => update(a.agentId, { maxLeads: sanitizeInt(e.target.value) })}
                      style={{ ...inputStyle, width: 80, textAlign: "right" }}
                    />
                    {blocked ? (
                      <span className="pill warn" style={{ display: "block", marginTop: 4, fontSize: 11 }}>{t("blockedNoNewLeads")}</span>
                    ) : null}
                    {maxMissing ? (
                      <span style={{ display: "block", marginTop: 4, fontSize: 11, color: "#b45309" }}>{t("enterCapacity")}</span>
                    ) : null}
                  </td>
                  <td>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                      <input type="checkbox" checked={a.available} onChange={(e) => update(a.agentId, { available: e.target.checked })} aria-label={`Available: ${a.name}`} />
                      {a.available ? "Yes" : "No"}
                    </label>
                  </td>
                  <td>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                      <input type="checkbox" checked={a.onLeave} onChange={(e) => update(a.agentId, { onLeave: e.target.checked })} aria-label={`On leave: ${a.name}`} />
                      {a.onLeave ? "Yes" : "No"}
                    </label>
                  </td>
                  <td>
                    <Button type="button" size="sm" onClick={() => requestSave(a)} disabled={busy || maxMissing} aria-label={`Save capacity for ${a.name}`}>
                      {busy ? "Saving…" : "Save"}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <ConfirmDialog
        open={confirmFor !== null}
        title={t("confirmRoutingChange")}
        description={
          confirmFor ? (
            <p style={{ margin: 0 }}>
              {t.rich("routingChangeDescription", { name: confirmFor.name, strong: (chunks) => <strong>{chunks}</strong> })}
            </p>
          ) : null
        }
        requireReason
        minReasonLength={5}
        confirmLabel={t("saveChange")}
        busy={busyId !== null}
        onConfirm={(reason) => {
          const agent = confirmFor;
          setConfirmFor(null);
          if (agent) void performSave(agent, reason);
        }}
        onCancel={() => setConfirmFor(null)}
      />
    </div>
  );
}
