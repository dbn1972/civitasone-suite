import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";
import { schema as filesModule }      from "../modules/files/schema.js";
import { schema as committeeModule }  from "../modules/committee/schema.js";
import { schema as assetsModule }     from "../modules/assets/schema.js";
import { schema as facilitiesModule } from "../modules/facilities/schema.js";
import { schema as legalModule }      from "../modules/legal/schema.js";
import { schema as approvalRulesModule } from "../modules/approval-rules/schema.js";
import { schema as dfaModule }         from "../modules/dfa/schema.js";
import { schema as handoverModule }    from "../modules/handover/schema.js";
import { schema as migrationModule }   from "../modules/migration/schema.js";
import { schema as operatorsModule }   from "../modules/operators/schema.js";
import { outboxSchema }               from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://estab_svc:***@host/civitas_estab)");

export const sqlClient = createSqlClient(url);

export const db = drizzle(sqlClient, {
  schema: { ...filesModule, ...committeeModule, ...assetsModule, ...facilitiesModule, ...legalModule, ...approvalRulesModule, ...dfaModule, ...handoverModule, ...migrationModule, ...operatorsModule, ...outboxSchema },
});

export type Db = typeof db;
