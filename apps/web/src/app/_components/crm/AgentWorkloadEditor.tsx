"use client";
/**
 * AgentWorkloadEditor — AS-003 admin. Set each agent's lead capacity and
 * availability. Reads the roster (with live open-lead counts) on mount and PUTs
 * capacity per agent. `maxLeads` is NaN-guarded so a half-typed value never
 * lands in a PUT. Open-lead counts are gated on the load source: when the load
 * fails (source==="error") we show "—" + DataSourceBadge rather than a
 * fabricated 0 workload.
 */
import { useEffect, useId, useState } from "react";
import { DataSourceBadge } from "../DataSourceBadge";
import { EmptyState } from "../ds";
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

export function AgentWorkloadEditor() {
  const [agents, setAgents] = useState<AgentWorkload[]>([]);
  const [source, setSource] = useState<AsSource | "loading">("loading");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const headingId = useId();

  async function load(isLive: () => boolean = () => true) {
    setSource("loading");
    const { data, source: s } = await getAgents();
    if (!isLive()) return;
    setAgents(data);
    setSource(s);
  }

  useEffect(() => {
    let live = true;
    void load(() => live);
    return () => { live = false; };
  }, []);

  const isError = source === "error";

  function update(agentId: string, patch: Partial<AgentWorkload>) {
    setAgents((prev) => prev.map((a) => (a.agentId === agentId ? { ...a, ...patch } : a)));
  }

  async function save(agent: AgentWorkload) {
    setMessage("");
    setError("");
    if (!Number.isInteger(agent.maxLeads) || agent.maxLeads < 0) {
      setError(`${agent.name} needs a whole-number lead capacity of 0 or more.`);
      return;
    }
    setBusyId(agent.agentId);
    try {
      await updateAgentCapacity(agent.agentId, {
        maxLeads: agent.maxLeads,
        available: agent.available,
        onLeave: agent.onLeave,
      });
      // Reload from the server so the row reflects server truth (e.g. a field
      // the backend normalised or ignored), never optimistic local state.
      await load();
      setMessage(`${agent.name}'s capacity saved.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the capacity.");
    } finally {
      setBusyId(null);
    }
  }

  if (source === "loading") {
    return (
      <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)" }}>
        Loading agent workload…
      </p>
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
        />
      ) : (
        <table className="tbl" aria-labelledby={headingId}>
          <thead>
            <tr>
              <th>Agent</th>
              <th style={{ textAlign: "right" }}>Open leads</th>
              <th style={{ textAlign: "right" }}>Max leads</th>
              <th>Available</th>
              <th>On leave</th>
              <th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a, i) => {
              const n = i + 1;
              const busy = busyId === a.agentId;
              const over = !isError && Number.isFinite(a.maxLeads) && a.maxLeads > 0 && a.activeLeads > a.maxLeads;
              return (
                <tr key={a.agentId}>
                  <td>{a.name}</td>
                  <td className="num">
                    {isError ? "—" : (
                      <span className={over ? "pill warn" : undefined}>
                        {a.activeLeads}{over ? " (over)" : ""}
                      </span>
                    )}
                  </td>
                  <td className="num">
                    <label className="sr-only" htmlFor={`${headingId}-max-${a.agentId}`}>Max leads for agent {n}</label>
                    <input
                      id={`${headingId}-max-${a.agentId}`}
                      type="number" min={0} step={1}
                      value={Number.isInteger(a.maxLeads) ? a.maxLeads : ""}
                      aria-invalid={Number.isInteger(a.maxLeads) ? undefined : true}
                      onChange={(e) => update(a.agentId, { maxLeads: sanitizeInt(e.target.value) })}
                      style={{ ...inputStyle, width: 80, textAlign: "right" }}
                    />
                  </td>
                  <td>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                      <input type="checkbox" checked={a.available} onChange={(e) => update(a.agentId, { available: e.target.checked })} aria-label={`Available for agent ${n}`} />
                      {a.available ? "Yes" : "No"}
                    </label>
                  </td>
                  <td>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                      <input type="checkbox" checked={a.onLeave} onChange={(e) => update(a.agentId, { onLeave: e.target.checked })} aria-label={`On leave for agent ${n}`} />
                      {a.onLeave ? "Yes" : "No"}
                    </label>
                  </td>
                  <td>
                    <button type="button" className="btn primary sm" onClick={() => void save(a)} disabled={busy}>
                      {busy ? "Saving…" : "Save"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
