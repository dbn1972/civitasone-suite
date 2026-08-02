import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as ticketRepo from "../tickets/repo.js";
import { tickets } from "../tickets/schema.js";
import * as repo from "./repo.js";
import type { FormField, FulfilmentStage } from "./domain.js";

const log = pino({ name: "helpdesk.catalogue.consumer" });
const AUDIT = "audit.event.record";

type Msg = { tenantId: string; actorId: string; correlationId: string; messageId: string };
type Tx = Parameters<typeof enqueue>[0];

function audit(tx: Tx, msg: Msg, action: string, resourceId: string, outcome = "success"): Promise<unknown> {
  return enqueue(tx, {
    topic: AUDIT,
    eventType: AUDIT,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "helpdesk", action, resourceType: "service_request", resourceId, outcome },
  });
}

function event(tx: Tx, msg: Msg, eventType: string, payload: Record<string, unknown>): Promise<unknown> {
  return enqueue(tx, {
    topic: eventType,
    eventType,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload,
  });
}

export function registerCatalogueConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.catalogueOfferingCreate, async (msg) => {
    const p = msg.payload as Record<string, unknown> & { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      try {
        await repo.insertOffering(tx as repo.Writer, {
          id: p.id,
          tenantId: p.tenantId,
          name: p.name as string,
          category: (p.category as string) ?? "general",
          description: (p.description as string | null) ?? null,
          status: "active",
          slaPolicyId: (p.slaPolicyId as string | null) ?? null,
          approvalRequired: (p.approvalRequired as boolean) ?? false,
          requestFormSchema: (p.requestFormSchema as FormField[]) ?? [],
          fulfilmentStages: (p.fulfilmentStages as FulfilmentStage[]) ?? [],
          defaultPriority: (p.defaultPriority as string) ?? "Medium",
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });
        await audit(tx, msg, "create_offering", p.id);
      } catch (err) {
        if ((err as { code?: string }).code === "23505") {
          await audit(tx, msg, "create_offering", p.id, "rejected_duplicate");
        } else {
          throw err;
        }
      }
    });
    log.info({ id: p.id }, "catalogue offering created");
  });

  queue.subscribe(COMMANDS.catalogueOfferingUpdate, async (msg) => {
    const p = msg.payload as Record<string, unknown> & { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const patch: Record<string, unknown> = { updatedBy: msg.actorId };
      for (const key of [
        "name",
        "category",
        "description",
        "status",
        "slaPolicyId",
        "approvalRequired",
        "requestFormSchema",
        "fulfilmentStages",
        "defaultPriority",
      ]) {
        if (p[key] !== undefined) patch[key] = p[key];
      }
      const updated = await repo.updateOffering(tx as repo.Writer, p.id, p.tenantId, patch);
      if (updated) await audit(tx, msg, "update_offering", p.id);
    });
  });

  queue.subscribe(COMMANDS.catalogueOlaCreate, async (msg) => {
    const p = msg.payload as Record<string, unknown> & { id: string; tenantId: string; offeringId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertOla(tx as repo.Writer, {
        id: p.id,
        tenantId: p.tenantId,
        offeringId: p.offeringId,
        name: p.name as string,
        kind: (p.kind as string) ?? "ola",
        provider: p.provider as string,
        targetMinutes: p.targetMinutes as number,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create_ola", p.id);
    });
  });

  queue.subscribe(COMMANDS.catalogueRequestRaise, async (msg) => {
    const p = msg.payload as {
      requestId: string;
      ticketId: string;
      tenantId: string;
      offeringId: string;
      offeringName: string;
      formData: Record<string, unknown>;
      priority: string;
      initialStatus: string;
      initialStage: string | null;
      approvalRequired: boolean;
      slaPolicyId: string | null;
      responseDeadline: string | null;
      resolutionDeadline: string | null;
    };
    await db.transaction(async (txRaw) => {
      if (!(await markProcessed(txRaw, msg.messageId))) return;
      const tx = txRaw as unknown as ticketRepo.Writer & repo.Writer;

      await ticketRepo.insert(tx as ticketRepo.Writer, {
        id: p.ticketId,
        tenantId: p.tenantId,
        subject: `${p.offeringName} — service request`,
        description: `Self-service catalogue request for "${p.offeringName}".`,
        priority: p.priority,
        status: "open",
        source: "catalogue",
        sourceRef: p.requestId,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      } as typeof tickets.$inferInsert);

      await repo.insertRequest(tx as repo.Writer, {
        id: p.requestId,
        tenantId: p.tenantId,
        offeringId: p.offeringId,
        ticketId: p.ticketId,
        requestedBy: msg.actorId,
        formData: p.formData,
        status: p.initialStatus,
        currentStage: p.initialStage,
        slaPolicyId: p.slaPolicyId,
        responseDeadline: p.responseDeadline ? new Date(p.responseDeadline) : null,
        resolutionDeadline: p.resolutionDeadline ? new Date(p.resolutionDeadline) : null,
        slaStatus: "within_sla",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });

      if (p.initialStage) {
        await repo.insertStageEvent(tx as repo.Writer, {
          tenantId: p.tenantId,
          requestId: p.requestId,
          fromStage: null,
          toStage: p.initialStage,
          actorId: msg.actorId,
          note: "request raised",
        });
      }

      await event(tx as Tx, msg, EVENTS.requestRaised, {
        requestId: p.requestId,
        offeringId: p.offeringId,
        offeringName: p.offeringName,
        ticketId: p.ticketId,
        requestedBy: msg.actorId,
        status: p.initialStatus,
        approvalRequired: p.approvalRequired,
      });
      await event(tx as Tx, msg, EVENTS.ticketCreated, {
        ticketId: p.ticketId,
        subject: `${p.offeringName} — service request`,
        source: "catalogue",
        sourceRef: p.requestId,
      });
      await audit(tx as Tx, msg, "raise_request", p.requestId);
    });
    log.info({ requestId: p.requestId, ticketId: p.ticketId }, "service request raised");
  });

  queue.subscribe(COMMANDS.catalogueRequestApprove, async (msg) => {
    const p = msg.payload as {
      requestId: string;
      tenantId: string;
      decision: "approved" | "rejected";
      comment?: string | null;
      nextStatus: string;
      nextStage: string | null;
      ticketId: string | null;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertApproval(tx as repo.Writer, {
        tenantId: p.tenantId,
        requestId: p.requestId,
        decision: p.decision,
        decidedBy: msg.actorId,
        comment: p.comment ?? null,
        createdBy: msg.actorId,
      });
      await repo.updateRequest(tx as repo.Writer, p.requestId, p.tenantId, {
        status: p.nextStatus,
        currentStage: p.nextStage,
        updatedBy: msg.actorId,
      });
      if (p.decision === "approved" && p.nextStage) {
        await repo.insertStageEvent(tx as repo.Writer, {
          tenantId: p.tenantId,
          requestId: p.requestId,
          fromStage: null,
          toStage: p.nextStage,
          actorId: msg.actorId,
          note: "approved — fulfilment started",
        });
      }
      await event(
        tx as Tx,
        msg,
        p.decision === "approved" ? EVENTS.requestApproved : EVENTS.requestRejected,
        { requestId: p.requestId, ticketId: p.ticketId, decidedBy: msg.actorId, status: p.nextStatus },
      );
      await audit(tx as Tx, msg, p.decision === "approved" ? "approve_request" : "reject_request", p.requestId);
    });
  });

  queue.subscribe(COMMANDS.catalogueRequestAdvance, async (msg) => {
    const p = msg.payload as {
      requestId: string;
      tenantId: string;
      fromStage: string;
      toStage: string;
      ticketId: string | null;
      note?: string | null;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updateRequest(tx as repo.Writer, p.requestId, p.tenantId, {
        status: "in_fulfilment",
        currentStage: p.toStage,
        updatedBy: msg.actorId,
      });
      await repo.insertStageEvent(tx as repo.Writer, {
        tenantId: p.tenantId,
        requestId: p.requestId,
        fromStage: p.fromStage,
        toStage: p.toStage,
        actorId: msg.actorId,
        note: p.note ?? null,
      });
      await event(tx as Tx, msg, EVENTS.requestStageAdvanced, {
        requestId: p.requestId,
        ticketId: p.ticketId,
        fromStage: p.fromStage,
        toStage: p.toStage,
      });
      await audit(tx as Tx, msg, "advance_stage", p.requestId);
    });
  });

  queue.subscribe(COMMANDS.catalogueRequestFulfil, async (msg) => {
    const p = msg.payload as {
      requestId: string;
      tenantId: string;
      ticketId: string | null;
      offeringId: string;
      fromStage: string | null;
      note?: string | null;
    };
    const now = new Date();
    await db.transaction(async (txRaw) => {
      if (!(await markProcessed(txRaw, msg.messageId))) return;
      const tx = txRaw as unknown as repo.Writer & ticketRepo.Writer;
      await repo.updateRequest(tx as repo.Writer, p.requestId, p.tenantId, {
        status: "fulfilled",
        updatedBy: msg.actorId,
      });
      await repo.insertStageEvent(tx as repo.Writer, {
        tenantId: p.tenantId,
        requestId: p.requestId,
        fromStage: p.fromStage,
        toStage: "fulfilled",
        actorId: msg.actorId,
        note: p.note ?? "request fulfilled",
      });
      if (p.ticketId) {
        await ticketRepo.transitionStatus(
          tx as ticketRepo.Writer,
          p.ticketId,
          p.tenantId,
          "resolved",
          msg.actorId,
          now,
        );
      }
      await event(tx as Tx, msg, EVENTS.requestFulfilled, {
        requestId: p.requestId,
        ticketId: p.ticketId,
        offeringId: p.offeringId,
      });
      await audit(tx as Tx, msg, "fulfil_request", p.requestId);
    });
  });
}
