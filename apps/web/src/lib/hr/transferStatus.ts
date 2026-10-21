import { humanizeStatus } from "@/lib/formatters";

/**
 * GAP-HR-TRANSFER-07/08: the single source of truth for a transfer order's
 * status vocabulary -- the statuses services/hrms-service actually produces,
 * which action each one allows, its pill tone, its pipeline position and the
 * stat bucket it is counted in. Labels are NOT kept here: they live in the
 * `transferUi.status.*` message keys (en/hi) so the card, the filter dropdown
 * and the table all read the same translated words; transferStatusLabel()
 * below resolves them, falling back to humanizeStatus() for a status this
 * module has never heard of.
 *
 * Real enum (lifecycle/consumer.ts, lifecycle/eoffice-consumer.ts,
 * employee/consumer.ts):
 *  - direct path: requested -> ordered -> relieved -> joined
 *    (legacy rows may still sit in `pending`, which the backend accepts for
 *    issue-order exactly like `requested`)
 *  - eOffice-approval path: pending_approval -> pending_effective ->
 *    completed, or -> cancelled
 *  - approved / rejected: legacy values kept by the hrms_transfers status
 *    CHECK constraint (migration 0042) for backward compatibility.
 */
export const TRANSFER_STATUSES = [
  "requested",
  "pending",
  "ordered",
  "relieved",
  "joined",
  "pending_approval",
  "pending_effective",
  "completed",
  "cancelled",
  "approved",
  "rejected",
] as const;

export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export type TransferTone = "good" | "warn" | "mut" | "bad" | "info";

/** Pill tone per status -- passed explicitly to StatusPill and DataTable's
 * `statusVariants`, so the same status reads the same on the card and in the
 * table without recolouring the words `requested`/`pending` on other screens
 * that share the global StatusPill map. */
export const TRANSFER_STATUS_TONE: Record<TransferStatus, TransferTone> = {
  requested: "warn",
  pending: "warn",
  ordered: "warn",
  relieved: "info",
  joined: "good",
  pending_approval: "warn",
  pending_effective: "warn",
  completed: "good",
  cancelled: "bad",
  approved: "good",
  rejected: "bad",
};

/** Plain-data tone lookup (DataTable `statusVariants` takes a Record). */
export function transferStatusTones(): Record<string, TransferTone> {
  return { ...TRANSFER_STATUS_TONE };
}

export function transferStatusTone(status: string): TransferTone | undefined {
  return (TRANSFER_STATUS_TONE as Record<string, TransferTone>)[status];
}

/** Minimal shape of a next-intl translator scoped to `transferUi` -- kept
 * structural so this module stays free of next-intl types. */
export interface StatusTranslator {
  (key: string): string;
  has: (key: string) => boolean;
}

/** Localised label for a transfer status: transferUi.status.<status>, else a
 * humanised version of the raw value (never the raw enum string). */
export function transferStatusLabel(tr: StatusTranslator, status: string): string {
  return tr.has(`status.${status}`) ? tr(`status.${status}`) : humanizeStatus(status);
}

/** Plain-data label table (DataTable `statusLabels`) for the statuses present. */
export function transferStatusLabels(tr: StatusTranslator, statuses: Iterable<string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of statuses) out[s] = transferStatusLabel(tr, s);
  return out;
}

/** True for a status produced by the eOffice-approval path, which doesn't
 * advance through the direct-path numbered pipeline below (it has its own,
 * simpler approve/effective/cancel shape) -- rendered as plain status text
 * instead. */
export function isEofficeStatus(status: string): boolean {
  return status === "pending_approval" || status === "pending_effective" || status === "completed";
}

/** The direct (non-eOffice) pipeline, in order. Each key is also the
 * `transferUi.status.*` label key. */
export const DIRECT_PIPELINE: ReadonlyArray<{ key: "requested" | "ordered" | "relieved" | "joined" }> = [
  { key: "requested" },
  { key: "ordered" },
  { key: "relieved" },
  { key: "joined" },
];

const DIRECT_PIPELINE_INDEX: Record<string, number> = {
  requested: 0,
  pending: 0,
  ordered: 1,
  relieved: 2,
  joined: 3,
};

export function directPipelineIndex(status: string): number {
  return DIRECT_PIPELINE_INDEX[status] ?? 0;
}

/**
 * Which lifecycle action a status allows -- mirrors the backend guards in
 * services/hrms-service/src/modules/lifecycle/routes.ts exactly (issue-order
 * from requested|pending, relieve from ordered, join from relieved) so a
 * button is only offered where the route will accept it.
 */
export const ISSUE_ORDER_FROM: ReadonlyArray<string> = ["requested", "pending"];
export const RELIEVE_FROM: ReadonlyArray<string> = ["ordered"];
export const JOIN_FROM: ReadonlyArray<string> = ["relieved"];

/** Stat-card bucket. Every status lands in exactly one bucket, so the bucket
 * counts always sum to the total. An unrecognised status is counted as
 * `pending` (needs a human to look at it) rather than silently dropped. */
export type TransferBucket = "completed" | "pending" | "approved" | "relieved" | "cancelled";

const BUCKET: Record<string, TransferBucket> = {
  completed: "completed",
  joined: "completed",
  relieved: "relieved",
  ordered: "approved",
  pending_effective: "approved",
  approved: "approved",
  cancelled: "cancelled",
  rejected: "cancelled",
  requested: "pending",
  pending: "pending",
  pending_approval: "pending",
};

export function transferStatusBucket(status: string): TransferBucket {
  return BUCKET[status] ?? "pending";
}

export function countTransferBuckets(statuses: Iterable<string>): Record<TransferBucket, number> {
  const counts: Record<TransferBucket, number> = { completed: 0, pending: 0, approved: 0, relieved: 0, cancelled: 0 };
  for (const s of statuses) counts[transferStatusBucket(s)] += 1;
  return counts;
}
