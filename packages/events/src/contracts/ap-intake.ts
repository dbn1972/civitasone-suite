/**
 * UAT bundle 10 (F93/F94/F95; T6-05/06/07): shared contracts for the two
 * supply-chain hand-offs that used to break silently between services.
 *
 *   - `finance.bill.create` (command, handled by finance-service). Producers:
 *     works-service (DO-finalized RA bill) and finance-service itself (the
 *     procurement.grn.accepted to AP-bill integration).
 *   - `procurement.grn.accepted` (event, owned by procurement-service).
 *     Consumers: finance, inventory, asset, stock and notification.
 *
 * Producers build their payload through these contracts and consumers validate
 * against the same definition, so a shape drift (a vendor code where a uuid is
 * required, a number where the wire carries a money string, a PO line id read
 * as a stock item id) fails a contract test instead of dead-lettering at run
 * time.
 *
 * House rules: money is a string on the wire, in a field ending in "Minor".
 * The money codec also reads a legacy JSON integer (tolerant reader). Unknown
 * keys pass through.
 */
import { z } from "zod";
import { zMoneyMinorStringNonNeg } from "@civitasone/schemas/money";
import { defineContract } from "./define.js";

const zUuid = z.string().uuid();

/**
 * finance.bill.create v1.1.
 *
 * The bill head is given EITHER as `headCode` (resolved by finance against the
 * bill tenant's own chart, which is what every producer should send) OR as a
 * legacy `headId`. One of the two is required; finance-service checks that,
 * because a cross-field rule is not part of the walker subset.
 * `vendorId` is the finance vendor-master uuid of the payee. A namespaced
 * string such as "works_award:<id>" is not a vendor.
 */
export const financeBillCreate = defineContract({
  topic: "finance.bill.create",
  kind: "command",
  owner: "finance-service",
  version: "1.1",
  consumers: ["finance-service"],
  pii: ["contractorName"],
  schema: z.object({
    id: zUuid,
    tenantId: zUuid,
    billNo: z.string().min(1).optional(),
    vendorId: zUuid,
    headId: zUuid.optional(),
    headCode: z.string().min(1).max(64).optional(),
    grossMinor: zMoneyMinorStringNonNeg,
    netMinor: zMoneyMinorStringNonNeg,
    currency: z.string().length(3).optional(),
    deductions: z.array(z.object({
      type: z.string().min(1),
      amountMinor: zMoneyMinorStringNonNeg,
      description: z.string().optional(),
    })).optional(),
    ddoCode: z.string().optional(),
    paoCode: z.string().optional(),
    sanctionRef: z.string().optional(),
    poRef: z.string().optional(),
    poNumber: z.string().optional(),
    grnRef: z.string().optional(),
    billDate: z.string().optional(),
    poAmountMinor: zMoneyMinorStringNonNeg.optional(),
    grnAmountMinor: zMoneyMinorStringNonNeg.optional(),
    // works-service extras (display and back-links only).
    workId: zUuid.optional(),
    worksBillId: zUuid.optional(),
    contractorName: z.string().nullable().optional(),
  }),
});

/**
 * finance.bill.rejected v1.0: finance could not create the bill a producer
 * asked for. Carries a stable refusal `code` so the producer can show "not
 * accepted by finance, and why" instead of waiting for a bill that never comes.
 */
export const financeBillRejected = defineContract({
  topic: "finance.bill.rejected",
  kind: "event",
  owner: "finance-service",
  version: "1.0",
  consumers: ["works-service"],
  pii: [],
  schema: z.object({
    billId: z.string().min(1),
    code: z.string().min(1),
    reason: z.string(),
    poRef: z.string().optional(),
    grnRef: z.string().optional(),
    worksBillId: z.string().optional(),
  }),
});

/**
 * procurement.grn.accepted v1.1.
 *
 * Item identity: `itemCode` is the business key that every consumer shares
 * (inventory resolves its stock item by SKU = itemCode). `poItemId` is the
 * procurement PO line id. `itemId` is kept only as a legacy alias of
 * `poItemId`; it is NOT an inventory item id.
 * `storeId` is the receiving store recorded on the GRN; inventory needs it to
 * post a stock receipt.
 */
export const procurementGrnAccepted = defineContract({
  topic: "procurement.grn.accepted",
  kind: "event",
  owner: "procurement-service",
  version: "1.1",
  consumers: ["finance-service", "inventory-service", "asset-service", "stock-service", "notification-service"],
  pii: [],
  schema: z.object({
    grnId: zUuid,
    poRef: z.string().min(1),
    poNo: z.string().optional(),
    vendorId: zUuid,
    storeId: zUuid.optional(),
    grossMinor: zMoneyMinorStringNonNeg,
    poAmountMinor: zMoneyMinorStringNonNeg,
    grnAmountMinor: zMoneyMinorStringNonNeg,
    items: z.array(z.object({
      itemCode: z.string().min(1),
      itemName: z.string(),
      acceptedQty: z.number().int().nonnegative(),
      rateMinor: zMoneyMinorStringNonNeg,
      currency: z.string().length(3),
      itemType: z.string().min(1),
      poItemId: z.string().optional(),
      itemId: z.string().optional(),
    })),
  }),
});

export const apIntakeContracts = [financeBillCreate, financeBillRejected, procurementGrnAccepted] as const;
