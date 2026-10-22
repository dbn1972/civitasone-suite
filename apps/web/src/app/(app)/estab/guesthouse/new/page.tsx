"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button, PageHeader } from "@/app/_components/ds";
import { EmployeePicker } from "@/app/_components/EmployeePicker";
import { useFormError } from "@/lib/useFormError";
import { istLocalToUtcIso } from "./istLocal";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const inputStyle = {
  width: "100%",
  padding: "8px 12px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  fontSize: 13,
} as const;

type FieldKey = "roomId" | "guestName" | "guestRef" | "checkIn" | "checkOut";

export default function NewGuesthouseBookingPage() {
  const tFallback = useTranslations("employeeFallback");
  const t = useTranslations("estabW2");
  const router = useRouter();
  const [roomId, setRoomId] = useState("");
  // GAP-ESTAB-GUESTHOUSE-NEW-01: rooms directory for picker (no more raw UUID).
  const [rooms, setRooms] = useState<Array<{ id: string; roomNo: string; type: string; capacity: number; status: string }>>([]);
  // "loading" until the directory answers; "error" on a non-OK/network failure (never read as "no rooms").
  const [roomsSource, setRoomsSource] = useState<"loading" | "api" | "error">("loading");
  // GAP-ESTAB-GUESTHOUSE-NEW-02: staff directory for optional guest picker.
  const [staff, setStaff] = useState<Array<{ employeeId: string; employeeName?: string; division: string }>>([]);
  const [guestName, setGuestName] = useState("");
  const [guestRef, setGuestRef] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [sponsorDept, setSponsorDept] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [toast, setToast] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const formError = useFormError("booking");
  const fieldRefs = useRef<Partial<Record<FieldKey, HTMLInputElement | HTMLSelectElement | null>>>({});
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      // successTimer holds a setTimeout handle (not a DOM node); clearing the
      // latest handle on unmount is correct — the exhaustive-deps DOM-ref
      // warning is a false positive here.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (successTimer.current) clearTimeout(successTimer.current);
    };
  }, []);

  // GAP-ESTAB-GUESTHOUSE-NEW-01: load the rooms directory for the picker.
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/proxy/v1/estab/rooms?limit=500", { signal: controller.signal });
        if (!res.ok) { setRoomsSource("error"); return; }
        const body = (await res.json()) as { data?: Array<{ id: string; roomNo: string; type: string; capacity: number; status: string }> };
        setRooms(body.data ?? []);
        setRoomsSource("api");
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setRoomsSource("error");
      }
    })();
    return () => controller.abort();
  }, []);

  // GAP-ESTAB-GUESTHOUSE-NEW-02: load the staff directory (operator roster,
  // which carries server-side-resolved names) for the optional guest picker.
  // Reuses the roster rather than over-fetching the full HRMS directory.
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/proxy/v1/estab/operators?activeOnly=true&limit=500", { signal: controller.signal });
        if (res.ok) {
          const body = (await res.json()) as { data?: Array<{ employeeId: string; employeeName?: string; division: string }> };
          setStaff(body.data ?? []);
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
      }
    })();
    return () => controller.abort();
  }, []);

  const setRef = (key: FieldKey) => (el: HTMLInputElement | HTMLSelectElement | null) => {
    fieldRefs.current[key] = el;
  };

  function validate(): Partial<Record<FieldKey, string>> {
    const errs: Partial<Record<FieldKey, string>> = {};
    if (!roomId.trim()) errs.roomId = "Select a room.";
    if (!guestName.trim()) errs.guestName = "Guest name is required.";
    if (guestRef.trim() && !UUID_RE.test(guestRef.trim()))
      errs.guestRef = "Guest employee ref must be a valid UUID, or leave it blank.";
    if (!checkIn) errs.checkIn = "Check-in is required.";
    if (!checkOut) errs.checkOut = "Check-out is required.";
    if (checkIn && checkOut) {
      const ci = istLocalToUtcIso(checkIn);
      const co = istLocalToUtcIso(checkOut);
      if (ci && co && new Date(co) <= new Date(ci)) errs.checkOut = "Check-out must be after check-in.";
    }
    return errs;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || done) return;
    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) {
      // Focus the first invalid field (declared order).
      const order: FieldKey[] = ["roomId", "guestName", "guestRef", "checkIn", "checkOut"];
      const first = order.find((k) => errs[k]);
      if (first) fieldRefs.current[first]?.focus();
      return;
    }
    const checkInIso = istLocalToUtcIso(checkIn)!;
    const checkOutIso = istLocalToUtcIso(checkOut)!;
    setSubmitting(true);
    formError.clear();
    setToast(null);
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
        setDone(true);
        setToast({
          type: "success",
          message: `Booking requested for ${guestName.trim()}. It will appear in the register shortly.`,
        });
        router.push("/estab/guesthouse");
        return;
      }
      setToast({
        type: "error",
        message: (await formError.fromResponse(res, "save")).message,
      });
      setSubmitting(false);
    } catch (caught) {
      setToast({ type: "error", message: formError.fromException("save", caught).message });
      setSubmitting(false);
    }
  };

  const availableRooms = rooms.filter((r) => r.status === "available");
  // A failed directory ("error") has its own message; only a successful, empty directory reads as "none".
  const roomsNote =
    roomsSource === "error" ? t("ghRoomsFailed")
      : roomsSource === "api" && rooms.length === 0 ? t("ghRoomsNone")
        : roomsSource === "api" && availableRooms.length === 0 ? t("ghRoomsNoneAvailable")
          : "";

  return (
    <div className="page-main wrap">
      <PageHeader
        title="New Guest House Booking"
        subtitle={t("ghSubtitleNew")}
        back="/estab/guesthouse"
        help="estab"
      />

      {toast && (
        <div
          className="banner"
          role={toast.type === "error" ? "alert" : "status"}
          aria-live={toast.type === "error" ? "assertive" : "polite"}
          style={{
            background: toast.type === "success" ? "var(--goodbg)" : "var(--badbg)",
            border: `1px solid ${toast.type === "success" ? "#6ee7b7" : "var(--badbd)"}`,
            color: toast.type === "success" ? "var(--good)" : "var(--bad)",
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
        <div className="card-h">
          <h3>Booking details</h3>
        </div>
        <form onSubmit={handleSubmit} noValidate>
          <div className="fields">
            <div
              className="fld"
              style={{
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 4,
              }}
            >
              <label htmlFor="roomId" className="l">
                Room <span style={{ color: "var(--bad)" }}>*</span>
              </label>
              {/* The room is always chosen by name from the directory: a clerk cannot know a room's UUID, so there is no typed fallback. */}
              <select
                id="roomId"
                ref={setRef("roomId")}
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                disabled={roomsSource !== "api" || roomsNote !== ""}
                aria-required="true"
                aria-invalid={fieldErrors.roomId ? true : undefined}
                aria-describedby={fieldErrors.roomId ? "roomId-error" : roomsNote ? "roomId-note" : undefined}
                style={inputStyle}
              >
                <option value="">{roomsSource === "loading" ? t("ghRoomsLoading") : t("ghRoomSelect")}</option>
                {availableRooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {t("ghRoomOption", { roomNo: r.roomNo, type: r.type, capacity: r.capacity })}
                  </option>
                ))}
              </select>
              {roomsNote ? (
                <span id="roomId-note" role={roomsSource === "error" ? "alert" : "note"} className="sub" style={{ fontSize: 12, color: roomsSource === "error" ? "var(--bad)" : undefined }}>
                  {roomsNote}
                </span>
              ) : null}
              {fieldErrors.roomId && (
                <span id="roomId-error" role="alert" style={{ color: "var(--bad)", fontSize: 12 }}>{fieldErrors.roomId}</span>
              )}
            </div>
            <div
              className="fld"
              style={{
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 4,
              }}
            >
              <label htmlFor="guestName" className="l">
                Guest name <span style={{ color: "var(--bad)" }}>*</span>
              </label>
              <input
                id="guestName"
                type="text"
                ref={setRef("guestName")}
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                required
                placeholder="Full name of the guest"
                aria-invalid={fieldErrors.guestName ? true : undefined}
                aria-describedby={fieldErrors.guestName ? "guestName-error" : undefined}
                style={inputStyle}
              />
              {fieldErrors.guestName && (
                <span id="guestName-error" role="alert" style={{ color: "var(--bad)", fontSize: 12 }}>{fieldErrors.guestName}</span>
              )}
            </div>
            <div
              className="fld"
              style={{
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 4,
              }}
            >
              <label htmlFor="guestRef" className="l">
                Guest employee ref (optional)
              </label>
              {staff.length > 0 ? (
                <select
                  id="guestRef"
                  ref={setRef("guestRef")}
                  value={guestRef}
                  onChange={(e) => {
                    const empId = e.target.value;
                    setGuestRef(empId);
                    // Auto-fill guestName from staff selection if currently empty.
                    if (empId) {
                      const s = staff.find((op) => op.employeeId === empId);
                      if (s?.employeeName && !guestName.trim()) setGuestName(s.employeeName);
                    }
                  }}
                  aria-invalid={fieldErrors.guestRef ? true : undefined}
                  aria-describedby={fieldErrors.guestRef ? "guestRef-error guestRef-help" : "guestRef-help"}
                  style={inputStyle}
                >
                  <option value="">External guest (no employee link)</option>
                  {staff.map((s) => (
                    <option key={s.employeeId} value={s.employeeId}>
                      {s.employeeName ?? tFallback("unknownEmployee")} · {s.division}
                    </option>
                  ))}
                </select>
              ) : (
                <EmployeePicker
                  id="guestRef"
                  inputRef={setRef("guestRef")}
                  aria-invalid={fieldErrors.guestRef ? true : undefined}
                  aria-describedby={fieldErrors.guestRef ? "guestRef-error guestRef-help" : "guestRef-help"}
                  value={guestRef || null}
                  clearable
                  placeholder="Search staff, if the guest is staff"
                  onChange={(empId, option) => {
                    setGuestRef(empId ?? "");
                    // Auto-fill guestName from the picked staff member if currently empty.
                    if (option && !guestName.trim()) setGuestName(option.label.replace(/\s*\([^)]*\)$/, ""));
                  }}
                />
              )}
              <span id="guestRef-help" className="sub" style={{ fontSize: 12 }}>
                Link a staff member to auto-fill their name, or leave blank for external guests.
              </span>
              {fieldErrors.guestRef && (
                <span id="guestRef-error" role="alert" style={{ color: "var(--bad)", fontSize: 12 }}>{fieldErrors.guestRef}</span>
              )}
            </div>
            <div
              className="fld"
              style={{
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 4,
              }}
            >
              <label htmlFor="checkIn" className="l">
                Check-in (IST) <span style={{ color: "var(--bad)" }}>*</span>
              </label>
              <input
                id="checkIn"
                type="datetime-local"
                ref={setRef("checkIn")}
                value={checkIn}
                onChange={(e) => setCheckIn(e.target.value)}
                required
                aria-invalid={fieldErrors.checkIn ? true : undefined}
                aria-describedby={fieldErrors.checkIn ? "checkIn-error" : undefined}
                style={inputStyle}
              />
              {fieldErrors.checkIn && (
                <span id="checkIn-error" role="alert" style={{ color: "var(--bad)", fontSize: 12 }}>{fieldErrors.checkIn}</span>
              )}
            </div>
            <div
              className="fld"
              style={{
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 4,
              }}
            >
              <label htmlFor="checkOut" className="l">
                Check-out (IST) <span style={{ color: "var(--bad)" }}>*</span>
              </label>
              <input
                id="checkOut"
                type="datetime-local"
                ref={setRef("checkOut")}
                value={checkOut}
                onChange={(e) => setCheckOut(e.target.value)}
                required
                aria-invalid={fieldErrors.checkOut ? true : undefined}
                aria-describedby={fieldErrors.checkOut ? "checkOut-error" : undefined}
                style={inputStyle}
              />
              {fieldErrors.checkOut && (
                <span id="checkOut-error" role="alert" style={{ color: "var(--bad)", fontSize: 12 }}>{fieldErrors.checkOut}</span>
              )}
            </div>
            <div
              className="fld"
              style={{
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 4,
              }}
            >
              <label htmlFor="sponsorDept" className="l">
                Sponsoring department (optional)
              </label>
              <input
                id="sponsorDept"
                type="text"
                value={sponsorDept}
                onChange={(e) => setSponsorDept(e.target.value)}
                placeholder="e.g. Administration"
                style={inputStyle}
              />
            </div>
          </div>
          <div
            className="pad"
            style={{
              borderTop: "1px solid var(--line)",
              display: "flex",
              gap: 8,
            }}
          >
            <Button type="submit" disabled={submitting || done}>
              {submitting ? "Booking…" : done ? "Booked" : "Create booking"}
            </Button>
            <a href="/estab/guesthouse" className="btn ghost">
              Cancel
            </a>
          </div>
        </form>
      </div>
    </div>
  );
}
