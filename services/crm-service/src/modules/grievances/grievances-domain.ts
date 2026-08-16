/**
 * grievances-domain.ts
 *
 * CPGRAMS-aligned domain constants, types and Zod schemas for the grievances
 * module. Exported separately so vitest unit tests can import without pulling
 * in Fastify or the database layer.
 */
import { z } from "zod";

export const PRIORITY = ["low", "normal", "high", "urgent"] as const;

/**
 * CPGRAMS-aligned status vocabulary (DARPG portal compatible).
 *
 * Legacy → CPGRAMS mapping:
 *   open        → REGISTERED
 *   assigned    → FORWARDED
 *   in_progress → ATTENDED
 *   resolved    → DISPOSED
 *   closed      → DISPOSED
 *   escalated   → APPEAL
 */
export const STATUS = [
  "REGISTERED",
  "FORWARDED",
  "ATTENDED",
  "DISPOSED",
  "APPEAL",
] as const;

export type GrievanceStatus = (typeof STATUS)[number];

/**
 * Ministry code set by the deploying ministry via MINISTRY_CODE env var.
 * Defaults to "DARPG" for the central CPGRAMS portal.
 */
export const MINISTRY_CODE = process.env.MINISTRY_CODE ?? "DARPG";

/**
 * Returns the year-prefix portion of a CPGRAMS reference number.
 * The 6-digit sequence suffix is appended by the database (nextval).
 * Full format: DARPG/2026/000001
 */
export function grievanceRefPrefix(): string {
  const yr = new Date().getFullYear();
  return `${MINISTRY_CODE}/${yr}/`;
}

/** Regex that validates a fully-formed CPGRAMS reference number. */
export const REF_PATTERN = /^[A-Z]+\/\d{4}\/\d{6}$/;

/** Human-readable label for each CPGRAMS status. */
export const STATUS_LABEL: Record<GrievanceStatus, string> = {
  REGISTERED: "Registered",
  FORWARDED: "Forwarded",
  ATTENDED: "Attended",
  DISPOSED: "Disposed",
  APPEAL: "Appeal",
};

/**
 * Legacy CivitasOne status → CPGRAMS status mapping.
 * Used by migration 0082 and kept here as the canonical reference.
 */
export const LEGACY_STATUS_MAP: Record<string, GrievanceStatus> = {
  open: "REGISTERED",
  assigned: "FORWARDED",
  in_progress: "ATTENDED",
  resolved: "DISPOSED",
  closed: "DISPOSED",
  escalated: "APPEAL",
};

// ── Zod schemas ────────────────────────────────────────────────────────────────

export const createBody = z.object({
  contactId: z.string().uuid().optional(),
  citizenName: z.string().min(1).max(200),
  citizenPhone: z.string().min(3).max(32).optional(),
  citizenEmail: z.string().email().max(320).optional(),
  category: z.string().min(1).max(64),
  subject: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  priority: z.enum(PRIORITY).default("normal"),
  dueAt: z.string().datetime().optional(),
});

export const assignBody = z.object({ assignedTo: z.string().uuid() });

export const resolveBody = z.object({
  resolution: z.string().min(1).max(5000),
});

/** PATCH /forward — forward to a department/office */
export const forwardBody = z.object({
  forwardedTo: z.string().min(1).max(200),
});

/** PATCH /first-appeal — citizen files a first appeal */
export const appealBody = z.object({
  appealReason: z.string().max(2000).optional(),
});
