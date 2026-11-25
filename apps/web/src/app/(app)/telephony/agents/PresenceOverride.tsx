"use client";

/**
 * GAP-TELEPHONY-AGENTS-05: presence override control for one agent row.
 * POST /api/proxy/v1/telephony/agents/:id/status  { status, expectedVersion? }  (202 accepted, async command).
 */
import { useState } from "react";
import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";
import { useEstabT } from "@/lib/estab/useEstabT";
import { AGENT_STATUSES, type AgentStatus } from "@/lib/telephony/roles";

export function PresenceOverride({
  id,
  name,
  status,
  version,
  onChanged,
}: {
  id: string;
  name: string;
  status: string;
  version?: number;
  onChanged: () => void;
}) {
  const t = useEstabT("telephonyAgents");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function change(next: AgentStatus) {
    if (next === status) return;
    setPending(true);
    setMessage("");
    setError("");
    try {
      const res = await fetch(`/api/proxy/v1/telephony/agents/${encodeURIComponent(id)}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(typeof version === "number" && version >= 1 ? { status: next, expectedVersion: version } : { status: next }),
      });
      if (!res.ok) {
        const e = await userFacingErrorFromResponse(res, "save");
        setError(e.message);
        return;
      }
      setMessage(t("submitted"));
      onChanged();
    } catch {
      setError(t("failed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <label className="sr-only" htmlFor={`presence-${id}`}>{t("setFor", { name })}</label>
      <select
        id={`presence-${id}`}
        value={status}
        disabled={pending}
        onChange={(e) => void change(e.target.value as AgentStatus)}
      >
        {AGENT_STATUSES.map((s) => (
          <option key={s} value={s}>{t(`status_${s}`)}</option>
        ))}
      </select>
      <span role="status" aria-live="polite" style={{ fontSize: 12, color: "var(--good)", marginLeft: 6 }}>
        {pending ? t("saving") : message}
      </span>
      <span role="alert" style={{ fontSize: 12, color: "var(--bad)", marginLeft: 6 }}>{error}</span>
    </div>
  );
}
