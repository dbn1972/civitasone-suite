"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { EmptyState } from "../../../_components/ds";
import type { AgentStatus } from "./governance";

/**
 * Pause or resume an agent. Only ai_admin/super_admin may actually do it — the
 * service enforces that and returns 403, which is surfaced rather than hidden,
 * because hiding the control is not an authorisation check.
 */
export function AgentKillSwitch({ agents }: { agents: AgentStatus[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function toggle(agent: AgentStatus) {
    const pausing = agent.status === "active";
    setBusyId(agent.id);
    setMessage("");
    setError("");
    try {
      const res = await fetch(`/api/proxy/v1/ai/agents/${agent.id}/${pausing ? "pause" : "resume"}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
        throw new Error(
          body.code === "FORBIDDEN"
            ? "You need the AI administrator role to pause or resume an agent."
            : body.message || `Could not ${pausing ? "pause" : "resume"} the agent.`,
        );
      }
      setMessage(`${agent.name} ${pausing ? "paused" : "resumed"}.`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change the agent state.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="card">
      <div className="card-h"><h3>Agent Kill-Switch</h3></div>
      {agents.length === 0 ? (
        <EmptyState icon="⚡" title="No agents defined" message="Publish an agent before you can pause it here." />
      ) : (
        <div className="pad">
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
                    <span className={`pill ${pausing ? "ok" : "info"}`} style={{ marginLeft: 8 }}>{agent.status}</span>
                  </span>
                  <button
                    type="button"
                    className={`btn ${pausing ? "danger" : "ghost"}`}
                    disabled={busyId === agent.id}
                    onClick={() => toggle(agent)}
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
        <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", padding: "0 12px 12px" }}>{message}</p>
      ) : null}
      {error ? (
        <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", padding: "0 12px 12px" }}>{error}</p>
      ) : null}
    </div>
  );
}
