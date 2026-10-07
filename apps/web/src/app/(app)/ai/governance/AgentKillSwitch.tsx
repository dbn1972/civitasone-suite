"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import type { AgentStatus } from "./governance";

/**
 * Pause or resume an agent. Only ai_admin/super_admin may actually do it — the
 * service enforces that and returns 403, which is surfaced rather than hidden,
 * because hiding the control is not an authorisation check.
 *
 * GAP-AI-GOVERNANCE-01: when the agents fetch itself failed, show a retry state
 * rather than the misleading "No agents defined" empty state.
 * GAP-AI-GOVERNANCE-02: pausing a live, citizen-facing agent is dangerous, so a
 * confirmation (with an optional reason) is required before the request is sent.
 * GAP-AI-GOVERNANCE-05: non-admins see the controls disabled with an explanation
 * (UI gating only — the service remains the authority).
 */
export function AgentKillSwitch({
  agents,
  errored,
  canManage,
}: {
  agents: AgentStatus[];
  errored?: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<AgentStatus | null>(null);

  async function toggle(agent: AgentStatus, reason?: string) {
    const pausing = agent.status === "active";
    setBusyId(agent.id);
    setMessage("");
    setError("");
    try {
      const res = await fetch(`/api/proxy/v1/ai/agents/${agent.id}/${pausing ? "pause" : "resume"}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reason ? { reason } : {}),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string };
        // GAP-AI-GOVERNANCE-05: map a 403 by status too, not only by body.code.
        setError(
          res.status === 403 || body.code === "FORBIDDEN"
            ? "You need the AI administrator role to pause or resume an agent."
            : `Could not ${pausing ? "pause" : "resume"} the agent.`,
        );
        return;
      }
      setMessage(`${agent.name} ${pausing ? "paused" : "resumed"}.`);
      router.refresh();
    } catch {
      setError("Could not change the agent state.");
    } finally {
      setBusyId(null);
      setPending(null);
    }
  }

  return (
    <div className="card">
      <div className="card-h"><h3>Agent Kill-Switch</h3></div>
      {errored ? (
        <RefreshErrorState
          error={toHumanError("load", { area: "agents" })}
          source={{ area: "agents" }}
        />
      ) : agents.length === 0 ? (
        <EmptyState icon="⚡" title="No agents defined" message="Publish an agent before you can pause it here." />
      ) : (
        <div className="pad">
          {!canManage ? (
            <p style={{ fontSize: 12, color: "var(--muted, #667085)", margin: "0 0 10px" }}>
              Pausing or resuming an agent requires the AI administrator role.
            </p>
          ) : null}
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {agents.map((agent) => {
              const pausing = agent.status === "active";
              return (
                <li
                  key={agent.id}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10 }}
                >
                  <span>
                    {agent.name}
                    <span className={`pill ${pausing ? "good" : "info"}`} style={{ marginLeft: 8 }}>{agent.status}</span>
                  </span>
                  <button
                    type="button"
                    className={`btn ${pausing ? "danger" : "ghost"}`}
                    disabled={busyId === agent.id || !canManage}
                    title={!canManage ? "Requires AI administrator" : undefined}
                    onClick={() => setPending(agent)}
                    style={{ minHeight: 44 }}
                  >
                    {busyId === agent.id ? "Working…" : pausing ? "Pause" : "Resume"}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {message ? (
        <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--good, #047857)", padding: "0 12px 12px" }}>{message}</p>
      ) : null}
      {error ? (
        <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "var(--bad, #b42318)", padding: "0 12px 12px" }}>{error}</p>
      ) : null}

      {/* GAP-AI-GOVERNANCE-02: confirm before halting / resuming a live agent. */}
      <ConfirmDialog
        open={pending !== null}
        title={pending?.status === "active" ? `Pause ${pending?.name}?` : `Resume ${pending?.name}?`}
        description={
          pending?.status === "active"
            ? "Pausing stops this agent from handling any new requests, including citizen-facing ones, until it is resumed."
            : "Resuming lets this agent start handling requests again."
        }
        confirmLabel={pending?.status === "active" ? "Pause agent" : "Resume agent"}
        danger={pending?.status === "active"}
        optionalReason
        reasonLabel="Reason (optional, recorded in the audit trail)"
        busy={busyId !== null}
        onConfirm={(reason) => { if (pending) void toggle(pending, reason); }}
        onCancel={() => { if (busyId === null) setPending(null); }}
      />
    </div>
  );
}
