/**
 * Applying an asset-settings change (GL heads / maker-checker flags). Used by the direct save, by the approval of a pending
 * "GL heads change" request, and by the second-approver flows.
 *
 * Serialisation: the tenant's settings row is locked FOR UPDATE first, the patch is merged onto the LOCKED row, and the
 * merged heads are re-validated (finance chart + distinctness) before anything is written. Two concurrent saves therefore
 * cannot each validate against a stale row and together produce a duplicate/invalid head set -- the second one waits for
 * the lock, sees the first one's result and is refused if it now clashes. The route's pre-check is only a fast fail.
 * The deferred-journal sweep runs after the apply, in the same transaction.
 */
import type { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { validateHead, type HeadKind } from "../../shared/finance-client.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { HEAD_COLUMN, ALL_HEAD_KINDS, headsFromSettings, assertDistinctHeads, reasonMessage } from "./gl-heads.js";
import { sweepDeferred, type PostingMsg, type SweepResult } from "./postings.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type HeadColumn = (typeof HEAD_COLUMN)[HeadKind];
export const HEAD_COLUMNS: readonly HeadColumn[] = ALL_HEAD_KINDS.map((k) => HEAD_COLUMN[k]);
const KIND_OF_COLUMN = Object.fromEntries(ALL_HEAD_KINDS.map((k) => [HEAD_COLUMN[k], k])) as Record<HeadColumn, HeadKind>;

/** A set of head changes: a code sets the head, null clears it; absent = unchanged. */
export type HeadPatch = Partial<Record<HeadColumn, string | null>>;

export function headPatchFrom(p: Record<string, unknown>): HeadPatch {
  const out: HeadPatch = {};
  for (const c of HEAD_COLUMNS) {
    const v = p[c];
    if (v === null || typeof v === "string") out[c] = v;
  }
  return out;
}

export type Refusal = { code: string; message: string };

/**
 * Check a patch against the LOCKED settings row. Returns a refusal (definitive: GL_HEAD_INVALID) or null when it may be
 * applied. Throws on FINANCE_UNAVAILABLE so the message is redelivered rather than silently dropped.
 */
export async function checkHeadPatch(
  tenantId: string, locked: Awaited<ReturnType<typeof repo.lockAssetSettings>>, patch: HeadPatch, correlationId: string,
): Promise<Refusal | null> {
  const merged = headsFromSettings(locked, ALL_HEAD_KINDS);
  for (const c of HEAD_COLUMNS) {
    const v = patch[c];
    if (v === null) delete merged[KIND_OF_COLUMN[c]];
    else if (typeof v === "string") merged[KIND_OF_COLUMN[c]] = v;
  }
  try {
    assertDistinctHeads(merged);
  } catch (e) {
    if (e instanceof HttpError) return { code: e.code, message: e.message };
    throw e;
  }
  for (const c of HEAD_COLUMNS) {
    const code = patch[c];
    if (typeof code !== "string") continue;
    const kind = KIND_OF_COLUMN[c];
    const check = await validateHead(tenantId, kind, code, correlationId);
    if (!check.ok) {
      if (check.reason === "UNAVAILABLE") throw new Error(`FINANCE_UNAVAILABLE: ${reasonMessage(kind, code, check)}`);
      return { code: "GL_HEAD_INVALID", message: reasonMessage(kind, code, check) };
    }
  }
  return null;
}

/** Settings as shown in audit before/after images (heads + both maker-checker flags). */
export function settingsImage(s: Awaited<ReturnType<typeof repo.getAssetSettingsTx>>): Record<string, unknown> {
  const out: Record<string, unknown> = { capitalizeMakerChecker: s?.capitalizeMakerChecker ?? true, glMakerChecker: s?.glMakerChecker ?? true };
  for (const c of HEAD_COLUMNS) out[c] = s?.[c] ?? null;
  return out;
}

export async function auditSettings(
  tx: Tx, msg: PostingMsg, action: string, resourceId: string, details: Record<string, unknown>, outcome: "success" | "failure" = "success",
): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record", eventType: "audit.event.record",
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "asset", module: "enterprise", action, resourceType: "asset_settings", resourceId, outcome, details },
  });
}

export type ApplyResult = { ok: true; swept: SweepResult | null } | { ok: false; refusal: Refusal };

/**
 * Lock, merge, re-validate, apply, sweep. `flags` are applied together with the heads (e.g. capitalizeMakerChecker=true).
 * A refusal is audited (outcome failure) and returned; nothing is written in that case.
 */
export async function applySettingsChange(
  tx: Tx, msg: PostingMsg, tenantId: string,
  change: { heads?: HeadPatch; capitalizeMakerChecker?: boolean | undefined; glMakerChecker?: boolean | undefined; reason: string | null; resourceId: string; action?: string; requestedBy?: string },
): Promise<ApplyResult> {
  const locked = await repo.lockAssetSettings(tx, tenantId, msg.actorId);
  const heads = change.heads ?? {};
  const hasHeads = Object.keys(heads).length > 0;
  const action = change.action ?? "update";
  if (hasHeads) {
    const refusal = await checkHeadPatch(tenantId, locked, heads, msg.correlationId);
    if (refusal) {
      await auditSettings(tx, msg, action, change.resourceId, { failure: refusal.code, message: refusal.message, reason: change.reason, attempted: heads }, "failure");
      return { ok: false, refusal };
    }
  }
  const patch: repo.AssetSettingsPatch = { ...heads };
  if (change.capitalizeMakerChecker !== undefined) patch.capitalizeMakerChecker = change.capitalizeMakerChecker;
  if (change.glMakerChecker !== undefined) patch.glMakerChecker = change.glMakerChecker;
  await repo.upsertAssetSettings(tx, tenantId, msg.actorId, patch);
  const after = await repo.getAssetSettingsTx(tx, tenantId);
  // Records saved while accounts were missing get their deferred journals now (bounded; `more` => run "post pending" again).
  const swept = hasHeads ? await sweepDeferred(tx, msg, tenantId, { includeFailed: false }) : null;
  await auditSettings(tx, msg, action, change.resourceId, {
    reason: change.reason, before: settingsImage(locked), after: settingsImage(after), deferredPosted: swept, requestedBy: change.requestedBy ?? null,
  });
  return { ok: true, swept };
}
