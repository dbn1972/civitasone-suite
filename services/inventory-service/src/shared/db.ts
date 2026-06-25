/**
 * inventory-service DB connection.
 * Connects with the inventory_svc role to the civitas_inventory database ONLY (L1).
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";
import { schema as itemsModule } from "../modules/items/schema.js";
import { schema as storesModule } from "../modules/stores/schema.js";
import { schema as movementsModule } from "../modules/movements/schema.js";
import { outboxSchema } from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://inventory_svc:***@host/civitas_inventory)");

export const sqlClient = createSqlClient(url);

export const db = drizzle(sqlClient, {
  schema: { ...itemsModule, ...storesModule, ...movementsModule, ...outboxSchema },
});

export type Db = typeof db;
