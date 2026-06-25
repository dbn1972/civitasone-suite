"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, ActionButton, EmptyState } from "../../../_components/ds";

type Row = { id: string; label: string; status?: string };

const LOCATION_TYPES = [
  { value: "state", label: "State" },
  { value: "district", label: "District" },
  { value: "block", label: "Block" },
  { value: "ward", label: "Ward" },
  { value: "office", label: "Office" },
  { value: "facility", label: "Facility" },
] as const;

const inputStyle = {
  width: "100%",
  padding: 8,
  borderRadius: 8,
  border: "1px solid var(--line)",
} as const;

const fieldCol = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 4,
  marginBottom: 12,
};

export function LocationActions({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState("office");
  const [lgdCode, setLgdCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/proxy/v1/locations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, type, lgdCode: lgdCode || undefined }),
      });
      if (!res.ok) throw new Error(await res.text());
      setName("");
      setLgdCode("");
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to create location.");
    } finally {
      setBusy(false);
    }
  }

  async function archive(id: string, reason?: string) {
    const res = await fetch(`/api/proxy/v1/locations/${id}/archive`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: reason || undefined }),
    });
    if (!res.ok) throw new Error(await res.text());
    router.refresh();
  }

  const active = rows.filter((r) => r.status !== "archived").slice(0, 8);

  return (
    <div className="grid g-2" style={{ marginBottom: 18 }}>
      <Card title="Create Location">
        <form className="pad" onSubmit={create}>
          <div style={fieldCol}>
            <label className="l" htmlFor="loc-name">Location name</label>
            <input
              id="loc-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={fieldCol}>
            <label className="l" htmlFor="loc-type">Location type</label>
            <select
              id="loc-type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              style={inputStyle}
            >
              {LOCATION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div style={fieldCol}>
            <label className="l" htmlFor="loc-lgd">LGD code (optional)</label>
            <input
              id="loc-lgd"
              value={lgdCode}
              onChange={(e) => setLgdCode(e.target.value)}
              style={inputStyle}
            />
          </div>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? "Saving…" : "Add location"}
          </button>
          <p
            role="status"
            aria-live="polite"
            style={{ minHeight: 18, marginTop: 8, fontSize: 12, color: "var(--danger, #b91c1c)" }}
          >
            {message}
          </p>
        </form>
      </Card>
      <Card title="Operational Controls">
        <div className="pad">
          {active.length === 0 ? (
            <EmptyState
              icon="🏢"
              title="No active locations"
              message="Locations you create will appear here for operational control."
            />
          ) : (
            active.map((row) => (
              <div key={row.id} className="prefrow">
                <span>{row.label}</span>
                <ActionButton
                  label="Archive"
                  className="btn ghost"
                  danger
                  requireReason
                  reasonLabel="Reason for archiving"
                  confirmTitle="Archive this location?"
                  confirmDescription={`This will archive “${row.label}”. Archived locations are hidden from active operations and cannot be selected for new records.`}
                  confirmLabel="Archive location"
                  onConfirm={(reason) => archive(row.id, reason)}
                  onSuccess={() => router.refresh()}
                />
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
