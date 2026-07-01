import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";
import { schema as itemModule }       from "../modules/item/schema.js";
import { schema as warehouseModule }  from "../modules/warehouse/schema.js";
import { schema as ledgerModule }     from "../modules/ledger/schema.js";
import { schema as entryModule }      from "../modules/entry/schema.js";
import { schema as valuationModule }  from "../modules/valuation/schema.js";
import { schema as receiptModule }    from "../modules/receipt/schema.js";
import { schema as ewayBillModule }   from "../modules/eway-bill/schema.js";
import { outboxSchema }               from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://stock_svc:***@host/civitas_stock)");

export const sqlClient = createSqlClient(url);

export const db = drizzle(sqlClient, {
  schema: { ...itemModule, ...warehouseModule, ...ledgerModule, ...entryModule, ...valuationModule, ...receiptModule, ...ewayBillModule, ...outboxSchema },
});

export type Db = typeof db;
