import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";
import { schema as contractsModule } from "../modules/contracts/schema.js";
import { schema as rateModule }      from "../modules/rate/schema.js";
import { schema as clausesModule }   from "../modules/clauses/schema.js";
import { schema as versionsModule }  from "../modules/versions/schema.js";
import { schema as obligationsModule } from "../modules/obligations/schema.js";
import { schema as renewalsModule }    from "../modules/renewals/schema.js";
import { schema as approvalsModule }   from "../modules/approvals/schema.js";
import { schema as esignModule }       from "../modules/esign/schema.js";
import { outboxSchema }              from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://contract_svc:***@host/civitas_contract)");

export const sqlClient = createSqlClient(url);

export const db = drizzle(sqlClient, {
  schema: { ...contractsModule, ...rateModule, ...clausesModule, ...versionsModule, ...obligationsModule, ...renewalsModule, ...approvalsModule, ...esignModule, ...outboxSchema },
});

export type Db = typeof db;
