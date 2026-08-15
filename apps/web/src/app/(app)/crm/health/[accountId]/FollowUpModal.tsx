"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface FollowUpModalProps {
  accountId: string;
  onClose: () => void;
}

const FIELD: React.CSSProperties = { padding: "8px 12px", border: "1px solid var(--line)", borderRadius: "var(--r)", background: "var(--bg)", color: "var(--ink)", fontSize: 14, width: "100%" };
const LABEL: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 14, fontWeight: 500 };

const SERVICE_TYPES = [
  "Health Score Review",
  "General Follow-up",
  "Service Request",
  "Account Review Meeting",
  "Data Quality Check",
  "Other",
];

export function FollowUpModal({ accountId, onClose }: FollowUpModalProps) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const [serviceType, setServiceType] = useState("Health Score Review");
  const [notes, setNotes] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Move focus into modal on open; return on close
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => prev?.focus();
  }, []);

  const handleOverlayKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/crm/service-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, serviceType, notes, priority, source: "health_followup" }),
      });
      if (!res.ok) throw new Error(await res.text());
      router.push("/crm/service-requests");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create follow-up. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="followup-title"
      onKeyDown={handleOverlayKey}
      style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      {/* backdrop */}
      <div
        onClick={onClose}
        style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)" }}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        style={{ position: "relative", background: "var(--bg)", borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,0.2)", width: "100%", maxWidth: 480, padding: "24px 28px", outline: "none" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 id="followup-title" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Create Follow-up</h2>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "var(--ink2)", lineHeight: 1 }}>✕</button>
        </div>

        <p style={{ fontSize: 13, color: "var(--ink2)", margin: "0 0 20px" }}>
          Account:{" "}
          <code style={{ fontFamily: "monospace", background: "var(--surface)", padding: "2px 6px", borderRadius: 4 }}>
            {accountId}
          </code>
        </p>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <label style={LABEL}>
            Service Type
            <select value={serviceType} onChange={(e) => setServiceType(e.target.value)} style={FIELD} required>
              {SERVICE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>

          <label style={LABEL}>
            Priority
            <select value={priority} onChange={(e) => setPriority(e.target.value as "low" | "medium" | "high")} style={FIELD}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>

          <label style={LABEL}>
            Notes
            <textarea
              style={{ ...FIELD, minHeight: 80, resize: "vertical" }}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Describe the follow-up action needed..."
              maxLength={500}
            />
          </label>

          {error && (
            <p role="alert" style={{ color: "#ef4444", fontSize: 13, margin: 0, padding: "8px 12px", background: "#fef2f2", borderRadius: "var(--r)", border: "1px solid #fecaca" }}>
              {error}
            </p>
          )}

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn primary" disabled={saving} aria-busy={saving}>
              {saving ? "Creating…" : "Create Service Request"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
