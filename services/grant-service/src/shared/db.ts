import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";
import { schema as schemeModule }       from "../modules/scheme/schema.js";
import { schema as applicationModule }  from "../modules/application/schema.js";
import { schema as disbursementModule } from "../modules/disbursement/schema.js";
import { schema as utilisationModule }  from "../modules/utilisation/schema.js";
import { schema as beneficiaryModule }  from "../modules/beneficiary/schema.js";
import { outboxSchema }                  from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://grant_svc:***@host/civitas_grant)");

export const sqlClient = createSqlClient(url);

export const db = drizzle(sqlClient, {
  schema: {
    ...schemeModule,
    ...applicationModule,
    ...disbursementModule,
    ...utilisationModule,
    ...beneficiaryModule,
    ...outboxSchema,
  },
});

export type Db = typeof db;
