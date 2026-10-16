"use client";

/**
 * GAP-HR-SOCIAL-FEED-03: the empty state used to promise a "Give kudos"
 * action that didn't exist anywhere on this page. Corrected in review:
 * EntityPicker is already built, tested, and live (EditEmployeeForm.tsx,
 * the add-employee wizard, StartOnboardingPicker.tsx) -- adopting it here
 * for the receiver picker is the same small, mechanical reuse those three
 * already do, not a wait on unbuilt shared work. Reuses the existing
 * searchEmployees/resolveEmployees adapter (GET /v1/hrms/employees, already
 * DIRECTORY_ROLES-gated, no PII) unchanged -- no new backend endpoint.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFormError } from "@/lib/useFormError";
import { Modal, EntityPicker } from "../../../_components/ds";
import { searchEmployees, resolveEmployees } from "@/lib/entityAdapters/employee";

const BADGES = [
  { value: "star", label: "⭐ Star" },
  { value: "rocket", label: "🚀 Rocket" },
  { value: "heart", label: "❤️ Heart" },
  { value: "trophy", label: "🏆 Trophy" },
  { value: "fire", label: "🔥 Fire" },
  { value: "lightning", label: "⚡ Lightning" },
  { value: "thumbsup", label: "👍 Thumbs up" },
] as const;

export function GiveKudosButton({ label }: { label: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [receiverId, setReceiverId] = useState<string | null>(null);
  const [badge, setBadge] = useState<string>("star");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const formError = useFormError("kudos");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function reset() {
    setReceiverId(null);
    setBadge("star");
    setMessage("");
    setError("");
    setFieldErrors({});
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!receiverId) {
      setFieldErrors({ receiverId: "Pick a colleague to give kudos to." });
      return;
    }
    setBusy(true);
    setError("");
    setFieldErrors({});
    try {
      const res = await fetch("/api/proxy/v1/hrms/kudos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ receiverId, badge, message }),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setFieldErrors(resolved.fieldErrors);
        setError(resolved.message);
        return;
      }
      setOpen(false);
      reset();
      router.refresh();
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn primary" onClick={() => setOpen(true)}>
        {label}
      </button>
      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          reset();
        }}
        title={label}
      >
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label htmlFor="kudos-receiver" style={{ display: "block", fontSize: 13, marginBottom: 4 }}>
              Colleague
            </label>
            <EntityPicker
              id="kudos-receiver"
              value={receiverId}
              onChange={(v) => setReceiverId(Array.isArray(v) ? (v[0] ?? null) : v)}
              search={searchEmployees}
              resolve={resolveEmployees}
              placeholder="Search for a colleague…"
              aria-label="Colleague to give kudos to"
            />
            {fieldErrors.receiverId ? (
              <span role="alert" style={{ fontSize: 12, color: "var(--danger)" }}>
                {fieldErrors.receiverId}
              </span>
            ) : null}
          </div>
          <div>
            <label htmlFor="kudos-badge" style={{ display: "block", fontSize: 13, marginBottom: 4 }}>
              Badge
            </label>
            <select
              id="kudos-badge"
              value={badge}
              onChange={(e) => setBadge(e.target.value)}
              style={{ minHeight: 40, width: "100%", borderRadius: 8, border: "1px solid var(--line)" }}
            >
              {BADGES.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="kudos-message" style={{ display: "block", fontSize: 13, marginBottom: 4 }}>
              Message
            </label>
            <textarea
              id="kudos-message"
              required
              minLength={5}
              maxLength={500}
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              style={{ width: "100%", borderRadius: 8, border: "1px solid var(--line)", padding: 8 }}
              aria-invalid={fieldErrors.message ? true : undefined}
              aria-describedby={fieldErrors.message ? "kudos-message-err" : undefined}
            />
            {fieldErrors.message ? (
              <span id="kudos-message-err" role="alert" style={{ fontSize: 12, color: "var(--danger)" }}>
                {fieldErrors.message}
              </span>
            ) : null}
          </div>
          {error ? (
            <p role="alert" aria-live="assertive" style={{ fontSize: 12, color: "var(--danger)", margin: 0 }}>
              {error}
            </p>
          ) : null}
          <button type="submit" className="btn primary" disabled={busy} style={{ minHeight: 44 }}>
            {busy ? "Sending…" : "Give kudos"}
          </button>
        </form>
      </Modal>
    </>
  );
}
