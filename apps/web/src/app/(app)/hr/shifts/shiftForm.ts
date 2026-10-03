/**
 * GAP-HR-SHIFTS-01: pure form <-> API payload mapping for the shift editor,
 * kept out of the component so it is unit-testable without rendering.
 */
export type ManagedShift = { id: string; name: string; startTime: string; endTime: string; graceMinutes: number };

export type ShiftForm = { name: string; startTime: string; endTime: string; graceMins: string };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** API time strings may be HH:MM:SS (postgres `time`); the form and the API body use HH:MM. */
export function toHhmm(t: string): string {
  return t.length >= 5 ? t.slice(0, 5) : t;
}

export function shiftToForm(s: ManagedShift | null): ShiftForm {
  if (!s) return { name: "", startTime: "09:00", endTime: "17:30", graceMins: "15" };
  return { name: s.name, startTime: toHhmm(s.startTime), endTime: toHhmm(s.endTime), graceMins: String(s.graceMinutes) };
}

export type ShiftPayloadResult =
  | { ok: true; payload: { name: string; startTime: string; endTime: string; graceMins: number } }
  | { ok: false; reason: "name" | "time" | "same" | "grace" };

export function toShiftPayload(f: ShiftForm): ShiftPayloadResult {
  const name = f.name.trim();
  if (!name || name.length > 80) return { ok: false, reason: "name" };
  if (!HHMM.test(f.startTime) || !HHMM.test(f.endTime)) return { ok: false, reason: "time" };
  if (f.startTime === f.endTime) return { ok: false, reason: "same" };
  const grace = Number(f.graceMins === "" ? "0" : f.graceMins);
  if (!Number.isInteger(grace) || grace < 0 || grace > 240) return { ok: false, reason: "grace" };
  return { ok: true, payload: { name, startTime: f.startTime, endTime: f.endTime, graceMins: grace } };
}
