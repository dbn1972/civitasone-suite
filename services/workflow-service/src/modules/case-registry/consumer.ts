import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { registerCaseTx } from "./repo.js";
import { caseDeviations } from "./schema.js";

/**
 * CAP-031 — cross-domain case registration. Each source domain emits its own
 * "created" event; we map it onto the canonical registry row and upsert it
 * idempotently (unique on tenant+source_service+source_ref_id). Inbox-dedup and
 * the registry insert commit in ONE transaction so a mid-flight crash never
 * marks a message processed without registering it.
 *
 * NOTE: the queue passed in MUST be tenantScoped() (see worker.ts) so each
 * handler runs inside runWithTenant — workflow.cases is FORCE-RLS and
 * workflow_svc is NOBYPASSRLS, so a GUC-less insert is rejected.
 */
interface DomainCaseEvent {
  id?: string; tenantId?: string; title?: string; subject?: string; name?: string;
  caseType?: string; type?: string; priority?: string;
  sourceRefId?: string; metadata?: Record<string, unknown>;
}

const REGISTRATION_MAP: Array<{ topic: string; sourceService: string; defaultType: string }> = [
  { topic: "workflow.case.create", sourceService: "workflow", defaultType: "generic" },
  { topic: "court.case.created", sourceService: "court", defaultType: "court_case" },
  { topic: "legal.matter.created", sourceService: "legal", defaultType: "legal_matter" },
  { topic: "helpdesk.ticket.created", sourceService: "helpdesk", defaultType: "ticket" },
  { topic: "citizen.request.created", sourceService: "citizen", defaultType: "service_request" },
];

export function registerCaseRegistryConsumers(q: Queue): void {
  for (const m of REGISTRATION_MAP) {
    q.subscribe(m.topic, async (msg: CommandEnvelope<DomainCaseEvent>) => {
      const p = msg.payload;
      const sourceRefId = p.sourceRefId ?? p.id;
      if (!sourceRefId) return;
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await registerCaseTx(tx as never, {
          tenantId: p.tenantId ?? msg.tenantId,
          title: p.title ?? p.subject ?? p.name ?? `${m.sourceService} case`,
          caseType: p.caseType ?? p.type ?? m.defaultType,
          sourceService: m.sourceService,
          sourceRefId,
          priority: p.priority ?? "normal",
          metadata: p.metadata ?? {},
          actorId: msg.actorId,
          correlationId: msg.correlationId,
        });
      });
    });
  }

  // CAP-031 — deviation observation recorder (simple register; the full waiver
  // lifecycle is the deviations module, CAP-039).
  q.subscribe("workflow.case.deviation", async (msg: CommandEnvelope<{ id: string; caseId: string; tenantId: string; type: string; description: string; severity?: string }>) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.insert(caseDeviations).values({
        id: p.id, tenantId: p.tenantId, caseId: p.caseId,
        type: p.type, description: p.description, severity: p.severity ?? "medium",
        status: "open", createdBy: msg.actorId,
      });
    });
  });
}
