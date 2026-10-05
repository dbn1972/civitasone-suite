/**
 * GAP-CRM-GRIEVANCES-NEW-03 — grievance-category master admin (CQRS).
 *   GET    /v1/crm/grievance-categories        — the tenant's configured categories
 *   POST   /v1/crm/grievance-categories        — create (admin; 202 -> consumer, audited)
 *   PUT    /v1/crm/grievance-categories/:id     — amend (admin; 202 -> consumer, audited)
 *   DELETE /v1/crm/grievance-categories/:id     — remove (admin; 202 -> consumer, audited)
 *
 * Mirrors the service-type master: routes validate + publish; the consumer in
 * shared/code-master.ts writes + audits in one transaction. The table starts EMPTY per
 * tenant; the CPGRAMS-aligned default list is a labelled web-side fallback.
 */
import type { FastifyInstance } from "fastify";
import type { Queue } from "@civitasone/queue";
import { COMMANDS } from "../../topics.js";
import { registerCodeMasterRoutes, registerCodeMasterConsumers, type CodeMasterConfig } from "../../shared/code-master.js";

const CFG: CodeMasterConfig = {
  path: "grievance-categories",
  table: "crm.grievance_categories",
  resource: "grievance_category",
  noun: "grievance category",
  commands: {
    create: COMMANDS.createGrievanceCategory,
    update: COMMANDS.updateGrievanceCategory,
    remove: COMMANDS.deleteGrievanceCategory,
  },
};

export const grievanceCategoryRoutes = (app: FastifyInstance): Promise<void> => registerCodeMasterRoutes(app, CFG);
export const registerGrievanceCategoryConsumers = (queue: Queue): void => registerCodeMasterConsumers(queue, CFG);
