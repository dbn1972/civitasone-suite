"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AssignmentActions() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [inspectionId, setInspectionId] = useState("");
  const [inspectorId, setInspectorId] = useState("");
  const [inspectionTypeId, setInspectionTypeId] = useState("");
  const [entityId, setEntityId] = useState("");
  const [scheduledDate, setScheduledDate] = useState(() => new Date().toISOString().slice(0, 10));

  async function createAssignment() {
    setBusy(true);
    setError(undefined);
    setMessage("");
    try {
      const res = await fetch("/api/proxy/v1/inspection/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inspectionId: inspectionId.trim(),
          inspectorId: inspectorId.trim(),
          inspectionTypeId: inspectionTypeId.trim(),
          entityId: entityId.trim(),
          scheduledDate,
        }),
      });
      if (res.status !== 202 && !res.ok) {
        throw new Error((await res.text()) || "Create assignment failed");
      }
      setMessage("Assignment creation accepted (queued).");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Assignment create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "end" }}>
        <label style={{ fontSize: 12 }}>
          Inspection ID
          <input
            className="inp"
            value={inspectionId}
            onChange={(e) => setInspectionId(e.target.value)}
            placeholder="UUID"
          />
        </label>
        <label style={{ fontSize: 12 }}>
          Inspector ID
          <input
            className="inp"
            value={inspectorId}
            onChange={(e) => setInspectorId(e.target.value)}
            placeholder="UUID"
          />
        </label>
        <label style={{ fontSize: 12 }}>
          Type ID
          <input
            className="inp"
            value={inspectionTypeId}
            onChange={(e) => setInspectionTypeId(e.target.value)}
            placeholder="UUID"
          />
        </label>
        <label style={{ fontSize: 12 }}>
          Entity ID
          <input className="inp" value={entityId} onChange={(e) => setEntityId(e.target.value)} placeholder="UUID" />
        </label>
        <label style={{ fontSize: 12 }}>
          Scheduled
          <input
            className="inp"
            type="date"
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
          />
        </label>
        <button type="button" className="btn" disabled={busy} onClick={() => void createAssignment()}>
          Create assignment
        </button>
      </div>
      {message ? (
        <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--good)", margin: 0 }}>
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" style={{ fontSize: 13, color: "var(--bad)", margin: 0 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
