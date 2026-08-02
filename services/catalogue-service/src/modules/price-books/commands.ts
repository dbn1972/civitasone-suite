/**
 * price-books/commands.ts — publishes price-book mutation commands. No DB writes.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function createPriceBook(
  ctx: RequestContext,
  body: {
    name: string;
    segment: string;
    currency: string;
    geography: Record<string, unknown>;
    effectiveFrom: string;
    effectiveTo: string | null;
    status: string;
  },
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.createPriceBook, id, { id, ...body });
}

export async function updatePriceBook(
  ctx: RequestContext,
  id: string,
  body: { version: number; patch: Record<string, unknown> },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.updatePriceBook, id, { id, ...body });
}

export async function replacePriceBookEntries(
  ctx: RequestContext,
  priceBookId: string,
  body: {
    entries: Array<{
      id: string;
      productId: string;
      amountMinor: string;
      currency: string;
    }>;
    totalAmountMinor: string;
  },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.replacePriceBookEntries, priceBookId, { priceBookId, ...body });
}
