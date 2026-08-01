import type { AucRow } from "./AucTable";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

// Server returns accumulated_minor as a bigint-serialized string or a number, both
// paise. Normalize to a validated non-negative integer string so every downstream
// consumer (BigInt(...) in page.tsx, formatMoney, ConfirmDialog copy) can trust the
// value instead of risking a crash on a malformed payload like "150.00" or "abc" —
// BigInt() throws a SyntaxError on any non-integer string, which would otherwise take
// down the whole server component render.
export function toIntegerMinorString(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 ? String(value) : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return /^\d+$/.test(trimmed) ? trimmed : null;
  }
  return null;
}

export function mapAucRows(payload: unknown): AucRow[] | null {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : null;
  if (!rows) return null;

  const mapped: AucRow[] = [];
  for (const raw of rows) {
    if (!isRecord(raw)) continue;
    const id = raw.id;
    const projectCode = raw.projectCode;
    const name = raw.name;
    const status = raw.status;
    if (typeof id !== "string" || typeof projectCode !== "string" || typeof name !== "string" || typeof status !== "string") continue;
    const accumulatedMinor = toIntegerMinorString(raw.accumulatedMinor);
    // A row whose money field cannot be trusted is dropped rather than displayed
    // with a silently-substituted amount — never show a fabricated cost.
    if (accumulatedMinor === null) continue;
    mapped.push({
      id,
      projectCode,
      name,
      wbsRef: typeof raw.wbsRef === "string" ? raw.wbsRef : null,
      accumulatedMinor,
      status,
      assetId: typeof raw.assetId === "string" ? raw.assetId : null,
    });
  }
  return mapped;
}
