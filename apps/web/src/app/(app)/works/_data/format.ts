/** works feature — small shared display helpers. */
import type { BillStatus } from "./types";

/** IST-friendly calendar date, e.g. "12 Jul 2026". Falls back to "—". */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/** Title-case a snake/kebab enum token, e.g. "so_finalized" → "So finalized". */
export function humanize(token: string | null | undefined): string {
  if (!token) return "—";
  const s = token.replace(/[_-]+/g, " ").trim();
  return s.length === 0 ? "—" : s.charAt(0).toUpperCase() + s.slice(1);
}

/** Shorten a UUID for compact display, e.g. "3f9a1c20…". Falls back to "—". */
export function shortId(id: string | null | undefined): string {
  if (!id) return "—";
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

/**
 * Buckets the granular bill workflow status (draft → so/sdo/auditor/dao/do
 * finalized → submitted) into the coarse status the billing list's stat
 * cards expect: draft | pending | finalized | submitted_ifms.
 */
export function billBucket(status: BillStatus | string): "draft" | "pending" | "finalized" | "submitted_ifms" {
  if (status === "draft") return "draft";
  if (status === "submitted") return "submitted_ifms";
  if (status === "do_finalized") return "finalized";
  return "pending"; // so/sdo/auditor/dao_finalized — mid-workflow
}
