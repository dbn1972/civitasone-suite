/**
 * inventory-service DB connection.
 * Connects with the inventory_svc role to the civitas_inventory database ONLY (L1).
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient, wrapWithTenantGuc } from "@civitasone/db";
import { schema as itemsModule } from "../modules/items/schema.js";
import { schema as storesModule } from "../modules/stores/schema.js";
import { schema as movementsModule } from "../modules/movements/schema.js";
import { schema as batchesModule } from "../modules/batches/schema.js";
import { schema as cycleCountModule } from "../modules/cycle-count/schema.js";
import { schema as matchingModule } from "../modules/matching/schema.js";
import { outboxSchema } from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://inventory_svc:***@host/civitas_inventory)");

export const sqlClient = createSqlClient(url);

const _rawDb = drizzle(sqlClient, {
  schema: { ...itemsModule, ...storesModule, ...movementsModule, ...batchesModule, ...cycleCountModule, ...matchingModule, ...outboxSchema },
});

export const db = wrapWithTenantGuc(_rawDb);
export type Db = typeof _rawDb;
