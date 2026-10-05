/**
 * GAP-CRM-SERVICE-REQUESTS-NEW-02 — service-type master admin (CQRS).
 *   GET    /v1/crm/service-types        — the tenant's configured service types
 *   POST   /v1/crm/service-types        — create a type (admin; 202 -> consumer, audited)
 *   PUT    /v1/crm/service-types/:id     — amend a type (admin; 202 -> consumer, audited)
 *   DELETE /v1/crm/service-types/:id     — remove a type (admin; 202 -> consumer, audited)
 *
 * Routes are read-only + validate + publish; the consumer (shared/code-master.ts) does
 * the write and the audit event in one transaction. The table starts EMPTY per tenant on
 * purpose — the built-in default list is a labelled web-side fallback, so no fake tenant
 * rows are ever seeded. The new-request form keeps accepting the free-text `serviceType`
 * label; this master only governs which labels are *offered*.
 */
import type { FastifyInstance } from "fastify";
import type { Queue } from "@civitasone/queue";
import { COMMANDS } from "../../topics.js";
import { registerCodeMasterRoutes, registerCodeMasterConsumers, type CodeMasterConfig } from "../../shared/code-master.js";

const CFG: CodeMasterConfig = {
  path: "service-types",
  table: "crm.service_types",
  resource: "service_type",
  noun: "service type",
  hasSla: true,
  commands: {
    create: COMMANDS.createServiceType,
    update: COMMANDS.updateServiceType,
    remove: COMMANDS.deleteServiceType,
  },
};

export const serviceTypeRoutes = (app: FastifyInstance): Promise<void> => registerCodeMasterRoutes(app, CFG);
export const registerServiceTypeConsumers = (queue: Queue): void => registerCodeMasterConsumers(queue, CFG);
