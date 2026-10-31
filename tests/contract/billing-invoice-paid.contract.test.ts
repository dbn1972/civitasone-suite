/**
 * F92 (UAT T6-04) -- producer/consumer contract for billing.invoice.paid.
 *
 * billing-service emits it from two settle paths with `{ invoiceId, totalMinor }`; finance-service's revenue-billing
 * consumer read `paidMinor`, a field no producer sends, so every paid invoice died on BigInt(undefined). Neither
 * service's own suite could see it. This reads the payload keys each producer actually builds (from source) and feeds
 * that exact shape to finance's reader: a rename on either side fails here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { invoicePaidAmountMinor } from "../../services/finance-service/src/modules/revenue-billing/payload.js";

const ROOT = process.cwd();
const PRODUCERS = [
  "services/billing-service/src/modules/payments/consumer.ts",
  "services/billing-service/src/modules/invoice-ops/consumer.ts",
];

/** The keys of the `payload: { ... }` object of every enqueue whose topic is EVENTS.invoicePaid in `file`. */
function invoicePaidPayloadKeys(file: string): string[][] {
  const text = readFileSync(join(ROOT, file), "utf8");
  const shapes: string[][] = [];
  for (const m of text.matchAll(/topic:\s*EVENTS\.invoicePaid\b[\s\S]*?payload:\s*\{([^}]*)\}/g)) {
    const body = m[1]!;
    shapes.push([...body.matchAll(/(?:^|,)\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?::|,|$)/g)].map((k) => k[1]!));
  }
  return shapes;
}

describe("billing.invoice.paid contract (billing-service -> finance-service)", () => {
  for (const file of PRODUCERS) {
    it(`finance reads the amount from the payload ${file.split("/").slice(-2).join("/")} sends`, () => {
      const shapes = invoicePaidPayloadKeys(file);
      expect(shapes.length).toBeGreaterThan(0); // the producer really emits it here
      for (const keys of shapes) {
        expect(keys).toContain("invoiceId");
        const sample: Record<string, unknown> = Object.fromEntries(keys.map((k) => [k, k === "invoiceId" ? "inv-1" : "123456"]));
        expect(invoicePaidAmountMinor(sample)).toBe(123456n);
      }
    });
  }
});
