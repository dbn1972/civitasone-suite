"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const inputStyle = { width: "100%", padding: "8px 12px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 } as const;

export default function NewGuesthouseBookingPage() {
  const router = useRouter();
  const [roomId, setRoomId] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestRef, setGuestRef] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [sponsorDept, setSponsorDept] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [fieldError, setFieldError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldError("");
    if (!UUID_RE.test(roomId.trim())) { setFieldError("A valid Room ID (UUID) is required."); return; }
    if (!guestName.trim()) { setFieldError("Guest name is required."); return; }
    if (guestRef.trim() && !UUID_RE.test(guestRef.trim())) { setFieldError("Guest employee ref must be a valid UUID, or leave it blank."); return; }
    if (!checkIn || !checkOut) { setFieldError("Both check-in and check-out are required."); return; }
    const checkInIso = new Date(checkIn).toISOString();
    const checkOutIso = new Date(checkOut).toISOString();
    if (new Date(checkOutIso) <= new Date(checkInIso)) { setFieldError("Check-out must be after check-in."); return; }
    setSubmitting(true);
    try {
      const payload = {
        roomId: roomId.trim(),
        guestName: guestName.trim(),
        ...(guestRef.trim() ? { guestRef: guestRef.trim() } : {}),
        checkIn: checkInIso,
        checkOut: checkOutIso,
        ...(sponsorDept.trim() ? { sponsorDept: sponsorDept.trim() } : {}),
      };
      const res = await fetch("/api/proxy/v1/estab/room-bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 202 || res.ok) {
        setToast({ type: "success", message: `Booking requested for ${guestName.trim()}. It will appear in the register shortly.` });
        setTimeout(() => router.push("/estab/guesthouse"), 900);
      } else {
        const text = await res.text();
        setToast({ type: "error", message: text || `Error ${res.status}` });
      }
    } catch {
      setToast({ type: "error", message: "Network error. Please try again." });
    } finally {
      setSubmitting(false);
      setTimeout(() => setToast(null), 5000);
    }
  };

  return (
    <>
      <a className="back" href="/estab/guesthouse">← Back</a>
      <div className="ph" style={{ marginTop: 6 }}>
        <div>
          <h1>New Guest House Booking</h1>
          <div className="sub">Reserve a room for a guest. The booking enters the register pending approval.</div>
        </div>
      </div>

      {toast && (
        <div
          className="banner"
          role={toast.type === "error" ? "alert" : "status"}
          aria-live={toast.type === "error" ? "assertive" : "polite"}
          style={{
            background: toast.type === "success" ? "#ecfdf3" : "#fef2f2",
            border: `1px solid ${toast.type === "success" ? "#6ee7b7" : "#fca5a5"}`,
            color: toast.type === "success" ? "#065f46" : "#991b1b",
            borderRadius: 12,
            padding: "13px 16px",
            marginBottom: 18,
            fontSize: 13,
          }}
        >
          {toast.message}
        </div>
      )}

      <div className="card">
        <div className="card-h"><h3>Booking details</h3></div>
        <form onSubmit={handleSubmit}>
          <div className="fields">
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
              <label htmlFor="roomId" className="l">Room ID <span style={{ color: "#ef4444" }}>*</span></label>
              <input id="roomId" type="text" value={roomId} onChange={(e) => setRoomId(e.target.value)} required placeholder="Room UUID" aria-describedby="roomId-help" style={inputStyle} />
              <span id="roomId-help" className="sub" style={{ fontSize: 12 }}>Enter the room&apos;s ID. A room picker is pending a rooms directory API.</span>
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
              <label htmlFor="guestName" className="l">Guest name <span style={{ color: "#ef4444" }}>*</span></label>
              <input id="guestName" type="text" value={guestName} onChange={(e) => setGuestName(e.target.value)} required placeholder="Full name of the guest" style={inputStyle} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
              <label htmlFor="guestRef" className="l">Guest employee ref (optional)</label>
              <input id="guestRef" type="text" value={guestRef} onChange={(e) => setGuestRef(e.target.value)} placeholder="Employee UUID, if the guest is staff" style={inputStyle} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
              <label htmlFor="checkIn" className="l">Check-in <span style={{ color: "#ef4444" }}>*</span></label>
              <input id="checkIn" type="datetime-local" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} required style={inputStyle} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
              <label htmlFor="checkOut" className="l">Check-out <span style={{ color: "#ef4444" }}>*</span></label>
              <input id="checkOut" type="datetime-local" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} required style={inputStyle} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
              <label htmlFor="sponsorDept" className="l">Sponsoring department (optional)</label>
              <input id="sponsorDept" type="text" value={sponsorDept} onChange={(e) => setSponsorDept(e.target.value)} placeholder="e.g. Administration" style={inputStyle} />
            </div>
          </div>
          {fieldError && (
            <div className="pad" role="alert" aria-live="assertive" style={{ color: "var(--bad)", fontSize: 13, paddingTop: 0 }}>{fieldError}</div>
          )}
          <div className="pad" style={{ borderTop: "1px solid var(--line)", display: "flex", gap: 8 }}>
            <button type="submit" className="btn primary" disabled={submitting}>{submitting ? "Booking…" : "Create booking"}</button>
            <a href="/estab/guesthouse" className="btn ghost">Cancel</a>
          </div>
        </form>
      </div>
    </>
  );
}
