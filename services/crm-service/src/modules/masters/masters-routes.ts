/**
 * Tenant-managed code masters added by the owner decision sheet (2026-11-26).
 *
 *   GET|POST /v1/crm/price-book-segments   (+ PUT/DELETE /:id)   — C5 price-book segment master
 *   GET|POST /v1/crm/price-book-channels   (+ PUT/DELETE /:id)   — C5 price-book channel master
 *   GET|POST /v1/crm/business-lines        (+ PUT/DELETE /:id)   — C6 business-line master
 *
 * All three reuse the shared code-master plumbing (routes validate + publish -> consumer
 * writes + audits in one transaction), exactly like service types / grievance categories.
 * Reads are open to every CRM role; writes to crm_admin / tenant_admin / super_admin.
 */
import type { FastifyInstance } from "fastify";
import type { Queue } from "@civitasone/queue";
import { COMMANDS } from "../../topics.js";
import { registerCodeMasterRoutes, registerCodeMasterConsumers, type CodeMasterConfig } from "../../shared/code-master.js";

export const PRICE_BOOK_SEGMENT_CFG: CodeMasterConfig = {
  path: "price-book-segments",
  table: "crm.price_book_segments",
  resource: "price_book_segment",
  noun: "price book segment",
  commands: {
    create: COMMANDS.createPriceBookSegment,
    update: COMMANDS.updatePriceBookSegment,
    remove: COMMANDS.deletePriceBookSegment,
  },
};

export const PRICE_BOOK_CHANNEL_CFG: CodeMasterConfig = {
  path: "price-book-channels",
  table: "crm.price_book_channels",
  resource: "price_book_channel",
  noun: "price book channel",
  commands: {
    create: COMMANDS.createPriceBookChannel,
    update: COMMANDS.updatePriceBookChannel,
    remove: COMMANDS.deletePriceBookChannel,
  },
};

export const BUSINESS_LINE_CFG: CodeMasterConfig = {
  path: "business-lines",
  table: "crm.business_lines",
  resource: "business_line",
  noun: "business line",
  commands: {
    create: COMMANDS.createBusinessLine,
    update: COMMANDS.updateBusinessLine,
    remove: COMMANDS.deleteBusinessLine,
  },
};

const ALL = [PRICE_BOOK_SEGMENT_CFG, PRICE_BOOK_CHANNEL_CFG, BUSINESS_LINE_CFG];

/**
 * Each master registers in its OWN encapsulated plugin scope: registerCodeMasterRoutes installs a
 * scope-level error handler, which must not be shared between masters.
 */
export async function mastersRoutes(app: FastifyInstance): Promise<void> {
  for (const cfg of ALL) {
    await app.register(async (child) => {
      await registerCodeMasterRoutes(child, cfg);
    });
  }
}

export const registerMastersConsumers = (queue: Queue): void => {
  for (const cfg of ALL) registerCodeMasterConsumers(queue, cfg);
};
