/**
 * WC-010 — pure domain logic for configuration-as-artefact.
 *
 * No I/O: canonicalisation + checksum, the diff algorithm, and the promotion
 * guards (maker-checker, state, optimistic lock). Everything here is
 * deterministic and unit-testable.
 */
import { createHash } from "node:crypto";
import { HttpError } from "../../shared/context.js";

export const ENVIRONMENTS = ["dev", "staging", "uat", "production"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export const PROMOTION_KINDS = ["promote", "rollback"] as const;
export type PromotionKind = (typeof PROMOTION_KINDS)[number];

export const PROMOTION_STATUSES = ["pending", "promoted", "rejected"] as const;
export type PromotionStatus = (typeof PROMOTION_STATUSES)[number];

/** A config set is a flat-or-nested map of key → JSON value. */
export type ConfigEntries = Record<string, unknown>;

// ── canonicalisation + checksum ─────────────────────────────────────────────

/**
 * Deterministic JSON with object keys sorted at every depth, so two logically
 * equal config sets always produce the same checksum regardless of insertion
 * order. Arrays keep their order (order IS meaningful in a config list).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`);
  return `{${parts.join(",")}}`;
}

/** SHA-256 of the canonical form — the artefact's content address. */
export function checksumOf(entries: ConfigEntries): string {
  return createHash("sha256").update(canonicalJson(entries), "utf8").digest("hex");
}

// ── diff ────────────────────────────────────────────────────────────────────

/**
 * Flatten nested plain objects to dot-separated leaf paths.
 *
 * Arrays are LEAVES on purpose: a config list ("allowedOrigins": [...]) reads as
 * one setting to an operator, so reporting `allowedOrigins` as changed is more
 * useful than reporting `allowedOrigins.0`, `allowedOrigins.2`. An empty object
 * is also a leaf so that `{}` → `{a:1}` shows as a change at that path rather
 * than vanishing from the diff entirely.
 */
export function flattenEntries(entries: ConfigEntries, prefix = ""): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [key, value] of Object.entries(entries)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    const isPlainObject =
      value !== null && typeof value === "object" && !Array.isArray(value) &&
      Object.keys(value as Record<string, unknown>).length > 0;
    if (isPlainObject) {
      for (const [k, v] of flattenEntries(value as ConfigEntries, path)) out.set(k, v);
    } else {
      out.set(path, value);
    }
  }
  return out;
}

export interface DiffAdded { path: string; to: unknown }
export interface DiffRemoved { path: string; from: unknown }
export interface DiffChanged { path: string; from: unknown; to: unknown }
export interface DiffUnchanged { path: string; value: unknown }

export interface ConfigDiff {
  added: DiffAdded[];
  removed: DiffRemoved[];
  changed: DiffChanged[];
  unchanged: DiffUnchanged[];
  summary: { added: number; removed: number; changed: number; unchanged: number };
  identical: boolean;
}

/** Value equality by canonical form, so `{a:1,b:2}` equals `{b:2,a:1}`. */
export function valuesEqual(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/**
 * Diff two config sets by leaf path. Paths present only in `to` are added, only
 * in `from` are removed, in both with different values are changed, in both with
 * equal values are unchanged. Output arrays are sorted by path for a stable,
 * reviewable diff.
 */
export function diffConfig(from: ConfigEntries, to: ConfigEntries): ConfigDiff {
  const left = flattenEntries(from);
  const right = flattenEntries(to);

  const added: DiffAdded[] = [];
  const removed: DiffRemoved[] = [];
  const changed: DiffChanged[] = [];
  const unchanged: DiffUnchanged[] = [];

  for (const [path, toValue] of right) {
    if (!left.has(path)) {
      added.push({ path, to: toValue });
      continue;
    }
    const fromValue = left.get(path);
    if (valuesEqual(fromValue, toValue)) unchanged.push({ path, value: toValue });
    else changed.push({ path, from: fromValue, to: toValue });
  }
  for (const [path, fromValue] of left) {
    if (!right.has(path)) removed.push({ path, from: fromValue });
  }

  const byPath = <T extends { path: string }>(rows: T[]): T[] =>
    rows.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const result: ConfigDiff = {
    added: byPath(added),
    removed: byPath(removed),
    changed: byPath(changed),
    unchanged: byPath(unchanged),
    summary: { added: added.length, removed: removed.length, changed: changed.length, unchanged: unchanged.length },
    identical: added.length === 0 && removed.length === 0 && changed.length === 0,
  };
  return result;
}

// ── guards ──────────────────────────────────────────────────────────────────

/** The next artefact number for a set (monotonic, starts at 1). */
export function nextArtefactVersion(currentMax: number | null | undefined): number {
  return (currentMax ?? 0) + 1;
}

/**
 * Maker-checker / separation of duties: whoever REQUESTED a promotion can never
 * be the principal who approves it. Promotion changes what runs in an
 * environment, so a single actor must not be able to do it alone.
 */
export function assertApproverDistinct(requestedBy: string, approverId: string): void {
  if (requestedBy === approverId) {
    throw new HttpError(
      409,
      "MAKER_CHECKER_VIOLATION",
      "the approver of a config promotion must differ from the requester",
    );
  }
}

/** Only a still-pending promotion can be approved or rejected. */
export function assertPendingPromotion(status: string): void {
  if (status !== "pending") {
    throw new HttpError(
      409,
      "NOT_PENDING",
      `promotion is '${status}', only 'pending' promotions can be decided`,
    );
  }
}

/**
 * Optimistic lock check. `expected` comes from the client (the version it read);
 * `current` is what the row holds now. A mismatch means someone else wrote in
 * between → 409, never a silent overwrite.
 */
export function assertVersionMatch(current: number, expected: number | undefined): void {
  if (expected === undefined) return;
  if (current !== expected) {
    throw new HttpError(
      409,
      "VERSION_CONFLICT",
      `version conflict: expected ${expected}, current is ${current}`,
    );
  }
}

/**
 * A rollback may only target an artefact version that was ALREADY approved and
 * promoted into that environment before. That is what makes rollback safe to
 * perform with a single (privileged) actor: it restores a state the tenant's
 * own maker-checker already sanctioned, rather than introducing new config.
 */
export function assertRollbackTargetPreviouslyPromoted(
  promotedVersions: readonly number[],
  targetVersion: number,
): void {
  if (!promotedVersions.includes(targetVersion)) {
    throw new HttpError(
      422,
      "ROLLBACK_TARGET_NOT_PROMOTED",
      `artefact version ${targetVersion} was never promoted to this environment, so it cannot be rolled back to`,
    );
  }
}

/** A rollback must move to a strictly earlier artefact version than the live one. */
export function assertRollbackIsBackwards(liveVersion: number, targetVersion: number): void {
  if (targetVersion >= liveVersion) {
    throw new HttpError(
      422,
      "NOT_A_ROLLBACK",
      `rollback target ${targetVersion} must be earlier than the live version ${liveVersion}`,
    );
  }
}
