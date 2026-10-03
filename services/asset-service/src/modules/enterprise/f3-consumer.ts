import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { queue as rawQueue } from "../../shared/infra.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, CONSUMED_EVENTS } from "../../topics.js";
import { uuidV5 } from "../../shared/ids.js";
import * as repo from "./repo.js";
import * as registerRepo from "../register/repo.js";
import { makeBarcode } from "../register/consumer.js";
import { todayIST } from "../../shared/dates.js";
import { buildLeaseSchedule, type LeaseFrequency } from "./lease-domain.js";
import { headsFromSettings, HEAD_LABEL } from "./gl-heads.js";
import { sweepDeferred } from "./postings.js";
import { applySettingsChange, auditSettings, headPatchFrom } from "./settings-apply.js";
import type { projectAuc } from "./schema.js";

const log = pino({ name: "asset-f3-enterprise" });
const WORKFLOW_CREATE = "workflow.instance.create";
const GL_TOPIC = "finance.gl.post";
const AUDIT_TOPIC = "audit.event.record";
const DEFAULT_IT_CATEGORY = "77777777-0001-0000-0000-000000000001";
// There are NO default heads for the fixed asset, capital work in progress, the right-of-use asset, the lease liability or
// the lease clearing account: they come from asset_settings (validated against the finance chart of accounts when set), and the
// routes refuse the action (409 ASSET_GL_NOT_CONFIGURED) until they exist.

const REQUEST_KINDS = ["maker_checker_off", "gl_maker_checker_off", "gl_heads_change"];

type AucRow = typeof projectAuc.$inferSelect;

/** The capitalisation journal: Dr fixed asset / Cr CWIP. Deterministic id, so a repost is the same journal. */
function aucJournal(auc: Pick<AucRow, "id" | "tenantId" | "accumulatedMinor">, capDate: string, heads: { fixed_asset: string; cwip: string }) {
  return {
    id: uuidV5(`auc-capitalize:${auc.id}`),
    tenantId: auc.tenantId,
    type: "asset_capitalization",
    voucherNo: `CAP/${capDate}/${auc.id.slice(0, 8)}`,
    postingDate: capDate,
    lines: [
      { accountCode: heads.fixed_asset, debitMinor: auc.accumulatedMinor.toString(), creditMinor: "0" },
      { accountCode: heads.cwip, debitMinor: "0", creditMinor: auc.accumulatedMinor.toString() },
    ],
  };
}

type LeaseHeads = { rou?: string; lease_liability?: string; lease_offset?: string };
/** Which heads a lease journal needs: the clearing head only when ROU differs from the liability. */
function leaseHeadKinds(rou: bigint, liab: bigint): Array<"rou" | "lease_liability" | "lease_offset"> {
  return rou === liab ? ["rou", "lease_liability"] : ["rou", "lease_liability", "lease_offset"];
}

/** Initial recognition: Dr ROU / Cr lease liability (+ the clearing head for any difference). Deterministic id. */
function leaseJournal(lease: { id: string; tenantId: string; leaseStart: string; rouCostMinor: bigint; liabilityMinor: bigint }, heads: LeaseHeads) {
  const rou = lease.rouCostMinor;
  const liab = lease.liabilityMinor;
  const lines = [
    { accountCode: heads.rou as string, debitMinor: rou.toString(), creditMinor: "0" },
    { accountCode: heads.lease_liability as string, debitMinor: "0", creditMinor: liab.toString() },
  ];
  if (rou > liab) lines.push({ accountCode: heads.lease_offset as string, debitMinor: "0", creditMinor: (rou - liab).toString() });
  else if (liab > rou) lines.push({ accountCode: heads.lease_offset as string, debitMinor: (liab - rou).toString(), creditMinor: "0" });
  return {
    id: uuidV5(`lease-recognition:${lease.id}`),
    tenantId: lease.tenantId,
    type: "lease_recognition",
    voucherNo: `LEASE/${lease.leaseStart}/${lease.id.slice(0, 8)}`,
    postingDate: lease.leaseStart,
    lines,
  };
}
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Msg = { tenantId: string; actorId: string; correlationId: string };

async function auditEvent(
  tx: Tx, msg: Msg, action: string, resourceType: string, resourceId: string, details: Record<string, unknown>,
  outcome: "success" | "failure" = "success",
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "asset", module: "enterprise", action, resourceType, resourceId, outcome, details },
  });
}

/**
 * GAP-ASSETS-PROJECTS-09: the AUC row has already been flipped to `capitalized` by a conditional UPDATE
 * (so this runs at most once per project). Creates the fixed asset dated at the capitalisation date,
 * posts Dr Fixed asset / Cr CWIP, and writes the audit event, all in the caller's transaction.
 */
async function capitalizeInTx(tx: Tx, msg: Msg, auc: AucRow, assetId: string, mode: "direct" | "approved"): Promise<string> {
  const code = `AUC/${auc.projectCode}`;
  const capDate = auc.capitalizationDate ?? todayIST();
  await registerRepo.insertAsset(tx, {
    id: assetId, tenantId: auc.tenantId, name: auc.name, code,
    categoryId: DEFAULT_IT_CATEGORY, assetType: "infra", barcode: makeBarcode(code),
    status: "active", acquisitionCost: auc.accumulatedMinor, salvageValue: 0n,
    usefulLifeYears: 10, depRate: "10", depMethod: "SLM", currency: "INR",
    bookValue: auc.accumulatedMinor, accumulatedDep: 0n,
    acquisitionDate: capDate,
    poRef: null, grnRef: null, location: null, notes: `Capitalized from AUC ${auc.projectCode}`,
    projectRef: auc.projectCode, orgUnit: null, aucId: auc.id,
    createdBy: msg.actorId, updatedBy: msg.actorId,
  });
  let journal: "none" | "pending" | "failed" = "none";
  if (auc.accumulatedMinor > 0n) {
    const aucHeads = headsFromSettings(await repo.getAssetSettingsTx(tx, auc.tenantId), ["cwip", "fixed_asset"]);
    if (!aucHeads.cwip || !aucHeads.fixed_asset) {
      // The route pre-flights this; reaching here means the setting was cleared in between. Never post to a guessed
      // account: the record shows the journal as failed so it cannot look capitalised-and-posted.
      journal = "failed";
      const unset = (["cwip", "fixed_asset"] as const).filter((k) => !aucHeads[k]).map((k) => HEAD_LABEL[k]).join(", ");
      await repo.setAucGlFailed(tx, auc.id, auc.tenantId, `no ${unset} account configured`);
    } else {
      const payload = aucJournal(auc, capDate, { fixed_asset: aucHeads.fixed_asset, cwip: aucHeads.cwip });
      await enqueue(tx, {
        topic: GL_TOPIC, eventType: GL_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload,
      });
      await repo.setAucGlPending(tx, auc.id, auc.tenantId, payload.id);
      journal = "pending";
    }
  }
  // Both depreciation books start at the capitalisation date. Enqueued through the outbox IN THIS transaction, so a
  // crash after commit can never leave a capitalised asset without its schedules (deterministic ids make a replay a no-op).
  for (const [method, depBook] of [["SLM", "company"], ["WDV", "statutory"]] as const) {
    await enqueue(tx, {
      topic: COMMANDS.depSchedule, eventType: COMMANDS.depSchedule,
      tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
      payload: { id: uuidV5(`auc-dep:${auc.id}:${depBook}`), assetId, tenantId: auc.tenantId, method, startDate: capDate, depBook },
    });
  }
  await auditEvent(tx, msg, "capitalize", "auc_project", auc.id, {
    projectCode: auc.projectCode, assetId, amountMinor: auc.accumulatedMinor.toString(), capitalizationDate: capDate,
    mode, requestedBy: auc.capRequestedBy ?? null, reason: auc.capReason ?? null, journal,
  });
  return capDate;
}

export function registerF3EnterpriseConsumers(rawQ: Queue): void {
  // Mirror other asset consumers: tenantScoped so NOBYPASSRLS + FORCE RLS
  // accepts writes when the queue is a bare MemoryQueue (tests). createQueue()
  // already wraps withTenantConsumer — double-wrap is idempotent.
  const queue = tenantScoped(rawQ);
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, unknown>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "auc_create", "auc_capitalize", "lease_create", "impairment", "revaluation",
      "location_create", "location_update", "spare_part", "request_disposal", "inter_org_transfer", "bulk_import",
      "location_deactivate", "location_reactivate", "scan_log", "asset_settings_update",
      "auc_capitalize_request", "auc_capitalize_approve", "auc_capitalize_reject",
      "settings_request", "settings_request_approve", "settings_request_reject",
      "auc_journal_repost", "lease_journal_repost", "gl_post_pending",
    ]);
    if (!ops.has(op)) return;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "auc_create": {
            await repo.insertAuc(tx, {
              id: p.id as string,
              tenantId: p.tenantId as string,
              projectCode: p.projectCode as string,
              name: p.name as string,
              wbsRef: (p.wbsRef as string | null) ?? null,
              accumulatedMinor: BigInt(p.amountMinor as number),
              currency: "INR",
              status: "under_construction",
              assetId: null,
              createdBy: msg.actorId,
              updatedBy: msg.actorId,
            });
            // GAP-ASSETS-PROJECTS-05: AUC creation is an audited mutation; the
            // clerk's stated reason/authorisation rides in the audit details.
            await enqueue(tx, {
              topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
              tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
              payload: {
                service: "asset", module: "enterprise", action: "create", resourceType: "auc_project",
                resourceId: p.id as string, outcome: "success",
                details: { projectCode: p.projectCode, amountMinor: p.amountMinor, ...(p.reason ? { reason: p.reason } : {}) },
              },
            });
            break;
          }
          case "auc_capitalize": {
            // Direct (single-actor) path: only valid while the tenant has maker-checker switched OFF. The route checks
            // too, but the consumer is the authority: a request published before the setting flipped back ON is refused.
            // Double-click / replay guard: only the call that wins the conditional status flip creates the asset.
            const assetId = p.assetId as string;
            const current = await repo.getAssetSettingsTx(tx, p.tenantId as string);
            if (current?.capitalizeMakerChecker ?? true) {
              await auditEvent(tx, msg, "capitalize", "auc_project", p.aucId as string, { mode: "direct", failure: "MAKER_CHECKER_REQUIRED" }, "failure");
              break;
            }
            const claimed = await repo.claimAucDirect(
              tx, p.aucId as string, p.tenantId as string, assetId, msg.actorId,
              (p.capitalizationDate as string | undefined) ?? todayIST(), String(p.reason ?? ""),
            );
            if (!claimed) {
              await auditEvent(tx, msg, "capitalize", "auc_project", p.aucId as string, { mode: "direct", failure: "NOT_CAPITALIZABLE" }, "failure");
              break;
            }
            await capitalizeInTx(tx, msg, claimed, assetId, "direct");
            break;
          }
          case "auc_capitalize_request": {
            // Maker step: under_construction -> pending_capitalization (conditional; a second request is a no-op).
            const ok = await repo.requestAucCapitalization(
              tx, p.aucId as string, p.tenantId as string, msg.actorId, p.capitalizationDate as string, String(p.reason ?? ""),
            );
            if (ok) {
              await auditEvent(tx, msg, "capitalize_request", "auc_project", p.aucId as string, {
                capitalizationDate: p.capitalizationDate, reason: p.reason ?? null,
              });
            }
            break;
          }
          case "auc_capitalize_approve": {
            // Checker step: ONE conditional UPDATE enforces pending status AND checker != maker, so a replay
            // or a racing second approval cannot create a second asset / journal.
            const assetId = p.assetId as string;
            const approved = await repo.approveAucCapitalization(tx, p.aucId as string, p.tenantId as string, assetId, msg.actorId);
            if (!approved) {
              // Lost the race / replay / approver was the requester: recorded, not silent.
              await auditEvent(tx, msg, "capitalize_approve", "auc_project", p.aucId as string, { failure: "NOT_PENDING_OR_SAME_ACTOR" }, "failure");
              break;
            }
            await capitalizeInTx(tx, msg, approved, assetId, "approved");
            break;
          }
          case "auc_capitalize_reject": {
            const rejected = await repo.rejectAucCapitalization(tx, p.aucId as string, p.tenantId as string, msg.actorId, String(p.reason ?? ""));
            await auditEvent(
              tx, msg, "capitalize_reject", "auc_project", p.aucId as string,
              rejected ? { reason: p.reason ?? null } : { failure: "NOT_PENDING", reason: p.reason ?? null },
              rejected ? "success" : "failure",
            );
            break;
          }
          case "asset_settings_update": {
            // Direct save: GL heads (only while the tenant's GL maker-checker is OFF; otherwise they go through a pending
            // request) and the "ON" direction of both maker-checker flags. Turning a control OFF is a two-person request.
            const tenantId = p.tenantId as string;
            const heads = headPatchFrom(p);
            const hasHeads = Object.keys(heads).length > 0;
            const wantCap = p.capitalizeMakerChecker === true ? true : undefined;
            const wantGl = p.glMakerChecker === true ? true : undefined;
            if (!hasHeads && wantCap === undefined && wantGl === undefined) break;
            const locked = await repo.lockAssetSettings(tx, tenantId, msg.actorId);
            // ANY head in the command while approval is ON is refused, whatever else the command carries (e.g. glMakerChecker:true)
            if (hasHeads && locked.glMakerChecker) {
              await auditSettings(tx, msg, "update", tenantId, { failure: "MAKER_CHECKER_REQUIRED", attempted: heads, reason: p.reason ?? null }, "failure");
              break;
            }
            await applySettingsChange(tx, msg, tenantId, {
              heads, capitalizeMakerChecker: wantCap, glMakerChecker: wantGl, reason: (p.reason as string | null) ?? null, resourceId: tenantId,
            });
            break;
          }
          case "gl_post_pending": {
            // Post journals deferred for missing accounts AND re-send ones finance rejected, once the accounts are right.
            // Bounded (SWEEP_LIMIT per kind); `more` tells the user to run it again.
            const swept = await sweepDeferred(tx, msg, p.tenantId as string, { includeFailed: true });
            await auditSettings(tx, msg, "gl_post_pending", p.tenantId as string, { ...swept });
            break;
          }
          case "settings_request": {
            // A change that weakens a control, or edits the GL heads while GL maker-checker is ON, waits for a second approver.
            const kind = String(p.kind ?? "");
            if (!REQUEST_KINDS.includes(kind)) { await auditSettings(tx, msg, "settings_request", p.id as string, { failure: "UNKNOWN_KIND", kind }, "failure"); break; }
            const inserted = await repo.insertSettingRequest(tx, {
              id: p.id as string, tenantId: p.tenantId as string, kind,
              reason: String(p.reason ?? ""), requestedBy: msg.actorId, payload: kind === "gl_heads_change" ? headPatchFrom(p.heads as Record<string, unknown> ?? {}) : null,
            });
            await auditSettings(tx, msg, `${kind}_request`, p.id as string,
              inserted ? { reason: p.reason ?? null, heads: p.heads ?? null } : { failure: "ALREADY_PENDING", kind }, inserted ? "success" : "failure");
            break;
          }
          case "settings_request_approve": {
            const tenantId = p.tenantId as string;
            const id = p.id as string;
            await repo.lockAssetSettings(tx, tenantId, msg.actorId); // one lock order everywhere: settings row, then the request
            const req = await repo.findSettingRequestForUpdate(tx, tenantId, id);
            if (!req || req.status !== "pending" || req.requestedBy === msg.actorId) {
              await auditSettings(tx, msg, `${req?.kind ?? "settings_request"}_approve`, id, { failure: !req || req.status !== "pending" ? "NOT_PENDING" : "SAME_ACTOR" }, "failure");
              break;
            }
            const reason = (p.reason as string | null) ?? null;
            if (req.kind === "gl_heads_change") {
              const applied = await applySettingsChange(tx, msg, tenantId, {
                heads: headPatchFrom((req.payload ?? {}) as Record<string, unknown>), reason: req.reason, resourceId: id,
                action: "gl_heads_change_approve", requestedBy: req.requestedBy,
              });
              if (!applied.ok) {
                // The accounts are no longer valid (or now clash): the request is closed as rejected, with the reason shown to the requester.
                await repo.decideSettingRequest(tx, tenantId, id, msg.actorId, "rejected", `${applied.refusal.code}: ${applied.refusal.message}`);
                break;
              }
            } else if (req.kind === "gl_maker_checker_off") {
              await applySettingsChange(tx, msg, tenantId, { glMakerChecker: false, reason: req.reason, resourceId: id, action: "gl_maker_checker_off_approve", requestedBy: req.requestedBy });
            } else {
              await applySettingsChange(tx, msg, tenantId, { capitalizeMakerChecker: false, reason: req.reason, resourceId: id, action: "maker_checker_off_approve", requestedBy: req.requestedBy });
            }
            await repo.decideSettingRequest(tx, tenantId, id, msg.actorId, "approved", reason);
            break;
          }
          case "settings_request_reject": {
            const decided = await repo.decideSettingRequest(tx, p.tenantId as string, p.id as string, msg.actorId, "rejected", (p.reason as string | null) ?? null);
            await auditSettings(tx, msg, decided ? `${decided.kind}_reject` : "settings_request_reject", p.id as string,
              decided ? { kind: decided.kind, reason: p.reason ?? null } : { failure: "NOT_PENDING" }, decided ? "success" : "failure");
            break;
          }
          case "auc_journal_repost": {
            // asset_admin repost of a FAILED capitalisation journal (the route re-validated the heads). ONE conditional
            // UPDATE failed -> pending, so a double click reposts once; the same deterministic journal is re-enqueued under a
            // fresh outbox message id, which finance sees as a new message (the dead-lettered one is already processed).
            const tenantId = p.tenantId as string;
            const aucId = p.aucId as string;
            const heads = headsFromSettings(await repo.getAssetSettingsTx(tx, tenantId), ["cwip", "fixed_asset"]);
            const row = await repo.findAucByIdTx(tx, tenantId, aucId);
            if (!row || row.status !== "capitalized" || row.accumulatedMinor <= 0n || !heads.cwip || !heads.fixed_asset) {
              await auditEvent(tx, msg, "journal_repost", "auc_project", aucId, { failure: !heads.cwip || !heads.fixed_asset ? "ASSET_GL_NOT_CONFIGURED" : "NOT_REPOSTABLE" }, "failure");
              break;
            }
            const journal = aucJournal(row, row.capitalizationDate ?? todayIST(), { fixed_asset: heads.fixed_asset, cwip: heads.cwip });
            if (!(await repo.repostAucJournal(tx, tenantId, aucId, journal.id))) {
              await auditEvent(tx, msg, "journal_repost", "auc_project", aucId, { failure: "NOT_FAILED", glPostStatus: row.glPostStatus }, "failure");
              break;
            }
            await enqueue(tx, { topic: GL_TOPIC, eventType: GL_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: journal });
            await auditEvent(tx, msg, "journal_repost", "auc_project", aucId, { journalId: journal.id, from: "failed", to: "pending", previousError: row.glPostError ?? null });
            break;
          }
          case "lease_journal_repost": {
            const tenantId = p.tenantId as string;
            const leaseId = p.leaseId as string;
            const row = await repo.findLeaseByIdTx(tx, tenantId, leaseId);
            if (!row) {
              await auditEvent(tx, msg, "journal_repost", "asset_lease", leaseId, { failure: "NOT_REPOSTABLE" }, "failure");
              break;
            }
            const needed = leaseHeadKinds(row.rouCostMinor, row.liabilityMinor);
            const heads = headsFromSettings(await repo.getAssetSettingsTx(tx, tenantId), needed);
            if (needed.some((k) => !heads[k])) {
              await auditEvent(tx, msg, "journal_repost", "asset_lease", leaseId, { failure: "ASSET_GL_NOT_CONFIGURED" }, "failure");
              break;
            }
            const journal = leaseJournal(row, heads);
            if (!(await repo.repostLeaseJournal(tx, tenantId, leaseId, journal.id))) {
              await auditEvent(tx, msg, "journal_repost", "asset_lease", leaseId, { failure: "NOT_FAILED", glPostStatus: row.glPostStatus }, "failure");
              break;
            }
            await enqueue(tx, { topic: GL_TOPIC, eventType: GL_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: journal });
            await auditEvent(tx, msg, "journal_repost", "asset_lease", leaseId, { journalId: journal.id, from: "failed", to: "pending", previousError: row.glPostError ?? null });
            break;
          }
          case "scan_log": {
            await repo.insertScanLog(tx, {
              id: p.id as string, tenantId: p.tenantId as string, barcode: String(p.barcode).slice(0, 256),
              assetId: (p.assetId as string | null) ?? null, found: Boolean(p.found), scannedBy: msg.actorId,
            });
            break;
          }
          case "location_deactivate": {
            // Re-check the child rule INSIDE the transaction (the route's pre-check can race with a child create).
            if ((await repo.countActiveChildren(tx, p.tenantId as string, p.id as string)) > 0) break;
            if (await repo.setLocationActive(tx, p.tenantId as string, p.id as string, false, msg.actorId)) {
              await auditEvent(tx, msg, "deactivate", "functional_location", p.id as string, { reason: p.reason ?? null });
            }
            break;
          }
          case "location_reactivate": {
            if (await repo.setLocationActive(tx, p.tenantId as string, p.id as string, true, msg.actorId)) {
              await auditEvent(tx, msg, "reactivate", "functional_location", p.id as string, {});
            }
            break;
          }
          case "lease_create": {
            // GL heads come from the tenant's settings (no defaults). The route pre-flights them; if they are gone by
            // now the lease is still recorded but its journal is marked failed -- it never looks recognised.
            const rou = BigInt(p.rouCostMinor as number);
            const liab = BigInt(p.liabilityMinor as number);
            const needed = leaseHeadKinds(rou, liab);
            const leaseHeads = headsFromSettings(await repo.getAssetSettingsTx(tx, p.tenantId as string), needed);
            const missingHeads = needed.filter((k) => !leaseHeads[k]);
            const leaseJournalId = leaseJournal({ id: p.leaseId as string, tenantId: p.tenantId as string, leaseStart: p.leaseStart as string, rouCostMinor: rou, liabilityMinor: liab }, {}).id;
            await repo.insertLease(tx, {
              id: p.leaseId as string,
              tenantId: p.tenantId as string,
              leaseNo: p.leaseNo as string,
              lessorName: p.lessorName as string,
              rouCostMinor: BigInt(p.rouCostMinor as number),
              liabilityMinor: BigInt(p.liabilityMinor as number),
              leaseStart: p.leaseStart as string,
              leaseEnd: p.leaseEnd as string,
              assetId: p.assetId as string,
              status: "active",
              ibrBps: typeof p.ibrBps === "number" ? p.ibrBps : null,
              paymentMinor: typeof p.paymentMinor === "number" ? BigInt(p.paymentMinor) : null,
              paymentFrequency: typeof p.paymentFrequency === "string" ? p.paymentFrequency : null,
              glPostStatus: missingHeads.length === 0 ? "pending" : "failed",
              glJournalId: missingHeads.length === 0 ? leaseJournalId : null,
              glPostError: missingHeads.length === 0 ? null : `no ${missingHeads.map((k) => HEAD_LABEL[k]).join(", ")} account configured`,
              createdBy: msg.actorId,
              updatedBy: msg.actorId,
            });
            // GAP-ASSETS-LEASES-07: discounted lease => persist the amortisation schedule (recomputed from the
            // same inputs the route used, so liability and schedule can never disagree).
            if (typeof p.ibrBps === "number" && typeof p.paymentMinor === "number") {
              const sched = buildLeaseSchedule({
                leaseStart: p.leaseStart as string, leaseEnd: p.leaseEnd as string, paymentMinor: BigInt(p.paymentMinor),
                ibrBps: p.ibrBps, frequency: (p.paymentFrequency as LeaseFrequency | undefined) ?? "monthly",
              });
              await repo.insertLeaseScheduleRows(tx, sched.rows.map((r) => ({
                tenantId: p.tenantId as string, leaseId: p.leaseId as string, seq: r.seq, dueDate: r.dueDate,
                openingMinor: r.openingMinor, interestMinor: r.interestMinor, paymentMinor: r.paymentMinor,
                principalMinor: r.principalMinor, closingMinor: r.closingMinor,
              })));
            }
            await registerRepo.insertAsset(tx, {
              id: p.assetId as string,
              tenantId: p.tenantId as string,
              name: `ROU — ${p.lessorName as string}`,
              code: p.code as string,
              categoryId: DEFAULT_IT_CATEGORY,
              assetType: "fixed",
              barcode: makeBarcode(p.code as string),
              status: "active",
              acquisitionCost: BigInt(p.rouCostMinor as number),
              salvageValue: 0n,
              usefulLifeYears: p.usefulLifeYears as number,
              depRate: "20",
              depMethod: "SLM",
              currency: "INR",
              bookValue: BigInt(p.rouCostMinor as number),
              accumulatedDep: 0n,
              acquisitionDate: p.leaseStart as string,
              poRef: null,
              grnRef: null,
              location: null,
              notes: `ROU lease ${p.leaseNo as string}`,
              createdBy: msg.actorId,
              updatedBy: msg.actorId,
            });
            // Initial recognition journal: Dr ROU asset / Cr lease liability (+ the clearing head for any ROU-vs-liability difference).
            if (missingHeads.length === 0) {
              await enqueue(tx, {
                topic: GL_TOPIC, eventType: GL_TOPIC,
                tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
                payload: leaseJournal({ id: p.leaseId as string, tenantId: p.tenantId as string, leaseStart: p.leaseStart as string, rouCostMinor: rou, liabilityMinor: liab }, leaseHeads),
              });
            }
            await auditEvent(tx, msg, "create", "asset_lease", p.leaseId as string, {
              leaseNo: p.leaseNo, rouCostMinor: rou.toString(), liabilityMinor: liab.toString(), discounted: typeof p.ibrBps === "number",
              journal: missingHeads.length === 0 ? "pending" : "failed",
            });
            break;
          }
          case "impairment": {
            const evId = p.id as string;
            const assetId = p.assetId as string;
            const tenantId = p.tenantId as string;
            const amountMinor = BigInt(p.amountMinor as number);
            const before = BigInt(p.bookValueBefore as string);
            const after = BigInt(p.bookValueAfter as string);
            const eventDate = p.eventDate as string;
            await repo.insertImpairment(tx, {
              id: evId, tenantId, assetId, eventType: "impairment",
              amountMinor, bookValueBefore: before, bookValueAfter: after,
              reason: (p.reason as string | null) ?? null, eventDate,
              createdBy: msg.actorId,
            });
            await registerRepo.updateAssetBookValue(tx, assetId, tenantId, after, BigInt(p.accumulatedDep as string), msg.actorId);
            await enqueue(tx, {
              topic: GL_TOPIC, eventType: GL_TOPIC,
              tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
              payload: {
                id: uuidV5(`impairment:${evId}`),
                tenantId,
                type: "asset_impairment",
                voucherNo: `IMP/${eventDate}/${assetId.slice(0, 8)}`,
                postingDate: eventDate,
                lines: [
                  { accountCode: await requiredHead(tx, tenantId, "impairment_expense"), debitMinor: amountMinor.toString(), creditMinor: "0" },
                  { accountCode: await requiredHead(tx, tenantId, "fixed_asset"), debitMinor: "0", creditMinor: amountMinor.toString() },
                ],
              },
            });
            break;
          }
          case "revaluation": {
            const evId = p.id as string;
            const assetId = p.assetId as string;
            const tenantId = p.tenantId as string;
            const before = BigInt(p.bookValueBefore as string);
            const after = BigInt(p.bookValueAfter as string);
            const delta = BigInt(p.delta as string);
            const isUpward = p.isUpward as boolean;
            const eventDate = p.eventDate as string;
            await repo.insertImpairment(tx, {
              id: evId, tenantId, assetId, eventType: "revaluation",
              amountMinor: delta, bookValueBefore: before, bookValueAfter: after,
              reason: (p.reason as string | null) ?? null, eventDate,
              createdBy: msg.actorId,
            });
            await registerRepo.updateAssetBookValue(tx, assetId, tenantId, after, BigInt(p.accumulatedDep as string), msg.actorId);
            if (delta > 0n) {
              const lines = isUpward
                ? [
                    { accountCode: await requiredHead(tx, tenantId, "fixed_asset"), debitMinor: delta.toString(), creditMinor: "0" },
                    { accountCode: await requiredHead(tx, tenantId, "revaluation_reserve"), debitMinor: "0", creditMinor: delta.toString() },
                  ]
                : [
                    { accountCode: await requiredHead(tx, tenantId, "revaluation_reserve"), debitMinor: delta.toString(), creditMinor: "0" },
                    { accountCode: await requiredHead(tx, tenantId, "fixed_asset"), debitMinor: "0", creditMinor: delta.toString() },
                  ];
              await enqueue(tx, {
                topic: GL_TOPIC, eventType: GL_TOPIC,
                tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
                payload: {
                  id: uuidV5(`revaluation:${evId}`),
                  tenantId,
                  type: "asset_revaluation",
                  voucherNo: `REVAL/${eventDate}/${assetId.slice(0, 8)}`,
                  postingDate: eventDate,
                  lines,
                },
              });
            }
            break;
          }
          case "location_create": {
            await repo.insertLocation(tx, {
              id: p.id as string,
              tenantId: p.tenantId as string,
              code: p.code as string,
              name: p.name as string,
              orgUnit: (p.orgUnit as string | null) ?? null,
              parentId: (p.parentId as string | null) ?? null,
              createdBy: msg.actorId,
            });
            await enqueue(tx, {
              topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
              tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
              payload: {
                service: "asset", module: "enterprise", action: "create", resourceType: "functional_location",
                resourceId: p.id as string, outcome: "success",
                details: { code: p.code, name: p.name, orgUnit: p.orgUnit ?? null, parentId: p.parentId ?? null },
              },
            });
            break;
          }
          case "location_update": {
            const patch: { name?: string; orgUnit?: string | null } = {};
            if (typeof p.name === "string") patch.name = p.name;
            if (p.orgUnit === null || typeof p.orgUnit === "string") patch.orgUnit = p.orgUnit;
            if (Object.keys(patch).length > 0) {
              const before = await repo.findLocationByIdTx(tx, p.tenantId as string, p.id as string);
              await repo.updateLocation(tx, p.tenantId as string, p.id as string, patch);
              await enqueue(tx, {
                topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
                tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
                payload: {
                  service: "asset", module: "enterprise", action: "update", resourceType: "functional_location",
                  resourceId: p.id as string, outcome: "success",
                  details: { ...patch, before: before ? { name: before.name, orgUnit: before.orgUnit } : null },
                },
              });
            }
            break;
          }
          case "spare_part": {
            await repo.insertSparePart(tx, {
              id: p.id as string,
              tenantId: p.tenantId as string,
              workOrderId: p.workOrderId as string,
              partCode: p.partCode as string,
              description: (p.description as string | null) ?? null,
              qty: p.qty as number,
              costMinor: BigInt(p.costMinor as number),
              createdBy: msg.actorId,
            });
            break;
          }
          case "request_disposal": {
            await repo.insertPendingDisposal(tx, {
              id: p.id as string,
              tenantId: p.tenantId as string,
              assetId: p.assetId as string,
              disposalDate: p.disposalDate as string,
              disposalMethod: p.disposalMethod as string,
              proceedsMinor: BigInt(p.proceedsMinor as number),
              currency: p.currency as string,
              notes: (p.notes as string | null) ?? null,
              workflowStatus: "pending",
              createdBy: msg.actorId,
            });
            await enqueue(tx, {
              topic: WORKFLOW_CREATE, eventType: WORKFLOW_CREATE,
              tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
              payload: {
                id: p.wfId as string,
                tenantId: p.tenantId as string,
                name: `Asset Disposal — ${(p.assetId as string).slice(0, 8)}`,
                status: "active",
                definitionCode: "asset_disposal",
                startNodeKey: "committee",
                initialTaskName: "Write-off Committee",
                version: 1,
                refType: "asset_disposal",
                refId: p.id as string,
              },
            });
            break;
          }
          case "inter_org_transfer": {
            await repo.insertInterOrgTransfer(tx, {
              id: p.id as string,
              tenantId: p.tenantId as string,
              assetId: p.assetId as string,
              fromOrg: p.fromOrg as string,
              toOrg: p.toOrg as string,
              transferDate: p.transferDate as string,
              notes: (p.notes as string | null) ?? null,
              createdBy: msg.actorId,
            });
            await registerRepo.updateAssetLocation(tx, p.assetId as string, p.tenantId as string, String(p.toOrg), msg.actorId);
            break;
          }
          case "bulk_import": {
            const rows = p.rows as Array<Record<string, unknown>>;
            await repo.bulkInsertAssets(tx, rows as never);
            // GAP-ASSETS-BULK-IMPORT-04: one audit event per batch (actor,
            // row count, reason), in the same transaction as the insert.
            await enqueue(tx, {
              topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
              tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
              payload: {
                service: "asset", action: "bulk_import", resourceType: "asset_batch",
                resourceId: p.id as string, outcome: "success",
                count: rows.length, reason: (p.reason as string | undefined) ?? null,
              },
            });
            break;
          }
        }
      });
    } catch (err) {
      log.error({ err, op, messageId: msg.messageId }, "f3RouteWrite failed");
      throw err;
    }
  });

  // Finance answers for every journal the asset service sent: flip the record's gl_post_status so the UI shows
  // "journal not posted" instead of a silently-missing journal. Conditional on `pending`, so replays are no-ops.
  queue.subscribe(CONSUMED_EVENTS.glPosted, async (msg) => {
    const p = msg.payload as { journalId?: string };
    if (typeof p.journalId !== "string") return;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.resolveGlJournal(tx, msg.tenantId, p.journalId as string, "posted", null);
    });
  });

  queue.subscribe(CONSUMED_EVENTS.glRejected, async (msg) => {
    const p = msg.payload as { journalId?: string; reason?: string; code?: string };
    if (typeof p.journalId !== "string") return;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Finance's refusal code is kept with the reason (PERIOD_CLOSED, NOT_LEAF_ACCOUNT, UNKNOWN_ACCOUNT_CODE, ...) so the
      // record's page can say what to do. The record is only marked rejected; the journal is never silently re-dated.
      const text = String(p.reason ?? "finance rejected the journal");
      const reason = p.code && !text.startsWith(p.code) ? `${p.code}: ${text}` : text;
      const hit = await repo.resolveGlJournal(tx, msg.tenantId, p.journalId as string, "failed", reason);
      if (hit) {
        await auditEvent(tx, msg, "gl_post", REJECTED_RESOURCE[hit.kind], hit.id, { journalId: p.journalId, code: p.code ?? null, failure: reason }, "failure");
      }
    });
  });
}

const REJECTED_RESOURCE = { auc: "auc_project", lease: "asset_lease", asset: "asset", work_order: "work_order" } as const;

/**
 * A tenant's configured head for an impairment / revaluation journal. No default: if it has vanished since the route
 * pre-flighted it, the consumer REFUSES (throws, so nothing is written and the book value is not changed) rather than
 * guessing an account.
 */
async function requiredHead(tx: Tx, tenantId: string, kind: "fixed_asset" | "impairment_expense" | "revaluation_reserve"): Promise<string> {
  const head = headsFromSettings(await repo.getAssetSettingsTx(tx, tenantId), [kind])[kind];
  if (!head) throw new Error(`ASSET_GL_NOT_CONFIGURED: no ${HEAD_LABEL[kind]} account configured for tenant ${tenantId}`);
  return head;
}
