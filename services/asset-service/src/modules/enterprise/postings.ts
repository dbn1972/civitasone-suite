/**
 * Acquisition and maintenance journals. There are NO default GL accounts: the heads come from the tenant's
 * asset_settings. When a head is not configured the operational record (the asset, the completed work order) is STILL
 * SAVED and its journal is DEFERRED -- gl_post_status "awaiting_accounts" with the catalogued error
 * ASSET_GL_NOT_CONFIGURED naming the missing heads -- and posts once the accounts are set (a sweep after the settings
 * change, or an explicit "post pending journals"). A journal is never posted to a guessed account.
 */
import type { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { uuidV5 } from "../../shared/ids.js";
import * as repo from "./repo.js";
import { headsFromSettings, HEAD_LABEL, ASSET_GL_NOT_CONFIGURED } from "./gl-heads.js";
import type { HeadKind } from "../../shared/finance-client.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type PostingMsg = { tenantId: string; actorId: string; correlationId: string };

const GL_TOPIC = "finance.gl.post";
const AUDIT_TOPIC = "audit.event.record";

export type AcquisitionKind = "direct" | "grn";
const acquisitionHeadKinds = (kind: AcquisitionKind): HeadKind[] => ["fixed_asset", kind === "grn" ? "grn_clearing" : "acquisition_offset"];
const MAINTENANCE_HEAD_KINDS: HeadKind[] = ["maintenance_expense", "ap_control"];

/** Dr fixed asset / Cr GRN clearing (goods received) or the acquisition offset (direct registration). Deterministic id. */
export function acquisitionJournal(a: { id: string; tenantId: string; costMinor: bigint; date: string }, kind: AcquisitionKind, heads: Partial<Record<HeadKind, string>>) {
  return {
    id: uuidV5(`acq:${a.id}`),
    tenantId: a.tenantId,
    type: "asset_acquisition",
    voucherNo: `ACQ/${a.date}/${a.id.slice(0, 8)}`,
    postingDate: a.date,
    lines: [
      { accountCode: heads.fixed_asset as string, debitMinor: a.costMinor.toString(), creditMinor: "0" },
      { accountCode: (kind === "grn" ? heads.grn_clearing : heads.acquisition_offset) as string, debitMinor: "0", creditMinor: a.costMinor.toString() },
    ],
  };
}

/** Dr maintenance expense / Cr accounts payable control. Deterministic id. */
export function maintenanceJournal(w: { id: string; tenantId: string; assetId: string; costMinor: bigint; completedDate: string }, heads: Partial<Record<HeadKind, string>>) {
  return {
    id: uuidV5(`maintenance:${w.id}`),
    tenantId: w.tenantId,
    type: "asset_maintenance",
    voucherNo: `MNT/${w.completedDate}/${w.assetId.slice(0, 8)}`,
    postingDate: w.completedDate,
    lines: [
      { accountCode: heads.maintenance_expense as string, debitMinor: w.costMinor.toString(), creditMinor: "0" },
      { accountCode: heads.ap_control as string, debitMinor: "0", creditMinor: w.costMinor.toString() },
    ],
  };
}

const missingText = (kinds: readonly HeadKind[]): string => `${ASSET_GL_NOT_CONFIGURED}: ${kinds.map((k) => HEAD_LABEL[k]).join(", ")}`;

async function audit(tx: Tx, msg: PostingMsg, action: string, resourceType: string, resourceId: string, details: Record<string, unknown>, outcome: "success" | "failure" = "success") {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "asset", module: "enterprise", action, resourceType, resourceId, outcome, details },
  });
}

async function send(tx: Tx, msg: PostingMsg, payload: Record<string, unknown>) {
  await enqueue(tx, { topic: GL_TOPIC, eventType: GL_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload });
}

/** In the caller's transaction: post the acquisition journal, or defer it (record kept) when a head is not configured. */
export async function postAcquisitionOrDefer(tx: Tx, msg: PostingMsg, a: { id: string; tenantId: string; costMinor: bigint; date: string }, kind: AcquisitionKind): Promise<"pending" | "awaiting_accounts" | "none"> {
  if (a.costMinor <= 0n) return "none"; // finance never sees a zero-total journal
  const kinds = acquisitionHeadKinds(kind);
  const heads = headsFromSettings(await repo.getAssetSettingsTx(tx, a.tenantId), kinds);
  const missing = kinds.filter((k) => !heads[k]);
  if (missing.length > 0) {
    await repo.setAssetGl(tx, a.tenantId, a.id, "awaiting_accounts", null, missingText(missing));
    await audit(tx, msg, "gl_deferred", "asset", a.id, { failure: ASSET_GL_NOT_CONFIGURED, missing, journal: "acquisition" }, "failure");
    return "awaiting_accounts";
  }
  const journal = acquisitionJournal(a, kind, heads);
  await send(tx, msg, journal);
  await repo.setAssetGl(tx, a.tenantId, a.id, "pending", journal.id, null);
  return "pending";
}

export async function postMaintenanceOrDefer(tx: Tx, msg: PostingMsg, w: { id: string; tenantId: string; assetId: string; costMinor: bigint; completedDate: string }): Promise<"pending" | "awaiting_accounts" | "none"> {
  if (w.costMinor <= 0n) return "none";
  const heads = headsFromSettings(await repo.getAssetSettingsTx(tx, w.tenantId), MAINTENANCE_HEAD_KINDS);
  const missing = MAINTENANCE_HEAD_KINDS.filter((k) => !heads[k]);
  if (missing.length > 0) {
    await repo.setWorkOrderGl(tx, w.tenantId, w.id, "awaiting_accounts", null, missingText(missing));
    await audit(tx, msg, "gl_deferred", "work_order", w.id, { failure: ASSET_GL_NOT_CONFIGURED, missing, journal: "maintenance" }, "failure");
    return "awaiting_accounts";
  }
  const journal = maintenanceJournal(w, heads);
  await send(tx, msg, journal);
  await repo.setWorkOrderGl(tx, w.tenantId, w.id, "pending", journal.id, null);
  return "pending";
}

export type SweepResult = { assetsPosted: number; workOrdersPosted: number; skipped: number; more: boolean };

/** One bound for every sweep (settings save, approval, "post pending"): at most this many records per kind per run. */
export const SWEEP_LIMIT = 200;

/**
 * Post journals that were deferred (and, when asked, ones finance rejected) now that the accounts may be configured.
 *
 * Heads in force AT POST TIME are used on purpose: a deferred record had no heads when it was saved (that is why it is
 * deferred), and a journal already sent to finance is never re-derived -- only rows not yet sent are read here.
 *
 * Concurrency: candidates are selected FOR UPDATE SKIP LOCKED and only rows whose journal can be built now (heads present,
 * cost > 0) are selected, so (a) two overlapping sweeps never pick the same row, (b) a blocked row cannot starve later
 * rows, and (c) each status flip is CONDITIONAL on the state that was selected -- a row that finance has meanwhile
 * marked posted is never set back to pending, and no journal is enqueued for a row that was not updated.
 * Bounded to SWEEP_LIMIT per kind; `more` says another run is needed. Each journal keeps its deterministic id.
 */
export async function sweepDeferred(tx: Tx, msg: PostingMsg, tenantId: string, opts: { includeFailed: boolean; limit?: number }): Promise<SweepResult> {
  const limit = opts.limit ?? SWEEP_LIMIT;
  const statuses = opts.includeFailed ? (["awaiting_accounts", "failed"] as const) : (["awaiting_accounts"] as const);
  const settings = await repo.getAssetSettingsTx(tx, tenantId);
  const hasAll = (kinds: readonly HeadKind[]) => {
    const heads = headsFromSettings(settings, kinds);
    return kinds.every((k) => !!heads[k]);
  };
  const res: SweepResult = { assetsPosted: 0, workOrdersPosted: 0, skipped: 0, more: false };

  const assets = await repo.findAssetsGlOpen(tx, tenantId, statuses, limit + 1, {
    direct: hasAll(acquisitionHeadKinds("direct")), grn: hasAll(acquisitionHeadKinds("grn")),
  });
  res.more = assets.length > limit;
  for (const a of assets.slice(0, limit)) {
    const kind: AcquisitionKind = a.grnRef?.startsWith("procurement_grn:") ? "grn" : "direct";
    const heads = headsFromSettings(settings, acquisitionHeadKinds(kind));
    const journal = acquisitionJournal({ id: a.id, tenantId, costMinor: a.acquisitionCost, date: a.acquisitionDate }, kind, heads);
    // conditional flip first; the journal is sent only if THIS sweep won the row
    if (!(await repo.setAssetGl(tx, tenantId, a.id, "pending", journal.id, null, statuses))) { res.skipped += 1; continue; }
    await send(tx, msg, journal);
    await audit(tx, msg, "gl_post", "asset", a.id, { journalId: journal.id, from: a.glPostStatus, to: "pending" });
    res.assetsPosted += 1;
  }

  const wos = await repo.findWorkOrdersGlOpen(tx, tenantId, statuses, limit + 1, hasAll(MAINTENANCE_HEAD_KINDS));
  res.more = res.more || wos.length > limit;
  for (const w of wos.slice(0, limit)) {
    const heads = headsFromSettings(settings, MAINTENANCE_HEAD_KINDS);
    const journal = maintenanceJournal({ id: w.id, tenantId, assetId: w.assetId, costMinor: w.costMinor, completedDate: w.completedDate as string }, heads);
    if (!(await repo.setWorkOrderGl(tx, tenantId, w.id, "pending", journal.id, null, statuses))) { res.skipped += 1; continue; }
    await send(tx, msg, journal);
    await audit(tx, msg, "gl_post", "work_order", w.id, { journalId: journal.id, from: w.glPostStatus, to: "pending" });
    res.workOrdersPosted += 1;
  }
  return res;
}
