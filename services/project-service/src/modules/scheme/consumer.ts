import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { assertFundReleaseWithinAllocation, assertFundReleaseCanDisburse } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";
const FINANCE_URL = process.env.FINANCE_SERVICE_URL ?? "http://finance-service:3007";

export function registerSchemeConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.schemeCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; code: string; name: string; type?: string;
      fundingPattern?: string; totalOutlayMinor?: number; sanctionRef?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertScheme(tx, {
        id: p.id, tenantId: p.tenantId, code: p.code, name: p.name,
        type: p.type ?? "css", fundingPattern: p.fundingPattern ?? "100",
        totalOutlayMinor: BigInt(p.totalOutlayMinor ?? 0),
        sanctionRef: p.sanctionRef ?? null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.schemeCreated, eventType: EVENTS.schemeCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          schemeId: p.id, code: p.code, name: p.name,
          sanctionRef: p.sanctionRef ?? null,
          totalOutlayMinor: String(p.totalOutlayMinor ?? 0),
        },
      });
      await audit(tx, msg, "create", "scheme", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "scheme", p.id));
  });

  queue.subscribe(COMMANDS.schemeComponentCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; schemeId: string; code: string; name: string;
      allocationMinor: number; weightPct?: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertComponent(tx, {
        id: p.id, schemeId: p.schemeId, tenantId: p.tenantId,
        code: p.code, name: p.name,
        allocationMinor: BigInt(p.allocationMinor),
        weightPct: String(p.weightPct ?? 0),
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "scheme_component", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "scheme", p.schemeId));
  });

  queue.subscribe(COMMANDS.fundReleaseCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; schemeId: string; componentId: string;
      releaseNo: string; amountMinor: number; toEntity?: string; pfmsRef?: string;
    };
    const amount = BigInt(p.amountMinor);

    // Domain check: fund release within component allocation
    const component = await repo.findComponentByIdTx(db as any, p.componentId);
    if (!component) {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await enqueue(tx, {
          topic: EVENTS.fundReleaseAllocationExceeded, eventType: EVENTS.fundReleaseAllocationExceeded,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { releaseId: p.id, componentId: p.componentId, reason: "component not found" },
        });
      });
      return;
    }

    try {
      assertFundReleaseWithinAllocation(
        component.allocationMinor ?? 0n,
        component.releasedMinor ?? 0n,
        amount
      );
    } catch (err) {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await enqueue(tx, {
          topic: EVENTS.fundReleaseAllocationExceeded, eventType: EVENTS.fundReleaseAllocationExceeded,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { releaseId: p.id, componentId: p.componentId, amountMinor: p.amountMinor, reason: String(err) },
        });
      });
      return;
    }

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertFundRelease(tx, {
        id: p.id, schemeId: p.schemeId, componentId: p.componentId, tenantId: p.tenantId,
        releaseNo: p.releaseNo, amountMinor: amount, currency: "INR",
        status: "approved", toEntity: p.toEntity ?? "agency",
        pfmsRef: p.pfmsRef ?? null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await repo.updateComponentReleasedTx(tx, p.componentId, amount, component.version ?? 1);
      await enqueue(tx, {
        topic: EVENTS.fundReleaseApproved, eventType: EVENTS.fundReleaseApproved,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          releaseId: p.id, schemeId: p.schemeId, componentId: p.componentId,
          amountMinor: p.amountMinor, toEntity: p.toEntity ?? "agency",
        },
      });
      await audit(tx, msg, "create", "fund_release", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "scheme", p.schemeId));
  });

  queue.subscribe(COMMANDS.fundReleaseDisburse, async (msg) => {
    const p = msg.payload as { rId: string; tenantId: string; schemeId: string; pfmsRef?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const release = await repo.findFundReleaseByIdTx(tx, p.rId);
      if (!release) throw new Error(`fund release ${p.rId} not found`);
      assertFundReleaseCanDisburse(release.status ?? "pending");
      await repo.updateFundReleaseTx(tx, p.rId, {
        status: "disbursed",
        pfmsRef: p.pfmsRef ?? release.pfmsRef,
        disbursedAt: new Date(),
        updatedBy: msg.actorId,
        version: (release.version ?? 1) + 1,
      });
      await enqueue(tx, {
        topic: EVENTS.fundReleaseDisbursed, eventType: EVENTS.fundReleaseDisbursed,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { releaseId: p.rId, schemeId: p.schemeId },
      });
      await audit(tx, msg, "disburse", "fund_release", p.rId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "scheme", p.schemeId));
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "project", action, resourceType, resourceId, outcome: "success" },
  });
}
