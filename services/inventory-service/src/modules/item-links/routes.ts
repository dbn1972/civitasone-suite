/**
 * item-links HTTP routes -- the non-destructive cross-reference between the inventory item
 * master (sku) and the stock-service item master (itemCode), the single item picker, and the
 * unmatched-items report (GAP-INVENTORY-DETAIL-04 / GAP-INVENTORY-LIST-02).
 *
 * Reads are tenant-scoped. Writes are admin-gated and run through the queue (202 + command);
 * this file never writes the database.
 */
import type { FastifyInstance } from "fastify";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { hasAnyRole } from "@civitasone/auth";
import { resolveContext, requireRole, registerErrorHandler, HttpError } from "../../shared/context.js";
import {
  fetchStockItem, searchStockItems, fetchAllStockItems, fetchStockBalances, StockUnavailableError,
  type RemoteStockItem,
} from "../../shared/stock-client.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";
import { mergePicker, normalizeCode, suggestLinks, type InvItem, type LinkRef, type StockItem } from "./domain.js";
import {
  createItemLinkBody, linkListQuery, linkLookupQuery, pickerQuery, unmatchedQuery, idParam,
} from "./validators.js";
import type { ItemStockLinkRow } from "./schema.js";

/** Who may confirm / remove a link and see the unmatched report. */
const LINK_ROLES = ["inventory_manager", "inventory_admin", "super_admin"];
const WRITE_ROLES = ["inventory_user", "inventory_manager", "inventory_admin", "store_keeper", "super_admin"];
/**
 * Stock valuation (per-warehouse rate and value) is only returned to roles that may read it in
 * stock-service itself, or that need it for finance/audit/inventory management. Other readers get
 * the link and the item but no balances (the call to stock-service uses the service identity, so
 * this list is the access check).
 */
const BALANCE_ROLES = [
  "inventory_manager", "inventory_admin", "finance_officer", "audit_officer",
  "stock_manager", "stock_admin", "procurement_officer", "super_admin",
];
/** Readers include the stock-service roles, because the stock register uses the picker too. */
const READER_ROLES = [...WRITE_ROLES, "audit_officer", "finance_officer", "stock_manager", "stock_admin", "procurement_officer"];

function view(l: ItemStockLinkRow) {
  return {
    id: l.id, inventoryItemId: l.inventoryItemId, stockItemId: l.stockItemId,
    stockItemCode: l.stockItemCode, stockItemName: l.stockItemName,
    source: l.linkSource, linkedBy: l.linkedBy, linkedAt: l.linkedAt.toISOString(),
  };
}

const toLinkRef = (l: ItemStockLinkRow): LinkRef => ({
  id: l.id, inventoryItemId: l.inventoryItemId, stockItemId: l.stockItemId,
  stockItemCode: l.stockItemCode, stockItemName: l.stockItemName,
});

const toStock = (s: RemoteStockItem): StockItem => ({ id: s.id, code: s.code, name: s.name });

/** stock-service being down is a 503 for the caller, never "not found" and never an empty list. */
async function withStock<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof StockUnavailableError) throw new HttpError(503, "STOCK_UNAVAILABLE", "the stock service is not reachable right now");
    throw err;
  }
}

export async function itemLinkRoutes(app: FastifyInstance): Promise<void> {
  // ── Create a link (admin confirms a typed pair or an auto-suggestion) ──────────────
  app.post("/v1/inventory/item-links", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LINK_ROLES);
    const body = createItemLinkBody.parse(req.body);

    const inv = await repo.findInventoryItem(ctx.tenantId, body.inventoryItemId);
    if (!inv) throw new HttpError(404, "NOT_FOUND", "inventory item not found");
    const stock = await withStock(() => fetchStockItem(ctx.tenantId, body.stockItemId));
    if (!stock) throw new HttpError(404, "STOCK_ITEM_NOT_FOUND", "stock item not found");

    // At most one link each way. The unique indexes are the real guard (a concurrent link loses
    // there); these pre-checks give the caller a clear 409 instead of a silent dead-letter.
    if (await repo.findLinkByInventory(ctx.tenantId, inv.id)) {
      throw new HttpError(409, "INVENTORY_ITEM_ALREADY_LINKED", "this inventory item is already linked to a stock item");
    }
    if (await repo.findLinkByStock(ctx.tenantId, stock.id)) {
      throw new HttpError(409, "STOCK_ITEM_ALREADY_LINKED", "this stock item is already linked to an inventory item");
    }
    // A "suggested" confirmation must really be an exact code/sku match -- the server decides, not the client.
    if (body.source === "suggested" && (normalizeCode(inv.sku) === "" || normalizeCode(inv.sku) !== normalizeCode(stock.code))) {
      throw new HttpError(409, "NOT_AN_EXACT_MATCH", "the sku and the stock code are not an exact match, link them manually instead");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.createItemLink(ctx, body, stock));
  });

  // ── Remove a link (the items themselves are never touched) ─────────────────────────
  app.delete("/v1/inventory/item-links/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LINK_ROLES);
    const { id } = idParam.parse(req.params);
    if (!(await repo.findLink(ctx.tenantId, id))) throw new HttpError(404, "NOT_FOUND", "item link not found");
    return sendAccepted(reply, acceptedResponseSchema, await commands.removeItemLink(ctx, id));
  });

  app.get("/v1/inventory/item-links", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = linkListQuery.parse(req.query);
    const { rows, total } = await repo.listLinks(ctx.tenantId, q.limit, q.offset);
    return reply.send({ data: rows.map(view), total, pagination: { hasMore: q.offset + rows.length < total, pageSize: q.limit } });
  });

  // One link by either side (the stock register resolves its stock id to the linked inventory item).
  app.get("/v1/inventory/item-links/lookup", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = linkLookupQuery.parse(req.query);
    const link = q.inventoryItemId !== undefined
      ? await repo.findLinkByInventory(ctx.tenantId, q.inventoryItemId)
      : await repo.findLinkByStock(ctx.tenantId, q.stockItemId as string);
    return reply.send({ data: link ? view(link) : null });
  });

  // ── Auto-suggest: exact, unambiguous sku <-> code matches among unlinked items ─────
  app.get("/v1/inventory/item-links/suggestions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LINK_ROLES);
    const [{ rows: inv }, links, stock] = await Promise.all([
      repo.listActiveInventoryItems(ctx.tenantId, 5000),
      repo.allLinks(ctx.tenantId),
      withStock(() => fetchAllStockItems(ctx.tenantId)),
    ]);
    const { suggestions, ambiguous } = suggestLinks(inv, stock.items.map(toStock), links);
    return reply.send({ data: suggestions, ambiguous, truncated: stock.truncated });
  });

  // ── Admin report: items that exist on one side only ────────────────────────────────
  app.get("/v1/inventory/item-links/unmatched", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LINK_ROLES);
    const q = unmatchedQuery.parse(req.query);
    const [{ rows: inv, total: invTotal }, links] = await Promise.all([
      repo.listActiveInventoryItems(ctx.tenantId, 5000),
      repo.allLinks(ctx.tenantId),
    ]);
    let stockItems: StockItem[] | null = null;
    let stockTruncated = false;
    try {
      const all = await fetchAllStockItems(ctx.tenantId);
      stockItems = all.items.map(toStock);
      stockTruncated = all.truncated;
    } catch (err) {
      if (!(err instanceof StockUnavailableError)) throw err;
    }
    const linkedInv = new Set(links.map((l) => l.inventoryItemId));
    const linkedStock = new Set(links.map((l) => l.stockItemId));
    const { suggestions, ambiguous } = suggestLinks(inv, stockItems ?? [], links);
    const suggestedInv = new Set(suggestions.map((s) => s.inventoryItemId));
    const suggestedStock = new Set(suggestions.map((s) => s.stockItemId));

    const inventoryOnly = inv.filter((i) => !linkedInv.has(i.id));
    const stockOnly = stockItems ? stockItems.filter((s) => !linkedStock.has(s.id)) : null;
    return reply.send({
      data: {
        inventoryOnly: inventoryOnly.slice(0, q.limit).map((i) => ({ id: i.id, name: i.name, sku: i.sku, hasSuggestion: suggestedInv.has(i.id) })),
        stockOnly: stockOnly ? stockOnly.slice(0, q.limit).map((s) => ({ id: s.id, code: s.code, name: s.name, hasSuggestion: suggestedStock.has(s.id) })) : null,
      },
      counts: {
        inventoryTotal: invTotal,
        inventoryLinked: inv.length - inventoryOnly.length,
        inventoryUnlinked: inventoryOnly.length,
        stockTotal: stockItems ? stockItems.length : null,
        stockLinked: stockItems && stockOnly ? stockItems.length - stockOnly.length : null,
        stockUnlinked: stockOnly ? stockOnly.length : null,
        suggestions: suggestions.length,
        ambiguous,
      },
      stockAvailable: stockItems !== null,
      truncated: stockTruncated || inv.length < invTotal,
    });
  });

  // ── Item detail: the linked stock-side item and its balances ───────────────────────
  app.get("/v1/inventory/items/:id/stock-link", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const inv = await repo.findInventoryItem(ctx.tenantId, id);
    if (!inv) throw new HttpError(404, "NOT_FOUND", "item not found");
    const link = await repo.findLinkByInventory(ctx.tenantId, id);

    if (!link) {
      // Not linked: offer the exact-code suggestion (if any) so an admin can confirm it in one click.
      let suggestion: { stockItemId: string; stockItemCode: string; stockItemName: string } | null = null;
      let suggestionAvailable = true;
      if (normalizeCode(inv.sku) !== "") {
        try {
          const hits = await searchStockItems(ctx.tenantId, (inv.sku ?? "").trim(), 50);
          const exact = hits.filter((s) => normalizeCode(s.code) === normalizeCode(inv.sku));
          const only = exact.length === 1 ? exact[0] : undefined;
          if (only && !(await repo.findLinkByStock(ctx.tenantId, only.id))) {
            suggestion = { stockItemId: only.id, stockItemCode: only.code, stockItemName: only.name };
          }
        } catch (err) {
          if (!(err instanceof StockUnavailableError)) throw err;
          suggestionAvailable = false; // "could not check" must not read as "no suggestion"
        }
      }
      return reply.send({ data: { inventoryItemId: id, linked: false, link: null, stock: null, stockAvailable: suggestionAvailable, suggestion } });
    }

    const canSeeBalances = hasAnyRole(ctx, BALANCE_ROLES);
    try {
      const [item, balances] = await Promise.all([
        fetchStockItem(ctx.tenantId, link.stockItemId),
        canSeeBalances ? fetchStockBalances(ctx.tenantId, link.stockItemId) : Promise.resolve(null),
      ]);
      return reply.send({ data: { inventoryItemId: id, linked: true, link: view(link), stock: { item, balances }, stockAvailable: true, suggestion: null } });
    } catch (err) {
      if (!(err instanceof StockUnavailableError)) throw err;
      // The link is still real and shown from its snapshot; only the live balances are unavailable.
      return reply.send({ data: { inventoryItemId: id, linked: true, link: view(link), stock: null, stockAvailable: false, suggestion: null } });
    }
  });

  // ── Single item picker: both masters, a linked pair is ONE entry ────────────────────
  app.get("/v1/inventory/item-picker", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = pickerQuery.parse(req.query);

    const invHits = await repo.searchInventoryItems(ctx.tenantId, q.q, q.limit);
    let stockHits: StockItem[] = [];
    let stockAvailable = true;
    try {
      stockHits = (await searchStockItems(ctx.tenantId, q.q, q.limit)).map(toStock);
    } catch (err) {
      if (!(err instanceof StockUnavailableError)) throw err;
      stockAvailable = false;
    }

    const [linksOfInv, linksOfStock] = await Promise.all([
      repo.linksForInventoryIds(ctx.tenantId, invHits.map((i) => i.id)),
      repo.linksForStockIds(ctx.tenantId, stockHits.map((s) => s.id)),
    ]);
    const linkRows = new Map<string, ItemStockLinkRow>();
    for (const l of [...linksOfInv, ...linksOfStock]) linkRows.set(l.id, l);
    const links = [...linkRows.values()].map(toLinkRef);
    const partners = await repo.inventoryItemsByIds(ctx.tenantId, links.map((l) => l.inventoryItemId));
    const invById = new Map<string, InvItem>([...invHits, ...partners].map((i) => [i.id, i]));

    let entries = mergePicker(invHits, stockHits, links, invById);
    if (q.masters === "stock") entries = entries.filter((e) => e.stockItemId !== null);
    return reply.send({ data: entries.slice(0, q.limit), stockAvailable });
  });

  registerErrorHandler(app);
}
