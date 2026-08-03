// @ts-nocheck — F3 leftover consumer; ops closed over from enterprise routes
import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { queue as rawQueue } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { uuidV5 } from "../../shared/ids.js";
import * as repo from "./repo.js";
import * as registerRepo from "../register/repo.js";
import { makeBarcode } from "../register/consumer.js";

const log = pino({ name: "asset-f3-enterprise" });
const WORKFLOW_CREATE = "workflow.instance.create";
const GL_TOPIC = "finance.gl.post";
const DEFAULT_IT_CATEGORY = "77777777-0001-0000-0000-000000000001";
const FIXED_ASSET_CODE = process.env.ASSET_FIXED_ASSET_CODE ?? "1200";
const IMPAIRMENT_CODE = process.env.ASSET_IMPAIRMENT_CODE ?? "5200";
const REVAL_RESERVE_CODE = process.env.ASSET_REVAL_RESERVE_CODE ?? "3100";

export function registerF3EnterpriseConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, unknown>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "auc_create", "auc_capitalize", "lease_create", "impairment", "revaluation",
      "location_create", "spare_part", "request_disposal", "inter_org_transfer", "bulk_import",
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
            break;
          }
          case "auc_capitalize": {
            const aucId = p.aucId as string;
            const assetId = p.assetId as string;
            const tenantId = p.tenantId as string;
            const projectCode = p.projectCode as string;
            const name = p.name as string;
            const accumulatedMinor = BigInt(p.accumulatedMinor as string);
            const code = `AUC/${projectCode}`;
            await registerRepo.insertAsset(tx, {
              id: assetId, tenantId, name, code,
              categoryId: DEFAULT_IT_CATEGORY, assetType: "infra", barcode: makeBarcode(code),
              status: "active", acquisitionCost: accumulatedMinor, salvageValue: 0n,
              usefulLifeYears: 10, depRate: "10", depMethod: "SLM", currency: "INR",
              bookValue: accumulatedMinor, accumulatedDep: 0n,
              acquisitionDate: new Date().toISOString().slice(0, 10),
              poRef: null, grnRef: null, location: null, notes: `Capitalized from AUC ${projectCode}`,
              projectRef: projectCode, orgUnit: null, aucId,
              createdBy: msg.actorId, updatedBy: msg.actorId,
            });
            await repo.updateAuc(tx, aucId, { status: "capitalized", assetId, updatedBy: msg.actorId });
            break;
          }
          case "lease_create": {
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
              createdBy: msg.actorId,
              updatedBy: msg.actorId,
            });
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
              notes: `IFRS 16 ROU lease ${p.leaseNo as string}`,
              createdBy: msg.actorId,
              updatedBy: msg.actorId,
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
                  { accountCode: IMPAIRMENT_CODE, debitMinor: amountMinor.toString(), creditMinor: "0" },
                  { accountCode: FIXED_ASSET_CODE, debitMinor: "0", creditMinor: amountMinor.toString() },
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
                    { accountCode: FIXED_ASSET_CODE, debitMinor: delta.toString(), creditMinor: "0" },
                    { accountCode: REVAL_RESERVE_CODE, debitMinor: "0", creditMinor: delta.toString() },
                  ]
                : [
                    { accountCode: REVAL_RESERVE_CODE, debitMinor: delta.toString(), creditMinor: "0" },
                    { accountCode: FIXED_ASSET_CODE, debitMinor: "0", creditMinor: delta.toString() },
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
            break;
          }
        }
      });
      if (op === "auc_capitalize") {
        const assetId = p.assetId as string;
        const tenantId = p.tenantId as string;
        await rawQueue.publish(COMMANDS.depSchedule, {
          messageId: randomUUID(), type: COMMANDS.depSchedule,
          tenantId, actorId: msg.actorId, correlationId: msg.correlationId, schemaVersion: "1.0",
          payload: { id: randomUUID(), assetId, tenantId, method: "SLM", startDate: new Date().toISOString().slice(0, 10), depBook: "company" },
        });
        await rawQueue.publish(COMMANDS.depSchedule, {
          messageId: randomUUID(), type: COMMANDS.depSchedule,
          tenantId, actorId: msg.actorId, correlationId: msg.correlationId, schemaVersion: "1.0",
          payload: { id: randomUUID(), assetId, tenantId, method: "WDV", startDate: new Date().toISOString().slice(0, 10), depBook: "statutory" },
        });
      }
    } catch (err) {
      log.error({ err, op, messageId: msg.messageId }, "f3RouteWrite failed");
      throw err;
    }
  });
}
