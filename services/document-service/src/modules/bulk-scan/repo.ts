/**
 * bulk_scan repository. Queries ONLY the bulk_scan schema (module isolation).
 *
 * Reads use scopedRead (tenant GUC from the ambient tenant context; every query also filters tenant_id).
 * Writes take a transaction handle and are called ONLY from consumers / the worker pipeline
 * (CQRS: route files never import the write functions).
 *
 * transition() is the single write path for file state: race-safe conditional UPDATE + append-only event.
 */
import { and, asc, desc, eq, inArray, isNull, lte, ne, notExists, notInArray, or, sql, count } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { SYSTEM_ACTOR_ID } from "@civitasone/outbox";
import { db, scopedRead } from "../../shared/db.js";
import {
  links, batches, batchFiles, fileEvents, settings, settingsChangeRequests, profiles,
  type BatchRow, type BatchFileRow, type BatchFileInsert, type FileEventRow,
  type ChangeRequestRow, type ProfileRow, type SettingsRow,
} from "./schema.js";
import {
  CANONICAL_RELEASING_STATES, LEASED_STATES, PIPELINE_SETTLED_STATES, assertTransition,
  type FileState,
} from "./state.js";
import { parseStoredSettings, applyProfile, isSensitiveChange } from "./settings.js";
import { profileConfigSchema, profileChangeSchema, type BulkScanSettings, type ProfileConfig } from "./validators.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select" | "delete" | "execute">;
type Reader = Pick<typeof db, "select" | "selectDistinct">;

// ── settings / profiles (reads) ─────────────────────────────────

export async function getSettingsRow(tenantId: string): Promise<SettingsRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(settings).where(eq(settings.tenantId, tenantId)).limit(1));
  return rows[0] ?? null;
}

export async function getProfile(tenantId: string, id: string): Promise<ProfileRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(profiles).where(and(eq(profiles.tenantId, tenantId), eq(profiles.id, id), isNull(profiles.deletedAt))).limit(1));
  return rows[0] ?? null;
}

export async function listProfiles(tenantId: string): Promise<ProfileRow[]> {
  return scopedRead((tx) =>
    tx.select().from(profiles).where(and(eq(profiles.tenantId, tenantId), isNull(profiles.deletedAt))).orderBy(asc(profiles.name)));
}

export interface EffectiveSettings { settings: BulkScanSettings; version: number; degraded: boolean; profileId: string | null; profile: ProfileConfig | null }

/**
 * Effective settings for a tenant, optionally with a scan profile layered over them. Never throws for a
 * missing/invalid stored document: it falls back to the documented SAFE DEFAULTS (fail-closed malware ON,
 * tesseract only, ...) - see settings.ts.
 */
export async function resolveEffectiveSettings(tenantId: string, profileId?: string | null): Promise<EffectiveSettings> {
  const row = await getSettingsRow(tenantId);
  const { settings: base, degraded } = parseStoredSettings(row?.config ?? null);
  let profile: ProfileConfig | null = null;
  if (profileId) {
    const p = await getProfile(tenantId, profileId);
    const parsed = p ? profileConfigSchema.safeParse(p.config) : null;
    if (parsed?.success) profile = parsed.data;
  }
  let effective = base;
  try { effective = applyProfile(base, profile); } catch { profile = null; }
  return { settings: effective, version: row?.version ?? 0, degraded, profileId: profile ? (profileId ?? null) : null, profile };
}

export async function listChangeRequests(tenantId: string, status?: string): Promise<ChangeRequestRow[]> {
  return scopedRead((tx) =>
    tx.select().from(settingsChangeRequests)
      .where(and(eq(settingsChangeRequests.tenantId, tenantId), status ? eq(settingsChangeRequests.status, status) : undefined))
      .orderBy(desc(settingsChangeRequests.createdAt)).limit(100));
}

export async function getChangeRequest(tenantId: string, id: string): Promise<ChangeRequestRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(settingsChangeRequests).where(and(eq(settingsChangeRequests.tenantId, tenantId), eq(settingsChangeRequests.id, id))).limit(1));
  return rows[0] ?? null;
}

// ── batches / files (reads) ─────────────────────────────────────

export async function getBatch(tenantId: string, id: string): Promise<BatchRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(batches).where(and(eq(batches.tenantId, tenantId), eq(batches.id, id))).limit(1));
  return rows[0] ?? null;
}

/** In-transaction read of a batch (use inside db.transaction; getBatch opens its own read transaction). */
export async function getBatchTx(tx: Writer, tenantId: string, id: string): Promise<BatchRow | null> {
  const rows = await tx.select().from(batches).where(and(eq(batches.tenantId, tenantId), eq(batches.id, id))).limit(1);
  return rows[0] ?? null;
}

export async function listBatches(tenantId: string, o: { status?: string | undefined; limit: number; offset: number }): Promise<BatchRow[]> {
  return scopedRead((tx) =>
    tx.select().from(batches)
      .where(and(eq(batches.tenantId, tenantId), o.status ? eq(batches.status, o.status) : undefined))
      .orderBy(desc(batches.createdAt), desc(batches.id)).limit(o.limit).offset(o.offset));
}

/** Per-state file counts for a set of batches (one grouped query, no N+1). */
export async function stateCounts(tenantId: string, batchIds: string[]): Promise<Map<string, Record<string, number>>> {
  const out = new Map<string, Record<string, number>>();
  if (batchIds.length === 0) return out;
  const rows = await scopedRead((tx) =>
    tx.select({ batchId: batchFiles.batchId, state: batchFiles.state, n: count() })
      .from(batchFiles)
      .where(and(eq(batchFiles.tenantId, tenantId), inArray(batchFiles.batchId, batchIds)))
      .groupBy(batchFiles.batchId, batchFiles.state));
  for (const r of rows) {
    const m = out.get(r.batchId) ?? {};
    m[r.state] = Number(r.n);
    out.set(r.batchId, m);
  }
  return out;
}

export async function getFile(tenantId: string, id: string): Promise<BatchFileRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(batchFiles).where(and(eq(batchFiles.tenantId, tenantId), eq(batchFiles.id, id))).limit(1));
  return rows[0] ?? null;
}

export async function listBatchFiles(
  tenantId: string, batchId: string, o: { state?: string | undefined; limit: number; offset: number },
): Promise<BatchFileRow[]> {
  return scopedRead((tx) =>
    tx.select().from(batchFiles)
      .where(and(eq(batchFiles.tenantId, tenantId), eq(batchFiles.batchId, batchId), o.state ? eq(batchFiles.state, o.state) : undefined))
      .orderBy(asc(batchFiles.createdAt), asc(batchFiles.id)).limit(o.limit).offset(o.offset));
}

export async function listFileEvents(tenantId: string, fileId: string): Promise<FileEventRow[]> {
  return scopedRead((tx) =>
    tx.select().from(fileEvents).where(and(eq(fileEvents.tenantId, tenantId), eq(fileEvents.fileId, fileId))).orderBy(asc(fileEvents.createdAt)));
}

// ── batch writes ────────────────────────────────────────────────

export async function insertBatch(tx: Writer, row: typeof batches.$inferInsert): Promise<void> {
  await tx.insert(batches).values(row);
}

/**
 * Atomically reserve capacity for `n` files / `bytes` in a batch. Returns false when the batch is missing,
 * cancelled, or the reservation would exceed the limits (conditional UPDATE: race-safe across concurrent
 * register commands). A completed batch is re-opened to `processing`.
 */
export async function reserveBatchCapacity(
  tx: Writer,
  a: { tenantId: string; batchId: string; n: number; bytes: number; maxFiles: number; maxBytes: number; actorId: string },
): Promise<boolean> {
  const rows = await tx.update(batches)
    .set({
      fileCount: sql`${batches.fileCount} + ${a.n}`,
      totalBytes: sql`${batches.totalBytes} + ${a.bytes}`,
      status: sql`CASE WHEN ${batches.status} = 'completed' THEN 'processing' ELSE ${batches.status} END`,
      completedAt: sql`CASE WHEN ${batches.status} = 'completed' THEN NULL ELSE ${batches.completedAt} END`,
      updatedBy: a.actorId, updatedAt: new Date(), version: sql`${batches.version} + 1`,
    })
    .where(and(
      eq(batches.id, a.batchId), eq(batches.tenantId, a.tenantId), ne(batches.status, "cancelled"),
      sql`${batches.fileCount} + ${a.n} <= ${a.maxFiles}`,
      sql`${batches.totalBytes} + ${a.bytes} <= ${a.maxBytes}`,
    ))
    .returning({ id: batches.id });
  return rows.length > 0;
}

export async function insertFiles(tx: Writer, rows: BatchFileInsert[]): Promise<void> {
  if (rows.length === 0) return;
  await tx.insert(batchFiles).values(rows);
  await tx.insert(fileEvents).values(rows.map((r) => ({
    id: randomUUID(), tenantId: r.tenantId, fileId: r.id, batchId: r.batchId,
    fromState: null, toState: r.state ?? "pending_upload", actorId: r.createdBy, reason: "registered", detail: null,
  })));
}

/** Move an open batch to `processing` once its first upload completes. */
export async function markBatchProcessing(tx: Writer, tenantId: string, batchId: string): Promise<void> {
  await tx.update(batches).set({ status: "processing", updatedAt: new Date() })
    .where(and(eq(batches.id, batchId), eq(batches.tenantId, tenantId), eq(batches.status, "open")));
}

/**
 * Mark the batch `completed` when no file is left in a pipeline-active state. Conditional, idempotent.
 * Returns true if THIS call completed it (caller may then emit the batch-complete event).
 */
export async function refreshBatchCompletion(tx: Writer, tenantId: string, batchId: string, now = new Date()): Promise<boolean> {
  const active = tx.select({ one: sql`1` }).from(batchFiles).where(and(
    eq(batchFiles.batchId, batchId),
    notInArray(batchFiles.state, [...PIPELINE_SETTLED_STATES]),
  ));
  const rows = await tx.update(batches)
    .set({ status: "completed", completedAt: now, updatedAt: now, version: sql`${batches.version} + 1` })
    .where(and(
      eq(batches.id, batchId), eq(batches.tenantId, tenantId),
      inArray(batches.status, ["open", "processing"]), sql`${batches.fileCount} > 0`,
      notExists(active),
    ))
    .returning({ id: batches.id });
  return rows.length > 0;
}

/** A retried/late file re-opens a completed batch (completed -> processing). */
export async function reopenBatchIfCompleted(tx: Writer, tenantId: string, batchId: string, actorId: string): Promise<void> {
  await tx.update(batches)
    .set({ status: "processing", completedAt: null, updatedAt: new Date(), updatedBy: actorId, version: sql`${batches.version} + 1` })
    .where(and(eq(batches.id, batchId), eq(batches.tenantId, tenantId), eq(batches.status, "completed")));
}

export async function cancelBatchRow(tx: Writer, tenantId: string, batchId: string, actorId: string, now = new Date()): Promise<boolean> {
  const rows = await tx.update(batches)
    .set({ status: "cancelled", cancelledAt: now, updatedAt: now, updatedBy: actorId, version: sql`${batches.version} + 1` })
    .where(and(eq(batches.id, batchId), eq(batches.tenantId, tenantId), ne(batches.status, "cancelled")))
    .returning({ id: batches.id });
  return rows.length > 0;
}

// ── the state machine write path ────────────────────────────────

export type FilePatch = Partial<Omit<BatchFileRow, "id" | "tenantId" | "batchId" | "state" | "version" | "createdAt" | "createdBy">> & {
  /** attempts = attempts + 1 */
  incrementAttempts?: boolean;
};

export interface TransitionArgs {
  tenantId: string;
  fileId: string;
  /** The file may move only if its CURRENT state is one of these (race-safe). */
  from: FileState[];
  to: FileState;
  patch?: FilePatch;
  /** null/undefined = system (worker) transition. */
  actorId?: string | null;
  reason?: string | null;
  detail?: Record<string, unknown> | null;
  now?: Date;
  /** Leased->X moves by a step: only the current lease owner may move the file (see lease.ts). */
  leaseOwner?: string;
  /** Sweeper: only move the file if its lease has truly expired by this instant. */
  leaseExpiredBy?: Date;
  /** Optimistic concurrency (reviewer actions): the move happens only if the row is still at this version. */
  expectedVersion?: number;
}

/**
 * Conditionally move a file between states and append a file_events row IN THE SAME TRANSACTION.
 *
 *   SELECT ... FOR UPDATE   (serialises concurrent movers; second one re-reads the new state)
 *   UPDATE ... WHERE id AND tenant_id AND state = ANY(from)
 *
 * Returns true if this call moved the file, false if someone else won (0 rows) - callers treat false as
 * "drop my result". Throws IllegalTransitionError BEFORE touching the DB when the table forbids from -> to.
 */
function transitionGuard(a: TransitionArgs) {
  return and(
    eq(batchFiles.id, a.fileId), eq(batchFiles.tenantId, a.tenantId), inArray(batchFiles.state, a.from),
    a.leaseOwner ? eq(batchFiles.leaseOwner, a.leaseOwner) : undefined,
    a.leaseExpiredBy ? lte(batchFiles.leaseExpiresAt, a.leaseExpiredBy) : undefined,
    a.expectedVersion === undefined ? undefined : eq(batchFiles.version, a.expectedVersion),
  );
}

export async function transition(tx: Writer, a: TransitionArgs): Promise<boolean> {
  assertTransition(a.from, a.to);
  const now = a.now ?? new Date();
  const locked = await tx.select({ state: batchFiles.state, batchId: batchFiles.batchId })
    .from(batchFiles)
    .where(transitionGuard(a))
    .for("update").limit(1);
  const cur = locked[0];
  if (!cur) return false;

  const { incrementAttempts, ...rest } = a.patch ?? {};
  const set: Record<string, unknown> = {
    ...rest,
    state: a.to,
    version: sql`${batchFiles.version} + 1`,
    updatedAt: now,
    updatedBy: rest.updatedBy ?? a.actorId ?? SYSTEM_ACTOR_ID,
  };
  if (incrementAttempts) set.attempts = sql`${batchFiles.attempts} + 1`;
  if (!LEASED_STATES.includes(a.to) && !("leaseExpiresAt" in rest)) set.leaseExpiresAt = null;
  if (!("leaseOwner" in rest)) set.leaseOwner = null;
  if (CANONICAL_RELEASING_STATES.includes(a.to) && !("canonicalForHash" in rest)) set.canonicalForHash = false;

  const moved = await tx.update(batchFiles).set(set)
    .where(transitionGuard(a))
    .returning({ id: batchFiles.id });
  if (moved.length === 0) return false;

  await tx.insert(fileEvents).values({
    id: randomUUID(), tenantId: a.tenantId, fileId: a.fileId, batchId: cur.batchId,
    fromState: cur.state, toState: a.to, actorId: a.actorId ?? null, reason: a.reason ?? null, detail: a.detail ?? null,
  });
  return true;
}

/** Take a per-key advisory lock held until the transaction ends (serialises e.g. same-hash duplicates). */
export async function advisoryXactLock(tx: Writer, key: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

export async function findCanonicalByHash(tx: Writer, tenantId: string, sha256: string, excludeId: string): Promise<{ id: string } | null> {
  const rows = await tx.select({ id: batchFiles.id }).from(batchFiles)
    .where(and(eq(batchFiles.tenantId, tenantId), eq(batchFiles.sha256, sha256), eq(batchFiles.canonicalForHash, true), ne(batchFiles.id, excludeId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Any other live (non-failed) file with the same hash - informational duplicate_of for policy `keep`. */
export async function findAnyByHash(tx: Writer, tenantId: string, sha256: string, excludeId: string): Promise<{ id: string } | null> {
  const rows = await tx.select({ id: batchFiles.id }).from(batchFiles)
    .where(and(
      eq(batchFiles.tenantId, tenantId), eq(batchFiles.sha256, sha256), ne(batchFiles.id, excludeId),
      inArray(batchFiles.state, ["uploaded", "scanning", "scan_pending", "queued", "ocr_running", "extracted", "needs_review", "ready_to_file", "filed"]),
    ))
    .orderBy(asc(batchFiles.createdAt)).limit(1);
  return rows[0] ?? null;
}

export async function getFileTx(tx: Writer, tenantId: string, id: string): Promise<BatchFileRow | null> {
  const rows = await tx.select().from(batchFiles).where(and(eq(batchFiles.tenantId, tenantId), eq(batchFiles.id, id))).limit(1);
  return rows[0] ?? null;
}

export async function listFileIdsByStates(tx: Writer, tenantId: string, batchId: string, states: FileState[]): Promise<string[]> {
  const rows = await tx.select({ id: batchFiles.id }).from(batchFiles)
    .where(and(eq(batchFiles.tenantId, tenantId), eq(batchFiles.batchId, batchId), inArray(batchFiles.state, states)))
    .orderBy(asc(batchFiles.createdAt));
  return rows.map((r) => r.id);
}

export async function countInState(tx: Writer, tenantId: string, state: FileState): Promise<number> {
  const rows = await tx.select({ n: count() }).from(batchFiles).where(and(eq(batchFiles.tenantId, tenantId), eq(batchFiles.state, state)));
  return Number(rows[0]?.n ?? 0);
}

// ── settings writes (maker-checker) ─────────────────────────────

export async function insertChangeRequest(tx: Writer, row: typeof settingsChangeRequests.$inferInsert): Promise<void> {
  await tx.insert(settingsChangeRequests).values(row);
}

export type ApproveFailure =
  | "NOT_FOUND" | "NOT_PENDING" | "MAKER_CHECKER_VIOLATION" | "STALE_BASE" | "SUPER_ADMIN_REQUIRED"
  | "INVALID_PROFILE_CHANGE" | "PROFILE_NAME_TAKEN" | "PROFILE_VERSION_CONFLICT_OR_MISSING" | "PROFILE_NOT_FOUND";
export type ApproveResult =
  | { ok: true; request: ChangeRequestRow; version: number; settings: BulkScanSettings }
  | { ok: false; code: ApproveFailure; /** set when the request could never apply (stale) and was therefore marked rejected / STALE in this transaction */ stale?: ChangeRequestRow };

/**
 * Approve a settings change request. maker <> checker is enforced IN SQL by the conditional UPDATE
 * (`... AND maker <> $checker`), backed by a table CHECK; a per-tenant advisory lock serialises approvals so
 * concurrent approvers get exactly one winner. Sensitive requests (turning malware fail-closed OFF) also need
 * a super_admin checker. `kind='profile'` requests (a scan profile overriding a sensitive field) go through the SAME
 * conditional UPDATE and then apply the queued profile create / update / delete in the same transaction; a failing
 * apply makes the caller throw, which rolls the approval back.
 */
export async function approveChangeRequest(
  tx: Writer,
  a: { tenantId: string; requestId: string; checker: string; checkerIsSuperAdmin: boolean; reason?: string | undefined; now?: Date },
): Promise<ApproveResult> {
  const now = a.now ?? new Date();
  await advisoryXactLock(tx, "bulk_scan_settings:" + a.tenantId);
  const cur = await tx.select().from(settings).where(eq(settings.tenantId, a.tenantId)).limit(1);
  const currentVersion = cur[0]?.version ?? 0;

  const existing = await tx.select().from(settingsChangeRequests)
    .where(and(eq(settingsChangeRequests.id, a.requestId), eq(settingsChangeRequests.tenantId, a.tenantId))).limit(1);
  const cr = existing[0];
  if (!cr) return { ok: false, code: "NOT_FOUND" };
  if (cr.sensitive && !a.checkerIsSuperAdmin) return { ok: false, code: "SUPER_ADMIN_REQUIRED" };

  const isProfile = cr.kind === "profile";
  const won = await tx.update(settingsChangeRequests)
    .set({ status: "approved", checker: a.checker, decidedAt: now, decisionReason: a.reason ?? null, updatedAt: now, version: sql`${settingsChangeRequests.version} + 1` })
    .where(and(
      eq(settingsChangeRequests.id, a.requestId), eq(settingsChangeRequests.tenantId, a.tenantId),
      eq(settingsChangeRequests.status, "pending"),
      ne(settingsChangeRequests.maker, a.checker),            // maker != checker, in SQL
      isProfile ? undefined : eq(settingsChangeRequests.baseVersion, currentVersion), // settings unchanged since the proposal
    ))
    .returning();
  const request = won[0];
  if (!request) {
    if (cr.status !== "pending") return { ok: false, code: "NOT_PENDING" };
    if (cr.maker === a.checker) return { ok: false, code: "MAKER_CHECKER_VIOLATION" };
    // STALE_BASE: the settings moved on since the proposal, so this request can never apply: reject it (conditional on still pending)
    const rej = await tx.update(settingsChangeRequests)
      .set({ status: "rejected", checker: a.checker, decidedAt: now, decisionReason: "STALE", updatedAt: now, version: sql`${settingsChangeRequests.version} + 1` })
      .where(and(eq(settingsChangeRequests.id, a.requestId), eq(settingsChangeRequests.tenantId, a.tenantId), eq(settingsChangeRequests.status, "pending"), ne(settingsChangeRequests.maker, a.checker)))
      .returning();
    return rej[0] ? { ok: false, code: "STALE_BASE", stale: rej[0] } : { ok: false, code: "STALE_BASE" };
  }

  if (isProfile) {
    const applied = await applyProfileChange(tx, request, a.checker, now);
    if (applied !== "ok") {
      // the profile changed (or the name was taken) since the request was made: it can never apply. Nothing was written by the
      // failed apply, so flip THIS transaction's approval to rejected / STALE instead of leaving a pending trap.
      const rej = await tx.update(settingsChangeRequests)
        .set({ status: "rejected", decisionReason: "STALE:" + applied, updatedAt: now, version: sql`${settingsChangeRequests.version} + 1` })
        .where(and(eq(settingsChangeRequests.id, request.id), eq(settingsChangeRequests.tenantId, a.tenantId), eq(settingsChangeRequests.status, "approved"), eq(settingsChangeRequests.checker, a.checker)))
        .returning();
      return rej[0] ? { ok: false, code: applied, stale: rej[0] } : { ok: false, code: applied };
    }
    return { ok: true, request, version: currentVersion, settings: parseStoredSettings(cur[0]?.config ?? null).settings };
  }

  const version = currentVersion + 1;
  if (cur[0]) {
    await tx.update(settings).set({ config: request.proposed, version, updatedBy: a.checker, updatedAt: now })
      .where(and(eq(settings.tenantId, a.tenantId), eq(settings.version, currentVersion)));
  } else {
    await tx.insert(settings).values({ id: randomUUID(), tenantId: a.tenantId, config: request.proposed, version, createdBy: request.maker, updatedBy: a.checker });
  }
  // Every other pending proposal was based on an older version: mark explicit instead of leaving traps.
  await tx.update(settingsChangeRequests)
    .set({ status: "superseded", decidedAt: now, updatedAt: now })
    .where(and(eq(settingsChangeRequests.tenantId, a.tenantId), eq(settingsChangeRequests.status, "pending"), eq(settingsChangeRequests.kind, "settings"), ne(settingsChangeRequests.id, a.requestId)));
  const parsed = parseStoredSettings(request.proposed);
  return { ok: true, request, version, settings: parsed.settings };
}

/** Apply an approved profile change request (create / update / delete). Runs inside the approval transaction. */
async function applyProfileChange(tx: Writer, cr: ChangeRequestRow, checker: string, now: Date): Promise<"ok" | Exclude<ApproveFailure, "NOT_FOUND" | "NOT_PENDING" | "MAKER_CHECKER_VIOLATION" | "STALE_BASE" | "SUPER_ADMIN_REQUIRED">> {
  const change = profileChangeSchema.safeParse(cr.profileChange);
  if (!change.success || !cr.profileId) return "INVALID_PROFILE_CHANGE";
  const ch = change.data;
  if (ch.op === "create") {
    if (await profileNameTaken(tx, cr.tenantId, ch.name)) return "PROFILE_NAME_TAKEN";
    await insertProfile(tx, {
      id: cr.profileId, tenantId: cr.tenantId, name: ch.name, description: ch.description ?? null,
      config: ch.config as Record<string, unknown>, createdBy: cr.maker, updatedBy: checker, createdAt: now, updatedAt: now,
    });
    return "ok";
  }
  if (ch.op === "update") {
    const set: Partial<Pick<ProfileRow, "name" | "description" | "config">> = {};
    if (ch.name !== undefined) set.name = ch.name;
    if (ch.description !== undefined) set.description = ch.description;
    if (ch.config !== undefined) set.config = ch.config as Record<string, unknown>;
    return (await updateProfile(tx, { tenantId: cr.tenantId, id: cr.profileId, expectedVersion: ch.expectedVersion, actorId: checker, set })) ? "ok" : "PROFILE_VERSION_CONFLICT_OR_MISSING";
  }
  return (await softDeleteProfile(tx, cr.tenantId, cr.profileId, checker)) ? "ok" : "PROFILE_NOT_FOUND";
}

export async function getProfileTx(tx: Writer, tenantId: string, id: string): Promise<ProfileRow | null> {
  const rows = await tx.select().from(profiles).where(and(eq(profiles.tenantId, tenantId), eq(profiles.id, id), isNull(profiles.deletedAt))).limit(1);
  return rows[0] ?? null;
}

export type RejectResult = { ok: true; request: ChangeRequestRow } | { ok: false; code: "NOT_FOUND" | "NOT_PENDING" | "MAKER_CHECKER_VIOLATION" };

export async function rejectChangeRequest(
  tx: Writer, a: { tenantId: string; requestId: string; checker: string; reason: string; now?: Date },
): Promise<RejectResult> {
  const now = a.now ?? new Date();
  const won = await tx.update(settingsChangeRequests)
    .set({ status: "rejected", checker: a.checker, decidedAt: now, decisionReason: a.reason, updatedAt: now, version: sql`${settingsChangeRequests.version} + 1` })
    .where(and(
      eq(settingsChangeRequests.id, a.requestId), eq(settingsChangeRequests.tenantId, a.tenantId),
      eq(settingsChangeRequests.status, "pending"), ne(settingsChangeRequests.maker, a.checker),
    ))
    .returning();
  if (won[0]) return { ok: true, request: won[0] };
  const ex = await tx.select().from(settingsChangeRequests)
    .where(and(eq(settingsChangeRequests.id, a.requestId), eq(settingsChangeRequests.tenantId, a.tenantId))).limit(1);
  if (!ex[0]) return { ok: false, code: "NOT_FOUND" };
  if (ex[0].status !== "pending") return { ok: false, code: "NOT_PENDING" };
  return { ok: false, code: "MAKER_CHECKER_VIOLATION" };
}

export async function currentSettingsTx(tx: Writer, tenantId: string): Promise<{ settings: BulkScanSettings; version: number }> {
  const rows = await tx.select().from(settings).where(eq(settings.tenantId, tenantId)).limit(1);
  return { settings: parseStoredSettings(rows[0]?.config ?? null).settings, version: rows[0]?.version ?? 0 };
}

export { isSensitiveChange };

/**
 * Apply a settings change IMMEDIATELY (a pure security tightening, see change-classifier.ts). Must run in the caller's
 * transaction AFTER taking the per-tenant settings lock (same lock as approvals). Pending settings change requests were based
 * on the old version, so they are marked superseded exactly as an approval does.
 */
export async function applySettingsDirect(tx: Writer, a: { tenantId: string; proposed: BulkScanSettings; actorId: string; now?: Date }): Promise<number> {
  const now = a.now ?? new Date();
  const cur = await tx.select().from(settings).where(eq(settings.tenantId, a.tenantId)).limit(1);
  const version = (cur[0]?.version ?? 0) + 1;
  if (cur[0]) {
    await tx.update(settings).set({ config: a.proposed as unknown as Record<string, unknown>, version, updatedBy: a.actorId, updatedAt: now })
      .where(and(eq(settings.tenantId, a.tenantId), eq(settings.version, cur[0].version)));
  } else {
    await tx.insert(settings).values({ id: randomUUID(), tenantId: a.tenantId, config: a.proposed as unknown as Record<string, unknown>, version, createdBy: a.actorId, updatedBy: a.actorId });
  }
  await tx.update(settingsChangeRequests).set({ status: "superseded", decidedAt: now, updatedAt: now })
    .where(and(eq(settingsChangeRequests.tenantId, a.tenantId), eq(settingsChangeRequests.status, "pending"), eq(settingsChangeRequests.kind, "settings")));
  return version;
}

/** Is the profile still referenced by any batch (batches.profile_id)? Deleting a referenced profile needs approval. */
export async function profileReferencedTx(tx: Pick<Writer, "select">, tenantId: string, profileId: string): Promise<boolean> {
  const rows = await tx.select({ id: batches.id }).from(batches).where(and(eq(batches.tenantId, tenantId), eq(batches.profileId, profileId))).limit(1);
  return rows.length > 0;
}
export async function profileReferenced(tenantId: string, profileId: string): Promise<boolean> {
  return scopedRead((tx) => profileReferencedTx(tx, tenantId, profileId));
}

// ── profiles (writes) ───────────────────────────────────────────

export async function insertProfile(tx: Writer, row: typeof profiles.$inferInsert): Promise<void> {
  await tx.insert(profiles).values(row);
}

export async function profileNameTaken(tx: Writer, tenantId: string, name: string): Promise<boolean> {
  const rows = await tx.select({ id: profiles.id }).from(profiles)
    .where(and(eq(profiles.tenantId, tenantId), isNull(profiles.deletedAt), sql`lower(${profiles.name}) = lower(${name})`)).limit(1);
  return rows.length > 0;
}

export async function updateProfile(
  tx: Writer, a: { tenantId: string; id: string; expectedVersion: number; actorId: string; set: Partial<Pick<ProfileRow, "name" | "description" | "config">> },
): Promise<boolean> {
  const rows = await tx.update(profiles)
    .set({ ...a.set, updatedBy: a.actorId, updatedAt: new Date(), version: sql`${profiles.version} + 1` })
    .where(and(eq(profiles.id, a.id), eq(profiles.tenantId, a.tenantId), eq(profiles.version, a.expectedVersion), isNull(profiles.deletedAt)))
    .returning({ id: profiles.id });
  return rows.length > 0;
}

export async function softDeleteProfile(tx: Writer, tenantId: string, id: string, actorId: string): Promise<boolean> {
  const rows = await tx.update(profiles)
    .set({ deletedAt: new Date(), updatedBy: actorId, updatedAt: new Date(), version: sql`${profiles.version} + 1` })
    .where(and(eq(profiles.id, id), eq(profiles.tenantId, tenantId), isNull(profiles.deletedAt)))
    .returning({ id: profiles.id });
  return rows.length > 0;
}

// ── cross-tenant discovery for the dispatcher (scanner role, READ-ONLY) ──

export interface DueFile { tenantId: string; fileId: string; state: FileState }

/**
 * Tenants that currently have due queued / scan_pending work, OLDEST due work first (a tenant that was not served last
 * time keeps its old due timestamp and therefore sorts first next time, so no tenant starves behind the page limit).
 * Ties break on tenant id for a stable order.
 */
export async function discoverDueTenants(rdb: Reader, now: Date, limit: number): Promise<string[]> {
  const oldest = sql`min(coalesce(${batchFiles.nextAttemptAt}, ${batchFiles.createdAt}))`;
  const rows = await rdb.select({ tenantId: batchFiles.tenantId }).from(batchFiles)
    .where(and(
      inArray(batchFiles.state, ["queued", "scan_pending"]),
      or(isNull(batchFiles.nextAttemptAt), lte(batchFiles.nextAttemptAt, now)),
    ))
    .groupBy(batchFiles.tenantId).orderBy(asc(oldest), asc(batchFiles.tenantId)).limit(limit);
  return rows.map((r) => r.tenantId);
}

/** Due files for ONE tenant (capped so one heavy tenant cannot starve the scan of the others). */
export async function dueFilesForTenant(rdb: Reader, tenantId: string, now: Date, cap: number): Promise<DueFile[]> {
  const rows = await rdb.select({ tenantId: batchFiles.tenantId, fileId: batchFiles.id, state: batchFiles.state })
    .from(batchFiles)
    .where(and(
      eq(batchFiles.tenantId, tenantId), inArray(batchFiles.state, ["queued", "scan_pending"]),
      or(isNull(batchFiles.nextAttemptAt), lte(batchFiles.nextAttemptAt, now)),
    ))
    .orderBy(asc(batchFiles.nextAttemptAt), asc(batchFiles.createdAt)).limit(cap);
  return rows.map((r) => ({ tenantId: r.tenantId, fileId: r.fileId, state: r.state as FileState }));
}

/** pending_upload rows registered before `before` (abandoned uploads), for the sweeper (scanner role, read-only). */
export async function discoverStalePendingUploads(rdb: Reader, before: Date, limit: number): Promise<{ tenantId: string; fileId: string }[]> {
  const rows = await rdb.select({ tenantId: batchFiles.tenantId, fileId: batchFiles.id }).from(batchFiles)
    .where(and(eq(batchFiles.state, "pending_upload"), lte(batchFiles.createdAt, before)))
    .orderBy(asc(batchFiles.createdAt)).limit(limit);
  return rows;
}

export interface ExpiredLease { tenantId: string; fileId: string; state: FileState }

/** Expired leases, longest-expired first, fair across tenants: the oldest expired lease of EACH tenant ranks first (so one tenant's backlog cannot hide another's), then the rest. */
export async function discoverExpiredLeases(rdb: Reader, now: Date, limit: number): Promise<ExpiredLease[]> {
  const rows = await rdb.select({ tenantId: batchFiles.tenantId, fileId: batchFiles.id, state: batchFiles.state })
    .from(batchFiles)
    .where(and(inArray(batchFiles.state, [...LEASED_STATES]), lte(batchFiles.leaseExpiresAt, now)))
    .orderBy(
      sql`row_number() OVER (PARTITION BY ${batchFiles.tenantId} ORDER BY ${batchFiles.leaseExpiresAt} ASC, ${batchFiles.id} ASC)`,
      asc(batchFiles.leaseExpiresAt), asc(batchFiles.id),
    ).limit(limit);
  return rows.map((r) => ({ tenantId: r.tenantId, fileId: r.fileId, state: r.state as FileState }));
}

// ── latest link per file (single query, tenant scoped) ──────────

export interface FileLinkSummary { state: string; target: string; targetId: string; reason: string | null; detail: Record<string, string | number | boolean> | null }

/** Latest bulk_scan.links row per file for the given files: ONE query (no N+1). `reason`/`detail` are the shared target codes. */
export async function latestLinkSummaries(tenantId: string, fileIds: string[]): Promise<Map<string, FileLinkSummary>> {
  const out = new Map<string, FileLinkSummary>();
  if (fileIds.length === 0) return out;
  const rows = await scopedRead((tx) =>
    tx.select({ fileId: links.fileId, state: links.state, target: links.target, targetId: links.targetId, reason: links.resultReason, detail: links.resultDetail })
      .from(links).where(and(eq(links.tenantId, tenantId), inArray(links.fileId, fileIds)))
      .orderBy(desc(links.createdAt), desc(links.id)));
  for (const r of rows) {
    if (!out.has(r.fileId)) out.set(r.fileId, { state: r.state, target: r.target, targetId: r.targetId, reason: r.reason ?? null, detail: r.detail ?? null });
  }
  return out;
}
