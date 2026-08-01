/** QP-001 reads that key on the tenant-unique product_code. */
import { eq, and } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { products, type ProductRow } from "./schema.js";

export async function findByProductCode(productCode: string, tenantId: string): Promise<ProductRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.productCode, productCode)))
      .limit(1),
  );
  return rows[0] ?? null;
}
